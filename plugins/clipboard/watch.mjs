#!/usr/bin/env node
// 剪贴板轮询器（macOS / Linux 版）：一个长期存活的 node 进程，循环读剪贴板，
// 有变化就把内容作为一行 JSON 写到 stdout。
//
// 它是 watch.ps1 的对等物（Windows 上仍然用 watch.ps1——PowerShell 常驻进程
// 在进程内轮询，比每次新起 powershell 省 200ms/次；mac/linux 上 pbpaste/pbclip
// 本身就是轻量小工具，node 轮询的代价可以忽略）。两边的**行协议完全一致**：
//   - stdout 每行一个 JSON：{ "text": "..." }
//   - 启动时先"预热"：把当前剪贴板内容当作已经见过，不记录启动前的残留
//   - 读不到（别的进程握着剪贴板 / 无 GUI 会话）按"这轮没读到"跳过，不当成变化
//   - 去重、条数上限、落盘都在上层 clipboard.mjs 里做，这里只报"变了，内容是这个"
//
// 参数：--interval-ms N   轮询间隔（默认 400）
//       --parent-pid N    父进程 PID；父进程不在了就退出，防止变孤儿
//       --max-iterations N  轮询多少轮后退出；0 = 一直跑（给测试留的口子）
import process from 'node:process';
import { clipboardIO } from './clipio.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const intervalMs = arg('interval-ms', 400);
const parentPid = arg('parent-pid', 0);
const maxIterations = arg('max-iterations', 0);

const io = clipboardIO();
if (io.missing) {
  process.stderr.write(`${io.missing}\n`);
  process.exit(1);
}

const alive = (pid) => {
  if (!pid) return true;   // 没给父 PID（测试场景）就不做这个检查
  try { process.kill(pid, 0); return true; } catch { return false; }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stamp = () => new Date().toISOString();

let lastRecorded = io.read() ?? '';
let i = 0;
process.stderr.write(`[${stamp()}] 轮询器就绪（interval=${intervalMs}ms，parent=${parentPid || 'n/a'}）\n`);

for (;;) {
  await sleep(intervalMs);
  i++;

  // 到轮数上限就退出。注意这个检查必须在 continue 之前——预热轮往往内容没变化，
  // 放在"有变化输出"之后的话，--max-iterations 会永远等不到（实测踩过）。
  if (maxIterations > 0 && i >= maxIterations) process.exit(0);

  // 每 12 轮（约 5 秒）确认一次父进程还活着；不在了就干净退出，不当孤儿
  if (i % 12 === 0 && !alive(parentPid)) {
    process.stderr.write(`[${stamp()}] 父进程 ${parentPid} 已不在，轮询器退出\n`);
    process.exit(0);
  }

  const text = io.read();
  if (text === null) continue;        // 这次没读到，跳过这一轮
  if (text === lastRecorded) continue;
  lastRecorded = text;
  if (text === '') continue;          // 空内容（复制图片等）不记
  process.stdout.write(JSON.stringify({ text }) + '\n');
}
