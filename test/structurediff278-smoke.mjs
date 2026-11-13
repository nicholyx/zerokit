// 第二百七十八轮：structuredDiff 纯函数 + CLI 集成
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- structurediff278 ${d}`); } };
console.log('structurediff278-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sd278-'));
process.env.ZEROKIT_HOME = home;

const { structuredDiff } = await import(pathToFileURL(path.join(ROOT, 'src', 'core/structuredDiff.ts')).href);

// ① 字段级三分类
const d1 = structuredDiff({ a: 1, b: 'x', c: true }, { a: 2, b: 'x', d: 'new' });
check('① 三分类（c 删 / d 加 / a 改；b 不动）', d1.added === 1 && d1.removed === 1 && d1.changed === 1 && d1.entries.some((e) => e.path === 'd' && e.kind === 'added') && !d1.entries.some((e) => e.path === 'b'), JSON.stringify(d1.entries.map((e) => [e.kind, e.path])));

// ② 数组语义
const d2 = structuredDiff([1, 2, 3], [1, 9, 3, 4]);
check('② 数组（[1] 改 + [3] 加）', d2.changed === 1 && d2.added === 1 && d2.entries.some((e) => e.path === '[3]'), JSON.stringify(d2.entries.map((e) => [e.kind, e.path])));

// ③ 嵌套递归 + 深度上限
const d3 = structuredDiff({ x: { y: { z: { w: 1 } } } }, { x: { y: { z: { w: 2 } } } });
check('③ 嵌套寻址（x.y.z.w 改）', d3.changed === 1 && d3.entries[0].path === 'x.y.z.w', d3.entries[0]?.path);
let deep = {};
for (let i = 0; i < 12; i++) deep = { n: deep };
const d4 = structuredDiff(deep, { ...deep });
check('③ 深度上限 8 不炸（12 层对象安全返回）', typeof d4.changed === 'number', '');

// ⑤ 相等对象零 diff
const d5 = structuredDiff({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] });
check('⑤ deepEqual（同构零 diff）', d5.added + d5.removed + d5.changed === 0, '');

// ④ CLI 集成：两次 run 的结构化对比
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env: { ...process.env, ZEROKIT_HOME: home }, encoding: 'utf8', timeout: 120000 });
const r1 = spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'diff', 'sysinfo.overview'], { cwd: ROOT, env: { ...process.env, ZEROKIT_HOME: home }, encoding: 'utf8', timeout: 60000 });
const r2 = spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'diff', 'sysinfo.overview'], { cwd: ROOT, env: { ...process.env, ZEROKIT_HOME: home }, encoding: 'utf8', timeout: 60000 });
check('④ CLI diff（首次无缓存提示 → 二次出摘要行）', (r1.stdout + '').includes('无上一缓存') && (r2.stdout + '').includes('删') && (r2.stdout + '').includes('改'), JSON.stringify({ r1: (r1.stdout + '').slice(0, 40), r2: (r2.stdout + '').slice(0, 40), r1s: r1.status, r2s: r2.status }));
const rj = spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'diff', 'sysinfo.overview', '--json'], { cwd: ROOT, env: { ...process.env, ZEROKIT_HOME: home }, encoding: 'utf8', timeout: 60000 });
const parsed = JSON.parse(rj.stdout || '{}');
check('④ --json 机读（summary + entries 数组）', parsed.hasPrev === true && typeof parsed.summary?.changed === 'number' && Array.isArray(parsed.entries), '');

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY 容错 */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
