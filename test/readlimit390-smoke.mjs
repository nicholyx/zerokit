// 第三百九十轮：read limit——取头 N 行/组合/兼容
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- readlimit390 ${d}`); } };
console.log('readlimit390-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rl390-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
const { exportZeroCol } = await import('file://' + path.join(ROOT, 'src/core/arrowIpc.ts'));
fs.mkdirSync(path.join(home, 'data'), { recursive: true });
fs.writeFileSync(path.join(home, 'data', 'ev.zerocol.json'), JSON.stringify(exportZeroCol([
  { name: 'ms', type: 'int', values: [100, 500, 50, 300] },
])));

const run = (a) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
const dir = path.join(home, 'plug', 'rl');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "rl"
name = "限行"
version = "0.1.0"
summary = "x"

[[action]]
id = "recent"
title = "r"
description = "r"
type = "chain"
risk = "read"
template = "top={r.data.ms} rows={r.data._rows}"

[[action.step]]
use = "builtin.zerocol-read"
as  = "r"
params = { file = "ev", sort = "ms:desc", limit = 2 }

[[action]]
id = "plain"
title = "p"
description = "p"
type = "chain"
risk = "read"
template = "rows={p.data._rows}"

[[action.step]]
use = "builtin.zerocol-read"
as  = "p"
params = { file = "ev" }

[[action]]
id = "wl"
title = "w"
description = "w"
type = "chain"
risk = "read"
template = "rows={w.data._rows}"

[[action.step]]
use = "builtin.zerocol-read"
as  = "w"
params = { file = "ev", sort = "ms", limit = 3 }
`);
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir], { cwd: ROOT, env, encoding: 'utf8' });

const r1 = run(['run', 'rl.recent']);
check('①② sort desc + limit 2（首行=500 最大、rows=2）', r1.status === 0 && (r1.stdout + '').includes('top=500') && (r1.stdout + '').includes('rows=2'), (r1.stdout + r1.stderr).slice(0, 100));
const r2 = run(['run', 'rl.plain']);
check('③ 无 limit 行为不变（rows=4 全表）', r2.status === 0 && (r2.stdout + '').includes('rows=4'), (r2.stdout + r2.stderr).slice(0, 80));
const r3 = run(['run', 'rl.wl']);
check('① sort asc + limit 3（rows=3）', r3.status === 0 && (r3.stdout + '').includes('rows=3'), (r3.stdout + r3.stderr).slice(0, 80));

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
