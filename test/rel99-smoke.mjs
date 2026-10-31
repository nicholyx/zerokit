// rel99-smoke：第九十九轮——发布工具自愈（锚点 + release-prep 自检）
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, copyFileSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- rel99`); } };
const home = mkdtempSync(path.join(tmpdir(), 'r99-'));
// 完整树拷贝（release-prep 在仓库根跑，测试用 cpSync 快照；排除 node_modules）
const tree = path.join(home, 'tree');
mkdirSync(tree, { recursive: true });
cpSync(PKG_ROOT, tree, { recursive: true, filter: (src) => !src.includes('node_modules') && !src.includes('.git') });
// fixture 用自造的干净 CHANGELOG（真实仓库的 [Unreleased] 在 release 分支上已被归档清空，
// 且历史上已有 1.4.0 段——干跑同版本会误报「重复段」。造一个只有旧版本的干净输入。）
writeFileSync(path.join(tree, 'CHANGELOG.md'), '## [Unreleased]\n\n### Added\n\n- 测试条目一\n- 测试条目二\n\n## [0.0.1] - 2020-01-01\n\n### Added\n\n- 旧条目\n');
// release-prep 的正则假定真实 JSON 格式（冒号后空格）——规范化版本行，避免 echo 紧凑格式干扰
{
  const fs2 = { read: (f) => readFileSync(path.join(tree, f), 'utf8'), write: (f, s2) => writeFileSync(path.join(tree, f), s2) };
  fs2.write('package.json', fs2.read('package.json').replace(/"version":\s*"([\d.]+)"/, '"version": "$1"'));
  fs2.write('apps/desktop/src-tauri/tauri.conf.json', fs2.read('apps/desktop/src-tauri/tauri.conf.json').replace(/"version":\s*"([\d.]+)"/, '"version": "$1"'));
  // v1.3.0 刚归档完 [Unreleased] 是空壳——种两条可归档条目
  fs2.write('CHANGELOG.md', fs2.read('CHANGELOG.md').replace(
    /## \[Unreleased\]\n\n（下一版攒着）\n/,
    '## [Unreleased]\n\n### Added\n\n- rel99 测试条目 A\n- rel99 测试条目 B\n'));
}
const run = (args) => spawnSync(process.execPath, [path.join(tree, 'scripts/release-prep.mjs'), ...args], { encoding: 'utf8', timeout: 60000, cwd: tree });
const readTree = (f) => readFileSync(path.join(tree, f), 'utf8');
const seedUnreleased = () => {
  const cl = readTree('CHANGELOG.md');
  const m = cl.match(/## \[Unreleased\]\n\n([^]*?)\n\n## \[/);
  if (!m || !m[1].startsWith('### Added')) {
    writeFileSync(path.join(tree, 'CHANGELOG.md'), cl.replace(
      /## \[Unreleased\]\n\n(?:（下一版攒着）\n\n?)?/,
      '## [Unreleased]\n\n### Added\n\n- rel99 后续条目\n\n'));
  }
};

console.log(`rel99-smoke（${home}）`);

// ① 锚存在（本仓库）
check('① 本仓 START-HERE 有锚', /<!-- zk-version -->.*v[\d.]+.*<!-- \/zk-version -->/.test(readFileSync(path.join(PKG_ROOT, 'START-HERE.md'), 'utf8')));

// ② 正常干跑：1.4.0 归档 + 五处提示
{
  const r = run(['1.4.0']);
  check('② 干跑成功（未写盘提示）', r.status === 0 && r.stdout.includes('干跑'));
}

// ② --write 后锚内版本更新（句式解耦的证据：锚外文字随便改也能换）
{
  // 故意把锚外句式改怪（模拟人改漂移）
  const sh = readTree('START-HERE.md');
  writeFileSync(path.join(tree, 'START-HERE.md'), sh.replace(/。<!-- zk-version -->/, '！是的！<!-- zk-version -->'));
  const r = run(['1.4.0', '--write']);
  const after = readTree('START-HERE.md');
  check('② 锚内换版本（句式漂移不影响）', r.status === 0 && after.includes('当前版本 v1.4.0<!-- /zk-version -->'));
  check('② 锚外怪句式保留', after.includes('！是的！'));
}

// ③ 归档条目守卫：人为破坏（归档后删一条）→ 不该被自检放过是不可能的（自检在同进程）——
//    改测守卫逻辑本身：正常归档后守卫打印
{
  seedUnreleased();
  const r = run(['1.5.0', '--write']);
  check('③ 归档条目守卫打印', r.status === 0 && r.stdout.includes('归档条目守卫通过'));
}

// ④ 五处复核打印
{
  seedUnreleased();
  const r = run(['1.6.0', '--write']);
  check('④ 五处复核', r.stdout.includes('五处版本号写盘复核通过'));
  check('④ START-HERE 到位', readTree('START-HERE.md').includes('v1.6.0'));
}

// ⑥ --check 三态
{
  const ok = run(['--check']);
  check('⑥ --check 通过态', ok.status === 0 && ok.stdout.includes('--check 通过'));
  // 版本不一致：改坏 package.json
  writeFileSync(path.join(tree, 'package.json'), readTree('package.json').replace('"version": "1.6.0"', '"version": "9.9.9"'));
  const bad = run(['--check']);
  check('⑥ --check 抓不一致', bad.status !== 0 && (bad.stdout + bad.stderr).includes('不一致'));
  // 恢复 + 破坏锚
  writeFileSync(path.join(tree, 'package.json'), readTree('package.json').replace('"version": "9.9.9"', '"version": "1.6.0"'));
  writeFileSync(path.join(tree, 'START-HERE.md'), readTree('START-HERE.md').replace('<!-- /zk-version -->', ''));
  const noAnchor = run(['--check']);
  check('⑥ --check 抓缺锚', noAnchor.status !== 0 && (noAnchor.stdout + noAnchor.stderr).includes('锚'));
  // 恢复锚
  writeFileSync(path.join(tree, 'START-HERE.md'), readTree('START-HERE.md').replace('当前版本 v1.6.0', '当前版本 v1.6.0<!-- /zk-version -->'));
  // 重复版本段：把最老的 [1.4.0] 段标题改成 [1.6.0] → 与最新段重复（版本号本身仍一致）
  writeFileSync(path.join(tree, 'CHANGELOG.md'), readTree('CHANGELOG.md').replace('## [1.4.0] - ', '## [1.6.0] - '));
  const dup = run(['--check']);
  check('⑥ --check 抓重复段', dup.status !== 0 && (dup.stdout + dup.stderr).includes('重复'));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
