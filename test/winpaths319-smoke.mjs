// 第三百一十九轮：zerocol 内建步 Windows 路径守护——静态审查判据固化
// 背景：304 轮暴露过 Windows ESM file:// 坑；内建步的路径/字节操作从没系统性抓样。
// 本测试把审查判据固化：任何回归（手写斜杠拼接 / /tmp 硬编码 / 非 LE Buffer）本地即拦。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- winpaths319 ${d}`); } };
console.log('winpaths319-smoke');

const runner = fs.readFileSync(path.join(ROOT, 'src', 'core', 'runner.ts'), 'utf8');

// ① 内建步的 DATA_DIR 路径构造全走 path.join（无手写斜杠拼接）
const manualJoin = /DATA_DIR\s*\+\s*['"`]/.test(runner) || /DATA_DIR\s*['"`]\s*\+/.test(runner);
const usesJoin = ['pathModule.join(DATA_DIR,', 'pathModuleS.join(DATA_DIR,', 'path.join(DATA_DIR,'].reduce((n, pat) => n + (runner.split(pat).length - 1), 0) >= 3;
check('① 三内建步路径全 path.join（export/read/stats；无手写拼接）', !manualJoin && usesJoin, `join=${usesJoin}`);

// ② 文件读写：JSON 读 utf8（文本语义）/ 写字符串默认 UTF-8（跨平台）；二进制经 base64 字符串不落原始字节
const badRead = /readFileSync\([^)]+\)\s*;/.test(runner.slice(runner.indexOf('builtin.zerocol'))); // 无 encoding 的裸读在 zerocol 段
const jsonReads = (runner.match(/readFileSync\([^)]+, 'utf8'\)/g) ?? []).length;
check('② zerocol 读写跨平台（JSON utf8 读 + 字符串写；二进制走 base64）', !badRead && jsonReads >= 3, `jsonReads=${jsonReads}`);

// ③ Buffer 字节序：解码全 LE 后缀（readBigInt64LE/readDoubleLE——字节序由 Buffer API 保证与平台无关）
const leOps = (runner.match(/read(BigInt64|Double)LE/g) ?? []).length;
const beOps = (runner.match(/read(BigInt64|Double)BE/g) ?? []).length;
check('③ 解码全 LE（字节序 API 级保证，平台无关）', leOps >= 2 && beOps === 0, `LE=${leOps} BE=${beOps}`);

// ④ web/ 无 /tmp 硬编码（Windows ENOENT 隐患——305 判据的 web 侧）
let webTmp = [];
for (const f of fs.readdirSync(path.join(ROOT, 'web')).filter((x) => x.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(ROOT, 'web', f), 'utf8');
  if (/(^|[^a-zA-Z0-9])\/tmp\//.test(src)) webTmp.push(f);
}
check('④ web/*.js 无 /tmp 硬编码', webTmp.length === 0, webTmp.join(','));

// ⑤ 测试自身的临时目录全 os.tmpdir（305 判据全库贯彻）
let testTmp = [];
for (const f of fs.readdirSync(path.join(ROOT, 'test')).filter((x) => x.endsWith('.mjs'))) {
  const src = fs.readFileSync(path.join(ROOT, 'test', f), 'utf8');
  if (/mkdtempSync\(path\.join\(path\.sep/.test(src) || /mkdtempSync\('\/tmp/.test(src) || /mkdtempSync\(path\.join\('\/tmp/.test(src)) testTmp.push(f);
}
check('⑤ test/*.mjs 临时目录全 os.tmpdir（无 path.sep/tmp 硬编码）', testTmp.length === 0, testTmp.join(','));

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
