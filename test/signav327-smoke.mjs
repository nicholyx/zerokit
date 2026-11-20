// 第三百二十七轮：watch↔dashboard 信号导航——入口/徽标 title/反向导航
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- signav327 ${d}`); } };
console.log('signav327-smoke');

const wt = fs.readFileSync(path.join(ROOT, 'web', 'watchtimers.js'), 'utf8');
check('① 面板「看统计」入口（#/dashboard 链接 + data-sig）', wt.includes('href="#/dashboard" data-sig') && wt.includes('看统计'), '');
check('② ⛓ 徽标 hover title 带统计数字（title 属性 max/avg/count）', wt.includes('chain-badge') && wt.includes('max=${o.max ?? \'-\'} avg='), '');
const app = fs.readFileSync(path.join(ROOT, 'web', 'app.js'), 'utf8');
check('③ dashboard 反向导航（去监控 + watch 面板链接空态引导）', app.includes('去监控') && app.includes('href="#/watch"'), '');

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
