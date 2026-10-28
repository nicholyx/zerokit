/**
 * 第四十六轮：CLI 收口与开发者体验冒烟。
 * 自包含：临时 ZEROKIT_HOME，不联网。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

let pass = 0; let fail = 0;
const ok = (cond, label, extra = '') => { if (cond) pass++; else { fail++; console.error(`FAIL: ${label} ${extra}`); } };
const REPO = path.resolve(import.meta.dirname, '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'zk-cli46-'));
const cli = (args) => spawnSync(process.execPath, [path.join(REPO, 'src/cli.ts'), ...args], {
  encoding: 'utf8', env: { ...process.env, ZEROKIT_HOME: HOME },
});
cli(['plugin', 'bundled']);

// ① completion 三 shell + 非法
{
  const b = cli(['completion', 'bash']);
  ok(b.status === 0 && b.stdout.includes('complete -F _zkit zkit'), 'completion bash');
  const z = cli(['completion', 'zsh']);
  ok(z.status === 0 && z.stdout.includes('#compdef zkit'), 'completion zsh');
  const f = cli(['completion', 'fish']);
  ok(f.status === 0 && f.stdout.includes('complete -c zkit'), 'completion fish');
  const bad = cli(['completion', 'tcsh']);
  ok(bad.status === 2, 'completion 非法 shell 退出码 2');
  // bash 脚本可被 bash -n 解析
  const n = spawnSync('bash', ['-n'], { input: b.stdout });
  ok(n.status === 0, 'bash 脚本语法合法');
}

// ② man
{
  const m = cli(['man']);
  ok(m.status === 0 && m.stdout.includes('zkit(1)') && m.stdout.includes('退出码'), 'man 参考文本');
}

// ③ --version / -V
{
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  for (const flag of ['--version', '-V']) {
    const v = cli([flag]);
    ok(v.status === 0 && v.stdout.trim() === pkg.version, `${flag} = ${pkg.version}`);
  }
}

// ⑥ 退出码细分
{
  const p404 = cli(['run', 'no-such-plugin', 'foo']);
  ok(p404.status === 2, '插件不存在 = 2');
  const a404 = cli(['run', 'quick', 'no-such-action']);
  ok(a404.status === 2, '动作不存在 = 2');
  const good = cli(['run', 'quick', 'ts2date', '--ts', '1760000000', '--yes']);
  ok(good.status === 0, '成功 = 0');
}

// ⑦ audit --follow 只读模式冒烟：不进循环（无 --follow 时立即返回）
{
  const a = cli(['audit', '--last', '3']);
  ok(a.status === 0, 'audit 无 --follow 立即返回');
}

// ⑧ stats --since
{
  cli(['run', 'quick', 'ts2date', '--ts', '1760000000', '--yes']);
  const s = cli(['stats', '--since', '1h']);
  ok(s.status === 0 && s.stdout.includes('quick.ts2date'), 'stats --since 1h 含刚跑的动作');
  const old = cli(['stats', '--since', '1s']);
  // 1s 窗口极窄：可能空也可能含（时间差），只验退出码与文案
  ok(old.status === 0, 'stats --since 窄窗不炸');
  const bad = cli(['stats', '--since', 'bogus']);
  ok(bad.status === 2, 'stats --since 非法 = 2');
}

// ⑤ check-docs.sh（bash 不存在的平台跳过——windows runner 也有 git bash，基本都有）
{
  const hasBash = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' }).status === 0;
  const r = hasBash ? spawnSync('bash', [path.join(REPO, 'scripts/check-docs.sh')], { encoding: 'utf8', cwd: REPO }) : null;
  ok(!hasBash || (r.status === 0 && r.stdout.includes('文档巡检全部通过')), 'check-docs 全过',
     hasBash ? `status=${r.status} out=[${r.stdout}] err=[${r.stderr.slice(0, 300)}]` : 'no bash');
}

console.log(`通过 ${pass} / ${pass + fail}`);
fs.rmSync(HOME, { recursive: true, force: true });
process.exit(fail > 0 ? 1 : 0);
