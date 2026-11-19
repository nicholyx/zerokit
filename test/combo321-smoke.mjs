// 第三百二十一轮：数据工作流组合拳回顾——多列 append → window 多列 stats 端到端
// 组合 315（多列）/301（append）/320（window）三轮能力，单一链路串验（收官回归）。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- combo321 ${d}`); } };
console.log('combo321-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cb321-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
const run = (a) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });

// ① 组合链路插件：gen（value=固定 1..5 演进 + score=10..50）→ append 多列 → stats 多列 window=3
const dir = path.join(home, 'plug', 'combo');
fs.mkdirSync(dir, { recursive: true });
// 用计数器文件让每次 gen 产出递增（value=n, score=n*10）——append 5 次得 value 1..5, score 10..50
fs.writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "combo"
name = "组合拳"
version = "0.1.0"
summary = "x"

[[action]]
id = "gen"
title = "g"
description = "g"
run = ["{node}", "-e", "const fs=require('fs'),p=process.env.ZEROKIT_HOME+'/cnt.txt';const n=fs.existsSync(p)?Number(fs.readFileSync(p,'utf8'))+1:1;fs.writeFileSync(p,String(n));console.log(JSON.stringify({value:n,score:n*10}))"]
risk = "read"
output = "json"

[[action]]
id = "append2"
title = "a"
description = "a"
type = "chain"
risk = "read"
template = "{s.stdout}"

[[action.step]]
use = "self.gen"
as  = "g"

[[action.step]]
use = "builtin.zerocol-export"
as  = "s"
params = { file = "combo-data", mode = "append", columns = [
  { name = "value", type = "int", from = "g.data.value" },
  { name = "score", type = "int", from = "g.data.score" },
] }

[[action]]
id = "wstats"
title = "w"
description = "w"
type = "chain"
risk = "read"
template = "v[min={s.data.stats.value.min},{s.data.stats.value.max}] sc[min={s.data.stats.score.min},{s.data.stats.score.max}]"

[[action.step]]
use = "builtin.zerocol-stats"
as  = "s"
params = { file = "combo-data", columns = "value,score", ops = "min,max", window = 3 }

[[action]]
id = "astats"
title = "a"
description = "a"
type = "chain"
risk = "read"
template = "v[min={s.data.stats.value.min},{s.data.stats.value.max}]"

[[action.step]]
use = "builtin.zerocol-stats"
as  = "s"
params = { file = "combo-data", columns = "value,score", ops = "min,max" }
`);
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir], { cwd: ROOT, env, encoding: 'utf8' });

// ①④ 跑两轮：第一轮 5 次（value 1..5），再 3 次（value 6..8 → 滚动到 8 行）
for (let i = 0; i < 5; i++) run(['run', 'combo.append2']);
const zc5 = JSON.parse(fs.readFileSync(path.join(home, 'data', 'combo-data.zerocol.json'), 'utf8'));
check('① 多列 append ×5 → 两列各 5 行', zc5.columns[0].count === 5 && zc5.columns[1].count === 5, `${zc5.columns.map((c) => c.count).join('/')}`);

// ② 窗口统计：value 尾 3 行 = 3,4,5 → min=3 max=5；score 尾 3 = 30,40,50 → min=30 max=50
const rw = run(['run', 'combo.wstats']);
check('② 多列 window=3（value 3..5 / score 30..50）', rw.status === 0 && (rw.stdout + '').includes('v[min=3,5] sc[min=30,50]'), (rw.stdout + rw.stderr).slice(0, 90));

// ③ 全表对照：value 1..5 → min=1（窗口没生效时会是 1——防假绿）
const ra = run(['run', 'combo.astats']);
check('③ 全表对照（min=1 ≠ 窗口 min=3——窗口真生效）', ra.status === 0 && (ra.stdout + '').includes('v[min=1,5]'), (ra.stdout + ra.stderr).slice(0, 80));

// ④ 第二轮 3 次：value 6..8 → 8 行全表 min=1 max=8；窗口尾 3 = 6,7,8 → min=6
for (let i = 0; i < 3; i++) run(['run', 'combo.append2']);
const rw2 = run(['run', 'combo.wstats']);
check('④ 数据演进（8 行后窗口 value min=6 max=8）', rw2.status === 0 && (rw2.stdout + '').includes('v[min=6,8] sc[min=60,80]'), (rw2.stdout + rw2.stderr).slice(0, 90));

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
