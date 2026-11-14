// 第二百九十七轮：v4 阶段复盘文档——双主题对照/建议/锚点
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- v4mid297 ${d}`); } };
console.log('v4mid297-smoke');

const doc = fs.readFileSync(path.join(ROOT, 'docs', 'guide', 'v4-outlook.md'), 'utf8');
const seg = doc.slice(doc.indexOf('v4 线进度'));

// ① 双主题对照
check('① 协作面 4/4（广播/presence/摘要/频控）', ['广播', 'presence', '结果摘要', '频控'].every((k) => seg.includes(k)), '');
check('① 数据工作流 4/4（pipe/导出端/读取端/调度面）', ['pipe 原语', '导出端', '读取端', '调度面'].every((k) => seg.includes(k)), '');
check('① 版本对照齐（v4.1-v4.8 各一）', ['v4.1.0', 'v4.2.0', 'v4.5.0', 'v4.8.0', 'v4.3.0', 'v4.4.0', 'v4.6.0', 'v4.7.0'].every((v) => seg.includes(v)), '');

// ②③ 建议
check('②③ 下一阶段建议 4 条（深化×2 + 桌面重审 + 征集）', ['协作面深化', '数据工作流深化', '桌面冻结重审', '新议题征集'].every((k) => seg.includes(k)), '');

// ④ 锚点
const readme = fs.readFileSync(path.join(ROOT, 'docs', 'README.md'), 'utf8');
check('④ docs/README v4 线进度锚点', readme.includes('v4-线进度'), '');

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
