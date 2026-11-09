// 第二百一十四轮⑥：可复现构建审计
// ① engines 字段存在且与 CI Node 主版本兼容（>=22.18 覆盖 CI 的 22/24）
// ② Cargo.lock 提交在库且含桌面壳 zerokit-desktop 条目
// ③ lockfile 存在且非空
// （npm ci 干跑与 cargo audit 是重操作/外部分别由 CI 与已知差距记录承载，不在 lint 每次全跑）
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const check = (name, ok, extra = '') => { if (ok) console.log(`OK    ${name}`); else { fail++; console.error(`FAIL  ${name}  ${extra}`); } };

// ① engines
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const engines = pkg.engines?.node ?? '';
const ciYml = readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const ciNodes = [...ciYml.matchAll(/node-version:\s*\[?\s*'?(\d+)/g)].map((m) => Number(m[1]));
const compatible = engines.includes('>=') && ciNodes.length > 0 && ciNodes.every((n) => {
  const floor = Number(engines.match(/>=([\d.]+)/)[1].split('.')[0]);
  return n >= floor;
});
check('① engines 存在且覆盖 CI Node 版本', Boolean(engines) && compatible, `engines=${engines} ci=${ciNodes.join(',')}`);

// ② Cargo.lock
const lockPath = path.join(ROOT, 'apps', 'desktop', 'src-tauri', 'Cargo.lock');
const hasLock = existsSync(lockPath);
const pkgs = hasLock ? (readFileSync(lockPath, 'utf8').match(/\[\[package\]\]/g) ?? []).length : 0;
const hasSelf = hasLock && readFileSync(lockPath, 'utf8').includes('name = "zerokit-desktop"');
check('② Cargo.lock 提交在库', hasLock);
check('② Cargo.lock 含桌面壳条目', hasSelf, `${pkgs} packages`);

// ③ npm lockfile
const npmLock = path.join(ROOT, 'package-lock.json');
check('③ package-lock.json 存在且非空', existsSync(npmLock) && statSync(npmLock).size > 1000);

console.log(fail === 0 ? '可复现构建审计全部通过' : `${fail} 项不达标`);
process.exit(fail === 0 ? 0 : 1);
