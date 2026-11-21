// 第三百六十四轮：CLI stats --tail N——窗口视图/兼容/json
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- statstail364 ${d}`); } };
console.log('statstail364-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'st364-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'market', 'add', ROOT], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'install', 'demochain', '--yes'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
for (let i = 0; i < 5; i++) spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'run', 'demochain.gen'], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });

const run = (a) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });

const r1 = run(['stats', '--tail', '3']);
check('①② --tail 3 窗口视图（头部「最近 3 次」+ 只统计 3 条）', r1.status === 0 && (r1.stdout + '').includes('最近 3 次'), (r1.stdout + r1.stderr).slice(0, 120));
const r2 = run(['stats']);
check('③ 无 --tail 行为不变（无窗口头）', r2.status === 0 && !(r2.stdout + '').includes('窗口视图'), (r2.stdout + '').slice(0, 80));
const r3 = run(['stats', '--tail', '2', '--json']);
const j = JSON.parse((r3.stdout + '').match(/\{[\s\S]*\}/)?.[0] ?? '{}');
check('② json 透传 window（最近 2 次）', r3.status === 0 && j.window === '最近 2 次', JSON.stringify(j).slice(0, 80));
const r4 = run(['stats', '--tail', 'abc']);
check('① 非法 --tail 被钳到 1（不炸——clamp 语义）', r4.status === 0 && (r4.stdout + '').includes('最近 1 次'), (r4.stdout + r4.stderr).slice(0, 80));

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
