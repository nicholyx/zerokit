// deep145-smoke：第一百四十五轮——deep 文档补全（结构断言）
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- deep145`); } };
console.log('deep145-smoke');

const rt = readFileSync(path.join(PKG_ROOT, 'docs', 'deep', 'runtime.md'), 'utf8');
const sec = readFileSync(path.join(PKG_ROOT, 'docs', 'deep', 'security.md'), 'utf8');
const idx = readFileSync(path.join(PKG_ROOT, 'docs', 'deep', 'index.md'), 'utf8');
const ov = readFileSync(path.join(PKG_ROOT, 'docs', 'reference', 'overview.md'), 'utf8');
const lines = (t) => t.split('\n').length;

// ①② 两篇存在且 ≥120 行
check('① runtime.md ≥120 行', lines(rt) >= 120);
check('② security.md ≥120 行', lines(sec) >= 120);

// ③ 各 ≥2 个「为什么」
check('③ runtime ≥2 个为什么', (rt.match(/为什么/g) ?? []).length >= 2);
check('③ security ≥2 个为什么', (sec.match(/为什么/g) ?? []).length >= 2);

// ④ 内容从真实源码提炼（引用具体行为/数值）
check('④ runtime 引用 476ms→22ms', rt.includes('476ms') && rt.includes('22ms'));
check('④ runtime 引用 MAX_OUTPUT 1 MiB', rt.includes('1 MiB'));
check('④ runtime 引用 PYTHONIOENCODING', rt.includes('PYTHONIOENCODING'));
check('④ security 引用快照文件名', sec.includes('.zk-integrity.json') || sec.includes('zk-integrity'));

// ⑤ index.md 坑位替换为真链
check('⑤ index 两篇链接化', idx.includes('[插件运行时](runtime.md)') && idx.includes('[安全边界](security.md)'));
check('⑤ index 无「待写」残留', !idx.includes('待写'));

// ⑥ 已知差距表销账
check('⑥ 已知差距销账', ov.includes('第一百四十五轮补全') && !ov.includes('坑位待写'));

// ⑦ guide/reference 交叉链
const qs = readFileSync(path.join(PKG_ROOT, 'docs', 'guide', 'quickstart.md'), 'utf8');
const spec = readFileSync(path.join(PKG_ROOT, 'docs', 'reference', 'plugin-spec.md'), 'utf8');
check('⑦ quickstart 交叉链', qs.includes('deep/runtime.md') && qs.includes('deep/security.md'));
check('⑦ plugin-spec 交叉链', spec.includes('deep/security.md'));

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
