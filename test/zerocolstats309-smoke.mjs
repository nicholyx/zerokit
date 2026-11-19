// 第三百零九轮：builtin 统计步——int 列/ops/报错/dataflow 重写
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- zerocolstats309 ${d}`); } };
console.log('zerocolstats309-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zs309-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'remove', 'dataflow'], { cwd: ROOT, env, encoding: 'utf8' });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', path.join(ROOT, 'plugins', 'dataflow')], { cwd: ROOT, env, encoding: 'utf8' });
const run = (a) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });

// 前置：5 次 append
for (let i = 0; i < 5; i++) run(['run', 'dataflow.append-ts']);

// ②③⑤ 活体：stats 步 min/max/avg/count
const r1 = run(['run', 'dataflow.consume-detail']);
const m = (r1.stdout + '').match(/min=(-?\d+) max=(-?\d+) avg=([\d.]+)（(\d+) 行）/);
check('②③⑤ 活体统计（min/max/avg/count 五行样本）', r1.status === 0 && m && m[4] === '5', (r1.stdout + r1.stderr).slice(0, 90));

// ⑥ string 列报错
const dir = path.join(home, 'plug', 'statstest');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "statstest"
name = "统计测试"
version = "0.1.0"
summary = "x"

[[action]]
id = "stats-string"
title = "s"
description = "s"
type = "chain"
risk = "read"
template = "x"

[[action.step]]
use = "builtin.zerocol-stats"
as  = "s"
params = { file = "ts-data", column = "ts", ops = "min,max" }

[[action]]
id = "stats-badops"
title = "b"
description = "b"
type = "chain"
risk = "read"
template = "x"

[[action.step]]
use = "builtin.zerocol-stats"
as  = "s"
params = { file = "ts-data", column = "value", ops = "median" }
`);
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir], { cwd: ROOT, env, encoding: 'utf8' });
const r2 = run(['run', 'statstest.stats-string']);
check('⑥ string 列明确报错（只支持 int/double）', r2.status !== 0 && (r2.stderr + r2.stdout).includes('int/double'), (r2.stderr + r2.stdout).slice(0, 80));
const r3 = run(['run', 'statstest.stats-badops']);
check('⑥ 非法 ops 报错（median 不支持）', r3.status !== 0 && (r3.stderr + r3.stdout).includes('min/max/avg/count'), (r3.stderr + r3.stdout).slice(0, 80));

// ① 源码面：plan 放行三内建步
const src = fs.readFileSync(path.join(ROOT, 'src', 'core', 'runner.ts'), 'utf8');
check('① plan 放行三内建步（export/read/stats）', src.includes("'builtin.zerocol-stats'") && (src.match(/builtin\.zerocol-stats/g) ?? []).length >= 2, '');

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
