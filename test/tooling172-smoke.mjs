// tooling172-smoke：第一百七十二轮——release-prep 空壳补齐与工具链收尾
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- tooling172 ${extra}`); } };
console.log('tooling172-smoke');

// ①② 全树快照归档 → 文件头必须是规范空壳（搬段不丢头——三次手工补回的回归锁）
{
  const tmp = mkdtempSync(path.join(tmpdir(), 't172-'));
  cpSync(PKG_ROOT, tmp, { recursive: true, filter: (src) => !src.includes('node_modules') && !src.includes('.git') });
  const clp = path.join(tmp, 'CHANGELOG.md');
  let s = readFileSync(clp, 'utf8');
  s = s.replace(/## \[Unreleased\]\n\n(?:### Added\n\n)?(?:（下一版攒着）\n\n?)?/,
    '## [Unreleased]\n\n### Added\n\n- tooling172 归档回归条目\n\n');
  writeFileSync(clp, s);
  const r = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'release-prep.mjs'), '1.74.0', '--write'], { encoding: 'utf8', timeout: 120000, cwd: tmp });
  const after = readFileSync(clp, 'utf8');
  check('①① 归档 exit 0', r.status === 0, (r.stdout + r.stderr).slice(-160));
  check('② 文件头=规范空壳（搬段不丢头）', after.startsWith('# Changelog\n\n## [Unreleased]\n\n### Added\n\n（下一版攒着）'), after.slice(0, 60));
  check('② 新段在空壳后', after.indexOf('## [1.74.0]') > after.indexOf('## [Unreleased]'));
  rmSync(tmp, { recursive: true, force: true });
}

// ③ release-prep 头注释与空壳形态一致
{
  const src = readFileSync(path.join(PKG_ROOT, 'scripts', 'release-prep.mjs'), 'utf8');
  check('③ 头注释带 ### Added 空壳', src.includes('带 ### Added 的空壳'));
}

// ⑥ help 补 bundle/bookmark/share
{
  const home = mkdtempSync(path.join(tmpdir(), 't172h-'));
  const r = spawnSync(process.execPath, [CLI, 'help'], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home } });
  check('⑥ help 有 bundle', r.stdout.includes('bundle create|list|diff|apply'));
  check('⑥ help 有 bookmark', r.stdout.includes('bookmark add|list|rm|run'));
  check('⑥ help 有 share', r.stdout.includes('share <插件.动作>'));
  rmSync(home, { recursive: true, force: true });
}

// ⑦ man 补 bundle 四行
{
  const home = mkdtempSync(path.join(tmpdir(), 't172m-'));
  const r = spawnSync(process.execPath, [CLI, 'man'], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home } });
  check('⑦ man bundle create', r.stdout.includes('bundle create <名字>'));
  check('⑦ man bundle diff/apply', r.stdout.includes('bundle list|diff|apply'));
  check('⑦ man share', r.stdout.includes('share <插件.动作>'));
  rmSync(home, { recursive: true, force: true });
}

// ④⑤ 脚本结构断言
{
  const chain = readFileSync(path.join(PKG_ROOT, 'scripts', 'release-chain.sh'), 'utf8');
  check('④ overview_late_ok 函数化', chain.includes('overview_late_ok()'));
  bashOk(chain, '④ release-chain.sh bash -n');
  const vr = readFileSync(path.join(PKG_ROOT, 'scripts', 'verify-remote.sh'), 'utf8');
  check('⑤ cat-file 结果可见', vr.includes('确认对象存在'));
  bashOk(vr, '⑤ verify-remote.sh bash -n');
}
function bashOk(src, name) {
  // /dev/stdin 在 CI 的 Linux/Windows runner 上不存在——写临时文件再 bash -n
  const tmp = path.join(tmpdir(), `t172-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
  fs.writeFileSync(tmp, src);
  const r = spawnSync('bash', ['-n', tmp], { encoding: 'utf8' });
  fs.rmSync(tmp, { force: true });
  check(name, r.status === 0, r.stderr.slice(0, 100));
}

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
