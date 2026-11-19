// 第三百二十五轮：动作执行热度 Top——stats --top / doctor executions / api 端点
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- topactions325 ${d}`); } };
console.log('topactions325-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ta325-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
const run = (a) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });

// ⑧ 造数据：gen 跑 3 次、double 1 次 → top 反映
for (let i = 0; i < 3; i++) run(['run', 'demochain.gen']);
run(['run', 'demochain.double', '--yes']);
const r1 = run(['stats', '--top', '2']);
const out = r1.stdout + '';
check('②⑧ stats --top 2（gen×3 排首）', r1.status === 0 && out.includes('demochain.gen×3') && (out.match(/×/g) ?? []).length <= 8, out.split('\n')[1]?.slice(0, 70));

// ③ doctor signal executions
const rd = run(['doctor', '--json']);
const j = JSON.parse((rd.stdout + '').match(/\{[\s\S]*\}/)?.[0] ?? '{}');
check('③ doctor signal.executions（4 次 + topAction gen×3）', j.signal?.executions === 4 && String(j.signal?.topAction ?? '').includes('demochain.gen'), JSON.stringify(j.signal));

// ④ 端点活体
const PORT = String(46000 + (process.pid % 2000));
const child = spawn(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'ui', '--port', PORT], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let started = false;
child.stdout.on('data', (d) => { if (String(d).includes('已就绪')) started = true; });
for (let i = 0; i < 40 && !started; i++) await new Promise((r) => setTimeout(r, 250));
if (started) {
  const page = await fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.text());
  const tok = (page.match(/['"]([0-9a-f]{48})['"]/) ?? [])[1] ?? '';
  const r2 = await fetch(`http://127.0.0.1:${PORT}/api/stats/top-actions?n=2`, { headers: { 'x-zerokit-token': tok } }).then((r) => r.json());
  check('④ /api/stats/top-actions（total=4 + top[0]=gen count=3）', r2.total === 4 && r2.top?.[0]?.key === 'demochain.gen' && r2.top?.[0]?.count === 3, JSON.stringify(r2).slice(0, 90));
} else {
  check('ui server 启动', false, '');
}
try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
