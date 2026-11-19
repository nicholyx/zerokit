// 第三百零八轮：dataflow 端到端——三动作/积累/消费/登记
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- dataflow308 ${d}`); } };
console.log('dataflow308-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'df308-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'remove', 'dataflow'], { cwd: ROOT, env, encoding: 'utf8' });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', path.join(ROOT, 'plugins', 'dataflow')], { cwd: ROOT, env, encoding: 'utf8' });
const run = (a) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });

// ②⑤ 跑 5 次 append → 5 行
for (let i = 0; i < 5; i++) run(['run', 'dataflow.append-ts']);
const zc = JSON.parse(fs.readFileSync(path.join(home, 'data', 'ts-data.zerocol.json'), 'utf8'));
check('②⑤ 5 次 append → ts-data 5 行', zc.columns[0].count === 5, String(zc.columns[0].count));

// ③ consume-ts 汇总（_rows=5）
const r1 = run(['run', 'dataflow.consume-ts']);
check('③ consume-ts 汇总（共 5 行样本）', r1.status === 0 && (r1.stdout + '').includes('共 5 行样本'), (r1.stdout + r1.stderr).slice(0, 80));

// ③b consume-detail 明细（rows/min/max JSON）
const r2 = run(['run', 'dataflow.consume-detail']);
const m = (r2.stdout + '').match(/min=(-?\d+) max=(-?\d+) avg=([\d.]+)（(\d+) 行）/);
check('③ consume-detail（stats 步：min/max/avg + 5 行）', r2.status === 0 && m && m[4] === '5' && Number.isFinite(Number(m[1])) && Number.isFinite(Number(m[2])), (r2.stdout + '').slice(0, 80));

// ⑤ market 登记
const mk = JSON.parse(fs.readFileSync(path.join(ROOT, 'market.json'), 'utf8'));
check('⑤ market.json 登记 dataflow', (mk.plugins ?? []).some((e) => e.id === 'dataflow'), '');

// ① 注释闭环说明（指向指南）
const toml = fs.readFileSync(path.join(ROOT, 'plugins', 'dataflow', 'plugin.toml'), 'utf8');
check('①④ 注释串起指南（data-pipelines + 定时积累）', toml.includes('data-pipelines.md') && toml.includes('定时积累'), '');

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
