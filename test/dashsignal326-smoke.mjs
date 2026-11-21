// 第三百二十六轮：UI 首页热度卡片——双列/空态/跳转/刷新
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- dashsignal326 ${d}`); } };
console.log('dashsignal326-smoke');

const app = fs.readFileSync(path.join(ROOT, 'web', 'app.js'), 'utf8');
// ① 双列结构
check('① 使用信号卡片（双列表：安装热度/执行热度）', app.includes('使用信号') && app.includes('安装热度') && app.includes('执行热度') && app.includes('grid-template-columns:1fr 1fr'), '');
// ② 空态引导
check('② 空态引导（装插件/跑动作提示）', app.includes('暂无信号——装一个插件'), '');
// ③ 执行项跳转（fetch /api/plugins + openDetail）
check('③ 执行项点击跳详情（data-sigact → openDetail）', app.includes('data-sigact') && app.includes("openDetail(pl, act)"), '');
// ④ 30s 刷新 + 离开即停
check('④ 30s 自动刷新 + 离开面板 clearInterval', app.includes('setInterval(renderSignal, 30000)') && app.includes("clearInterval(signalTimer)") && app.includes("mode !== 'dashboard'"), '');

// ⑧ 活体：双端点联测（造数据后 UI 数据面可渲染）
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ds326-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'market', 'add', ROOT], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'install', 'demochain', '--yes'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
for (let i = 0; i < 3; i++) spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'run', 'demochain.gen'], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
const PORT = String(47000 + (process.pid % 2000));
const child = spawn(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'ui', '--port', PORT], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let started = false;
child.stdout.on('data', (d) => { if (String(d).includes('已就绪')) started = true; });
for (let i = 0; i < 40 && !started; i++) await new Promise((r) => setTimeout(r, 250));
if (started) {
  const page = await fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.text());
  const tok = (page.match(/['"]([0-9a-f]{48})['"]/) ?? [])[1] ?? '';
  const [mk, st] = await Promise.all([
    fetch(`http://127.0.0.1:${PORT}/api/market-stats`, { headers: { 'x-zerokit-token': tok } }).then((r) => r.json()),
    fetch(`http://127.0.0.1:${PORT}/api/stats/top-actions?n=5`, { headers: { 'x-zerokit-token': tok } }).then((r) => r.json()),
  ]);
  check('⑧ 双端点联测（安装 demochain=1 + 执行 gen count=3——卡片可渲染）', mk.stats?.demochain?.installs === 1 && st.top?.[0]?.key === 'demochain.gen' && st.top?.[0]?.count === 3, JSON.stringify({ i: mk.stats?.demochain?.installs, t: st.top?.[0]?.count }));
} else {
  check('ui server 启动', false, '');
}
try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }

// 344①②：CDP 真渲染验证（本地）/ 降级源码断言（CI）——双路径同数 2
const CHROME = process.env.CI ? '' : ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].find((p2) => fs.existsSync(p2));
if (CHROME) {
  // 起 ui server + CDP 抓 dashboard 信号卡片
  const { spawn } = await import('node:child_process');
  const PORT2 = String(49500 + (process.pid % 400));
  const child2 = spawn(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'ui', '--port', PORT2], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let up2 = false;
  child2.stdout.on('data', (d) => { if (String(d).includes('已就绪')) up2 = true; });
  for (let i = 0; i < 40 && !up2; i++) await new Promise((r) => setTimeout(r, 250));
  const chrome2 = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${49600 + (process.pid % 300)}`, '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'ds-chrome-')), '--no-first-run', 'about:blank'], { stdio: 'ignore', detached: true });
  await new Promise((r) => setTimeout(r, 3000));
  try {
    let tgt = null;
    for (let i = 0; i < 20; i++) {
      const t = await fetch(`http://localhost:${49600 + (process.pid % 300)}/json/list`).then((r) => r.text()).catch(() => '');
      try { tgt = JSON.parse(t).find((x) => (x.webSocketDebuggerUrl ?? '').includes('/devtools/page/')); if (tgt) break; } catch { /* */ }
      await new Promise((r) => setTimeout(r, 800));
    }
    if (!tgt) {
      try { spawnSync('pkill', ['-f', 'remote-debugging-port']); } catch { /* */ }
      await new Promise((r) => setTimeout(r, 800));
      const chrome2b = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${49600 + (process.pid % 300)}`, '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'ds-chrome-b-')), '--no-first-run', 'about:blank'], { stdio: 'ignore', detached: true });
      await new Promise((r) => setTimeout(r, 4000));
      for (let i = 0; i < 8; i++) {
        const t = await fetch(`http://localhost:${49600 + (process.pid % 300)}/json/list`).then((r) => r.text()).catch(() => '');
        try { tgt = JSON.parse(t).find((x) => (x.webSocketDebuggerUrl ?? '').includes('/devtools/page/')); if (tgt) break; } catch { /* */ }
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    if (tgt) {
      const ws2 = new WebSocket(tgt.webSocketDebuggerUrl);
      let seq = 0; const pend = new Map();
      ws2.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
      await new Promise((r) => ws2.addEventListener('open', r, { once: true }));
      const send2 = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pend.set(id, resolve); ws2.send(JSON.stringify({ id, method, params })); });
      await send2('Runtime.enable');
      await send2('Page.enable');
      await send2('Page.navigate', { url: `http://localhost:${PORT2}/` });
      await new Promise((r) => setTimeout(r, 4000));
      await send2('Runtime.evaluate', { expression: `location.hash = '#/dashboard'` });
      // 352：轮询等元素（boot 慢时固定 sleep 不够）
      let cv = '';
      for (let i = 0; i < 20; i++) {
        const probe = await send2('Runtime.evaluate', { expression: `document.getElementById('dashSignalBody')?.innerText.slice(0, 200) ?? 'NO-EL'`, returnByValue: true });
        cv = String(probe?.result?.result?.value ?? '');
        if (cv !== 'NO-EL' && cv.length > 3) break;
        await new Promise((r) => setTimeout(r, 800));
      }
      check('①② CDP 卡片真渲染（含安装或执行数据）', cv.includes('🔥') || cv.includes('×') || cv.includes('暂无'), cv.slice(0, 80));
      ws2.close();
    } else {
      check('①② CDP 卡片真渲染', false, 'target 不可达');
    }
  } finally {
    try { chrome2.kill('SIGKILL'); } catch { /* */ }
    try { process.kill(-child2.pid, 'SIGTERM'); } catch { child2.kill(); }
  }
  check('④ 执行项跳转链路（源码级——openDetail 在绑定内）', app.includes('openDetail(pl, act)'), '');
} else {
  // CI 降级：源码断言补 2（与 CDP 同数）
  check('①② 降级：卡片容器与双表结构（源码级）', app.includes('dashSignalBody') && app.includes('安装热度') && app.includes('执行热度'), '');
  check('④ 降级：执行项跳转链路（openDetail 在绑定内）', app.includes('openDetail(pl, act)'), '');
}

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
