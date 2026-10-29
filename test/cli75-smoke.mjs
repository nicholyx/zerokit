// cli75-smoke：第七十五轮结果再加工——sort/pick/uniq/sum/head 组合 + 管道路径不受影响
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PKG_ROOT = path.resolve(import.meta.dirname, '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- cli75`); } };
const home = mkdtempSync(path.join(tmpdir(), 'cli75-'));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home },
});
console.log(`cli75-smoke（临时目录 ${home}）`);
run(['plugin', 'bundled']);

// 平台差异：sysinfo top 的列——macOS {PID,进程,内存}；Linux {PID,COMMAND,内存占用,CPU占用}
const COL_MEM = process.platform === 'linux' ? '内存占用' : '内存';
const COL_PROC = '进程';
const MEM_RE = process.platform === 'linux' ? /%/ : / MB/;
const memOf = (l) => parseFloat(l.match(/([\d.]+) ?(MB|%)/)?.[1] ?? '0');
const numOf = (l) => parseFloat(l.match(/([\d.]+)/)?.[1] ?? '0');


// ① sort 数值降序（内存是 '1509.2 MB' 前缀数字串）
{
  const r = run(['run', 'sysinfo', 'top', '--limit', '5', '--sort', `-${COL_MEM}`]);
  const nums = r.stdout.split('\n').filter((l) => MEM_RE.test(l)).map(memOf);
  check('① sort 数值降序', nums.length >= 4 && nums.every((n, i) => i === 0 || nums[i - 1] >= n));
}
// ② sort 升序
{
  const r = run(['run', 'sysinfo', 'top', '--limit', '5', '--sort', COL_MEM]);
  const nums = r.stdout.split('\n').filter((l) => MEM_RE.test(l)).map(memOf);
  check('② sort 数值升序', nums.length >= 4 && nums.every((n, i) => i === 0 || nums[i - 1] <= n));
}
// ③ pick 两列
{
  const r = run(['run', 'sysinfo', 'top', '--limit', '3', '--pick', `PID,${COL_PROC}`]);
  check('③ pick 两列', r.stdout.includes('PID') && r.stdout.includes(COL_PROC) && !MEM_RE.test(r.stdout));
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
  const r = run(['run', 'sysinfo', 'top', '--limit', '10', '--uniq', COL_PROC]);
  const names = r.stdout.split('\n').filter((l) => MEM_RE.test(l)).map((l) => (l.match(/\s(\S+)\s+[\d.]+ ?(MB|%)/) ?? [])[1]);
  check('⑥ uniq 保序去重', new Set(names).size === names.length && names.length >= 3);
}
// ⑦ sum TOTAL 行
{
  const r = run(['run', 'sysinfo', 'top', '--limit', '5', '--sum', COL_MEM]);
  const total = r.stdout.split('\n').find((l) => l.includes('TOTAL'));
  check('⑦ sum TOTAL 行', !!total && /TOTAL/.test(total));
}
// ⑧ sum 非数字拒绝
{
  const r = run(['run', 'sysinfo', 'top', '--limit', '3', '--sum', COL_PROC]);
  check('⑧ sum 非数字拒绝', r.stderr.includes('含非数字值') && r.status === 1);
}
// ⑨ 组合：uniq + pick + sum
{
  const r = run(['run', 'sysinfo', 'top', '--limit', '8', '--uniq', COL_PROC, '--pick', '进程,内存', '--sum', COL_MEM]);
  check('⑨ 组合加工', r.stdout.includes('TOTAL') && !r.stdout.includes('PID'));
}
// ⑩ --json 不受加工影响（原始顺序）
{
  const r = run(['run', 'sysinfo', 'top', '--limit', '5', '--sort', `-${COL_MEM}`, '--json']);
  if (!r.stdout.trim()) { console.error('FAIL  ⑩ --json 空 stdout  <- ' + r.stderr.slice(0, 120)); fail++; }
  else {
  const d = JSON.parse(r.stdout);
  check('⑩ --json 原始数据', Array.isArray(d.data) && d.data.length === 5 && !('TOTAL' in d.data[0]));
  }
}
// ⑪ --quiet 不受加工影响
{
  const r = run(['run', 'sysinfo', 'top', '--limit', '5', '--sort', `-${COL_MEM}`, '--quiet']);
  if (!r.stdout.trim()) { console.error('FAIL  ⑪ --quiet 空 stdout  <- ' + r.stderr.slice(0, 120)); fail++; }
  else {
  const d = JSON.parse(r.stdout.trim());
  check('⑪ --quiet 原始单行 JSON', d.ok === true && Array.isArray(d.data));
  }
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
  const r = run(['run', 'sysinfo', 'top', '--limit', '3', '--sort', `-${COL_MEM}`]);
  check('⑬ 旗标剥离', r.status === 0 && !r.stderr.includes('未知参数'));
}
// ⑭ --sort= 等号形式
{
  const r = run(['run', 'sysinfo', 'top', '--limit', '3', '--sort=' + COL_MEM]);
  check('⑭ --sort= 形式', r.status === 0 && r.stdout.includes('PID'));
}

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
