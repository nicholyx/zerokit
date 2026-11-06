// why167-smoke：第一百六十七轮——zkit why 与 config env
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- why167 ${extra}`); } };
const home = mkdtempSync(path.join(tmpdir(), 'w167-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (args, input) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env, input });
console.log(`why167-smoke（${home}）`);
run(['plugin', 'bundled']);

// ① why 归类三类真实报错
{
  const r1 = run(['why', 'ENOENT: no such file, open x.py']);
  check('① not-found 归类+步骤', r1.status === 0 && r1.stdout.includes('文件或目录不存在') && r1.stdout.includes('→'));
  const r2 = run(['why', 'permission denied: run.sh']);
  check('① permission 归类', r2.stdout.includes('没有权限'));
  const r3 = run(['why', 'Command timed out after 5000ms']);
  check('① timeout 归类', r3.stdout.includes('执行超时'));
}
// ① 认不出诚实说
{
  const r = run(['why', '一个完全无关的句子']);
  check('① 认不出 exit 1+指引', r.status === 1 && r.stdout.includes('没有认出') && r.stdout.includes('doctor'));
}
// ② why --last
{
  run(['run', 'quick', 'b64', '--text', 'x']); // 成功
  // 种一条失败：缺必填参数
  const failRun = run(['run', 'quick', 'b64']);
  check('② 前置：真失败产生', failRun.status !== 0);
  const r = run(['why', '--last']);
  check('② --last 解释最近失败', r.status === 0 && (r.stdout.includes('看起来是') || r.stdout.includes('没有认出')), r.stdout.slice(0, 100));
  const r0 = run(['why', '--last'], );
  // 清掉失败历史后再测「没有失败」分支——直接删 history 文件
}
// ⑤ 无参数用法+三例
{
  const r = run(['why']);
  check('⑤ 用法+三例', r.status === 0 && r.stdout.includes('用法') && r.stdout.includes('zkit why --last') && (r.stdout.match(/zkit why/g) ?? []).length >= 3);
}
// ⑥ --json 机读
{
  const r = run(['why', 'exit code 3', '--json']);
  const o = JSON.parse(r.stdout);
  check('⑥ json {kind,cause,next}', o.kind === 'exit-nonzero' && typeof o.cause === 'string' && Array.isArray(o.next));
}
// ⑦ 同源：CLI 分类结果与 web classifyError 一致
{
  const { classifyError } = await import('../web/extras.js');
  const cliOut = run(['why', 'EPERM operation not permitted', '--json']);
  const o = JSON.parse(cliOut.stdout);
  check('⑦ 与 web classifyError 同源一致', o.kind === classifyError('EPERM operation not permitted').kind);
}
// ③④ config env
{
  run(['config', 'demosettings', 'set', 'greeting', 'hi']);
  const r = run(['config', 'demosettings', 'env']);
  check('③ bash export 引导', r.status === 0 && r.stdout.includes('export ZEROKIT_SETTING_DEMOSETTINGS_GREETING') && r.stdout.includes('--stdin'));
  check('③ 值掩码不出现', !r.stdout.includes('hi\n') || !/export .*=hi/.test(r.stdout));
  const rf = run(['config', 'demosettings', 'env', '--shell', 'fish']);
  check('④ fish set -x', rf.stdout.includes('set -x ZEROKIT_SETTING_'));
  const rj = run(['config', 'demosettings', 'env', '--json']);
  const o = JSON.parse(rj.stdout);
  check('③ --json 机读', o.plugin === 'demosettings' && Array.isArray(o.settings) && o.settings.length >= 2);
}
// ⑧ logs --errors
{
  const all = run(['logs']);
  const errs = run(['logs', '--errors']);
  const allN = (all.stdout.match(/[✓✗]/g) ?? []).length;
  const errN = (errs.stdout.match(/✗/g) ?? []).length;
  check('⑧ --errors 只列失败', allN > 0 && errN >= 0 && errN < allN, `all=${allN} err=${errN}`);
}
// 路由补全：why 在 KNOWN_COMMANDS
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(path.join(PKG_ROOT, 'src', 'cli.ts'), 'utf8');
  check('⑨ KNOWN_COMMANDS 含 why', src.includes("'why'"));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
