// 第三百轮：盘点文档——深化阶段/旅程/展望/锚点
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- round300 ${d}`); } };
console.log('round300-smoke');

const doc = fs.readFileSync(path.join(ROOT, 'docs', 'guide', 'v4-outlook.md'), 'utf8');
const deep = doc.slice(doc.indexOf('深化阶段（第 298-299'));
const journey = doc.slice(doc.indexOf('第三百轮：旅程与展望'));

check('① 深化阶段 2/2（过滤订阅 + 协作锁 + 版本）', deep.includes('广播过滤订阅') && deep.includes('协作锁') && deep.includes('v4.10.0') && deep.includes('v4.11.0'), '');
check('① 299 战果记录（Chrome 158 + 247 轮笔误）', deep.includes('Chrome 158') && deep.includes('247 轮'), '');
check('② 三百轮量级（287 轮 79 minor + 13 轮 12 minor + 160 文件 3346 断言）', journey.includes('287 轮') && journey.includes('79 个 minor') && journey.includes('13 轮') && journey.includes('3346'), '');
check('③ 下一百轮候选 4 条', ['数据深化收尾', '真实用户驱动', '稳定性长跑', '新陈代谢'].every((k) => journey.includes(k)), '');
const readme = fs.readFileSync(path.join(ROOT, 'docs', 'README.md'), 'utf8');
check('④ docs/README 三百轮锚点', readme.includes('三百轮'), '');

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
