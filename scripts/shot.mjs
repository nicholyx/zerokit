// 开发用：给页面截图。
//
// 为什么不用 `msedge --screenshot`：那个用的是 --virtual-time-budget，
// 而虚拟时间在有未结束的长连接（比如 SSE）时推进不了，页面会停在流的开头。
// 这里直接走 CDP，按真实时间等够再截。
//
// 用法：node scripts/shot.mjs <url> <输出.png> [等待毫秒=4000] [宽=900] [高=820]

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [url, out, waitMs = '4000', width = '900', height = '820'] = process.argv.slice(2);
if (!url || !out) {
  console.error('用法：node scripts/shot.mjs <url> <输出.png> [等待毫秒] [宽] [高]');
  process.exit(2);
}

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const browser = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
if (!browser) {
  console.error('没找到 Edge 或 Chrome');
  process.exit(1);
}

const port = 9222 + Math.floor(Math.random() * 400);
const profile = path.join(path.dirname(path.resolve(out)), `.cdp-profile-${port}`);
const child = spawn(browser, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--hide-scrollbars',
  '--disable-extensions',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  `--window-size=${width},${height}`,
  'about:blank',
], { stdio: 'ignore', windowsHide: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
    await sleep(200);
  }
  throw new Error('浏览器没起来');
}

try {
  const wsUrl = await findTarget();
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('连不上调试端口'));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: Number(width), height: Number(height), deviceScaleFactor: 1, mobile: false,
  });
  await send('Page.navigate', { url });
  await sleep(Number(waitMs));

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`已截图：${out}`);
  ws.close();
} catch (e) {
  console.error('截图失败：' + (e.stack ?? e.message));
  process.exitCode = 1;
} finally {
  child.kill('SIGKILL');
  // 清理是尽力而为：浏览器进程可能还没释放文件句柄，
  // 这里报 EPERM 不该让已经成功的截图变成一次失败退出。
  await sleep(500);
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* 留在临时目录里无所谓 */
  }
}