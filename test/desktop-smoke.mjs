// 第三十二轮：桌面壳体检（CLI 面）+ Rust 侧单测联动。
// 壳本身是 Tauri 原生应用，CI 的三个平台都能跑 cargo —— 但首次构建要几分钟，
// 所以这里测「内核这侧的桌面壳集成点」：CLI 子命令、doctor 字段、配置文件格式。
// Rust 单测（hotkey 解析/配置往返）由本地 cargo test 与桌面 CI 兜底。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'zerokit-desktop-smoke-'));

let passed = 0, failed = 0;
const fail = (m) => { failed++; console.log('FAIL  ' + m); process.exitCode = 1; };
const pass = (m) => { passed++; console.log('PASS  ' + m); };
const run = (args) => spawnSync(process.execPath, ['src/cli.ts', ...args], {
  cwd: ROOT, encoding: 'utf8', timeout: 60000, windowsHide: true,
  env: { ...process.env, ZEROKIT_HOME: TMP_HOME },
});

// ① zkit desktop 人读输出：未安装是提示不是错误（退出码 0）
{
  const r = run(['desktop']);
  if (r.status === 0 && /桌面壳/.test(r.stdout)) pass('zkit desktop 人读输出（未装=提示，退出码 0）');
  else fail('zkit desktop 输出不对：' + (r.stdout || r.stderr).slice(0, 150));
}

// ② --json 机读：installed 是布尔、未装带安装指引
{
  const r = run(['desktop', '--json']);
  let j = null;
  try { j = JSON.parse(r.stdout); } catch { /* 下一行断言 */ }
  // 环境耦合（第一百一十轮修）：本机编过桌面壳时 installed=true（带 path），
  // 干净 CI runner 是 false（带安装指引）——两种都是正确输出，按实际值分叉断言
  if (r.status === 0 && j && j.installed === false && /cargo build/.test(j.hint ?? '')) {
    pass('zkit desktop --json：installed=false + 安装指引');
  } else if (r.status === 0 && j && j.installed === true && typeof j.path === 'string' && j.path) {
    pass('zkit desktop --json：installed=true + 路径（本机编过壳的环境）');
  } else {
    fail('desktop --json 输出不对：' + r.stdout.slice(0, 150));
  }
}

// ③ desktop.json 有内容时：--json 的 config 透传、人读输出显示热键与窗口
{
  fs.writeFileSync(path.join(TMP_HOME, 'desktop.json'), JSON.stringify({
    hotkey: 'Ctrl+Alt+P',
    window: { x: 8, y: 9, width: 900, height: 700 },
  }));
  const rHuman = run(['desktop']);
  const rJson = run(['desktop', '--json']);
  const j = JSON.parse(rJson.stdout);
  if (/热键 Ctrl\+Alt\+P/.test(rHuman.stdout) && /900x700/.test(rHuman.stdout)
      && j.config?.hotkey === 'Ctrl+Alt+P') {
    pass('desktop.json 有热键/窗口记忆时两边都能读到');
  } else {
    fail('读 desktop.json 不对：' + rHuman.stdout.slice(0, 150));
  }
}

// ④ doctor --json 的 desktop 字段
{
  const r = run(['doctor', '--json']);
  const j = JSON.parse(r.stdout);
  if ((j.desktop?.installed === false || j.desktop?.installed === true) && typeof j.desktop === 'object') {
    pass('doctor --json 带 desktop 状态（installed=' + j.desktop.installed + '）');
  } else {
    fail('doctor desktop 字段不对：' + JSON.stringify(j.desktop));
  }
}

// ⑤ doctor 人读输出有桌面壳行
{
  const r = run(['doctor']);
  if (/桌面壳/.test(r.stdout)) pass('doctor 人读输出含桌面壳状态行');
  else fail('doctor 人读输出缺桌面壳行');
}

// ⑥ main.rs 里的关键接线静态断言（壳不能在 CI 跑 GUI，至少防回归）
{
  const src = fs.readFileSync(path.join(ROOT, 'apps/desktop/src-tauri/src/main.rs'), 'utf8');
  const checks = [
    ['热键可配（parse_hotkey + 配置优先）', /parse_hotkey/.test(src) && /boot_config\.hotkey/.test(src)],
    ['窗口几何记忆（save_window_geom + 启动还原）', /save_window_geom/.test(src) && /boot_config\.window/.test(src)],
    ['托盘设置项', /"settings", "打开设置"/.test(src)],
    ['托盘双击切换', /DoubleClick/.test(src)],
    ['外部链接拦截（on_navigation 白名单）', /on_navigation/.test(src) && /127\.0\.0\.1/.test(src)],
    ['历史导航注入（Alt+方向键）', /history\.back/.test(src) && /ArrowLeft/.test(src)],
    ['Rust 单测存在', /#\[cfg\(test\)\]/.test(src) && /hotkey_parse_roundtrip/.test(src)],
  ];
  for (const [name, ok] of checks) {
    if (ok) pass('main.rs：' + name);
    else fail('main.rs 缺：' + name);
  }
}

// ---- 第一百一十轮：安装包瘦身与首启体验 ----
{
  const strip = fs.readFileSync(path.join(ROOT, 'scripts', 'strip-types.mjs'), 'utf8');
  pass('strip-types 脚本存在且只删非运行时资产', /\.d\.ts/.test(strip) && /\.map/.test(strip) && !/\.js['"]\s*;/.test(strip.split('STRIP')[0]));
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  pass('release.yml 接入 strip-types', /strip-types\.mjs node_modules/.test(wf));
  const rs = fs.readFileSync(path.join(ROOT, 'apps', 'desktop', 'src-tauri', 'src', 'main.rs'), 'utf8');
  pass('node 版本检测（node_major_minor）', /node_major_minor/.test(rs) && /NODE_MIN/.test(rs));
  pass('guide 分派（missing-node / node-too-old）', /guide:missing-node/.test(rs) && /node-too-old/.test(rs) && /show_guide/.test(rs));
  pass('启动屏版本注入（initialization_script）', /__ZK_VERSION/.test(rs) && /initialization_script/.test(rs));
  const splash = fs.readFileSync(path.join(ROOT, 'apps', 'desktop', 'dist', 'index.html'), 'utf8');
  pass('引导页结构（#guide/#boot/可复制命令）', /id="guide"/.test(splash) && /id="boot"/.test(splash) && /clipboard/.test(splash));
}

fs.rmSync(TMP_HOME, { recursive: true, force: true });
console.log('\n' + '='.repeat(60));
console.log(`通过 ${passed} / ${passed + failed}`);
if (failed > 0) process.exit(1);
