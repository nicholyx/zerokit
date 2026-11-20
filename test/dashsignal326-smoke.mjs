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
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
