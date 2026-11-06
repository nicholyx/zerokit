// relchain161-smoke：第一百六十一轮——release-chain.sh 结构与干跑
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SH = path.join(PKG_ROOT, 'scripts', 'release-chain.sh');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- relchain161 ${extra}`); } };
const sh = (args) => spawnSync('bash', [SH, ...args], { encoding: 'utf8', timeout: 60000 });
console.log('relchain161-smoke');

// ①② 语法与结构
const src = readFileSync(SH, 'utf8');
{
  const syn = spawnSync('bash', ['-n', SH]);
  check('① bash -n 语法过', syn.status === 0, syn.stderr.slice(0, 80));
  check('① set -uo pipefail', src.includes('set -uo pipefail'));
  check('② ci_poll_merge 定义', src.includes('ci_poll_merge()'));
  check('② push_retry 定义（https→SSH 降级）', src.includes('push_retry()') && src.includes('GITHUB_SSH'));
  check('② remote_main_sha（不依赖本地 fetch）', src.includes('remote_main_sha()') && src.includes('gh api repos/nicholyx/zerokit/branches/main'));
}
// ③ 事故判据固化
{
  check('③ CI-FAIL 即停（v1.59.1 事故）', /if \[\[ "\$f" -gt 0 \]\]/.test(src) && src.includes('绝不继续'));
  check('③ merge 复核（state=MERGED）', src.includes('--json state --jq .state'));
  check('③ tag 双确认', src.includes('git cat-file -t "$SHA"') && src.includes('ls-remote --tags origin "v$VER"'));
  check('③ tag 幂等保护（已存在即拒）', src.includes('远端已存在'));
  check('③ 11/12+MERGEABLE 捷径', src.includes('11/12 + MERGEABLE'));
}
// ④ 干跑
{
  const r = sh(['feature', '999', '--dry-run']);
  check('④ feature 干跑', r.status === 0 && r.stdout.includes('ci_poll_merge') && r.stdout.includes('main 同步'));
  const r2 = sh(['release', '9.9.9', '999', '--dry-run']);
  check('④ release 干跑全步骤', r2.status === 0 && r2.stdout.includes('verify-remote') && r2.stdout.includes('CI-FAIL 即停') && r2.stdout.includes('资产轮询'), `status=${r2.status} out=${(r2.stdout||'').slice(0,300)} err=${(r2.stderr||'').slice(0,200)}`);
  check('④ 干跑不动远端（无 gh 调用）', !r2.stdout.includes('MERGED'));
}
// ⑤ 负例退出码
{
  check('⑤ 未知模式非零退出（2）', sh(['bogus']).status !== 0);
  check('⑤ release 缺版本 exit 1', sh(['release']).status === 1);
  check('⑤ feature 缺 PR exit 1', sh(['feature']).status === 1);
  // 分支守卫：结构断言恒真（源码里有守卫且在 push_retry 之前）；行为断言只在能稳定复现的
  // 本地分支跑（CI 的 detached/浅克隆环境输出形态不同，不作为失败条件）
  check('⑤ 分支守卫在 push 之前（结构）', src.indexOf('git branch --show-current') < src.indexOf('push_retry "$BR"'));
  const r = sh(['release', '9.9.9', '999']);
  check('⑤ 非 release 分支拒执行', r.status === 1 && (r.stdout + r.stderr).includes('不在 chore/release-'), `status=${r.status} out=${(r.stdout||'').slice(-200)} err=${(r.stderr||'').slice(0,200)}`);
}
// ⑥b C locale 回归（CI 的 macOS runner 是非 UTF-8 locale——bash 3.2 下 $VAR 紧邻
// 多字节中文会把变量名读长成 unbound variable，本地 UTF-8 复现不了，必须显式测）
{
  const r = spawnSync('/bin/bash', [SH, 'release', '9.9.9', '999', '--dry-run'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, LC_ALL: 'C', LANG: 'C' } });
  check('⑥b C locale 干跑（CI 形态）', r.status === 0 && r.stdout.includes('release 模式'), `err=${(r.stderr||'').slice(0,120)}`);
  const r2 = spawnSync('/bin/bash', [SH, 'release', '9.9.9', '999'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, LC_ALL: 'C', LANG: 'C' } });
  check('⑥b C locale 分支拒执行', r2.status === 1, `err=${(r2.stderr||'').slice(0,120)}`);
}

// ⑥ shellcheck（有则跑，CI 兜底）
{
  const sc = spawnSync('shellcheck', [SH]);
  if (sc.error || sc.status === 127) { check('⑥ shellcheck（本机无，CI 兜底）', true); }
  else check('⑥ shellcheck 0 findings', sc.status === 0, (sc.stdout || '').slice(0, 120));
}

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
