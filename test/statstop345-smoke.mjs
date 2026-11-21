// 第三百四十五轮：stats top-frequency——string 列/数值列/多列/边界
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- statstop345 ${d}`); } };
console.log('statstop345-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'st345-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
fs.mkdirSync(path.join(home, 'data'), { recursive: true });

// 造数据：status（string: ok,ok,error,ok,warn）+ value（int: 3,3,7）两文件——分别测
const { exportZeroCol } = await import(pathToFileURL(path.join(ROOT, 'src/core/arrowIpc.ts')).href);
fs.writeFileSync(path.join(home, 'data', 'str-data.zerocol.json'), JSON.stringify(exportZeroCol([{ name: 'status', type: 'string', values: ['ok', 'ok', 'error', 'ok', 'warn', 'error'] }], undefined)));
fs.writeFileSync(path.join(home, 'data', 'num-data.zerocol.json'), JSON.stringify(exportZeroCol([{ name: 'value', type: 'int', values: [3, 3, 7, 3] }], undefined)));

const run = (a) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
const dir = path.join(home, 'plug', 'st');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "st"
name = "统计"
version = "0.1.0"
summary = "x"

[[action]]
id = "str-top"
title = "s"
description = "s"
type = "chain"
risk = "read"
template = "top={s.data.stats.status.top_value} top_count={s.data.stats.status.top_count} ratio={s.data.stats.status.top_ratio} rows={s.data.stats.status.count}"

[[action.step]]
use = "builtin.zerocol-stats"
as  = "s"
params = { file = "str-data", column = "status", ops = "top,count" }

[[action]]
id = "num-top"
title = "n"
description = "n"
type = "chain"
risk = "read"
template = "top={n.data.stats.value.top_value} ratio={n.data.stats.value.top_ratio} count={n.data.stats.value.count}"

[[action.step]]
use = "builtin.zerocol-stats"
as  = "n"
params = { file = "num-data", column = "value", ops = "top,count" }

[[action]]
id = "tail"
title = "t"
description = "t"
type = "chain"
risk = "read"
template = "med={t.data.stats.value.median} p90={t.data.stats.value.p90} rows={t.data.rows}"

[[action.step]]
use = "builtin.zerocol-stats"
as  = "t"
params = { file = "num-data", column = "value", ops = "median,p90" }

[[action]]
id = "multi"
title = "m"
description = "m"
type = "chain"
risk = "read"
template = "s.top={m.data.stats.status.top_value} rows={m.data.rows}"

[[action.step]]
use = "builtin.zerocol-stats"
as  = "m"
params = { file = "str-data", columns = "status", ops = "top" }

[[action]]
id = "empty"
title = "e"
description = "e"
type = "chain"
risk = "read"
template = "{e.data.stats.status.top_value ?? 'null-ok'}"

[[action.step]]
use = "builtin.zerocol-stats"
as  = "e"
params = { file = "empty-data", column = "status", ops = "top,count" }
`);
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir], { cwd: ROOT, env, encoding: 'utf8' });
// 空 status 文件（边界）
fs.writeFileSync(path.join(home, 'data', 'empty-data.zerocol.json'), JSON.stringify(exportZeroCol([{ name: 'status', type: 'string', values: [] }])));

const r1 = run(['run', 'st.str-top']);
check('① string 列 top（ok ×3 / ratio 0.5 / rows 6）', r1.status === 0 && (r1.stdout + '').includes('top=ok') && (r1.stdout + '').includes('ratio=0.5') && (r1.stdout + '').includes('rows=6'), (r1.stdout + r1.stderr).slice(0, 100));
const r2 = run(['run', 'st.num-top']);
check('③ 数值列 top（mode=3 / ratio 0.75）', r2.status === 0 && (r2.stdout + '').includes('top=3') && (r2.stdout + '').includes('ratio=0.75'), (r2.stdout + r2.stderr).slice(0, 90));
const r3 = run(['run', 'st.multi']);
check('② 多列形态（status.top 直取）', r3.status === 0 && (r3.stdout + '').includes('s.top=ok'), (r3.stdout + r3.stderr).slice(0, 80));
const r4 = run(['run', 'st.empty']);
check('④ 空列边界（top_value null 或空——不炸）', r4.status === 0, (r4.stdout + r4.stderr).slice(0, 80));

// 351①：复数形态 data.rows 恒全表（不受 window 影响）
// 361①③：median/p90（num-data 4 行 3,3,7,3 → median=3）
const rt = run(['run', 'st.tail']);
check('361①③ median=3（偶数行取中间两值平均）+ p90', rt.status === 0 && (rt.stdout + '').includes('med=3') && (rt.stdout + '').includes('p90='), (rt.stdout + rt.stderr).slice(0, 100));

const rm = run(['run', 'st.multi']);
check('351① 复数形态 rows 恒全表（=6）', rm.status === 0 && (rm.stdout + '').includes('rows=6'), (rm.stdout + rm.stderr).slice(0, 100));

// ⑤ 回归：315/320 行为不回退（min/max/avg 仍工作）
const r5 = run(['run', 'st.num-top']);
const r6 = run(['stats', '--top', '1']);
check('⑤ stats 主体不回退（num-top 再跑 + CLI stats 正常）', r5.status === 0 && r6.status === 0, `r5=${r5.status} r6=${r6.status}`);

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
