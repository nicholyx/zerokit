// 第三百六十六轮：stats where 组合——筛选统计/列报错/window 组合/兼容
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- statswhere366 ${d}`); } };
console.log('statswhere366-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sw366-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
const { exportZeroCol } = await import(pathToFileURL(path.join(ROOT, 'src/core/arrowIpc.ts')).href);
fs.mkdirSync(path.join(home, 'data'), { recursive: true });
// level + ms：error 行的 ms 更高（筛选后 avg 应只算 error 行）
fs.writeFileSync(path.join(home, 'data', 'mix.zerocol.json'), JSON.stringify(exportZeroCol([
  { name: 'level', type: 'string', values: ['info', 'error', 'info', 'error'] },
  { name: 'ms', type: 'int', values: [10, 500, 20, 900] },
])));

const run = (a) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
const dir = path.join(home, 'plug', 'sw');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "sw"
name = "筛统"
version = "0.1.0"
summary = "x"

[[action]]
id = "erravg"
title = "e"
description = "e"
type = "chain"
risk = "read"
template = "avg={s.data.stats.ms.avg} count={s.data.stats.ms.count} top={s.data.stats.level.top_value}"

[[action.step]]
use = "builtin.zerocol-stats"
as  = "s"
params = { file = "mix", columns = "ms,level", ops = "avg,count,top", where = "level=error" }

[[action]]
id = "plain"
title = "p"
description = "p"
type = "chain"
risk = "read"
template = "avg={p.data.stats.ms.avg} count={p.data.stats.ms.count}"

[[action.step]]
use = "builtin.zerocol-stats"
as  = "p"
params = { file = "mix", columns = "ms", ops = "avg,count" }

[[action]]
id = "bad"
title = "b"
description = "b"
type = "chain"
risk = "read"
template = "{b.data.stats.ms.count}"

[[action.step]]
use = "builtin.zerocol-stats"
as  = "b"
params = { file = "mix", columns = "ms", ops = "count", where = "nope=1" }
`);
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir], { cwd: ROOT, env, encoding: 'utf8' });

const r1 = run(['run', 'sw.erravg']);
// error 行 ms=500,900 → avg=700；count=2；level top=error（筛选后只有 error）
check('①② where 筛选统计（avg=700 count=2 top=error）', r1.status === 0 && (r1.stdout + '').includes('avg=700') && (r1.stdout + '').includes('count=2') && (r1.stdout + '').includes('top=error'), (r1.stdout + r1.stderr).slice(0, 120));
const r2 = run(['run', 'sw.plain']);
check('④ 无 where 行为不变（avg=357.5 count=4 全表）', r2.status === 0 && (r2.stdout + '').includes('count=4'), (r2.stdout + r2.stderr).slice(0, 90));
const r3 = run(['run', 'sw.bad']);
check('① 列不存在报错（nope——与 read 同文案）', r3.status !== 0 && (r3.stdout + r3.stderr + '').includes('nope'), (r3.stdout + r3.stderr).slice(0, 90));
const r4 = run(['run', 'sw.erravg']);
check('③ 幂等（再跑仍 avg=700）', r4.status === 0 && (r4.stdout + '').includes('avg=700'), '');

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
