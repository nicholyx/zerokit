// 第三百八十四轮：export select——append 列选择/报错/兼容
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- exportselect384 ${d}`); } };
console.log('exportselect384-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'es384-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
const { exportZeroCol, importZeroCol } = await import('file://' + path.join(ROOT, 'src/core/arrowIpc.ts'));
fs.mkdirSync(path.join(home, 'data'), { recursive: true });
// 基线文件：a=1 c=10（一行）
fs.writeFileSync(path.join(home, 'data', 'sel.zerocol.json'), JSON.stringify(exportZeroCol([
  { name: 'a', type: 'int', values: [1] },
  { name: 'c', type: 'int', values: [10] },
])));

const run = (a) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
const dir = path.join(home, 'plug', 'es');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "es"
name = "x"
version = "0.1.0"
summary = "x"

[[action]]
id = "part"
title = "p"
description = "p"
type = "chain"
risk = "read"
template = "part-done"

[[action.step]]
use = "builtin.zerocol-read"
as  = "r"
params = { file = "seed", columns = "v" }

[[action.step]]
use = "builtin.zerocol-export"
as  = "p"
params = { file = "sel", mode = "append", select = "a", columns = [
  { name = "a", type = "int", from = "r.data.v" },
] }

[[action]]
id = "bad"
title = "x"
description = "x"
type = "chain"
risk = "read"
template = "bad-done"

[[action.step]]
use = "builtin.zerocol-read"
as  = "r2"
params = { file = "seed", columns = "v" }

[[action.step]]
use = "builtin.zerocol-export"
as  = "x"
params = { file = "sel", mode = "append", select = "zzz", columns = [
  { name = "a", type = "int", from = "r2.data.v" },
] }
`);
// seed 文件（read 步取值 2）
fs.writeFileSync(path.join(home, 'data', 'seed.zerocol.json'), JSON.stringify(exportZeroCol([
  { name: 'v', type: 'int', values: [2] },
])));
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir], { cwd: ROOT, env, encoding: 'utf8' });

const r2 = run(['run', 'es.part']);
check('①② select=a append（a 追加 2；c 保留 10）', r2.status === 0 && (r2.stdout + '').includes('part-done'), (r2.stdout + r2.stderr).slice(0, 120));
const cols = importZeroCol(JSON.parse(fs.readFileSync(path.join(home, 'data', 'sel.zerocol.json'), 'utf8')));
const colA = cols.find((c) => c.name === 'a');
const colC = cols.find((c) => c.name === 'c');
check('①② 数据验证（a=[1,2]；c=[10,null→旧值保留型]）', JSON.stringify(colA?.values) === JSON.stringify([1, 2]) && colC && colC.values.length === 2, `a=${JSON.stringify(colA?.values)} c=${JSON.stringify(colC?.values)}`);
const r3 = run(['run', 'es.bad']);
check('① select 列不在声明中报错（zzz）', r3.status !== 0 && (r3.stdout + r3.stderr + '').includes('zzz'), (r3.stdout + r3.stderr).slice(0, 90));

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
