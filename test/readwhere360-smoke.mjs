// 第三百六十轮：zerocol-read where 行过滤——筛选/报错/兼容/组合
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- readwhere360 ${d}`); } };
console.log('readwhere360-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rw360-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
const { exportZeroCol } = await import(pathToFileURL(path.join(ROOT, 'src/core/arrowIpc.ts')).href);
fs.mkdirSync(path.join(home, 'data'), { recursive: true });
fs.writeFileSync(path.join(home, 'data', 'log.zerocol.json'), JSON.stringify(exportZeroCol([
  { name: 'level', type: 'string', values: ['error', 'info', 'error', 'warn'] },
  { name: 'msg', type: 'string', values: ['e1', 'i1', 'e2', 'w1'] },
])));

const run = (a) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
const dir = path.join(home, 'plug', 'rw');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "rw"
name = "行筛"
version = "0.1.0"
summary = "x"

[[action]]
id = "errors"
title = "e"
description = "e"
type = "chain"
risk = "read"
template = "rows={e.data._rows} first={e.data.msg}"

[[action.step]]
use = "builtin.zerocol-read"
as  = "e"
params = { file = "log", where = "level=error" }

[[action]]
id = "combo"
title = "c"
description = "c"
type = "chain"
risk = "read"
template = "rows={c.data._rows} cols={c.data._columns} m0={c.data.msg}"

[[action.step]]
use = "builtin.zerocol-read"
as  = "c"
params = { file = "log", where = "level=error", columns = "msg" }

[[action]]
id = "all"
title = "a"
description = "a"
type = "chain"
risk = "read"
template = "rows={a.data._rows}"

[[action.step]]
use = "builtin.zerocol-read"
as  = "a"
params = { file = "log" }

[[action]]
id = "multi"
title = "m"
description = "m"
type = "chain"
risk = "read"
template = "rows={m.data._rows}"

[[action.step]]
use = "builtin.zerocol-read"
as  = "m"
params = { file = "log", where = "level=error,warn" }

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
params = { file = "log", where = "nope=1" }
`);
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir], { cwd: ROOT, env, encoding: 'utf8' });

const r1 = run(['run', 'rw.errors']);
check('①② where 筛选（level=error → rows=2、首条 msg=e1）', r1.status === 0 && (r1.stdout + '').includes('rows=2') && (r1.stdout + '').includes('first=e1'), (r1.stdout + r1.stderr).slice(0, 100));
const r2 = run(['run', 'rw.combo']);
check('③ where+columns 组合（rows=2 cols=1）', r2.status === 0 && (r2.stdout + '').includes('rows=2') && (r2.stdout + '').includes('cols=1'), (r2.stdout + r2.stderr).slice(0, 90));
const r3 = run(['run', 'rw.all']);
check('③ 无 where 行为不变（rows=4 全表）', r3.status === 0 && (r3.stdout + '').includes('rows=4'), (r3.stdout + r3.stderr).slice(0, 80));
const rm2 = run(['run', 'rw.multi']);
check('378① read where 多值 OR（error,warn → rows=3）', rm2.status === 0 && (rm2.stdout + '').includes('rows=3'), (rm2.stdout + rm2.stderr).slice(0, 90));
const r4 = run(['run', 'rw.bad']);
check('① 列不存在报错（nope）', r4.status !== 0 && (r4.stdout + r4.stderr + '').includes('nope'), (r4.stdout + r4.stderr).slice(0, 90));

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
