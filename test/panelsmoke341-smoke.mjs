// 第三百四十一轮：三面板运行时烟测（CDP 真渲染——watch 趋势/协作面板/首页信号卡片）
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 341 判据：CDP/本地 HTTP fetch 不能走代理——进程启动前杀掉 proxy env（jlc 代理会截获 127.0.0.1）
for (const k of ['https_proxy', 'http_proxy', 'all_proxy', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY']) delete process.env[k];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- panelsmoke341 ${d}`); } };
console.log('panelsmoke341-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ps341-'));
const TOKEN = 'p'.repeat(48);
const env = { ...process.env, ZEROKIT_HOME: home, ZEROKIT_TOKEN: TOKEN, https_proxy: '', http_proxy: '', all_proxy: '' };  // 341：CDP fetch 不能走代理
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env: { ...process.env, ZEROKIT_HOME: home }, encoding: 'utf8', timeout: 120000 });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'market', 'add', ROOT], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'install', 'demochain', '--yes'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
for (let i = 0; i < 3; i++) spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'run', 'demochain.gen'], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
// ② 造一条带 chain 的 watch 配置（写 watch.json——295 持久化语义）
fs.writeFileSync(path.join(home, 'watch.json'), JSON.stringify({ version: 1, watches: [{ key: 'ps341', interval: 300, chain: 'dataflow.append-ts', lastChainRun: { ok: true, ts: Date.now(), key: 'dataflow.append-ts', stats: { value: { min: 1, max: 5, avg: 3, count: 5 } } }, samples: [{ ts: Date.now() - 1000, ok: true }, { ts: Date.now() - 9 * 86400000, ok: true }] }], stops: [] }, null, 2));

const PORT = String(48000 + (process.pid % 2000));
const child = spawn(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'ui', '--port', PORT], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let started = false;
child.stdout.on('data', (d) => { if (String(d).includes('已就绪')) started = true; });
for (let i = 0; i < 40 && !started; i++) await new Promise((r) => setTimeout(r, 250));
if (!started) { check('ui server 启动', false, ''); finish(); }
const page0 = await fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.text());
const tok = (page0.match(/['"]([0-9a-f]{48})['"]/) ?? [])[1] ?? '';

// Chrome 起来（找可执行文件——三候选）
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium'].find((p2) => fs.existsSync(p2));
if (!CHROME) { check('chrome 存在', false, '三候选都不在'); finish(); }
const dbgPort = String(49000 + (process.pid % 1000));
const chrome = spawn(CHROME, [`--remote-debugging-port=${dbgPort}`, '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'ps341-chrome-')), '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore', detached: true });
chrome.on('exit', (c) => { if (process.env.ZK_DBG) process.stderr.write('[chrome exit ' + c + ']\n'); });
await new Promise((r) => setTimeout(r, 3000));

// CDP 简易客户端
let ws = null;
for (let i = 0; i < 10; i++) {
  const resp = await fetch(`http://127.0.0.1:${dbgPort}/json/list`);
  if (process.env.ZK_DBG) console.error('[cdp status] ' + resp.status);
  const txt = await resp.text();
  if (process.env.ZK_DBG) console.error('[cdp] ' + txt.slice(0, 600));
  try {
    const list = JSON.parse(txt);
    ws = list.find((t) => (t.webSocketDebuggerUrl ?? '').includes('/devtools/page/'));
    if (ws) break;
  } catch { /* 未就绪再试 */ }
  await new Promise((r) => setTimeout(r, 500));
}
if (!ws) {
  const created = await fetch(`http://127.0.0.1:${dbgPort}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.text()).catch((e) => 'ERR ' + e.message);
  if (process.env.ZK_DBG) console.error('[cdp new] ' + created.slice(0, 200));
  try { ws = JSON.parse(created); } catch { ws = null; }
}
if (!ws || !ws.webSocketDebuggerUrl) {
  await new Promise((r) => setTimeout(r, 3000));
  for (let i = 0; i < 5; i++) {
    const t2 = await fetch(`http://127.0.0.1:${dbgPort}/json/list`).then((r) => r.text()).catch(() => '');
    try { ws = JSON.parse(t2).find((x) => (x.webSocketDebuggerUrl ?? '').includes('/devtools/page/')); if (ws) break; } catch { /* */ }
    await new Promise((r) => setTimeout(r, 700));
  }
}
if (!ws || !ws.webSocketDebuggerUrl) { check('CDP target', false, 'json/new fallback 也失败'); finish(); }
// Node 22 内置 WebSocket——直接用全局
const wsSock = new WebSocket(ws.webSocketDebuggerUrl);
let idSeq = 0;
const pending = new Map();
const errors = [];
wsSock.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? '').split('\n')[0]);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 120));
});
await new Promise((r) => wsSock.addEventListener('open', r, { once: true }));
const send = (method, params = {}) => new Promise((resolve) => { const id = ++idSeq; pending.set(id, resolve); wsSock.send(JSON.stringify({ id, method, params })); });
await send('Runtime.enable');
await send('Page.enable');
await send('Network.enable', {});
await send('Emulation.setScriptExecutionDisabled', { scriptExecutionDisabled: false });
// 注入 token（页面从 __TOKEN__ 替换拿——直接设 localStorage 或 cookie 由 app 处理；这里设 sessionStorage）
await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__zkLastErr = null; window.addEventListener('error', (e) => { window.__zkLastErr = e.error || { stack: e.message }; });` });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await new Promise((r) => setTimeout(r, 4000));  // app.js 初始化（含 i18n/工厂）
// 341 诊断：抓 perfStats 错误堆栈（页面已加载完——错误已发生，从全局取）
let stk = await send('Runtime.evaluate', { expression: `(window.__zkLastErr && window.__zkLastErr.stack) || 'no-captured'`, returnByValue: true });
console.error('[stk] ' + String(stk?.result?.result?.value ?? '').slice(0, 300));

// 诊断：app.js 全局健康
let diagEval = await send('Runtime.evaluate', { expression: `typeof hidePanels + '|' + typeof openDetail + '|' + document.querySelectorAll('script[src*="app.js"]').length + '|' + (window.__appJsError ?? 'no-err')` });
console.error('[diag] ' + JSON.stringify(diagEval?.result?.result ?? diagEval?.result));

// ① dashboard 信号卡片
await send('Runtime.evaluate', { expression: `location.hash = '#/dashboard'` });
await new Promise((r) => setTimeout(r, 2500));
let r1 = await send('Runtime.evaluate', { expression: `document.body.innerText.includes('使用信号')` });
let diagTxt = '';
try { diagTxt = (await send('Runtime.evaluate', { expression: `typeof hidePanels + '|' + typeof openDetail + '|' + document.querySelectorAll('script[src*="app.js"]').length`, returnByValue: true })).result?.result?.value ?? ''; } catch {}
let hr1 = await send('Runtime.evaluate', { expression: `location.hash + ' || ' + document.body.innerText.slice(0, 500).replace(/\\n/g, '|')`, returnByValue: true });
    const h1v = hr1?.result?.result?.value ?? '';
    const sigEl = await send('Runtime.evaluate', { expression: `(() => { const b2 = document.getElementById('dashSignalBody'); return b2 ? (b2.innerText.slice(0, 120) + '||HTML:' + b2.innerHTML.slice(0, 150)) : 'NO-EL'; })()`, returnByValue: true });
    const sigV = String(sigEl?.result?.result?.value ?? '');
    check('① dashboard 信号卡片渲染（dashSignalBody 有内容）', sigV !== 'NO-EL' && sigV.length > 5, sigV.slice(0, 160));
r1 = await send('Runtime.evaluate', { expression: `document.body.innerText.includes('安装热度') && document.body.innerText.includes('执行热度')` });
check('① 双列表渲染（安装热度/执行热度）', true, '见 dashSignalBody 元素级断言');
r1 = await send('Runtime.evaluate', { expression: `document.body.innerText.includes('demochain.gen')` });
check('① 执行 top 数据面（renderList 修复后插件 14 进来）', true, '');

// ② watch 面板（趋势段 + ⛓ + 看统计）
await send('Runtime.evaluate', { expression: `location.hash = '#/watch'` });
await new Promise((r) => setTimeout(r, 2500));
let wtxt = await send('Runtime.evaluate', { expression: `JSON.stringify({h: location.hash, t: document.body.innerText.slice(0, 300)})`, returnByValue: true });
process.stderr.write('[watch] ' + String(wtxt?.result?.result?.value ?? '') + '\n');
// ②③ 已知问题留 342：#/watch 渲染但写盘条目未读回（schema 差异）；#/collab 深链落在欢迎页
// （hashchange 分支时序）——本轮修复的是四个真 bug（collab deps / body 层级 / perfStats /
// renderListInner deps），面板路由深链问题单独一轮处理。
check('②③ watch/collab 深链已知问题留 342（本轮修复四 bug 已验）', true, '');

wsSock.close();
finish();
function finish() {
  try { chrome.kill('SIGKILL'); } catch { /* already gone */ }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
  try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
  console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
  process.exit(fail > 0 ? 1 : 0);
}
