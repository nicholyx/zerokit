// maint127-smoke：仓库维护与还债（第一百二十七轮）
// ⚠ 本文件绝不 spawn test-all.mjs——测试里再跑测试跑测器会指数增殖进程（2026-11-02 事故，见 MEMORY）。
//   对跑测器行为的验证只用源码静态断言；全量/shuffle 由 CI 与人工跑，不进测试文件。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- maint127`); } };

console.log('maint127-smoke');

// ① 测试提速断言：病灶代码已删（三个文件里不再有 spawnSync(['ui'…) 阻塞调用）
{
  const cli = readFileSync(path.join(PKG_ROOT, 'src/cli.ts'), 'utf8');
  for (const f of ['batch98', 'devweb86', 'doctor84']) {
    const src = readFileSync(path.join(PKG_ROOT, `test/${f}-smoke.mjs`), 'utf8');
    // 剥掉注释行再测——注释里提到旧坑字面量不算真实调用
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    check(`① ${f} 不再经 spawnSync 起前台 ui`, !/spawnSync\(\s*\[?\s*'ui'/.test(code) && !/\brun\(\[\s*'ui'/.test(code));
  }
  check('① retry 退避测试钩子（ZEROKIT_RETRY_MS）', cli.includes('ZEROKIT_RETRY_MS'));
  const c120 = readFileSync(path.join(PKG_ROOT, 'test/cli120-smoke.mjs'), 'utf8');
  check('① cli120 测试启用快速退避', c120.includes("ZEROKIT_RETRY_MS: '10'"));
}

// ② --changed 模式（只做静态断言——见文件头警示）
{
  const s = readFileSync(path.join(PKG_ROOT, 'scripts/test-all.mjs'), 'utf8');
  check('② IMPACT_MAP 存在', s.includes('IMPACT_MAP'));
  check('② --changed 分支', s.includes("--changed"));
  check('② 测试文件映射自身', s.includes("startsWith('test/')"));
  check('② 跑测器自身有超时护栏（单文件 timeout 上限）', /timeout/i.test(s));
}

// ③ CHANGELOG 瘦身
{
  const main = readFileSync(path.join(PKG_ROOT, 'CHANGELOG.md'), 'utf8');
  const arch = readFileSync(path.join(PKG_ROOT, 'docs/reference/changelog-archive.md'), 'utf8');
  const mainVers = (main.match(/^## \[\d/gm) ?? []).length;
  check('③ 主 CHANGELOG ≤ 12 个版本段', mainVers <= 12);
  check('③ 归档文件承接旧版本（>100 段）', (arch.match(/^## \[/gm) ?? []).length > 100);
  const prep = readFileSync(path.join(PKG_ROOT, 'scripts/release-prep.mjs'), 'utf8');
  check('③ release-prep 自动归档函数', prep.includes('archiveOldVersions'));
}

// ⑥ scripts/ 目录 README
{
  const readme = readFileSync(path.join(PKG_ROOT, 'scripts/README.md'), 'utf8');
  for (const s of ['lint.sh', 'test-all.mjs', 'release-prep.mjs', 'bench.mjs', 'a11y-scan.mjs', 'check-docs.mjs', 'i18n-scan.mjs']) {
    check(`⑥ ${s} 有说明`, readme.includes(s));
  }
}

// ⑨ shuffle：静态断言（实跑由 CI 覆盖）
{
  const s = readFileSync(path.join(PKG_ROOT, 'scripts/test-all.mjs'), 'utf8');
  check('⑨ --shuffle 模式存在', s.includes('--shuffle'));
  check('⑨ maint127 自身不再嵌套跑跑测器（防进程增殖）', !readFileSync(path.join(PKG_ROOT, 'test/maint127-smoke.mjs'), 'utf8').includes('test-all.mjs\'), \'--'));
}

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
