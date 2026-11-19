// 第三百一十六轮：stats 摘要进 watch——tick 钩子/通知/徽标/持久化
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- watchstats316 ${d}`); } };
console.log('watchstats316-smoke');

const wt = fs.readFileSync(path.join(ROOT, 'web', 'watchtimers.js'), 'utf8');

// ① tick 钩子带 stats
check('① lastChainRun 带 stats（r.data.stats 存在则摘入）', wt.includes('const st = r?.data?.stats ?? null') && wt.includes('...(st ? { stats: st } : {})'), '');
// ② 通知文案带人话摘要
check('② 通知摘要（col max= avg= 级别，notify 开关尊重）', wt.includes('notify !== false && st') && wt.includes('max=${o.max'), '');
// ③ 面板徽标带最新统计
check('③ 徽标行内统计（statsBrief max）', wt.includes('statsBrief') && wt.includes('col} max=${o.max'), '');
// ④ 持久化（lastChainRun 整体含 stats）
check('④ persistWatch 字段带 lastChainRun（stats 随整体落盘）', wt.includes('lastChainRun: w.lastChainRun'), '');

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
