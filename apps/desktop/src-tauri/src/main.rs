// zerokit 桌面壳。
//
// 这里**只做宿主该做的事**：全局热键、托盘、无边框窗口、以及把 Node 内核当子进程管起来。
// 所有业务（插件、执行、CLI、MCP、界面）都在内核里，所以这个壳很薄，
// 而且前端不需要为「进壳」重写一遍——窗口加载的就是内核的本地地址。
//
// 环境变量：
//   ZEROKIT_CORE      指定内核入口（src/server.ts），不给就按目录布局自动找
//   ZEROKIT_AUTOHIDE  设为 0 关闭「失焦自动隐藏」（默认开启，对齐 uTools 的体感）

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// 内核对进程。stdin 要一直握着不能丢：
/// 它一被 drop 管道就关了，内核会以为宿主死了而退出。
/// 反过来，正因为它握着，宿主无论怎么死内核都会跟着退出，不留孤儿。
struct CoreProcess(Mutex<Option<(Child, Option<std::process::ChildStdin>)>>);

#[cfg(windows)]
fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console(_cmd: &mut Command) {}

/// 找 node。Windows 上 PATH 经常不可靠，所以再兜几个常见安装目录。
fn find_node() -> Option<PathBuf> {
    let exe = if cfg!(windows) { "node.exe" } else { "node" };

    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(exe);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    let mut fallbacks: Vec<PathBuf> = Vec::new();
    if cfg!(windows) {
        for var in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Ok(base) = std::env::var(var) {
                fallbacks.push(PathBuf::from(&base).join("nodejs").join(exe));
                // 便携版常被解到 Program Files\software\<版本目录> 下
                let portable = PathBuf::from(&base).join("software");
                if let Ok(entries) = std::fs::read_dir(&portable) {
                    for entry in entries.flatten() {
                        fallbacks.push(entry.path().join(exe));
                    }
                }
            }
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            fallbacks.push(PathBuf::from(local).join("Programs").join("nodejs").join(exe));
        }
    } else {
        fallbacks.push(PathBuf::from("/usr/local/bin/node"));
        fallbacks.push(PathBuf::from("/usr/bin/node"));
    }
    fallbacks.into_iter().find(|p| p.is_file())
}

/// 找内核入口 src/server.ts：环境变量优先，其次从可执行文件往上找仓库根目录。
fn find_core_script() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("ZEROKIT_CORE") {
        let p = PathBuf::from(explicit);
        if p.is_file() {
            return Some(p);
        }
    }

    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        roots.push(exe);
    }
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd.join("x"));
    }

    for start in roots {
        let mut dir: Option<&Path> = start.parent();
        // 一路往上找，覆盖 dev（target/debug）和打包后（resources 旁边）两种布局
        for _ in 0..6 {
            let Some(d) = dir else { break };
            let candidate = d.join("src").join("server.ts");
            if candidate.is_file() {
                return Some(candidate);
            }
            dir = d.parent();
        }
    }
    None
}

/// 拉起内核，返回它监听的地址、子进程句柄、以及 stdin（必须一直握着）
fn start_core() -> Result<(String, Child, Option<std::process::ChildStdin>), String> {
    let node = find_node().ok_or_else(|| {
        "找不到 node。请先安装 Node.js：winget install OpenJS.NodeJS.LTS".to_string()
    })?;
    let script = find_core_script().ok_or_else(|| {
        format!(
            "找不到内核入口 src/server.ts。\n找过的位置从这些目录往上六级。\n\
             可以用环境变量 ZEROKIT_CORE 直接指定它的完整路径。"
        )
    })?;

    let mut cmd = Command::new(&node);
    cmd.arg(&script)
        .arg("ui")
        .arg("--port")
        .arg("0") // 让内核自己选空闲端口，避免和别的实例撞
        .arg("--exit-on-stdin-close")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::piped());
    hide_console(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动内核失败：{e}\nnode 路径：{}", node.display()))?;

    // stdout 必须**一直读到 EOF**，绝不能拿到地址就把读取端关掉：
    // 子进程之后再写一行就会拿到 EPIPE，Node 会当成未捕获异常直接退出。
    let stdout = child.stdout.take().ok_or("拿不到内核的输出管道")?;
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let _ = tx.send(line);
        }
    });

    // stderr 也收着，启动失败时能把它原样显示给用户，而不是只说一句"超时"
    let stderr = child.stderr.take();
    let err_buf = std::sync::Arc::new(Mutex::new(String::new()));
    if let Some(stderr) = stderr {
        let sink = err_buf.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let mut buf = sink.lock().unwrap();
                if buf.len() < 4000 {
                    buf.push_str(&line);
                    buf.push('\n');
                }
            }
        });
    }

    let deadline = std::time::Instant::now() + Duration::from_secs(40);
    let mut found: Option<String> = None;
    while std::time::Instant::now() < deadline {
        let left = deadline.saturating_duration_since(std::time::Instant::now());
        match rx.recv_timeout(left) {
            Ok(line) => {
                // 优先认机器可读的 zerokit-ready 行，退而求其次找 http://
                let candidate = if line.starts_with("zerokit-ready ") {
                    serde_json::from_str::<serde_json::Value>(line.trim_start_matches("zerokit-ready "))
                        .ok()
                        .and_then(|v| v.get("url").and_then(|u| u.as_str()).map(str::to_string))
                } else {
                    line.find("http://").map(|i| line[i..].trim().to_string())
                };
                if let Some(url) = candidate {
                    found = Some(url);
                    break;
                }
            }
            Err(_) => break,
        }
    }

    let stdin = child.stdin.take();
    match found {
        Some(url) => Ok((url, child, stdin)),
        None => {
            let _ = child.kill();
            let detail = err_buf.lock().unwrap().clone();
            Err(format!(
                "内核启动超时（40 秒）。{}\n\
                 可以手动跑一次看完整报错：\n  node src/server.ts ui --port 28900",
                if detail.trim().is_empty() {
                    "它没有输出任何错误信息。".to_string()
                } else {
                    format!("\n它的输出：\n{detail}")
                }
            ))
        }
    }
}

/// 桌面壳自己的配置（~/.zerokit/desktop.json）。
/// 与内核数据同目录：删掉 ~/.zerokit 就是完全重置，这条约定对壳同样成立。
#[derive(serde::Serialize, serde::Deserialize, Default, Clone)]
struct DesktopConfig {
    /// 窗口位置与尺寸记忆（物理像素）。None = 没记过，走默认居中。
    window: Option<WindowGeom>,
    /// 用户自选热键（如 "Alt+Space"）。None = 走内置候选列表。
    #[serde(default)]
    hotkey: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Copy)]
struct WindowGeom {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

/// 壳数据根目录：ZEROKIT_HOME 优先（与内核同一约定，隔离验证靠它），
/// 没设才落到用户主目录下的 .zerokit。
fn data_root() -> Option<PathBuf> {
    if let Ok(h) = std::env::var("ZEROKIT_HOME") {
        return Some(PathBuf::from(h));
    }
    home_dir().map(|p| p.join(".zerokit"))
}

fn config_path() -> Option<PathBuf> {
    data_root().map(|p| p.join("desktop.json"))
}

fn load_config() -> DesktopConfig {
    let Some(path) = config_path() else { return DesktopConfig::default() };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_config(cfg: &DesktopConfig) {
    let Some(path) = config_path() else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(path, serde_json::to_string_pretty(cfg).unwrap_or_default());
}

/// 把 "Alt+Z" 这类字符串解析成 Shortcut。不认识的组合返回 None——
/// 宁可不注册也不能崩：热键是入口，不是功能本体。
fn parse_hotkey(s: &str) -> Option<Shortcut> {
    let mut mods = Modifiers::empty();
    let mut code: Option<Code> = None;
    for part in s.split('+').map(str::trim) {
        if part.is_empty() {
            continue;
        }
        let part = part.to_ascii_lowercase();
        match part.as_str() {
            "alt" | "option" => mods |= Modifiers::ALT,
            "ctrl" | "control" | "cmd" | "meta" | "super" => mods |= Modifiers::CONTROL,
            "shift" => mods |= Modifiers::SHIFT,
            other => {
                code = match other {
                    "space" => Some(Code::Space),
                    "a" => Some(Code::KeyA), "b" => Some(Code::KeyB), "c" => Some(Code::KeyC),
                    "d" => Some(Code::KeyD), "e" => Some(Code::KeyE), "f" => Some(Code::KeyF),
                    "g" => Some(Code::KeyG), "h" => Some(Code::KeyH), "i" => Some(Code::KeyI),
                    "j" => Some(Code::KeyJ), "k" => Some(Code::KeyK), "l" => Some(Code::KeyL),
                    "m" => Some(Code::KeyM), "n" => Some(Code::KeyN), "o" => Some(Code::KeyO),
                    "p" => Some(Code::KeyP), "q" => Some(Code::KeyQ), "r" => Some(Code::KeyR),
                    "s" => Some(Code::KeyS), "t" => Some(Code::KeyT), "u" => Some(Code::KeyU),
                    "v" => Some(Code::KeyV), "w" => Some(Code::KeyW), "x" => Some(Code::KeyX),
                    "y" => Some(Code::KeyY), "z" => Some(Code::KeyZ),
                    "1" => Some(Code::Digit1), "2" => Some(Code::Digit2), "3" => Some(Code::Digit3),
                    "4" => Some(Code::Digit4), "5" => Some(Code::Digit5), "6" => Some(Code::Digit6),
                    "7" => Some(Code::Digit7), "8" => Some(Code::Digit8), "9" => Some(Code::Digit9),
                    "0" => Some(Code::Digit0),
                    "comma" => Some(Code::Comma), "period" => Some(Code::Period),
                    "slash" => Some(Code::Slash), "grave" => Some(Code::Backquote),
                    _ => None,
                };
                if code.is_none() {
                    return None;
                }
            }
        }
    }
    code.map(|c| Shortcut::new(Some(mods), c))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hotkey_parse_roundtrip() {
        assert!(parse_hotkey("Alt+Space").is_some());
        assert!(parse_hotkey("Ctrl+Alt+Z").is_some());
        assert!(parse_hotkey("alt+z").is_some()); // 大小写不敏感
        assert!(parse_hotkey("Shift+/").is_none()); // 暂不支持的键要有边界
        assert!(parse_hotkey("").is_none());
        assert!(parse_hotkey("Alt+Nonsense").is_none());
    }

    #[test]
    fn config_roundtrip() {
        let cfg = DesktopConfig {
            window: Some(WindowGeom { x: 10, y: 20, width: 880, height: 640 }),
            hotkey: Some("Ctrl+Alt+Space".into()),
        };
        let s = serde_json::to_string(&cfg).unwrap();
        let back: DesktopConfig = serde_json::from_str(&s).unwrap();
        assert_eq!(back.window.unwrap().x, 10);
        assert_eq!(back.hotkey.as_deref(), Some("Ctrl+Alt+Space"));
        // 旧配置（没有 hotkey 字段）也要能读
        let legacy: DesktopConfig = serde_json::from_str(r#"{"window":null}"#).unwrap();
        assert!(legacy.hotkey.is_none());
    }
}


fn toggle_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        save_window_geom(app); // 隐藏前记下位置——下次呼出还原
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// ④窗口记忆：把当前窗口几何写进 desktop.json（与热键配置同文件）。
/// 读不到就静默跳过——记忆失败不该影响任何功能。
fn save_window_geom(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    // 统一存 logical 坐标：builder.position/inner_size 吃的都是 logical，
    // 而 outer_position/inner_size() 返回 physical——在 Retina 上差 2 倍，
    // 混用会导致「记住的位置一次比一次远」。
    let scale = window.scale_factor().unwrap_or(1.0);
    let to_logical = |v: f64| (v / scale).round() as i32;
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.inner_size()) else { return };
    let mut cfg = load_config();
    cfg.window = Some(WindowGeom {
        x: to_logical(pos.x as f64),
        y: to_logical(pos.y as f64),
        width: (size.width as f64 / scale).round() as u32,
        height: (size.height as f64 / scale).round() as u32,
    });
    save_config(&cfg);
}

/// 在窗口里显示一条错误（内核没起来时用）
fn show_error(app: &AppHandle, message: &str) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let escaped = serde_json::to_string(message).unwrap_or_else(|_| "\"出错了\"".into());
    let _ = window.eval(format!(
        "document.body.innerHTML = \
         '<div style=\"max-width:640px;line-height:1.7\">' + \
         '<div style=\"color:#f0685f;font-weight:600;margin-bottom:10px\">zerokit 内核没能启动</div>' + \
         '<pre style=\"white-space:pre-wrap;font-size:12.5px;color:#c3cad6\">{}</pre>' + \
         '<div style=\"margin-top:14px;color:#6d7684;font-size:12px\">' + \
         '内核是独立的：你也可以不开这个窗口，直接用命令行（zkit）或让 AI 客户端走 MCP。' + \
         '</div></div>';",
        escaped.replace('\\', "\\\\").replace('\'', "\\'")
    ));
    let _ = window.show();
    let _ = window.set_focus();
}

fn main() {
    let boot_config = load_config();
    tauri::Builder::default()
        .manage(CoreProcess(Mutex::new(None)))
        .setup(move |app| {
            let handle = app.handle().clone();

            // 先把窗口建出来指向「启动中」占位页，再拉内核——
            // 这样即使内核起得慢，用户也能立刻看到反应，而不是点了没动静。
            // ④窗口记忆：上次关时的位置尺寸优先于默认居中。
            let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("zerokit")
                .min_inner_size(520.0, 360.0)
                .decorations(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(true)
                .visible(true)
                .focused(true)
                // ⑧外部链接一律挡在壳外：窗口只承载内核 UI（本地地址），
                // 其它目标转交系统浏览器——壳一旦导航走就「丢壳」了
                // （无边框窗口没有地址栏，用户回不来）。
                .on_navigation(|url| {
                    let s = url.as_str();
                    s.starts_with("http://127.0.0.1")
                        || s.starts_with("http://localhost")
                        || s.starts_with("http://[::1]")
                        || s.starts_with("tauri://")
                        || s.starts_with("asset://")
                        || s == "about:blank"
                });
            match boot_config.window {
                Some(g) => {
                    builder = builder
                        .inner_size(g.width as f64, g.height as f64)
                        .position(g.x as f64, g.y as f64);
                }
                None => {
                    builder = builder.inner_size(880.0, 640.0).center();
                }
            }
            let window = builder.build()?;

            // 居中放在窗口完全建好之后再干：实测在 setup 里立刻设置位置会被窗口管理器覆盖掉
            // （窗口会贴到屏幕右下角）。这里延迟一小会儿，并按主显示器自己算位置。
            // 只有没记过位置时才走默认居中；记过就尊重用户的选择。
            if boot_config.window.is_none() {
                let win = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(400));
                    match (win.primary_monitor(), win.outer_size()) {
                        (Ok(Some(monitor)), Ok(size)) => {
                            let mpos = monitor.position();
                            let msize = monitor.size();
                            let x = mpos.x + ((msize.width as i32 - size.width as i32) / 2).max(0);
                            let y = mpos.y + ((msize.height as i32 - size.height as i32) / 3).max(0);
                            let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
                            if std::env::var("ZEROKIT_DEBUG").is_ok() {
                                eprintln!(
                                    "显示器 {}x{}，窗口 {}x{}，放到 ({x}, {y})",
                                    msize.width, msize.height, size.width, size.height
                                );
                            }
                        }
                        other => eprintln!("拿不到显示器信息：{:?}", other.0.is_err() || other.1.is_err()),
                    }
                });
            }

            // 失焦自动隐藏：这是 uTools 那种「呼出即用、点走即走」体感的关键
            let autohide = std::env::var("ZEROKIT_AUTOHIDE").map(|v| v != "0").unwrap_or(true);
            let w = window.clone();
            let app_for_geom = handle.clone();
            window.on_window_event(move |event| {
                if autohide {
                    if let tauri::WindowEvent::Focused(false) = event {
                        save_window_geom(&app_for_geom);
                        let _ = w.hide();
                    }
                }
                // ④窗口记忆兜底：移动/缩放结束就落盘——崩溃或被 kill 也不丢
                if matches!(event, tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)) {
                    save_window_geom(&app_for_geom);
                }
            });

            // ④窗口记忆：启动后窗口稳定下来记一次初始几何——
            // 之后每次移动/缩放/隐藏都会更新，即使进程被强杀也有基线可还原。
            {
                let h = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(1500));
                    save_window_geom(&h);
                });
            }

            // ⑦壳内历史导航：内核 UI 是 hash 路由，WebView 自己没有前进后退手势。
            // 注入 Alt+←/→ 直接触发 history.back/forward，等价浏览器体感。
            {
                let w = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(1200));
                    let _ = w.eval(
                        "document.addEventListener('keydown', function (e) {\
                             if (!e.altKey) return;\
                             if (e.key === 'ArrowLeft') { history.back(); e.preventDefault(); }\
                             else if (e.key === 'ArrowRight') { history.forward(); e.preventDefault(); }\
                         });",
                    );
                });
            }

            // 全局热键。Alt+Space 和 uTools 一致，但它常被别的启动器占用
            // （PowerToys Run、其它启动器都可能抢），所以准备一串候选，
            // 能注册上的都用，并且把结果告诉用户。
            // ③用户自选热键优先：desktop.json 里配了就只用它；
            // 注册失败（被占用/格式不认识）回退到内置候选列表。
            let mut candidates: Vec<(String, Shortcut)> = Vec::new();
            if let Some(user_hk) = boot_config.hotkey.as_deref() {
                match parse_hotkey(user_hk) {
                    Some(s) => candidates.push((user_hk.to_string(), s)),
                    None => eprintln!("配置的热键 {user_hk} 无法解析，回退内置候选"),
                }
            }
            if candidates.is_empty() {
                candidates = vec![
                    ("Alt+Space".into(), Shortcut::new(Some(Modifiers::ALT), Code::Space)),
                    (
                        "Ctrl+Alt+Space".into(),
                        Shortcut::new(
                            Some(Modifiers::CONTROL | Modifiers::ALT),
                            Code::Space,
                        ),
                    ),
                    ("Alt+Z".into(), Shortcut::new(Some(Modifiers::ALT), Code::KeyZ)),
                ];
            }

            let watch: Vec<Shortcut> = candidates.iter().map(|(_, s)| s.clone()).collect();
            let app_for_hotkey = handle.clone();
            handle.plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |_app, pressed, event| {
                        if event.state() == ShortcutState::Pressed
                            && watch.iter().any(|s| s == pressed)
                        {
                            toggle_window(&app_for_hotkey);
                        }
                    })
                    .build(),
            )?;

            let mut registered: Vec<String> = Vec::new();
            for (name, shortcut) in &candidates {
                match handle.global_shortcut().register(shortcut.clone()) {
                    Ok(()) => registered.push(name.clone()),
                    Err(_) => eprintln!("热键 {name} 已被别的程序占用，跳过"),
                }
            }
            if registered.is_empty() {
                eprintln!("没有任何全局热键可用，只能通过托盘图标呼出窗口");
            } else {
                eprintln!("可用的全局热键：{}", registered.join(" / "));
            }

            // 托盘
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::TrayIconBuilder;

                // ①托盘菜单扩充：设置（打开内核设置面）/ 日志 / 退出
                let show = MenuItem::with_id(app, "show", "显示 / 隐藏", true, None::<&str>)?;
                let settings = MenuItem::with_id(app, "settings", "打开设置", true, None::<&str>)?;
                let logs = MenuItem::with_id(app, "logs", "打开日志目录", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show, &settings, &logs, &quit])?;

                let hotkey_tip = registered.first().cloned().unwrap_or_else(|| "托盘呼出".into());
                TrayIconBuilder::new()
                    .menu(&menu)
                    .tooltip(format!("zerokit —— {hotkey_tip} 呼出"))
                    // ②托盘左键/双击 = 切换主窗口（macOS 上明确化）
                    .on_tray_icon_event(|tray, event| {
                        if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                            toggle_window(tray.app_handle());
                        }
                    })
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => toggle_window(app),
                        "settings" => {
                            // 壳没有自己的设置页：把内核 UI 的外观面板路由带出来
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = window.eval("if (window.__zerokit) { try { location.hash = '#/'; } catch {} }");
                            }
                        }
                        "logs" => {
                            if let Some(home) = dirs_log_dir() {
                                let _ = open_path(&home);
                            }
                        }
                        "quit" => {
                            if let Some(state) = app.try_state::<CoreProcess>() {
                                if let Some((mut child, _stdin)) = state.0.lock().unwrap().take() {
                                    let _ = child.kill();
                                }
                            }
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .build(app)?;
            }

            // 拉内核（放在单独线程里，别把 setup 卡住）
            std::thread::spawn(move || match start_core() {
                Ok((url, child, stdin)) => {
                    if let Some(state) = handle.try_state::<CoreProcess>() {
                        *state.0.lock().unwrap() = Some((child, stdin));
                    }
                    if let Some(window) = handle.get_webview_window("main") {
                        // 内核起来了，把窗口导航到它
                        let init = format!(
                            "location.replace({});",
                            serde_json::to_string(&url).unwrap_or_else(|_| "\"/\"".into())
                        );
                        let _ = window.eval(init);
                    }
                }
                Err(message) => show_error(&handle, &message),
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Tauri 应用初始化失败")
        .run(|app, event| {
            // 壳退出时把内核一起收掉，别留孤儿进程
            if let tauri::RunEvent::Exit = event {
                save_window_geom(app);
                if let Some(state) = app.try_state::<CoreProcess>() {
                    if let Some((mut child, _stdin)) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}

/// 日志目录。Windows 的 USERPROFILE 只在 Windows 上有——
/// 三平台都归一到「用户主目录 / .zerokit / logs」。

fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE").ok().map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}

fn dirs_log_dir() -> Option<PathBuf> {
    home_dir().map(|p| p.join(".zerokit").join("logs"))
}

fn open_path(path: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("explorer");
        cmd.arg(path);
        hide_console(&mut cmd);
        cmd.spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(path).spawn()?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open").arg(path).spawn()?;
    }
    Ok(())
}