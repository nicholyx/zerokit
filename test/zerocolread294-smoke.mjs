// 第二百九十四轮：zerocol 读回 step——读回/取值/缺文件/往返一致
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- zerocolread294 ${d}`); } };
console.log('zerocolread294-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zr294-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'remove', 'demochain'], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', path.join(ROOT, 'plugins', 'demochain')], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
const run = (args) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });

// 前置：export 生成源文件
run(['run', 'demochain.pipe-export']);

// ⑤ 往返：read → export 回写
const r1 = run(['run', 'demochain.pipe-roundtrip']);
check('⑤ 往返跑通', r1.status === 0 && /已导出 .+（\d+ 行，\d+ 列）/.test(r1.stdout + ''), (r1.stdout + r1.stderr).slice(0, 80));

// ⑥ 往返一致（columns+data 全等 → checksum 相同）
const d1 = JSON.parse(fs.readFileSync(path.join(home, 'data', 'pipe-export-demo.zerocol.json'), 'utf8'));
const d2 = JSON.parse(fs.readFileSync(path.join(home, 'data', 'pipe-roundtrip-out.zerocol.json'), 'utf8'));
check('⑥ 往返一致（同 checksum）', d1.columns.length === d2.columns.length && d1.data === d2.data && d1.checksum === d2.checksum, `${d1.checksum?.slice(0, 16)} vs ${d2.checksum?.slice(0, 16)}`);

// ③ 读回取值（template 直接引用）
const dir = path.join(home, 'plug', 'rdcheck');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "rdcheck"
name = "读回检查"
version = "0.1.0"
summary = "x"

[[action]]
id = "dump"
title = "dump"
description = "x"
type = "chain"
risk = "read"
template = "v={back.data.value} rows={back.data._rows}"

[[action.step]]
use = "builtin.zerocol-read"
as  = "back"
params = { file = "pipe-export-demo" }
`);
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
const r2 = run(['run', 'rdcheck.dump']);
check('③ 读回取值（value=21 + _rows=1）', (r2.stdout + '').includes('v=21') && (r2.stdout + '').includes('rows=1'), (r2.stdout + r2.stderr).slice(0, 60));

// ④ 缺文件报错
fs.writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "rdcheck"
name = "读回检查"
version = "0.1.0"
summary = "x"

[[action]]
id = "missing"
title = "missing"
description = "x"
type = "chain"
risk = "read"
template = "x"

[[action.step]]
use = "builtin.zerocol-read"
as  = "back"
params = { file = "no-such-file" }
`);
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'remove', 'rdcheck'], { cwd: ROOT, env, encoding: 'utf8' });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir], { cwd: ROOT, env, encoding: 'utf8' });
const r3 = run(['run', 'rdcheck.missing']);
check('④ 缺文件明确报错（chain-read-missing + 提示先 export）', r3.status !== 0 && (r3.stderr + r3.stdout).includes('不存在') && (r3.stderr + r3.stdout).includes('zerocol-export'), (r3.stderr + r3.stdout).slice(0, 90));

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
