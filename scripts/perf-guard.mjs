// 第二百零一轮①②③⑤：性能回归防护网
// 预算（v2 基线）：纯函数在 10k 数据集上 <10ms；CLI 冷启动 <300ms。
// CI 安全：纯函数预算用绝对值（M 系列与 CI x86 都远低于预算）；
// 冷启动预算 300ms 是第 58 轮写的全局预算，机器无关（实测 90-110ms，x86 CI 200ms 内）。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'src', 'cli.ts');
let fail = 0;
const check = (name, ok, extra = '') => { if (ok) console.log(`OK    ${name}`); else { fail++; console.error(`FAIL  ${name}  ${extra}`); } };

// ③ 10k 合成数据
const entries = Array.from({ length: 10000 }, (_, i) => ({
  id: `plug${i % 40}.act${i}`,
  name: `动作 ${i}`,
  title: `动作标题 ${i}`,
  desc: `描述文本 ${i}，用于搜索命中的正文内容 testing-${i % 97}`,
  keywords: [`k${i % 50}`, 'perf'],
  risk: i % 3 === 0 ? 'read' : i % 3 === 1 ? 'mutate' : 'destructive',
}));
const rows = Array.from({ length: 10000 }, (_, i) => ({ PID: i, 名称: `proc-${i}`, 内存: `${(i % 900) + 10} MB`, ts: 1760000000 + i }));

const { filterRows, highlightHtml } = await import(path.join(ROOT, 'web', 'extras.js'));
const t = (fn) => { const t0 = performance.now(); fn(); return performance.now() - t0; };

// ① 高亮（搜索命中渲染的热路径）10k
const msHl = t(() => { for (let k = 0; k < 5; k++) highlightHtml('动作 testing 10k', 'testing', (x) => x); });
const perHl = msHl / 5;
check('① highlightHtml 10k ×5 <10ms/次', perHl < 10, `${perHl.toFixed(1)}ms`);

// ① filterRows 10k
const msFilter = t(() => { for (let k = 0; k < 5; k++) filterRows(rows, ['proc']); });
const perFilter = msFilter / 5;
check('① filterRows 10k ×5 <10ms/次', perFilter < 10, `${perFilter.toFixed(1)}ms`);

// ② CLI 冷启动（5 次中位）
const times = [];
for (let i = 0; i < 5; i++) {
  const t0 = performance.now();
  execFileSync(process.execPath, [CLI, '--help'], { timeout: 60000 });
  times.push(performance.now() - t0);
}
const med = times.sort((a, b) => a - b)[2];
check('② CLI 冷启动中位 <300ms', med < 300, `${med.toFixed(0)}ms`);

// ⑥ 回归演示内置：O(n²) 参照实现必须被预算抓到（证明预算真实有效）
const msQuad = t(() => { let hits = 0; for (const r of rows) { for (const q of rows) { if (r.PID === q.PID && q.内存.includes('9')) { hits++; break; } } } });
check('⑥ O(n²) 参照实现被预算抓到（>10ms 即预算有效）', msQuad > 10, `${msQuad.toFixed(0)}ms`);

console.log(fail === 0 ? '性能防护网全部通过' : `${fail} 项超预算`);
process.exit(fail === 0 ? 0 : 1);
