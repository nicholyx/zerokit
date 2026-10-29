// cli75-smoke：第七十五轮结果再加工——sort/pick/uniq/sum/head 组合 + 管道路径不受影响
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PKG_ROOT = path.resolve(import.meta.dirname, '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`); } };
const home = mkdtempSync(path.join(tmpdir(), 'cli75-'));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home },
});
console.log(`cli75-smoke（临时目录 ${home}）`);
run(['plugin', 'bundled']);

// ① sort 数值降序（内存是 '1509.2 MB' 前缀数字串）
{
  const r = run(['run', 'sysinfo', 'top', '--limit', '5', '--sort', '-内存']);
  const nums = r.stdout.split('\n').filter((l) => / MB/.test(l)).map((l) => parseFloat(l.match(/([\d.]+) MB/)?.[1] ?? '0'));
  check('① sort 数值降序', nums.length >= 4 && nums.every((n, i) => i === 0 || nums[i - 1] >= n));
}
// ② sort 升序
{
  const r = run(['run', 'sysinfo', 'top', '--limit', '5', '--sort', '内存']);
  const nums = r.stdout.split('\n').filter((l) => / MB/.test(l)).map((l) => parseFloat(l.match(/([\d.]+) MB/)?.[1] ?? '0'));
  check('② sort 数值升序', nums.length >= 4 && nums.every((n, i) => i === 0 || nums[i - 1] <= n));
}
// ③ pick 两列
{
  const r = run(['run', 'sysinfo', 'top', '--limit', '3', '--pick', 'PID,进程']);
  check('③ pick 两列', r.stdout.includes('PID') && r.stdout.includes('进程') && !r.stdout.includes('MB'));
}
// ④ pick 错列报清单
{
  const r = run(['run', 'sysinfo', 'top', '--limit', '3', '--pick', 'zzz']);
  check('④ pick 错列报可用列', r.stderr.includes('列不存在') && r.stderr.includes('可用列'));
  check('④ 错列退出码 1', r.status === 1);
}
// ⑤ head 3
{
  const r = run(['run', 'sysinfo', 'top', '--limit', '8', '--head', '3']);
  const dataRows = r.stdout.split('\n').filter((l) => l.trim() && !/PID|^---/.test(l));
  check('⑤ head 3 行', dataRows.length === 3);
}
// ⑥ uniq 进程名去重
{
  const r = run(['run', 'sysinfo', 'top', '--limit', '10', '--uniq', '进程']);
  const names = r.stdout.split('\n').filter((l) => / MB/.test(l)).map((l) => (l.match(/\s(\S+)\s+[\d.]+ MB/) ?? [])[1]);
  check('⑥ uniq 保序去重', new Set(names).size === names.length && names.length >= 3);
}
// ⑦ sum TOTAL 行
{
  const r = run(['run', 'sysinfo', 'top', '--limit', '5', '--sum', '内存']);
  const total = r.stdout.split('\n').find((l) => l.includes('TOTAL'));
  check('⑦ sum TOTAL 行', !!total && /TOTAL/.test(total));
}
// ⑧ sum 非数字拒绝
{
  const r = run(['run', 'sysinfo', 'top', '--limit', '3', '--sum', '进程']);
  check('⑧ sum 非数字拒绝', r.stderr.includes('含非数字值') && r.status === 1);
}
// ⑨ 组合：uniq + pick + sum
{
  const r = run(['run', 'sysinfo', 'top', '--limit', '8', '--uniq', '进程', '--pick', '进程,内存', '--sum', '内存']);
  check('⑨ 组合加工', r.stdout.includes('TOTAL') && !r.stdout.includes('PID'));
}
// ⑩ --json 不受加工影响（原始顺序）
{
  const r = run(['run', 'sysinfo', 'top', '--limit', '5', '--sort', '-内存', '--json']);
  const d = JSON.parse(r.stdout);
  check('⑩ --json 原始数据', Array.isArray(d.data) && d.data.length === 5 && !('TOTAL' in d.data[0]));
}
// ⑪ --quiet 不受加工影响
{
  const r = run(['run', 'sysinfo', 'top', '--limit', '5', '--sort', '-内存', '--quiet']);
  const d = JSON.parse(r.stdout.trim());
  check('⑪ --quiet 原始单行 JSON', d.ok === true && Array.isArray(d.data));
}
// ⑫ 纯函数边界
{
  const cliX = await import(pathToFileURL(path.join(PKG_ROOT, 'src', 'core', 'cliX.ts')).href);
  const rows = [{ a: 3, b: 'x' }, { a: 1, b: 'y' }, { a: 2, b: 'x' }];
  check('⑫ asc/desc', JSON.stringify(cliX.transformRows(rows, { sort: 'a' }).rows.map((r) => r.a)) === '[1,2,3]'
    && JSON.stringify(cliX.transformRows(rows, { sort: '-a' }).rows.map((r) => r.a)) === '[3,2,1]');
  check('⑫ uniq 首见序', cliX.transformRows(rows, { uniq: 'b' }).rows.length === 2 && cliX.transformRows(rows, { uniq: 'b' }).rows[0].a === 3);
  check('⑫ sum 值', cliX.transformRows(rows, { sum: 'a' }).rows.at(-1).a === 6);
  check('⑫ 空行集透传', cliX.transformRows([], { sort: 'a' }).rows.length === 0);
}
// ⑬ 加工旗标不进动作参数
{
  const r = run(['run', 'sysinfo', 'top', '--limit', '3', '--sort', '-内存']);
  check('⑬ 旗标剥离', r.status === 0 && !r.stderr.includes('未知参数'));
}
// ⑭ --sort= 等号形式
{
  const r = run(['run', 'sysinfo', 'top', '--limit', '3', '--sort=内存']);
  check('⑭ --sort= 形式', r.status === 0 && r.stdout.includes('PID'));
}

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
