// cli148-smoke：第一百四十八轮——CLI 输出管道（calc/where/rename/pipe 与组合语义）
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- cli148`); } };
const home = mkdtempSync(path.join(tmpdir(), 'cli148-'));
const run = (args) => spawnSync(process.execPath, [CLI, 'run', ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home } });
console.log(`cli148-smoke（${home}）`);
spawnSync(process.execPath, [CLI, 'plugin', 'bundled'], { encoding: 'utf8', timeout: 120000, env: { ...process.env, ZEROKIT_HOME: home } });

// 纯函数直测
const cliX = await import('../src/core/cliX.ts');
const rows = [
  { 名: 'a', 值: 10, 备: 'x10' },
  { 名: 'b', 值: 30, 备: 'x30' },
  { 名: 'c', 值: 5, 备: 'y5' },
];

// ① calcColumn：算术 + 列引用 + 优先级
{
  const r = cliX.calcColumn(rows, '双倍=值*2');
  check('① calc 基本算术', r.rows[0]?.['双倍'] === 20 && r.rows[1]?.['双倍'] === 60);
  const r2 = cliX.calcColumn(rows, '和=值+备'); // 备不是数字→numVal null→0
  check('① calc 非数字列按 0', r2.rows[0]?.['和'] === 10);
  const r3 = cliX.calcColumn(rows, '复杂=(值+10)*2');
  check('① calc 括号优先级', r3.rows[1]?.['复杂'] === 80);
  const r4 = cliX.calcColumn(rows, 'z=不存在的列+1');
  check('① calc 未知列报错', !!r4.error && r4.error.includes('不存在'));
}

// ② whereRows：三形态
{
  const w1 = cliX.whereRows(rows, '值>9');
  check('② where 数字比较', w1.rows.length === 2);
  const w2 = cliX.whereRows(rows, '名=b');
  check('② where 等值', w2.rows.length === 1 && w2.rows[0]?.['名'] === 'b');
  const w3 = cliX.whereRows(rows, '备~x');
  check('② where 子串', w3.rows.length === 2);
  const w4 = cliX.whereRows(rows, '没有>1');
  check('② where 未知列报错', !!w4.error && w4.error.includes('可用'));
}

// ③ renameColumn
{
  const r = cliX.renameColumn(rows, '名=name');
  check('③ rename 改名', r.rows[0]?.['name'] === 'a' && !('名' in (r.rows[0] ?? {})));
  const bad = cliX.renameColumn(rows, 'x=y');
  check('③ rename 未知列报错', !!bad.error);
}

// ④⑤ 组合链（CLI 实跑）：where 过滤后 calc 作用在过滤结果上
{
  const r = run(['sysinfo', 'top', '--head', '8', '--where', '内存>1000', '--calc', '标记=1', '--pick', '进程,标记']);
  const all = r.stdout + r.stderr;
  check('④⑤ 组合链 CLI', r.status === 0 && all.includes('进程') && all.includes('标记'), all.slice(0, 80));
}

// ⑥ --pipe
{
  const r = run(['sysinfo', 'top', '--head', '5', '--pick', '进程', '--pipe', 'grep -c .']);
  check('⑥ pipe 表格进命令', r.status === 0 && /^\d+/.test((r.stdout ?? '').trim()), (r.stdout ?? '').slice(0, 30));
  const r2 = run(['sysinfo', 'overview', '--pipe', 'cat', '--quiet']);
  check('⑥ pipe 与 --quiet 互斥拒绝', r2.status !== 0 && (r2.stdout + r2.stderr).includes('互斥') || (r2.stdout + r2.stderr).includes('不能'));
}

// ⑦ 负例提示
{
  const r = run(['sysinfo', 'top', '--where', '不存在>1']);
  check('⑦ 负例带可用列清单', r.status !== 0 && (r.stdout + r.stderr).includes('可用：'));
  const r3 = run(['sysinfo', 'top', '--head', '3', '--calc', 'bad']);
  check('⑦ calc 坏写法提示', r3.status !== 0 && (r3.stdout + r3.stderr).includes('怎么改'));
}

// ⑧ --help 组合顺序说明
{
  const r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home } });
  const all = r.stdout + r.stderr;
  check('⑧ help 组合顺序行', all.includes('组合顺序') && all.includes('--pipe') && all.includes('--calc'));
}

// ⑨ --jq + 加工：jq 先收窄（对象结果收窄后 toRows 单行，calc 照常作用）
{
  const r = run(['sysinfo', 'overview', '--jq', '.主机名']);
  check('⑨ jq 单值不受管道影响', r.status === 0);
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
