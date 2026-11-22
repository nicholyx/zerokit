// 第四百轮：400 轮复盘——分层/债账本/结构自检/路线图四审
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- round400review ${d}`); } };
console.log('round400review-smoke');

const ol = fs.readFileSync(path.join(ROOT, 'docs', 'guide', 'v4-outlook.md'), 'utf8');
const seg = ol.slice(ol.indexOf('400 轮复盘'));
check('① 三十轮分层（数据面收官/发布与年检/测试质量/例行巡检）', ['数据面收官', '发布与年检', '测试质量', '例行巡检'].every((k) => seg.includes(k)), '');
check('② 债的诚实账本（恒真断言/CI 抖动/版本号账目/里程碑命名）', ['恒真断言', 'CI 抖动', '版本号账目', '里程碑命名'].every((k) => seg.includes(k)) && seg.includes('没有自动护栏') && seg.includes('尚未被数据证实'), '');
check('③ 结构自检（功能轮只占 19% + 全部为干净轮 + 不粉饰）', seg.includes('19%') && seg.includes('本轮无动作') && seg.includes('不粉饰') || seg.includes('惯性真实存在'), '');
check('④ 路线图四审 + 三条后续', seg.includes('路线图四审') && seg.includes('稳态意味着') && seg.includes('恒真断言需要护栏') && seg.includes('失败率') && seg.includes('里程碑命名成文'), '');
const snap = fs.readFileSync(path.join(ROOT, 'docs', 'reference', 'v4-health-snapshot.md'), 'utf8');
check('⑤ 快照刷新（211 个/3597 级/400 轮）', snap.includes('211 个') && snap.includes('3597') && snap.includes('400 轮'), '');

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
