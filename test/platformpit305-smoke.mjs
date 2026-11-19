// 第三百零五轮：平台判据手册——战役对照/巡检扩展/索引/无害用例保留
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- platformpit305 ${d}`); } };
console.log('platformpit305-smoke');

const doc = fs.readFileSync(path.join(ROOT, 'docs', 'reference', 'platform-pitfalls.md'), 'utf8');
check('① Windows 表五坑（file:// ESM/tmp/CRLF/分隔符/execFileSync）', ['动态 import 裸路径', '/tmp 不存在', 'CRLF', '路径分隔符', 'execFileSync'].every((k) => doc.includes(k)), '');
check('① 战役对照（304/303/291/299）', ['304 轮', '303 轮', '291 轮', '299 轮'].every((k) => doc.includes(k)), '');
check('① Chrome 表 + 防线层次（三层）', doc.includes('Chrome / 浏览器') && doc.includes('防线层次') && doc.includes('三平台 CI'), '');

const chk = fs.readFileSync(path.join(ROOT, 'scripts', 'web-strict-check.mjs'), 'utf8');
check('② 巡检扩动态 import 裸路径（RAW_DYN_IMPORT + pathToFileURL 提示）', chk.includes('RAW_DYN_IMPORT') && chk.includes('pathToFileURL'), '');
const logs = fs.readFileSync(path.join(ROOT, 'web', 'logs.js'), 'utf8');
check('② 现库无裸动态 import path.join（web/）', !/import\s*\(\s*path\.join\s*\(/.test(fs.readdirSync(path.join(ROOT, 'web')).filter((x) => x.endsWith('.js')).map((x) => fs.readFileSync(path.join(ROOT, 'web', x), 'utf8')).join('\n')), '');

// ④ 无害用例保留（data82 报错用例等不误伤）——data82 仍在且含 /tmp 字面量
const d82 = fs.readFileSync(path.join(ROOT, 'test', 'data82-smoke.mjs'), 'utf8');
check('④ data82 报错用例 /tmp 字面量保留（无害不误伤）', d82.includes('/tmp/bad.zksnap-x'), '');

const sh = fs.readFileSync(path.join(ROOT, 'START-HERE.md'), 'utf8');
const rm = fs.readFileSync(path.join(ROOT, 'docs', 'README.md'), 'utf8');
check('⑤ START-HERE + docs/README 索引', sh.includes('platform-pitfalls') && rm.includes('platform-pitfalls'), '');

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
