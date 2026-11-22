// 第三百九十四轮：stats distinct——数值/string/组合/兼容
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- statsdistinct394 ${d}`); } };
console.log('statsdistinct394-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sd394-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
const { exportZeroCol } = await import('file://' + path.join(ROOT, 'src/core/arrowIpc.ts'));
fs.mkdirSync(path.join(home, 'data'), { recursive: true });
fs.writeFileSync(path.join(home, 'data', 'ec.zerocol.json'), JSON.stringify(exportZeroCol([
  { name: 'code', type: 'string', values: ['E1', 'E2', 'E1', 'E3', 'E2'] },
  { name: 'ms', type: 'int', values: [100, 200, 100, 300, 500] },
])));

const run = (a) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
const dir = path.join(home, 'plug', 'sd');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "sd"
name = "基数"
version = "0.1.0"
summary = "x"

[[action]]
id = "base"
title = "b"
description = "b"
type = "chain"
risk = "read"
template = "code.d={b.data.stats.code.distinct} ms.d={b.data.stats.ms.distinct} ms.cnt={b.data.stats.ms.count}"

[[action.step]]
use = "builtin.zerocol-stats"
as  = "b"
params = { file = "ec", columns = "code,ms", ops = "distinct,count" }

[[action]]
id = "win"
title = "w"
description = "w"
type = "chain"
risk = "read"
template = "d={w.data.stats.ms.distinct}"

[[action.step]]
use = "builtin.zerocol-stats"
as  = "w"
params = { file = "ec", column = "ms", ops = "distinct", window = 3 }

[[action]]
id = "plain"
title = "p"
description = "p"
type = "chain"
risk = "read"
template = "cnt={p.data.stats.ms.count}"

[[action.step]]
use = "builtin.zerocol-stats"
as  = "p"
params = { file = "ec", column = "ms", ops = "count" }
`);
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir], { cwd: ROOT, env, encoding: 'utf8' });

const r1 = run(['run', 'sd.base']);
check('①② distinct（code 3 种 / ms 4 种 / count=5）', r1.status === 0 && (r1.stdout + '').includes('code.d=3') && (r1.stdout + '').includes('ms.d=4') && (r1.stdout + '').includes('ms.cnt=5'), (r1.stdout + r1.stderr).slice(0, 120));
const r2 = run(['run', 'sd.win']);
check('③ window=3 内基数（最近 3 行 ms=[100,300,500] → distinct=3）', r2.status === 0 && (r2.stdout + '').includes('d=3'), (r2.stdout + r2.stderr).slice(0, 90));
const r3 = run(['run', 'sd.plain']);
check('④ 无 distinct 兼容（count=5 输出无 distinct 字样）', r3.status === 0 && (r3.stdout + '').includes('cnt=5') && !(r1.stdout + '').includes('d=undefined'), '');

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
