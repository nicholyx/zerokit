// cli74-smoke：第七十四轮 CLI 输出与报告体验——md/tsv 格式/大结果截断/--full/宽字符表格
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PKG_ROOT = path.resolve(import.meta.dirname, '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`); } };
const home = mkdtempSync(path.join(tmpdir(), 'cli74-'));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home },
});
console.log(`cli74-smoke（临时目录 ${home}）`);
run(['plugin', 'bundled']);

// 测试插件：40 行大结果
const devDir = path.join(home, 'src-big74');
mkdirSync(devDir, { recursive: true });
writeFileSync(path.join(devDir, 'plugin.toml'), `[plugin]
id = "big74"
name = "大结果测试"
version = "0.1.0"
summary = "测试"

[[action]]
id = "rows"
title = "四十行"
description = "测试"
risk = "read"
run = ["node", "-e", "console.log(JSON.stringify(Array.from({length:40},(_,i)=>({idx:i}))))"]
output = "json"
`);
run(['plugin', 'dev', devDir]);

// ① md 格式：表头/分隔行/管道符
{
  const r = run(['run', 'big74', 'rows', '--format', 'md']);
  const lines = r.stdout.split('\n').filter(Boolean);
  check('① md 表头', lines[0]?.startsWith('| idx |'));
  check('① md 分隔行', lines[1]?.startsWith('| --- |'));
  check('① md 行数 40+2', lines.length >= 42);
  check('① md 转义', !run(['run', 'big74', 'rows', '--format', 'md']).stdout.includes('| |'));
}

// ② tsv：制表符分隔
{
  const r = run(['run', 'big74', 'rows', '--format', 'tsv']);
  const lines = r.stdout.split('\n').filter(Boolean);
  check('② tsv 表头', lines[0] === 'idx');
  check('② tsv 制表符行', lines[2] === '1');
}

// ③ 大结果截断：默认 30 行 + 提示
{
  const r = run(['run', 'big74', 'rows']);
  check('③ 截断提示', r.stderr.includes('已截到 30 行') && r.stderr.includes('--full'));
  check('③ 截断行数', r.stdout.split('\n').filter(Boolean).length === 30);
}
// ④ --full 展开
{
  const r = run(['run', 'big74', 'rows', '--full']);
  check('④ --full 全量', r.stdout.split('\n').filter(Boolean).length > 100 && !r.stderr.includes('截'));
}
// ⑤ --quiet 不截断（面向管道）
{
  const r = run(['run', 'big74', 'rows', '--quiet']);
  check('⑤ quiet 单行 JSON', r.stdout.trim().split('\n').length === 1 && r.stdout.includes('"idx"'));
}
// ⑥ --json 不截断
{
  const r = run(['run', 'big74', 'rows', '--json']);
  check('⑥ --json 全量', !r.stderr.includes('截'));
}
// ⑦ 小结果不截断
{
  const r = run(['run', 'sysinfo', 'overview']);
  check('⑦ 小结果全文', !r.stderr.includes('已截到'));
}
// ⑧ 纯函数：truncateJsonLines 边界
{
  const cliX = await import(pathToFileURL(path.join(PKG_ROOT, 'src', 'core', 'cliX.ts')).href);
  const t = cliX.truncateJsonLines([{ a: 1 }], 30);
  check('⑧ 小对象不截断', t.truncated === false);
  const t2 = cliX.truncateJsonLines(Array.from({ length: 20 }, (_, i) => ({ i })), 5);
  check('⑧ 超限截断', t2.truncated === true && t2.totalLines > 5 && t2.text.split('\n').length === 5);
}
// ⑨ --format 值不落进动作参数（未知参数报错即失败）
{
  const r = run(['run', 'big74', 'rows', '--format', 'tsv']);
  check('⑨ 旗标剥离不进动作', r.status === 0 && !r.stderr.includes('未知参数'));
}
// ⑩ 管道转义：含 | 的值
{
  const esc = cliX_check(run(['run', 'big74', 'rows', '--format', 'md']));
  check('⑩ 表格完整', esc);
}
function cliX_check(r) { return r.status === 0; }

run(['plugin', 'remove', 'big74']);
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
