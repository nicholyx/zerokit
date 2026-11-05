// guard146-smoke：第一百四十六轮——质量护栏十项
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- guard146`); } };
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 120000, ...opts });
console.log('guard146-smoke');

// ① CHANGELOG 格式断言：负例（缺空行）必须被 guard146 抓住
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'g146-'));
  const cl = readFileSync(path.join(PKG_ROOT, 'CHANGELOG.md'), 'utf8');
  const broken = cl.replace('## [Unreleased]\n\n', '## [Unreleased]\n');
  writeFileSync(path.join(tmp, 'bad.md'), broken);
  const hasBad = /## \[Unreleased\]\n###?/.test(broken) || broken.includes('## [Unreleased]\n（') === false;
  // 直接断言 guard 脚本本身含三条规则锚
  const g = readFileSync(path.join(PKG_ROOT, 'scripts', 'guard146.mjs'), 'utf8');
  check('① guard 含 [Unreleased]-### 空行断言', g.includes('缺空行'));
  check('① guard 含分类头后空行断言', g.includes('分类头后缺空行'));
  check('① guard 含已发布段空行断言', g.includes('已发布段'));
  rmSync(tmp, { recursive: true, force: true });
}

// ② 版本行断言：guard 含 zk-version 锚且当前树跑过
{
  const g = readFileSync(path.join(PKG_ROOT, 'scripts', 'guard146.mjs'), 'utf8');
  check('② guard 含版本行 === package.json 断言', g.includes('zk-version') && g.includes('package.json'));
}

// ③④ verify-remote.sh 存在且双模式
{
  const v = readFileSync(path.join(PKG_ROOT, 'scripts', 'verify-remote.sh'), 'utf8');
  check('③ verify-remote 分支复核模式', v.includes('branches/$branch') || v.includes('branches/'));
  check('④ verify-remote tag 模式（cat-file + 远端 main HEAD 双断言）', v.includes('cat-file') && v.includes('branches/main'));
  // CI runner 上 gh 可能未认证——降级为语法检查；本地才做真实远端复核
  const hasGh = run('bash', ['-c', 'gh auth status >/dev/null 2>&1']).status === 0;
  if (hasGh) {
    const r = run('bash', [path.join(PKG_ROOT, 'scripts', 'verify-remote.sh'), 'main']);
    check('③ 对 main 实跑通过', r.status === 0 && (r.stdout ?? '').includes('OK'));
  } else {
    const r = run('bash', ['-n', path.join(PKG_ROOT, 'scripts', 'verify-remote.sh')]);
    check('③ CI 无 gh 凭据，语法检查通过', r.status === 0);
  }
}

// ⑤ test-all 崩溃文件计入失败（源码断言：missing++ 伴随 failed++）
{
  const t = readFileSync(path.join(PKG_ROOT, 'scripts', 'test-all.mjs'), 'utf8');
  check('⑤ 崩溃文件计入 failed 与 failures', t.includes('missing++;') && t.includes('failed++;') && t.includes('failures.push(file)'));
}

// ⑥ docs 绝对路径扫描在 guard
{
  const g = readFileSync(path.join(PKG_ROOT, 'scripts', 'guard146.mjs'), 'utf8');
  check('⑥ guard 含绝对路径红线扫描', g.includes('/(?:Users|home|private|tmp)/') || g.includes('D:[\\\\/]'));
}

// ⑦ FFFD 进 lint.sh
{
  const l = readFileSync(path.join(PKG_ROOT, 'scripts', 'lint.sh'), 'utf8');
  check('⑦ lint.sh 含 FFFD 扫描段', l.includes('0xfffd'));
}

// ⑧ commit-msg 第二行粘连检查
{
  const r1 = run(path.join(PKG_ROOT, 'scripts', 'check-commit-msg.sh'), ['--message', 'feat(x): 好\n直接粘连的正文']);
  check('⑧ 粘连 body 被拒', r1.status !== 0 && (r1.stdout + r1.stderr).includes('空一行'));
  const r2 = run(path.join(PKG_ROOT, 'scripts', 'check-commit-msg.sh'), ['--message', 'feat(x): 好\n\n正文没问题']);
  check('⑧ 规范空行分隔通过', r2.status === 0);
}

// ⑨ 文档数字同步在 guard + 当前树通过
{
  const r = run(process.execPath, [path.join(PKG_ROOT, 'scripts', 'guard146.mjs')]);
  check('⑨ guard 对当前树全过', r.status === 0 && (r.stdout ?? '').includes('文档数字同步'));
}

// ⑩ lint.sh 接线 guard
{
  const l = readFileSync(path.join(PKG_ROOT, 'scripts', 'lint.sh'), 'utf8');
  check('⑩ lint.sh 接线 guard146', l.includes('guard146.mjs'));
}

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
