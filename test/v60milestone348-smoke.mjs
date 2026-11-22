// 第三百四十八轮：60 版本里程碑——十轮分层/信号五层/路线图复核/快照刷新
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- v60milestone348 ${d}`); } };
console.log('v60milestone348-smoke');

const ol = fs.readFileSync(path.join(ROOT, 'docs', 'guide', 'v4-outlook.md'), 'utf8');
const seg = ol.slice(ol.indexOf('60 版本里程碑'));
check('① 十轮分层（烟测制度/数据消费/维护节奏 + 341-343/344-346）', ['烟测制度', '数据消费', '维护节奏', '341-343', '344-346'].every((k) => seg.includes(k)), '');
check('① 信号五层全景（写侧/API/UI/导航/MCP）', ['写侧', 'API', 'UI', '导航', 'MCP'].every((k) => seg.includes(k)), '');
check('③ 路线图复核（无真实诉求信号 + 稳态结论再确认）', seg.includes('无真实诉求信号') && seg.includes('再确认'), '');
const snap = fs.readFileSync(path.join(ROOT, 'docs', 'reference', 'v4-health-snapshot.md'), 'utf8');
check('④ 快照刷新（60→80 时点对照——outlook 量化节锚 3510→3533；快照查 348 轮标记不变项）', ol.includes('断言 3510→3533') && snap.includes('348 轮'), '');

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
