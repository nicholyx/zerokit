// 自测 changelog-add：对临时副本跑三次插入（新段/已有段追加/占位替换）
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cla-'));
const CL = path.join(tmp, 'CHANGELOG.md');
fs.writeFileSync(CL, `## [Unreleased]\n\n### Added\n\n（下一版攒着）\n\n## [1.0.0] - 2020-01-01\n\n### Fixed\n\n- 旧条目不该被动\n`);
let pass = 0, fail = 0;
const check = (n, ok, d = '') => ok ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('FAIL ' + n + ' ' + d));
process.env.CLA_TEST_ROOT = tmp;
// 临时切 ROOT：用 env 覆盖不可行（脚本用 import.meta）——改为直接在 tmp 里建 scripts 镜像不可取。
// 简单法：把工具复制到 tmp/scripts/ 且 tmp 当 ROOT
fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
fs.copyFileSync(path.join(ROOT2, 'scripts', 'changelog-add.mjs'), path.join(tmp, 'scripts', 'changelog-add.mjs'));
const run = (args) => execFileSync('node', [path.join(tmp, 'scripts', 'changelog-add.mjs'), ...args], { encoding: 'utf8' });
try { run(['Added', '新加的条目 A']); } catch (e) { /* 抛错即失败 */ }
let t = fs.readFileSync(CL, 'utf8');
check('① Added 占位被替换成条目', t.includes('### Added\n\n- 新加的条目 A\n\n## [1.0.0]'), JSON.stringify(t.split('\n').slice(0, 8)));
try { run(['Fixed', '新的修复 B']); } catch { }
t = fs.readFileSync(CL, 'utf8');
check('② Unreleased 内新建 Fixed 段', /## \[Unreleased\][\s\S]*### Fixed\n\n- 新的修复 B[\s\S]*## \[1\.0\.0\]/.test(t), '');
check('③ 已发布段的旧条目不动', t.includes('## [1.0.0] - 2020-01-01\n\n### Fixed\n\n- 旧条目不该被动'), '');
try { run(['Fixed', '第二个修复 C']); } catch { }
t = fs.readFileSync(CL, 'utf8');
check('④ 已有 Fixed 段追加（B 后接 C，空行分隔）', t.includes('- 新的修复 B\n\n- 第二个修复 C'), t.split('\n').slice(4, 12).join('|'));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail ? 1 : 0);
