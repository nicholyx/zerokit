// 第三百七十九轮：stats percol 逐列 ops——覆盖/兼容
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- statspercol379 ${d}`); } };
console.log('statspercol379-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pc379-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
fs.mkdirSync(path.join(home, 'data'), { recursive: true });
const { exportZeroCol } = await import('file://' + path.join(ROOT, 'src/core/arrowIpc.ts'));
fs.writeFileSync(path.join(home, 'data', 'pc.zerocol.json'), JSON.stringify(exportZeroCol([
  { name: 'ms', type: 'int', values: [10, 500, 20] },
  { name: 'level', type: 'string', values: ['info', 'error', 'info'] },
])));

const run = (a) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
const dir = path.join(home, 'plug', 'pc');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "pc"
name = "逐列"
version = "0.1.0"
summary = "x"

[[action]]
id = "mixed"
title = "m"
description = "m"
type = "chain"
risk = "read"
template = "ms.med={p.data.stats.ms.median} lv.top={p.data.stats.level.top_value}"

[[action.step]]
use = "builtin.zerocol-stats"
as  = "p"
params = { file = "pc", columns = "ms,level", ops = "median", percol = "level:top" }

[[action]]
id = "plain"
title = "p"
description = "p"
type = "chain"
risk = "read"
template = "ms.med={q.data.stats.ms.median}"

[[action.step]]
use = "builtin.zerocol-stats"
as  = "q"
params = { file = "pc", columns = "ms", ops = "median" }
`);
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir], { cwd: ROOT, env, encoding: 'utf8' });

const r1 = run(['run', 'pc.mixed']);
check('①② percol 覆盖（ms 只 median=20；level 只 top=info）', r1.status === 0 && (r1.stdout + '').includes('ms.med=20') && (r1.stdout + '').includes('lv.top=info'), (r1.stdout + r1.stderr).slice(0, 120));
const r2 = run(['run', 'pc.plain']);
check('③ 无 percol 行为不变（ms.median=20）', r2.status === 0 && (r2.stdout + '').includes('ms.med=20'), (r2.stdout + r2.stderr).slice(0, 90));
const r3 = run(['run', 'pc.mixed']);
check('④ 幂等', r3.status === 0 && (r3.stdout + '').includes('lv.top=info'), '');

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
