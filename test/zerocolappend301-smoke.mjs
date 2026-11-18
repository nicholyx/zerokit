// 第三百零一轮：zerocol append——追加/合并语义/上限/回报
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- zerocolappend301 ${d}`); } };
console.log('zerocolappend301-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'za301-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'remove', 'demochain'], { cwd: ROOT, env, encoding: 'utf8' });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', path.join(ROOT, 'plugins', 'demochain')], { cwd: ROOT, env, encoding: 'utf8' });
const run = (args) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });

// ①②⑤ 跑三次 append → 三行
for (let i = 0; i < 3; i++) run(['run', 'demochain.pipe-append']);
const f1 = JSON.parse(fs.readFileSync(path.join(home, 'data', 'append-demo.zerocol.json'), 'utf8'));
check('①②⑤ 三次 append → 3 行', f1.columns[0].count === 3, String(f1.columns[0].count));

// ③ 上限：rowsLimit=5 的链再跑 8 次 → 5 行
const dir = path.join(home, 'plug', 'capdemo');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "capdemo"
name = "上限演示"
version = "0.1.0"
summary = "x"

[[action]]
id = "gen2"
title = "g"
description = "g"
run = ["{node}", "-e", "console.log(JSON.stringify({value:7}))"]
risk = "read"
output = "json"

[[action]]
id = "cap-append"
title = "c"
description = "c"
type = "chain"
risk = "read"
template = "{s}"

[[action.step]]
use = "self.gen2"
as  = "g"

[[action.step]]
use = "builtin.zerocol-export"
as  = "s"
params = { file = "cap-demo", mode = "append", rowsLimit = 5, columns = [{ name = "value", type = "int", from = "g.data.value" }] }
`);
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir], { cwd: ROOT, env, encoding: 'utf8' });
for (let i = 0; i < 8; i++) run(['run', 'capdemo.cap-append']);
const f2 = JSON.parse(fs.readFileSync(path.join(home, 'data', 'cap-demo.zerocol.json'), 'utf8'));
check('③ rowsLimit=5 截断（8 次 → 5 行）', f2.columns[0].count === 5, String(f2.columns[0].count));

// ② 合并语义：旧缺列补空（旧文件只有 value，新声明加 extra → 旧行 extra 为 null）
const dir2 = path.join(home, 'plug', 'colmerge');
fs.mkdirSync(dir2, { recursive: true });
fs.writeFileSync(path.join(dir2, 'plugin.toml'), `[plugin]
id = "colmerge"
name = "列合并"
version = "0.1.0"
summary = "x"

[[action]]
id = "g3"
title = "g"
description = "g"
run = ["{node}", "-e", "console.log(JSON.stringify({value:9, extra:'e}))"].join(''].replace(")]\"", ")\"'")  + '"'
risk = "read"
output = "json"
`);
// 上面字符串拼接太绕——直接干净重写
fs.writeFileSync(path.join(dir2, 'plugin.toml'), `[plugin]
id = "colmerge"
name = "列合并"
version = "0.1.0"
summary = "x"

[[action]]
id = "g3"
title = "g"
description = "g"
run = ["{node}", "-e", "console.log(JSON.stringify({value:9,extra:'e'}))"]
risk = "read"
output = "json"

[[action]]
id = "m-append"
title = "m"
description = "m"
type = "chain"
risk = "read"
template = "{s}"

[[action.step]]
use = "self.g3"
as  = "g"

[[action.step]]
use = "builtin.zerocol-export"
as  = "s"
params = { file = "cap-demo", mode = "append", columns = [{ name = "value", type = "int", from = "g.data.value" }, { name = "extra", type = "string", from = "g.data.extra" }] }
`);
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir2], { cwd: ROOT, env, encoding: 'utf8' });
run(['run', 'colmerge.m-append']);
const { importZeroCol } = await import(pathToFileURL(path.join(ROOT, 'src/core/arrowIpc.ts')).href);
const f3 = importZeroCol(JSON.parse(fs.readFileSync(path.join(home, 'data', 'cap-demo.zerocol.json'), 'utf8')));
const extraCol = f3.find((c) => c.name === 'extra');
const oldRowsHaveNull = extraCol.values.slice(0, 5).every((v) => v === null || v === undefined || v === '');
const newRowHasE = extraCol.values[5] === 'e';
check('② 新列补空（旧 5 行 extra 空 + 新行 e）', extraCol.values.length === 6 && extraCol.values.slice(0, 5).every((v) => !v) && extraCol.values[5] === 'e', JSON.stringify(extraCol.values));

// ④ 回报 mode 标注
const rcm = run(['run', 'colmerge.m-append']); if (process.env.ZK_DBG) console.error('[cm] ' + (rcm.stdout + rcm.stderr).slice(0, 120));
const r4 = run(['run', 'demochain.pipe-append', '--json']);
const j = JSON.parse((r4.stdout.match(/\{[\s\S]*\}/) ?? ['{}'])[0]);
check('④ 回报含 mode=append（stdout 或 json 形态）', (r4.stdout + '').includes('append') || JSON.stringify(j).includes('append'), '');

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
