// batch114-smoke：第一百一十四轮——批量与队列进阶（纯函数 + CLI 端到端 + 双解析器交叉一致）
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- batch114`); } };
const home = mkdtempSync(path.join(tmpdir(), 'b114-'));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 90000, cwd: PKG_ROOT, env: { ...process.env, ZEROKIT_HOME: home } });
console.log(`batch114-smoke（${home}）`);

const { parseBatchList, batchToLines, shouldPauseBatch } = await import('../web/extras.js');

// ① 行格式基础：key=value
{
  const r = parseBatchList('sysinfo overview\nquick b64 text=hello');
  check('① 行格式 key=value', r.ok && r.items.length === 2 && r.items[1].values.text === 'hello');
}
// ② 旗标形态 --key value
{
  const r = parseBatchList('quick b64 --text hello');
  check('② 旗标形态 --key value', r.ok && r.items[0].values.text === 'hello');
  const r2 = parseBatchList('quick ts2date --ts 1760000000');
  check('② 旗标数字值', r2.ok && r2.items[0].values.ts === '1760000000');
}
// ③ 引号含空格
{
  const r = parseBatchList('quick b64 --text "hello world x"');
  check('③ 引号值保空格', r.ok && r.items[0].values.text === 'hello world x');
}
// ④ 注释与空行
{
  const r = parseBatchList('# 注释\n\nsysinfo overview\n   \n# 又一条');
  check('④ 注释空行跳过', r.ok && r.items.length === 1);
}
// ⑤ 逐行报错带行号
{
  const r = parseBatchList('sysinfo overview\nbadline');
  check('⑤ 报错带行号', !r.ok && r.error.includes('第 2 行'));
  const r2 = parseBatchList('quick b64 --text');
  check('⑤ 悬空旗标报错（提示两种写法）', !r2.ok && r2.error.includes('--key value'));
}
// ⑥ JSON 老格式仍认
{
  const r = parseBatchList(JSON.stringify([{ plugin: 'sysinfo', action: 'overview', values: {} }]));
  check('⑥ JSON 格式兼容', r.ok && r.items[0].plugin === 'sysinfo');
}
// ⑦ batchToLines 往返
{
  const items = [{ plugin: 'quick', action: 'b64', values: { text: 'hello world' } }];
  const lines = batchToLines(items);
  const back = parseBatchList(lines);
  check('⑦ 导出→回导往返一致', back.ok && back.items[0].values.text === 'hello world' && lines.includes('"hello world"'));
}
// ⑧ shouldPauseBatch
check('⑧ 首窗口不暂停', shouldPauseBatch(false, 0) === false);
check('⑧ 暂停时后续窗口停', shouldPauseBatch(true, 2) === true);
check('⑧ 未暂停后续窗口跑', shouldPauseBatch(false, 2) === false);

// ⑨ CLI --batch 端到端（行格式混合两种写法）
{
  run(['plugin', 'bundled']);
  const f = path.join(home, 'list.txt');
  writeFileSync(f, '# 混合格式\nsysinfo overview\nquick b64 --text hello\nquick ts2date ts=1760000000\n');
  const r = run(['run', '--batch', f]);
  const all = r.stdout + r.stderr;
  check('⑨ 三项全过', /成功 3 \/ 失败 0/.test(all));
  check('⑨ 逐项 N/M 行', all.includes('[2/3]') && all.includes('[3/3]'));
  check('⑨ 退出码 0', r.status === 0);
}
// ⑩ 失败项退出码 1 + 用户取消不中断（用一个不存在的插件行）
{
  const f = path.join(home, 'bad.txt');
  writeFileSync(f, 'sysinfo overview\nnosuch plug x=1\nquick b64 --text hi\n');
  const r = run(['run', '--batch', f]);
  const all = r.stdout + r.stderr;
  check('⑩ 坏行不中断（好项仍跑）', all.includes('quick.b64') || all.includes('[3/3]'));
  check('⑩ 有失败退出码 1', r.status === 1);
}
// ⑪ 文件不存在报错友好
{
  const r = run(['run', '--batch', path.join(home, 'nope.txt')]);
  check('⑪ 缺文件友好报错', (r.stdout + r.stderr).includes('读不了') || (r.stdout + r.stderr).includes('不存在') || r.status === 2);
}
// ⑫ 双解析器交叉一致：CLI 侧解析结果与 extras 同（用 --batch 的报错行为对拍——同一份坏清单两边同样的行号报错）
{
  const f = path.join(home, 'cross.txt');
  writeFileSync(f, 'sysinfo overview\nbadline\n');
  const r = run(['run', '--batch', f]);
  const cliErr = (r.stdout + r.stderr);
  const ex = parseBatchList('sysinfo overview\nbadline\n');
  check('⑫ 双解析器同一行号报错', cliErr.includes('第 2 行') && !ex.ok && ex.error.includes('第 2 行'));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
