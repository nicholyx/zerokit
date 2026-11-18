// 第三百零二轮：管道 DSL 指南——结构/实例可跑/互链/闭环
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- pipedsl302 ${d}`); } };
console.log('pipedsl302-smoke');

const doc = fs.readFileSync(path.join(ROOT, 'docs', 'guide', 'data-pipelines.md'), 'utf8');

// ① 全链五节
check('① 五节齐全（chain/pipe/export/read/watch）', ['chain 基础', 'pipe：', 'zerocol-export', 'zerocol-read', 'watch 触发'].every((k) => doc.includes(k)), '');
// ② 示例来自真实动作
check('② demochain 实例引用（pipe-export/pipe-roundtrip/pipe-append）', doc.includes('pipe-export') && doc.includes('pipe-roundtrip') && doc.includes('pipe-append'), '');
// ③ 速查表
check('③ 组合模式速查表（四行）', ['取数→变换→落盘', '读回→回写', '定时积累', '读回再加工'].every((k) => doc.includes(k)), '');
// ④ 互链
const spec = fs.readFileSync(path.join(ROOT, 'docs', 'reference', 'plugin-spec.md'), 'utf8');
const outlook = fs.readFileSync(path.join(ROOT, 'docs', 'guide', 'v4-outlook.md'), 'utf8');
check('④ 互链（spec ↔ guide；guide ↔ outlook）', spec.includes('data-pipelines') && doc.includes('v4-outlook'), '');
// ⑤ 导航
const readme = fs.readFileSync(path.join(ROOT, 'docs', 'README.md'), 'utf8');
check('⑤ docs/README 导航', readme.includes('data-pipelines'), '');

// ⑨ 按指南跑通闭环：export → read（往返）
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pd302-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'remove', 'demochain'], { cwd: ROOT, env, encoding: 'utf8' });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', path.join(ROOT, 'plugins', 'demochain')], { cwd: ROOT, env, encoding: 'utf8' });
const run = (a) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
run(['run', 'demochain.pipe-export']);
const r = run(['run', 'demochain.pipe-roundtrip']);
check('⑨ 指南闭环可跑（export → roundtrip 往返）', r.status === 0 && /已导出/.test(r.stdout + ''), (r.stdout + r.stderr).slice(0, 60));

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
