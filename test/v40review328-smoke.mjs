// 第三百二十八轮：40 版本整点复盘——弧线/量化/判据/定调
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- v40review328 ${d}`); } };
console.log('v40review328-smoke');

const doc = fs.readFileSync(path.join(ROOT, 'docs', 'guide', 'v4-outlook.md'), 'utf8');
const seg = doc.slice(doc.indexOf('40 版本整点复盘'));
check('① 三阶段弧线（排定 13 轮/深化 13 轮/信号驱动）', ['主题排定与核心落地', '深化与收官', '真实信号驱动'].every((k) => seg.includes(k)), '');
const bl = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'assertion-baseline.json'), 'utf8'));
check('② 量化对照（3284 起点/40 minor/149→185 文件，基线数以文件为准）', seg.includes('3284') && seg.includes('40') && seg.includes('149') && seg.includes('185') && bl.assertions > 3400, `${bl.assertions}`);
check('③ 三大判据（299 Chrome/304 Windows/324+325 信号）', ['299 Chrome 严格度', '304 Windows file://', '324+325 信号双面'].every((k) => seg.includes(k)), '');
check('④ 下阶段定调（三候选等真实诉求 + 不再推演）', seg.includes('opt-in 匿名上报') && seg.includes('不再主题内推演'), '');

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
