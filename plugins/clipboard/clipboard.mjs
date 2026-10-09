// 剪贴板历史插件的动作实现。
//
// 读剪贴板这件事本身在 watch.ps1 里做（见那个文件的注释：Node 没有内置 API，
// 而每次新起 powershell 要 ~200ms，只能用一个常驻进程在内部轮询）。
// 这个文件负责**动作**：把监听拉起来、读写历史、搜索、放回剪贴板。
//
// 落盘规则全在 history.mjs（纯函数，可单独测），这里只管流程和输出。
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import {
  DEFAULT_MAX_ENTRIES, DEFAULT_MAX_LENGTH, clearHistory, formatTime,
  openHistory, readEntries, searchEntries, selectEntry,
} from './history.mjs';

const HERE = import.meta.dirname; // 插件目录。worker 下 cwd 不是插件目录，所以一律用它。
const WATCH_PS1 = path.join(HERE, 'watch.ps1');

/** 显示用：把换行折叠掉，否则表格会被多行文本撑坏 */
function oneLine(text, limit) {
  const s = text.replace(/\r\n|\r|\n/g, ' ⏎ ');
  return s.length > limit ? s.slice(0, limit) + '…' : s;
}

function toInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function fail(msg) {
  process.stderr.write(msg + '\n');
  process.exit(1);
}

/**
 * PowerShell 可执行文件。
 *
 * 优先用系统目录下的绝对路径：PATH 是用户可改的，一个同名 powershell 挡在前面
 * 就能劫持整个插件。找不到（非标准安装 / 非 Windows）再退回按 PATH 找。
 */
function powershellExe() {
  const root = process.env['SystemRoot'] || 'C:\\Windows';
  const fixed = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return fs.existsSync(fixed) ? fixed : 'powershell';
}

function pidAlive(pid) {
  try {
    const out = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8', windowsHide: true, timeout: 8000,
    });
    return out.status === 0 && /"/.test(out.stdout ?? '');
  } catch {
    return false;
  }
}

function readPid(file) {
  try {
    // pid 文件里**只有数字**：services.ts 是 stream 直接 Number() 的，
    // 多写一个 JSON 或一行说明它就读不出来了。
    const pid = Number(fs.readFileSync(file, 'utf8').trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** pid 文件路径。相对路径按**插件目录**解析，与 services.ts 里 pidFile 的解析方式一致。 */
function resolvePidFile(arg) {
  const p = arg && arg.trim() ? arg.trim() : 'clipboard.pid';
  return path.isAbsolute(p) ? p : path.join(HERE, p);
}

// ---------------------------------------------------------------- list

function actionList(argv) {
  const dataDir = argv[0];
  const limit = toInt(argv[1], 20);
  const full = String(argv[2] ?? 'false').toLowerCase() === 'true';
  const { entries } = readEntries(dataDir);
  // 顶层输出**数组**而不是 {total, items:[...]}：各端按 render=table 渲染时
  // 认的是"对象数组"这个形状，包一层的话表格会退化成一格 JSON 字符串。
  // 空历史自然就是空数组，正好渲染成"（空结果）"。
  out(entries.slice(0, Math.max(0, limit)).map((e, i) => ({
    index: i + 1,
    at: formatTime(e.at),
    length: e.length,
    // 默认截断：启动器里是表格，一条 3 万字的记录会把整张表冲垮。
    // 想看全部就 full=true（或者直接 copy 回剪贴板看）。
    text: full ? e.text : oneLine(e.text, 60),
  })));
}

// ---------------------------------------------------------------- search

function actionSearch(argv) {
  const dataDir = argv[0];
  const keyword = argv[1];
  if (!keyword) fail('缺少关键词：用法 `search <关键词> --limit N`');
  const limit = toInt(argv[2], 20);
  const { entries } = readEntries(dataDir);
  const hit = searchEntries(entries, keyword, limit);
  // 带上 index：搜索结果里的某一条可以直接 `copy --index N` 放回剪贴板，
  // 不用再回 list 里数一遍。
  out(hit.map((e) => ({
    index: entries.indexOf(e) + 1,
    at: formatTime(e.at),
    length: e.length,
    text: oneLine(e.text, 80),
  })));
}

// ---------------------------------------------------------------- clear

function actionClear(argv) {
  const { removed } = clearHistory(argv[0]);
  process.stdout.write(`已清空剪贴板历史，删掉 ${removed} 条\n`);
}

// ---------------------------------------------------------------- copy

function actionCopy(argv) {
  const dataDir = argv[0];
  const index = toInt(argv[1], NaN);
  const { entries } = readEntries(dataDir);
  const entry = selectEntry(entries, index);
  if (!entry) {
    // 越界必须被拒，而且是在**动剪贴板之前**拒绝：
    // 悄悄把剪贴板清空或塞进别的东西，比报错难受得多。
    fail(`下标 ${argv[1]} 越界：当前历史共 ${entries.length} 条，可用下标 1~${entries.length}`
      + (entries.length ? '（1 是最新的一条）' : '（历史是空的，先用 watch-start 开始监听）'));
  }

  // 文本走 stdin 而不是命令行参数：剪贴板的正文可能很长、含引号换行，
  // 塞进 -Command 的字符串里迟早会被转义咬到；走管道则原样进原样出。
  // 用 StreamReader 显式按 UTF-8 读，避免受控制台代码页影响（中文会乱）。
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$r = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [Text.Encoding]::UTF8)',
    '$t = $r.ReadToEnd()',
    'Set-Clipboard -Value $t',
  ].join('; ');
  const r = spawnSync(powershellExe(), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    input: entry.text, encoding: 'utf8', windowsHide: true, timeout: 20000,
  });
  if (r.status !== 0) fail(`写入剪贴板失败：${(r.stderr || r.error?.message || '未知原因').trim().slice(0, 300)}`);

  out({ index, length: entry.length, copied: oneLine(entry.text, 60), at: formatTime(entry.at) });
}

// ---------------------------------------------------------------- watch-start / watch-stop

/**
 * 拉起监听。这是个 background 动作：zerokit 会把它托管起来，出现在「运行中」里。
 *
 * 进程结构：node(clipboard.mjs watch-start)  ←父→  powershell(watch.ps1 轮询)
 * 为什么中间要有一个 node 进程，而不是直接 `background = true` 跑 powershell：
 *   1. 去重/条数上限/JSON 落盘的规则在 history.mjs 里（JS），PowerShell 里重写一份
 *      等于同样的规则有两处实现，迟早不一致；
 *   2. Node 侧能顺手把"记了哪条"打到 stdout，于是「运行中」面板的实时输出里看得见它
 *      真的在工作，而不是一个沉默的进程。
 * PowerShell 只负责"剪贴板变了，内容是这个"这一件事。
 */
function actionWatchStart(argv) {
  const dataDir = argv[0];
  if (!dataDir) fail('内部参数缺失：watch-start 需要 {data_dir}');
  const pidFile = resolvePidFile(argv[1]);
  const maxEntries = toInt(argv[2], DEFAULT_MAX_ENTRIES);
  const maxLength = toInt(argv[3], DEFAULT_MAX_LENGTH);
  const intervalMs = toInt(argv[4], 400);

  // 已经在跑就别再拉一个。两个监听同时记同一个剪贴板，历史里会出现成对的重复，
  // 而且用户会找不到"到底哪个在跑、该关哪个"。
  const running = readPid(pidFile);
  if (running && pidAlive(running)) {
    fail(`剪贴板监听已经在运行（PID ${running}，pid 文件 ${pidFile}）。`
      + '要重启就先 `zkit run clipboard watch-stop`。');
  }

  // pid 文件由**监听进程自己写**，而不是等 zerokit 的 background 托管替我们写：
  // background 只登记在 running.json 里、并不产生某个插件的 pid 文件，
  // 而 [[service]] 的 pidFile 是 services.ts 直接去读这个文件的——不写就永远检测不到。
  // 好处是：手动从终端起的监听（甚至别的方式起的）同样能被「运行中」发现。
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, String(process.pid), 'utf8');

  const log = openHistory(dataDir, { maxEntries, maxLength });
  // 轮询器默认永远是 watch.ps1。留这个环境变量只是给测试一个缝：
  // 换成"假轮询器"才能在不碰真实剪贴板的前提下验证这一层（pid 文件的生命周期、
  // 行协议解析、落盘去重）——这是唯一能把粘合代码测到又不去污染用户剪贴板的办法。
  const poller = process.env['ZK_CLIPBOARD_POLLER'] || WATCH_PS1;
  const fake = /\.m?js$/i.test(poller);
  const child = spawn(
    fake ? process.execPath : powershellExe(),
    fake
      ? [poller]
      : ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', poller,
        '-IntervalMs', String(intervalMs), '-ParentPid', String(process.pid)],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );

  const stamp = () => formatTime(new Date().toISOString()).slice(11);
  process.stdout.write(`[${stamp()}] 剪贴板监听已启动（PID ${process.pid}），历史文件 ${path.join(dataDir, 'history.jsonl')}\n`);

  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let text;
      try {
        text = JSON.parse(line).text;
      } catch {
        continue; // 半行/告警噪音，跳过就好，不值得让监听挂掉
      }
      const r = log.append(text);
      if (r.added) {
        process.stdout.write(`[${stamp()}] +${r.entry.length} 字：${oneLine(text, 40)}\n`);
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => process.stderr.write(String(c)));

  const cleanup = () => {
    // 只在自己还是 pid 文件的主人时才删：万一有人已经重启了监听，
    // 这时候删掉的就是新监听刚写进去的 pid。
    if (readPid(pidFile) === process.pid) {
      try { fs.rmSync(pidFile, { force: true }); } catch { /* 删不掉就算了 */ }
    }
  };
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
    // Windows 上强杀是收不到信号的，这里主要是让 Ctrl+C 起的场景干净退出；
    // 真正兜底的是 watch.ps1 里的父进程存活检查。
    process.on(sig, () => { try { child.kill(); } catch { /* 已退出 */ } cleanup(); process.exit(0); });
  }
  child.on('error', (e) => {
    // 连轮询器都没起来（比如非 Windows 上没有 powershell）：把错误说出来再退，
    // 不然这里会是一个"启动了但什么都不做"的僵尸监听，还占着 pid 文件。
    cleanup();
    fail(`拉起剪贴板轮询器失败：${e.message}`);
  });
  child.on('exit', (code) => {
    // 轮询器不在了，监听就没有意义了——连它一起退，别留一个什么都不做的壳。
    cleanup();
    process.stdout.write(`[${stamp()}] 轮询进程已退出（code ${code}），监听结束\n`);
    process.exit(0);
  });
}

/**
 * 停掉监听。这是 [[service]] 里声明的 stop 命令。
 *
 * 用 taskkill /T 而不是只杀监听进程：/T 连它拉起的轮询进程一起结束。
 * （Node 在 Windows 上没法可靠地发信号，普通 kill 只结束父进程、
 * 留下一个还在轮询的 PowerShell，这正是 /T 存在的理由。）
 */
function actionWatchStop(argv) {
  const pidFile = resolvePidFile(argv[0]);
  const pid = readPid(pidFile);
  if (!pid) {
    process.stdout.write('剪贴板监听没有在运行（没有 pid 文件或内容不是 pid）\n');
    return;
  }
  if (!pidAlive(pid)) {
    try { fs.rmSync(pidFile, { force: true }); } catch { /* 忽略 */ }
    process.stdout.write(`PID ${pid} 已经不在了，顺手清掉 pid 文件\n`);
    return;
  }
  const r = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
    encoding: 'utf8', windowsHide: true, timeout: 15000,
  });
  if (r.status !== 0 && !/not found|不存在|没有找到/i.test(r.stderr ?? '')) {
    fail(`停止失败：${(r.stderr || r.stdout || '').trim().slice(0, 200)}`);
  }
  try { fs.rmSync(pidFile, { force: true }); } catch { /* 忽略 */ }
  process.stdout.write(`已停止剪贴板监听（PID ${pid} 及其轮询进程）\n`);
}

// ---------------------------------------------------------------- 入口

const [, , cmd, ...rest] = process.argv;
switch (cmd) {
  case 'list': actionList(rest); break;
  case 'search': actionSearch(rest); break;
  case 'clear': actionClear(rest); break;
  case 'copy': actionCopy(rest); break;
  case 'watch-start': actionWatchStart(rest); break;
  case 'watch-stop': actionWatchStop(rest); break;
  default:
    fail(`未知动作 ${cmd ?? '(空)'}；可用：list / search / clear / copy / watch-start / watch-stop`);
}