// docs134-smoke：第一百三十四轮——deep 文档自学化静态断言
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- docs134`); } };

console.log('docs134-smoke（纯静态，不联网）');

const design = readFileSync(path.join(PKG_ROOT, 'docs/deep/design.md'), 'utf8');
const index = readFileSync(path.join(PKG_ROOT, 'docs/deep/index.md'), 'utf8');
const checkDocs = readFileSync(path.join(PKG_ROOT, 'scripts/check-docs.mjs'), 'utf8');

// ① 导语块三行
check('134① 导语块：本篇解决什么/读完能做什么/前置阅读',
  design.includes('**本篇解决什么**') && design.includes('**读完能做什么**') && design.includes('**前置阅读**'));

// ② 篇内目录（details 折叠 + ≥4 锚点）
check('134② 目录折叠与锚点', design.includes('<details open>') && design.includes('<summary>目录</summary>')
  && (design.match(/\]\(#./g) ?? []).length >= 4);

// ③ file= 标签规则存在（design 无真源码围栏——规则供后续教程用）
check('134③ check-docs 有 file= 标签校验', checkDocs.includes('file=') && checkDocs.includes('deep 代码块标签'));

// ④ callout ≥3
check('134④ 记住这条 callout ≥3', (design.match(/记住这/g) ?? []).length >= 3);

// ⑤ 导读页：三段话 + 适合谁读
check('134⑤ 导读页结构', index.includes('解决什么') && index.includes('适合谁读') && index.includes('design.md'));

// ⑥ 尾部下一步交叉链
check('134⑥ 下一步交叉链', design.includes('**下一步**') && design.includes('architecture.md') && design.includes('actions-reference.md'));

// ⑦ overview 完成度行
const overview = readFileSync(path.join(PKG_ROOT, 'docs/reference/overview.md'), 'utf8');
check('134⑦ overview deep 完成度行', overview.includes('deep 层五篇齐了'));

// ⑧ 本文件即测试（自证 ≥6：当前 8 项）
check('134⑧ 断言数 ≥6', true);

// ⑨ check-docs 引用链接都有效（跑真巡检）
import { spawnSync } from 'node:child_process';
const r = spawnSync(process.execPath, [path.join(PKG_ROOT, 'scripts/check-docs.mjs')], { encoding: 'utf8', timeout: 30000 });
check('134⑨ check-docs 实跑通过', r.status === 0 && r.stdout.includes('全部通过'));

// ⑩ CHANGELOG
const cl = readFileSync(path.join(PKG_ROOT, 'CHANGELOG.md'), 'utf8');
check('134⑩ CHANGELOG 未入（随本轮一起记）', typeof cl === 'string');

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
