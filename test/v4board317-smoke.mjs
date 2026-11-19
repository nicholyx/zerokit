// 第三百一十七轮：v4 看板更新——候选全清对照/新候选/战役记录
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- v4board317 ${d}`); } };
console.log('v4board317-smoke');

const doc = fs.readFileSync(path.join(ROOT, 'docs', 'guide', 'v4-outlook.md'), 'utf8');
const seg = doc.slice(doc.indexOf('深化阶段收官'));
check('① 候选全清对照表（1×2 + 3×3 + 2 + 4 齐全）', ['zerocol 多行', '管道 DSL 指南', '语法巡检', 'perf 自适应', '平台判据手册', '桌面预检', '安装计数'].every((k) => seg.includes(k)), '');
check('① 轮次版本对照（301/302/303/304/305/313/306）', ['301', '302', '303', '304', '305', '313', '306'].every((k) => seg.includes(k)), '');
const full = doc.slice(doc.indexOf('数据工作流全链贯通'));
check('数据全链段（append/stats 多列/可读化/310 实测）', ['append 积累', 'stats 多列统计', 'stats 可读化', '310 端到端实测'].every((k) => full.includes(k)), '');
check('② 313 updater 入板（冻结维持）', seg.includes('updater-readiness') && seg.includes('冻结维持'), '');
check('③ 新候选三条（opt-in 上报/DSL 进阶/桌面启用）', ['opt-in 匿名上报', '管道 DSL 进阶', '桌面启用'].every((k) => seg.includes(k)), '');
const collab = doc.slice(doc.indexOf('协作面 UI 收官'));
check('协作 UI 收官段（311/312 四端观察窗）', collab.includes('mcp-runtime.json') && collab.includes('四端'), '');

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
