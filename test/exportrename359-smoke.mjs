// 第三百五十九轮：zerocol-export rename——写侧列改名对称
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- exportrename359 ${d}`); } };
console.log('exportrename359-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'er359-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });

const run = (a) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });

const dir = path.join(home, 'plug', 'er');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "er"
name = "改名"
version = "0.1.0"
summary = "x"

[[action]]
id = "renamed"
title = "r"
description = "r"
type = "chain"
risk = "read"
template = "exp-done"

[[action.step]]
use = "builtin.zerocol-export"
as  = "r"
params = { file = "renamed-data", rename = "old_name:new_name, ghost:whatever", columns = [
  { name = "old_name", type = "int", from = "1" },
  { name = "keep", type = "string", from = "a" },
] }

[[action]]
id = "plain"
title = "p"
description = "p"
type = "chain"
risk = "read"
template = "plain-done"

[[action.step]]
use = "builtin.zerocol-export"
as  = "p"
params = { file = "plain-data", columns = [
  { name = "old_name", type = "int", from = "2" },
] }
`, 'utf8');
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir], { cwd: ROOT, env, encoding: 'utf8' });


const r1 = run(['run', 'er.renamed']);
check('① rename 成功（old_name→new_name；ghost 忽略）', r1.status === 0 && (r1.stdout + '').includes('exp-done'), (r1.stdout + r1.stderr).slice(0, 120));
const data = JSON.parse(fs.readFileSync(path.join(home, 'data', 'renamed-data.zerocol.json'), 'utf8'));
const names = (data.columns ?? []).map((c) => c.name);
check('② 数据集列名已改（new_name 在、old_name 不在、keep 保留）', names.includes('new_name') && !names.includes('old_name') && names.includes('keep'), names.join(','));
const r2 = run(['run', 'er.plain']);
check('③ 无 rename 行为不变（plain-data 列名不变）', r2.status === 0 && JSON.parse(fs.readFileSync(path.join(home, 'data', 'plain-data.zerocol.json'), 'utf8')).columns.some((c) => c.name === 'old_name'), JSON.stringify(JSON.parse(fs.readFileSync(path.join(home, 'data', 'plain-data.zerocol.json'), 'utf8')).columns?.map?.((c) => c.name)));
const r3 = run(['run', 'er.plain']);
check('④ 幂等（再跑一次仍成功）', r3.status === 0, String(r3.status));

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
