// 第三百五十八轮：zerocol-read columns 投影——列裁剪/报错/兼容
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- readproj358 ${d}`); } };
console.log('readproj358-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rp358-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
const { exportZeroCol } = await import(pathToFileURL(path.join(ROOT, 'src/core/arrowIpc.ts')).href);
fs.mkdirSync(path.join(home, 'data'), { recursive: true });
fs.writeFileSync(path.join(home, 'data', 'wide.zerocol.json'), JSON.stringify(exportZeroCol([
  { name: 'ts', type: 'string', values: ['a', 'b'] },
  { name: 'value', type: 'int', values: [1, 2] },
  { name: 'level', type: 'string', values: ['x', 'y'] },
])));

const run = (a) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });

const dir = path.join(home, 'plug', 'rp');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "rp"
name = "投影"
version = "0.1.0"
summary = "x"

[[action]]
id = "proj"
title = "p"
description = "p"
type = "chain"
risk = "read"
template = "cols={r.data._columns} v0={r.data.value} ts0={r.data.ts}"

[[action.step]]
use = "builtin.zerocol-read"
as  = "r"
params = { file = "wide", columns = "value,ts" }

[[action]]
id = "all"
title = "a"
description = "a"
type = "chain"
risk = "read"
template = "cols={a.data._columns}"

[[action.step]]
use = "builtin.zerocol-read"
as  = "a"
params = { file = "wide" }

[[action]]
id = "bad"
title = "b"
description = "b"
type = "chain"
risk = "read"
template = "{b.data._columns}"

[[action.step]]
use = "builtin.zerocol-read"
as  = "b"
params = { file = "wide", columns = "nope" }
`);
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir], { cwd: ROOT, env, encoding: 'utf8' });

const r1 = run(['run', 'rp.proj']);
check('① 投影（columns=value,ts → _columns=2；value 首行=1）', r1.status === 0 && (r1.stdout + '').includes('cols=2') && (r1.stdout + '').includes('v0=1'), (r1.stdout + r1.stderr).slice(0, 100));
const r2 = run(['run', 'rp.all']);
check('③ 无 columns 行为不变（_columns=3）', r2.status === 0 && (r2.stdout + '').includes('cols=3'), (r2.stdout + r2.stderr).slice(0, 80));
const r3 = run(['run', 'rp.bad']);
check('② 列不存在报错（nope + 有：ts、value、level）', r3.status !== 0 && (r3.stderr + r3.stdout + '').includes('nope') && (r3.stderr + r3.stdout + '').includes('level'), (r3.stdout + r3.stderr).slice(0, 100));
const r4 = run(['run', 'rp.proj']);
check('④ 投影生效（_columns=2 < 全列 3；列序按参数）', r4.status === 0 && (r4.stdout + '').includes('cols=2') && (r4.stdout + '').includes('ts0=a'), (r4.stdout + '').slice(0, 100));

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
