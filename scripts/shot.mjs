// 开发用：给页面截图。
//
// 为什么不用 `msedge --screenshot`：那个用的是 --virtual-time-budget，
// 而虚拟时间在有未结束的长连接（比如 SSE）时推进不了，页面会停在流的开头。
// 这里直接走 CDP，按真实时间等够再截。
//
// 用法：node scripts/shot.mjs <url> <输出.png> [等待毫秒=4000] [宽=900] [高=820]

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 参数解析：先把带值的开关挑出去，剩下的按位置取，
// 这样 --eval 放在哪都不会把位置参数挤乱。
const rawArgs = process.argv.slice(2);
const evalIdx = rawArgs.indexOf('--eval');
const evalExpr = evalIdx >= 0 ? rawArgs[evalIdx + 1] : undefined;
// 注意：没传 --eval 时 evalIdx 是 -1，不能拿它去过滤，否则会把第一个位置参数也滤掉
const positional = evalIdx >= 0
  ? rawArgs.filter((_, i) => i !== evalIdx && i !== evalIdx + 1)
  : rawArgs;

const [url, out, waitMs = '4000', width = '900', height = '820'] = positional;
if (!url || !out) {
  console.error('用法：node scripts/shot.mjs <url> <输出.png> [等待毫秒] [宽] [高] [--eval "<js>"]');
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
// profile 固定放临时目录：放在输出目录旁边的话，一旦 out 参数出问题
// 就会在仓库里留下一堆浏览器垃圾文件（踩过）
const profile = path.join(os.tmpdir(), `.zerokit-cdp-${port}`);
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

  // 页面里的异常一定要打出来：模块求值阶段抛错会让整页静默变白，
// 只看截图会以为"没渲染"，其实是有报错。这个坑踩过。
const pageErrors = [];
ws.addEventListener('message', (ev) => {
  try {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params?.exceptionDetails;
      pageErrors.push(d?.exception?.description ?? d?.text ?? '未知异常');
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      pageErrors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '));
    }
  } catch { /* 忽略 */ }
});

await send('Runtime.enable');
await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: Number(width), height: Number(height), deviceScaleFactor: 1, mobile: false,
  });
  await send('Page.navigate', { url });
  await sleep(Number(waitMs));

  // 顺手能执行一段 JS 并打印结果——排查界面问题时比反复截图快得多
  if (evalExpr) {
    const result = await send('Runtime.evaluate', {
      expression: evalExpr,
      returnByValue: true,
      awaitPromise: true,
    });
    const value = result?.result?.value;
    console.log('eval ->', typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    if (result?.exceptionDetails) {
      console.error('eval 抛错：', result.exceptionDetails.text, result.exceptionDetails.exception?.description ?? '');
      process.exitCode = 1;
    }
  }

  if (pageErrors.length > 0) {
  console.error('页面里有 ' + pageErrors.length + ' 条错误：');
  for (const e of pageErrors.slice(0, 5)) console.error('  ' + String(e).split('\n')[0].slice(0, 200));
  process.exitCode = 1;
}

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