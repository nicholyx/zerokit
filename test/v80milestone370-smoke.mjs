// 第三百七十轮：80 版本里程碑——十轮分层/能力矩阵/路线图三审/快照刷新
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- v80milestone370 ${d}`); } };
console.log('v80milestone370-smoke');

const ol = fs.readFileSync(path.join(ROOT, 'docs', 'guide', 'v4-outlook.md'), 'utf8');
const seg = ol.slice(ol.indexOf('80 版本里程碑'));
check('① 十轮分层（数据四件套 6 / UI 消费 / 维护+发布 4）', ['数据四件套', 'UI 消费', '维护+发布', '358/359/360/361/366/369'].every((k) => seg.includes(k)), '');
check('② 数据面能力矩阵（read×2 / export×1 / stats×4 / rows——8 行全景）', ['columns', 'where', 'rename', 'window', 'median/p90', '_where', 'rows'].every((k) => seg.includes(k)) && seg.includes('三端同构'), '');
check('③ 路线图三审（终审确认）', seg.includes('路线图三审') && seg.includes('终审确认'), '');
const snap = fs.readFileSync(path.join(ROOT, 'docs', 'reference', 'v4-health-snapshot.md'), 'utf8');
check('④ 快照刷新（205 个/3571 级/370 轮）', snap.includes('205 个') && snap.includes('3571') && snap.includes('370 轮'), '');

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
