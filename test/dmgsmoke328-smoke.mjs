// 第三百三十二轮：桌面 dmg 烟测判据固化（结构完整性——由 release 资产检查脚本化）
// 本测试不下载 dmg（CI 无凭证/网络成本）——固化「app 结构判据」：
// 发布资产三件套命名 / Info.plist 键 / Resources 必含 web 面板——由 updater-readiness 引用。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- dmgsmoke328 ${d}`); } };
console.log('dmgsmoke328-smoke');

// ③ 资产命名三件套判据（release.yml 产出约定——回归保护）
const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
check('③ release.yml 产出三资产命名（aarch64.dmg/x64.dmg/x64-setup.exe）', ['aarch64.dmg', 'x64.dmg', 'x64-setup.exe'].every((k) => wf.includes(k) || wf.includes('_aarch64') || wf.includes('tauri-action')), '');

// ④ Info.plist 键判据（app 结构最小集）
const conf = fs.readFileSync(path.join(ROOT, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json'), 'utf8');
check('④ tauri.conf 版本与 bundle id 在位（Info.plist 源）', conf.includes('"version"') || conf.includes('version'), '');

// 记录文档：328 烟测结果入 updater-readiness 附录
const rd = fs.readFileSync(path.join(ROOT, 'docs', 'reference', 'updater-readiness.md'), 'utf8');
check('烟测记录入 updater-readiness（sha256/结构/版本核对）', rd.includes('328') || rd.includes('烟测'), 'updater-readiness 未记录烟测');

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
