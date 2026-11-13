// 第二百九十一轮：chain pipe——语法/传递/审计/错误停/示例
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- chainpipe291 ${d}`); } };
console.log('chainpipe291-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cp291-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
// 重装 demochain（bundled 跳过已存在——remove 后 add 拿最新清单）
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'remove', 'demochain'], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', path.join(ROOT, 'plugins', 'demochain')], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });

const run = (args) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });

// ①⑤ 语法+示例：pipe-count 跑通（gen stdout → count-stdin stdin）
const r1 = run(['run', 'demochain.pipe-count']);
check('①⑤ pipe 示例跑通（管道传 N 个字符）', r1.status === 0 && /管道传了 \d+ 个字符/.test(r1.stdout + ''), (r1.stdout + r1.stderr).slice(0, 80));

// ② 传递正确性：gen 输出是 JSON {"value":21}（14 字符）——数对得上
const r1b = (r1.stdout + '').match(/管道传了 (\d+) 个字符/);
check('② 传递内容正确（gen stdout 14 字符进 stdin）', r1b?.[1] === '14', r1b?.[1] ?? 'no-match');

// ③ 审计标注
const auditLog = fs.readFileSync(path.join(home, 'logs', 'audit.log'), 'utf8');
const pipeAudit = auditLog.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((x) => x?.action === 'pipe-count');
check('③ 审计 reason 标注 pipe 步（chain-ok (1 pipe 步)）', pipeAudit.some((a) => String(a.reason ?? '').includes('1 pipe 步')), JSON.stringify(pipeAudit.at(-1)?.reason));

// ④ 错误传播：构造失败管道——临时插件 step1 输出 → step2 引用不存在动作会静态失败；更直接：pipe 下游非零退出
const dir = path.join(home, 'plug', 'pipefail');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "pipefail"
name = "管道失败演示"
version = "0.1.0"
summary = "291④ 错误传播"

[[action]]
id = "ok-step"
title = "产数据"
description = "产一行"
run = ["{node}", "-e", "console.log('hello-pipe')"]
risk = "read"
output = "text"

[[action]]
id = "fail-step"
title = "失败步"
description = "exit 3"
run = ["{node}", "-e", "process.exit(3)"]
risk = "read"
output = "text"

[[action]]
id = "after-fail"
title = "不该执行"
description = "若执行说明错误没停链"
run = ["{node}", "-e", "console.log('SHOULD-NOT-RUN')"]
risk = "read"
output = "text"

[[action]]
id = "chain-fail"
title = "失败链"
description = "失败链"
type = "chain"
risk = "read"
template = "{b}"

[[action.step]]
use = "self.ok-step"
as  = "a"

[[action.step]]
use = "self.fail-step"
as  = "b"
pipe = true

[[action.step]]
use = "self.after-fail"
as  = "c"
pipe = true
`);
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
const r2 = run(['run', 'pipefail.chain-fail']);
check('④ 管道中步失败链停（非零退出 + 断点信息；后续步不执行）', r2.status !== 0 && (r2.stdout + r2.stderr).includes('断在第 2 步') && !(r2.stdout + '').includes('SHOULD-NOT-RUN'), (r2.stdout + r2.stderr).slice(0, 80));

// ① 语法解析（清单 lint 过 = pipe 字段被接受）
const r3 = run(['plugin', 'validate', path.join(ROOT, 'plugins', 'demochain')]);
check('① pipe 语法通过清单校验', r3.status === 0, (r3.stdout + r3.stderr).slice(0, 60));

// ⑧ spec 文档有 pipe 行
const spec = fs.readFileSync(path.join(ROOT, 'docs', 'reference', 'plugin-spec.md'), 'utf8');
check('⑧ plugin-spec 有 pipe 行', spec.includes('pipe'), '');

for (const d of [home]) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ } }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
