// 第三百八十七轮：read sort——升/降/组合/兼容
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- readsort387 ${d}`); } };
console.log('readsort387-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rs387-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
const { exportZeroCol } = await import('file://' + path.join(ROOT, 'src/core/arrowIpc.ts'));
fs.mkdirSync(path.join(home, 'data'), { recursive: true });
fs.writeFileSync(path.join(home, 'data', 'lat.zerocol.json'), JSON.stringify(exportZeroCol([
  { name: 'ms', type: 'int', values: [100, 500, 50, 300] },
  { name: 'lv', type: 'string', values: ['b', 'a', 'c', 'a'] },
])));

const run = (a) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
const dir = path.join(home, 'plug', 'rs');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "rs"
name = "排序"
version = "0.1.0"
summary = "x"

[[action]]
id = "desc"
title = "d"
description = "d"
type = "chain"
risk = "read"
template = "first={d.data.ms}"

[[action.step]]
use = "builtin.zerocol-read"
as  = "d"
params = { file = "lat", sort = "ms:desc" }

[[action]]
id = "asc"
title = "a"
description = "a"
type = "chain"
risk = "read"
template = "first={a.data.ms}"

[[action.step]]
use = "builtin.zerocol-read"
as  = "a"
params = { file = "lat", sort = "ms" }

[[action]]
id = "combo"
title = "c"
description = "c"
type = "chain"
risk = "read"
template = "first={c.data.ms} rows={c.data._rows}"

[[action.step]]
use = "builtin.zerocol-read"
as  = "c"
params = { file = "lat", where = "lv=a", sort = "ms:desc" }

[[action]]
id = "strsort"
title = "s"
description = "s"
type = "chain"
risk = "read"
template = "first={s.data.lv}"

[[action.step]]
use = "builtin.zerocol-read"
as  = "s"
params = { file = "lat", sort = "lv" }

[[action]]
id = "bad"
title = "b"
description = "b"
type = "chain"
risk = "read"
template = "{b.data._rows}"

[[action.step]]
use = "builtin.zerocol-read"
as  = "b"
params = { file = "lat", sort = "nope" }
`);
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir], { cwd: ROOT, env, encoding: 'utf8' });

const r1 = run(['run', 'rs.desc']);
check('①② sort ms:desc（首行=500 最大）', r1.status === 0 && (r1.stdout + '').includes('first=500'), (r1.stdout + r1.stderr).slice(0, 100));
const r2 = run(['run', 'rs.asc']);
check('① sort ms 升序（首行=50 最小）', r2.status === 0 && (r2.stdout + '').includes('first=50'), (r2.stdout + r2.stderr).slice(0, 90));
const r3 = run(['run', 'rs.combo']);
check('③ where+sort 组合（lv=a 行内 desc → 首行=500 rows=2——500>300）', r3.status === 0 && (r3.stdout + '').includes('first=500') && (r3.stdout + '').includes('rows=2'), (r3.stdout + r3.stderr).slice(0, 100));
const r4 = run(['run', 'rs.strsort']);
check('② string 列字典序（lv 升序首行=a）', r4.status === 0 && (r4.stdout + '').includes('first=a'), (r4.stdout + r4.stderr).slice(0, 90));
const r5 = run(['run', 'rs.bad']);
check('① 列不存在报错（nope）', r5.status !== 0 && (r5.stdout + r5.stderr + '').includes('nope'), (r5.stdout + r5.stderr).slice(0, 90));

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
