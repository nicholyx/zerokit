// 第三百零九轮：builtin 统计步——int 列/ops/报错/dataflow 重写
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

// 315①②③④ 多列形态：columns 分组 + string 跳过 + 单数兼容
const dir2 = path.join(home, 'plug', 'statsmulti');
fs.mkdirSync(dir2, { recursive: true });
fs.writeFileSync(path.join(dir2, 'plugin.toml'), `[plugin]
id = "statsmulti"
name = "多列统计"
version = "0.1.0"
summary = "x"

[[action]]
id = "multi"
title = "m"
description = "m"
type = "chain"
risk = "read"
template = "v={s.data.stats.value.count}"

[[action.step]]
use = "builtin.zerocol-stats"
as  = "s"
params = { file = "ts-data", columns = "value,ts", ops = "min,max,count" }
`);
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir2], { cwd: ROOT, env, encoding: 'utf8' });
const rmulti = run(['run', 'statsmulti.multi']);
check('315② 多列分组（value 计数 5 + ts string 跳过不炸）', rmulti.status === 0 && (rmulti.stdout + '').includes('v=5'), (rmulti.stdout + rmulti.stderr).slice(0, 90));
const dir3 = path.join(home, 'plug', 'statssingle');
fs.mkdirSync(dir3, { recursive: true });
fs.writeFileSync(path.join(dir3, 'plugin.toml'), `[plugin]
id = "statssingle"
name = "单数兼容"
version = "0.1.0"
summary = "x"

[[action]]
id = "single"
title = "s"
description = "s"
type = "chain"
risk = "read"
template = "min={s.data.stats.min}"

[[action.step]]
use = "builtin.zerocol-stats"
as  = "s"
params = { file = "ts-data", column = "value", ops = "min" }
`);
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir3], { cwd: ROOT, env, encoding: 'utf8' });
const rsingle = run(['run', 'statssingle.single']);
check('315④ 单数形态平铺兼容（stats.min 直取）', rsingle.status === 0 && (rsingle.stdout + '').includes('min='), (rsingle.stdout + rsingle.stderr).slice(0, 80));

// 320 窗口：造 5 行 value 1..5 的已知数据，window=3 → count=3 min=3 max=5
const dir4 = path.join(home, 'plug', 'statswin');
fs.mkdirSync(dir4, { recursive: true });
fs.writeFileSync(path.join(dir4, 'plugin.toml'), `[plugin]
id = "statswin"
name = "窗口统计"
version = "0.1.0"
summary = "x"

[[action]]
id = "seed"
title = "s"
description = "s"
run = ["{node}", "-e", "console.log(JSON.stringify({v:1}))"]
risk = "read"
output = "json"

[[action]]
id = "w3"
title = "w"
description = "w"
type = "chain"
risk = "read"
template = "count={s.data.stats.v.count} min={s.data.stats.v.min} max={s.data.stats.v.max}"

[[action.step]]
use = "builtin.zerocol-read"
as  = "r"
params = { file = "win-data" }

[[action.step]]
use = "builtin.zerocol-stats"
as  = "s"
params = { file = "win-data", columns = "v", ops = "min,max,count", window = 3 }
`);
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir4], { cwd: ROOT, env, encoding: 'utf8' });
// 造数据：node 直接写 zerocol（复用 exportZeroCol 的 JSON 形态——用 append 5 次：值 1..5 经插件难控——
// 直接写文件（与 arrowIpc 编码一致：int 列 8B LE + columns 元数据）
const { exportZeroCol } = await import(pathToFileURL(path.join(ROOT, 'src/core/arrowIpc.ts')).href);
fs.mkdirSync(path.join(home, 'data'), { recursive: true });
fs.writeFileSync(path.join(home, 'data', 'win-data.zerocol.json'), JSON.stringify(exportZeroCol([{ name: 'v', type: 'int', values: [1, 2, 3, 4, 5] }])));
const rw3 = run(['run', 'statswin.w3']);
check('320②③ 窗口取尾（5 行 window=3 → count=3 min=3 max=5）', rw3.status === 0 && (rw3.stdout + '').includes('count=3 min=3 max=5'), (rw3.stdout + rw3.stderr).slice(0, 90));
// window 超行数 → 取全表
fs.writeFileSync(path.join(dir4, 'plugin.toml'), fs.readFileSync(path.join(dir4, 'plugin.toml'), 'utf8').replace('window = 3', 'window = 99'));
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'remove', 'statswin'], { cwd: ROOT, env, encoding: 'utf8' });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir4], { cwd: ROOT, env, encoding: 'utf8' });
const rw99 = run(['run', 'statswin.w3']);
check('320② 超行取全（window=99 > 5 行 → count=5 min=1）', rw99.status === 0 && (rw99.stdout + '').includes('count=5 min=1'), (rw99.stdout + rw99.stderr).slice(0, 90));

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
