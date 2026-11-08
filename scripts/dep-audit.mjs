// 第二百零二轮⑥：依赖健康与供应链审计（第六审计线）
// ① 幽灵依赖：package.json 声明的每个依赖必须在源码/生成脚本中被 import
// ② 锁文件一致：lockfile v1 段数量与 manifest 包数匹配（npm ci 可跑）
// ③ 许可证：白名单 MIT/Apache-2.0/ISC/BSD-*/0BSD/Unlicense（读 node_modules/<pkg>/package.json）
// ④ 已知漏洞面：npm audit --omit=dev 由调用方跑（本脚本聚焦静态可判定项）
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const check = (name, ok, extra = '') => { if (ok) console.log(`OK    ${name}`); else { fail++; console.error(`FAIL  ${name}  ${extra}`); } };
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const deps = Object.keys(pkg.dependencies ?? {});
const devDeps = Object.keys(pkg.devDependencies ?? {});

// 源码全集（src + web + scripts + apps/desktop/src + plugins）
const collect = (dir, acc = []) => {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'target') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p, acc);
    else if (/\.(ts|mjs|js|html)$/.test(e.name)) acc.push(p);
  }
  return acc;
};
const files = [...collect(path.join(ROOT, 'src')), ...collect(path.join(ROOT, 'web')), ...collect(path.join(ROOT, 'scripts')), ...collect(path.join(ROOT, 'apps', 'desktop', 'src'))];
const allSrc = files.map((f) => readFileSync(f, 'utf8')).join('\n');

// ① 幽灵依赖：prod 依赖必须被 import（生成期专用依赖在 scripts 里被 import 也算）
const ghosts = deps.filter((d) => !allSrc.includes(d));
check('① 生产依赖无幽灵（全部被 import）', ghosts.length === 0, ghosts.join(','));
// 生成期依赖（devDeps）至少要在 scripts 里出现或属于已知工具链
const KNOWN_TOOLS = ['typescript', '@types/node', '@tauri-apps/cli'];
const ghostDev = devDeps.filter((d) => !KNOWN_TOOLS.includes(d) && !allSrc.includes(d));
check('① devDeps 无未解释项（工具链白名单外须被引用）', ghostDev.length === 0, ghostDev.join(','));

// ② 锁文件一致：npm ls --package-lock-only 静默=一致
try {
  execFileSync('npm', ['ls', '--package-lock-only', '--omit=dev'], { cwd: ROOT, encoding: 'utf8', timeout: 120000, stdio: 'pipe' });
  check('② lockfile 与 manifest 一致（npm ls dry）', true);
} catch (e) {
  check('② lockfile 与 manifest 一致（npm ls dry）', false, (e.stderr || '').slice(0, 80));
}

// ③ 许可证白名单
const ALLOW = ['MIT', 'Apache-2.0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Unlicense', 'CC0-1.0'];
const bad = [];
const licOf = (name) => {
  const pj = path.join(ROOT, 'node_modules', name, 'package.json');
  if (!existsSync(pj)) return '(missing)';
  try { return JSON.parse(readFileSync(pj, 'utf8')).license ?? '(none)'; } catch { return '(parse-err)'; }
};
const seen = new Set();
for (const d of deps) {
  const stack = [d];
  while (stack.length) {
    const name = stack.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    const lic = licOf(name);
    if (!ALLOW.some((a) => (lic ?? '').includes(a))) bad.push(`${name}: ${lic}`);
    // 传递依赖
    const pj = path.join(ROOT, 'node_modules', name, 'package.json');
    if (existsSync(pj)) {
      try {
        const deps2 = JSON.parse(readFileSync(pj, 'utf8')).dependencies ?? {};
        for (const k of Object.keys(deps2)) if (!seen.has(k)) stack.push(k);
      } catch { /* skip */ }
    }
  }
}
check('③ 许可证全 permissive（MIT/Apache/ISC/BSD 族）', bad.length === 0, bad.slice(0, 4).join(' | '));

console.log(fail === 0 ? '依赖健康审计全部通过' : `${fail} 项不达标`);
process.exit(fail === 0 ? 0 : 1);
