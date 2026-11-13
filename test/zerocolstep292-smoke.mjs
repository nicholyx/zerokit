// 第二百九十二轮：zerocol 导出 chain step——语法/取值/落盘/往返
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- zerocolstep292 ${d}`); } };
console.log('zerocolstep292-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zs292-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'remove', 'demochain'], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', path.join(ROOT, 'plugins', 'demochain')], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });

const run = (args) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });

// ①⑤ 语法+示例跑通
const r1 = run(['run', 'demochain.pipe-export']);
check('①⑤ pipe-export 跑通（已导出 N 行 M 列）', r1.status === 0 && /已导出 .+（\d+ 行，\d+ 列）/.test(r1.stdout + ''), (r1.stdout + r1.stderr).slice(0, 90));

// ④ 落盘文件
const out = path.join(home, 'data', 'pipe-export-demo.zerocol.json');
check('④ 文件落盘 data_dir', fs.existsSync(out), out);
const zc = JSON.parse(fs.readFileSync(out, 'utf8'));

// ③ 取值正确：value=21（gen），chars=14/15（count-stdin）
const { importZeroCol } = await import(pathToFileURL(path.join(ROOT, 'src/core/arrowIpc.ts')).href);
const cols = importZeroCol(zc);
const valueCol = cols.find((c) => c.name === 'value');
const charsCol = cols.find((c) => c.name === 'chars');
check('③ 取值路径（first.data.value=21）', valueCol?.values?.[0] === 21, JSON.stringify(valueCol?.values));
check('③ 取值路径（counted.data.count=14/15）', charsCol?.values?.[0] === 14 || charsCol?.values?.[0] === 15, JSON.stringify(charsCol?.values));

// ④ 往返：zerocol 校验和稳定 + 格式
check('④ zerocol 格式与校验和（sha256-）', zc.format === 'zerocol' && /^sha256-/.test(zc.checksum), zc.checksum?.slice(0, 20) ?? '');

// ① 参数缺失报错（无 file）
const dir = path.join(home, 'plug', 'badexp');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "badexp"
name = "坏导出"
version = "0.1.0"
summary = "292 参数校验"

[[action]]
id = "ok"
title = "ok"
description = "ok"
run = ["{node}", "-e", "console.log(1)"]
risk = "read"
output = "json"

[[action]]
id = "chain-bad"
title = "缺参数"
description = "缺 file"
type = "chain"
risk = "read"

[[action.step]]
use = "self.ok"
as  = "a"

[[action.step]]
use = "builtin.zerocol-export"
as  = "b"
params = { columns = [{ name = "x", type = "int", from = "a.data" }] }
`);
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
const r2 = run(['run', 'badexp.chain-bad']);
check('① 缺 file 参数明确报错（chain-export-bad-params）', r2.status !== 0 && (r2.stderr + r2.stdout).includes('file'), (r2.stderr + r2.stdout).slice(0, 80));

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
