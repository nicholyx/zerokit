// 第二百七十三轮：watch 采样窗口聚合（纯函数四断言 + CLI 集成）
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- watchstats273 ${d}`); } };
console.log('watchstats273-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ws273-'));
process.env.ZEROKIT_HOME = home;

const { aggregateWindow, windowStats, numericOf, DEFAULT_WINDOWS } = await import(pathToFileURL(path.join(ROOT, 'src/core/watchStats.ts')).href);
const NOW = 1_700_000_000_000;

// ① 聚合正确性：窗口内数值样本
const samples = [
  { ts: NOW - 60_000, ok: true, data: { uptime: 100 } },
  { ts: NOW - 30_000, ok: true, data: { uptime: 110 } },
  { ts: NOW - 10_000, ok: true, data: { uptime: 105 } },
  { ts: NOW - 400_000, ok: true, data: { uptime: 999 } },   // 5m 外（1h 内）
  { ts: NOW - 5_000, ok: false, data: null, err: 'x' },     // 失败样本跳过
  { ts: NOW - 4_000, ok: true, data: '文本' },               // 非数值跳过
];
const agg = aggregateWindow(samples, 5 * 60_000, NOW);
check('① 聚合正确性（5m：min100/max110/avg105/count3，窗口外与非数值剔除）', agg.count === 3 && agg.min === 100 && agg.max === 110 && agg.avg === 105 && agg.first === 100 && agg.last === 105, JSON.stringify(agg));
const agg1h = aggregateWindow(samples, 60 * 60_000, NOW);
check('① 窗口外样本计入 1h（count4 含 999）', agg1h.count === 4 && agg1h.max === 999, JSON.stringify(agg1h));

// ② 多窗口分组
const ws = windowStats(samples, DEFAULT_WINDOWS, NOW);
check('② windowStats 三窗分组（5m/1h/24h 标签与计数）', ws.length === 3 && ws[0].window === '5m' && ws[0].count === 3 && ws[1].window === '1h' && ws[1].count === 4 && ws[2].window === '24h' && ws[2].count === 4, JSON.stringify(ws.map((x) => [x.window, x.count])));

// ⑤ 边界：空样本/全非数值
const empty = aggregateWindow([], 60_000, NOW);
const nonNum = aggregateWindow([{ ts: NOW, ok: true, data: { s: '文本' } }], 60_000, NOW);
check('⑤ 边界（空样本/全非数值 → 全 null 不抛）', empty.count === 0 && empty.min === null && empty.avg === null && nonNum.count === 0 && nonNum.max === null, JSON.stringify([empty, nonNum]));

// numericOf 补充语义
check('numericOf（裸数值/对象首数值字段/失败样本/文本 → null）', numericOf({ ok: true, data: 42 }) === 42 && numericOf({ ok: true, data: { a: 1, b: 2 } }) === 1 && numericOf({ ok: false, data: 42 }) === null && numericOf({ ok: true, data: 'x' }) === null, '');

// ③ CLI 集成：造 watch.json 跑 stats
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
const NOW_MS = Date.now();
fs.writeFileSync(path.join(home, 'watch.json'), JSON.stringify({ watches: [{ key: 'demo.probe', interval: 30, runs: 3, changes: 0, samples: [
  { ts: NOW_MS - 120_000, ok: true, data: { uptime: 10 } },
  { ts: NOW_MS - 60_000, ok: true, data: { uptime: 20 } },
  { ts: NOW_MS - 10_000, ok: true, data: { uptime: 30 } },
] }] }));
const r = spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'watch', 'stats', 'demo.probe'], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
check('③ CLI stats（5m 行 min10/avg20/max30）', r.status === 0 && (r.stdout + '').includes('min=10') && (r.stdout + '').includes('avg=20') && (r.stdout + '').includes('max=30'), (r.stdout + r.stderr).slice(0, 80));
const rj = spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'watch', 'stats', 'demo.probe', '--json'], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
const parsed = JSON.parse(rj.stdout || '{}');
check('③ CLI --json（stats 数组三窗）', Array.isArray(parsed.stats) && parsed.stats.length === 3 && parsed.stats[0].window === '5m', (rj.stdout || '').slice(0, 60));

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY 容错 */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
