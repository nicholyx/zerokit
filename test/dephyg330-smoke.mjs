// 第三百三十轮：依赖卫生巡检——审计四项/清单文档/导航
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- dephyg330 ${d}`); } };
console.log('dephyg330-smoke');

// ① dep-audit 全过（活体）
let auditOk = true;
try { execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'dep-audit.mjs')], { stdio: 'pipe', timeout: 120000, cwd: ROOT }); } catch { auditOk = false; }
check('① dep-audit 四项全过（活体）', auditOk, '');

// ④ 清单文档存在 + 判据齐全
const doc = fs.readFileSync(path.join(ROOT, 'docs', 'reference', 'dep-hygiene.md'), 'utf8');
check('④ 月度巡检四步 + 判据（sdk 1.8 案例/lockfile 一致/@types 跟运行时）', doc.includes('月度巡检步骤') && doc.includes('引用面') && doc.includes('npm ls') && doc.includes('@types/node'), '');
check('④ 历史处理记录（329 sdk 1.8 + codeql + minor）', doc.includes('@anthropic-ai/sdk 1.8') && doc.includes('codeql-action'), '');
const rm = fs.readFileSync(path.join(ROOT, 'docs', 'README.md'), 'utf8');
check('docs/README 导航', rm.includes('dep-hygiene'), '');

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
