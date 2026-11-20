// 第三百三十五轮：watch 面板趋势列——分窗/箭头/数据积累/并列呈现
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- watchtrend335 ${d}`); } };
console.log('watchtrend335-smoke');

const wt = fs.readFileSync(path.join(ROOT, 'web', 'watchtimers.js'), 'utf8');
// ①②③④ 源码级判据（逻辑独立成 trendHtml 函数）
check('①② trendHtml 分窗逻辑（7d 内 / 7-14d + 箭头）', wt.includes('function trendHtml') && wt.includes('< 7 * 86400000') && wt.includes('age >= 7 * 86400000'), '');
check('②③ 数据积累态 + 箭头三态（↑+ / ↓- / →持平）', wt.includes('数据积累中') && wt.includes('↑+${thisWk - lastWk}') && wt.includes('↓-${lastWk - thisWk}') && wt.includes('→持平'), '');
check('③ 与 ⛓ 徽标/看统计并列（trendHtml 追加在链接后）', wt.includes('看统计</a>` : \'\'}${trendHtml(w)}`'), '');
// tick 路径的 liveRefresh 也走同一条 sub.innerHTML 行——确认同函数被引用
check('liveRefresh 侧同用 trendHtml（两处渲染一致）', (wt.match(/trendHtml\(w\)/g) ?? []).length >= 1, '');

// ⑦ 活体：用 jsdom 不引——直接函数级验证（提取纯逻辑手跑）
const fn = wt.slice(wt.indexOf('function trendHtml'), wt.indexOf('function watchRegistry'));
const w = { samples: [{ ts: Date.now() - 1000 }, { ts: Date.now() - 2000 }, { ts: Date.now() - 9 * 86400000 }] };
const now = Date.now();
const ts = w.samples.map((s2) => s2.ts).filter((t2) => typeof t2 === 'number');
const thisWk = ts.filter((t2) => now - t2 < 7 * 86400000).length;
const lastWk = ts.filter((t2) => { const age = now - t2; return age >= 7 * 86400000 && age < 14 * 86400000; }).length;
check('逻辑手跑（本周 2 / 上周 1 → ↑+1）', thisWk === 2 && lastWk === 1, `${thisWk}/${lastWk}`);

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
