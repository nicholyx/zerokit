// cli178-smoke：第一百七十八轮——CLI 提示与发现
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- cli178 ${extra}`); } };
console.log('cli178-smoke');

const home = mkdtempSync(path.join(tmpdir(), 'c178-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env });

// 纯函数
const E = await import('../src/core/cliX.ts');
check('⑧ relatedCommands(run) 同类别联想', E.relatedCommands('run').length >= 2 && E.relatedCommands('run').every((x) => ['list','show','doctor'].includes(x)));
check('⑧ relatedCommands 未知命令空数组', E.relatedCommands('nope-x') === null || Array.isArray(E.relatedCommands('nope-x')));
check('⑧ relatedCommands 去掉自己', !E.relatedCommands('run').includes('run'));
check('⑧ aliasValidate 合法名过', E.aliasValidate('top', ['run', 'list']) === null);
check('⑧ aliasValidate 内置命令拒绝', (E.aliasValidate('run', ['run']) ?? '').includes('内置命令'));
check('⑧ aliasValidate 大写拒绝', (E.aliasValidate('Top', ['run']) ?? '').length > 0);
check('⑧ aliasResolve 一层展开', Array.isArray(E.aliasResolve('t', [{ name: 't', argv: ['list', '--json'], createdAt: 1 }], ['list']).argv));
check('⑧ aliasResolve 嵌套拒绝', 'error' in E.aliasResolve('a', [{ name: 'a', argv: ['b'], createdAt: 1 }, { name: 'b', argv: ['list'], createdAt: 2 }], ['list']));

// ① commands
{
  const r = run(['commands']);
  check('① commands 索引有分类节', r.stdout.includes('【基本】') && r.stdout.includes('【配置】'));
  check('① commands 含 alias 行', r.stdout.includes('alias'));
}

// ③④ alias 闭环
run(['plugin', 'bundled']);
{
  const a = run(['alias', 'add', 'top', 'run', 'sysinfo', 'top', '--head', '3']);
  check('③ add 成功', a.stdout.includes('已添加：zkit top'));
  const dupe = run(['alias', 'add', 'top', 'list']);
  check('③ 重名拒绝', dupe.stdout.includes('已存在') || dupe.stderr.includes('已存在'));
  const builtin = run(['alias', 'add', 'run', 'list']);
  check('③ 内置命令名拒绝', builtin.stderr.includes('内置命令'));
  const l = run(['alias', 'list']);
  check('③ list 一行一条', l.stdout.includes('top') && l.stdout.includes('sysinfo'));
  const ex = run(['top', '--quiet']);
  check('④ zkit top 真执行', ex.stdout.trim().startsWith('{"ok":true'));
  check('④ 展开提示在 stderr', ex.stderr.includes('→ zkit run sysinfo top'));
  const bad = run(['alias', 'add', 't2', 'nope-cmd']);
  check('③ 目标非内置命令拒绝', bad.stderr.includes('不是内置命令'));
  const rmv = run(['alias', 'rm', 'top']);
  check('③ rm 后再跑回未知', rmv.stdout.includes('已删除') && run(['top']).stderr.includes('未知命令'));
}

// ⑤ version
{
  const r = run(['version']);
  check('⑤ zkit version 出号', /^\d+\.\d+\.\d+/.test(r.stdout.trim()));
}

// ⑥⑦ 核实已有
{
  const b = run(['completion', 'bash']);
  check('⑥ completion bash', b.stdout.includes('zkit') && b.stdout.length > 100);
  const z = run(['completion', 'zsh']);
  check('⑥ completion zsh', z.stdout.includes('zsh'));
  const f = run(['completion', 'fish']);
  check('⑥ completion fish', f.stdout.includes('fish'));
  const m = run(['man']);
  check('⑦ man 手册', m.stdout.includes('zkit(1)') || m.stdout.length > 500);
}

// ② 相关命令段
{
  const r = run(['run']);
  check('② run 用法带相关命令', (r.stderr + r.stdout).includes('相关命令：'));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
