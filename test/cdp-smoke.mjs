// 第二百五十二轮：CDP 面板回归（251 轮判据的 CI 常态化）
// 起真实 server + headless Chrome，逐面板打开，断言 console error = 0。
// 无 Chrome 环境优雅 skip（打印 SKIP，exit 0）——CI ubuntu 由 workflow 装 chrome。
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PANELS = ['#/doctor', '#/watch', '#/timers', '#/market', '#/logs', '#/stats', '#/services', '#/cache', '#/dashboard', '#/dev', '#/help', '#/ps'];

const CHROME_CANDIDATES = process.platform === 'darwin'
  ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium']
  : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
let CHROME = null;
for (const p of CHROME_CANDIDATES) {
  try {
    fs.accessSync(p);
    const v = spawnSync(p, ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (v.status === 0) { CHROME = p; break; }
  } catch { /* try next */ }
}

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- cdp ${detail}`); } };

if (!CHROME) {
  console.log('cdp-regression: SKIP（本机无 Chrome/Chromium——CI 由 workflow 安装）');
  console.log(`\n${'='.repeat(60)}\n通过 0 / 0`);
  process.exit(0);
}

console.log('cdp-regression');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-reg-'));
const uiPort = 29000 + (Date.now() % 500);
const cdpPort = uiPort + 500;
const env = { ...process.env, ZEROKIT_HOME: home };

// ① server 起
spawnSync(process.execPath, [path.join(ROOT, 'src', 'cli.ts'), 'plugin', 'bundled'], { env, cwd: ROOT, encoding: 'utf8', timeout: 120000, windowsHide: true });
const server = spawn(process.execPath, [path.join(ROOT, 'src', 'cli.ts'), 'ui', '--port', String(uiPort)], { env, cwd: ROOT, stdio: 'ignore', detached: false });
// ② Chrome 起
const chromeProfile = path.join(home, 'chrome');
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${chromeProfile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let serverOk = false;
for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://127.0.0.1:${uiPort}/`); if (r.ok) { serverOk = true; break; } } catch { /* booting */ } await sleep(250); }
let cdpOk = false;
for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://127.0.0.1:${cdpPort}/json/version`); if (r.ok) { cdpOk = true; break; } } catch { /* booting */ } await sleep(250); }

try {
  check('server + Chrome 起来', serverOk && cdpOk, `server=${serverOk} cdp=${cdpOk}`);
  if (!serverOk || !cdpOk) throw new Error('boot fail');

  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let mid = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((res) => { const id = ++mid; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? '').split('\n')[0]);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 120));
  });
  await new Promise((r) => ws.addEventListener('open', r));
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${uiPort}/` });
  await sleep(2500);

  let opened = 0;
  for (const hash of PANELS) {
    await send('Runtime.evaluate', { expression: `location.hash = '${hash}'` });
    await sleep(900);
    const r = await send('Runtime.evaluate', { expression: `!!document.querySelector('.panel, .ps-empty, h2, table')` });
    if (r?.result?.value) opened++;
  }
  check(`12 面板全部渲染（${opened}/12）`, opened === PANELS.length);
  check('console/异常 = 0（251 轮判据）', errors.length === 0, errors.slice(0, 3).join(' ; '));
  ws.close();
} catch (e) {
  check('回归流程自身', false, e.message);
} finally {
  try { chrome.kill('SIGKILL'); } catch { /* already gone */ }
  try { server.kill('SIGKILL'); } catch { /* already gone */ }
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* tmp */ }
}

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
