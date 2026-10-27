// 第三十五轮：错误预防与自愈——suggest/diagnose/foreignPath/orphan 的冒烟。
// 全部临时 ZEROKIT_HOME 自包含。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zerokit-selfheal-'));
let passed = 0, failed = 0;
const fail = (m) => { failed++; console.log('FAIL  ' + m); process.exitCode = 1; };
const pass = (m) => { passed++; console.log('PASS  ' + m); };
const run = (args) => spawnSync(process.execPath, ['src/cli.ts', ...args], {
  cwd: ROOT, encoding: 'utf8', timeout: 60000, windowsHide: true,
  env: { ...process.env, ZEROKIT_HOME: TMP },
});
run(['plugin', 'bundled']);

// ---- 纯函数直测
{
  const m = await import(pathToFileURL(path.join(ROOT, 'src/core/suggest.ts')).href);
  // ①编辑距离
  if (m.editDistance('plugin', 'plugin') === 0 && m.editDistance('plugn', 'plugin') === 1
      && m.editDistance('abc', 'xyz') === 3) pass('编辑距离基准');
  else fail('editDistance 基准错');
  // ①建议：前缀优先、差太远不给
  if (m.suggest('plugn', ['plugin', 'market', 'run'])[0]?.candidate === 'plugin'
      && m.suggest('zzzzzzzz', ['plugin']).length === 0
      && m.suggest('pl', ['plugin', 'ps'])[0]?.candidate === 'plugin') pass('建议排序与前缀加权、宁缺毋滥');
  else fail('suggest 行为不对');
  if (m.suggestLine('dctor', ['doctor'])?.includes('doctor')) pass('suggestLine 出人话');
  else fail('suggestLine');
  // ⑥诊断规则
  if (m.diagnose('sh: permission denied')?.kind === 'permission'
      && m.diagnose('Error: ENOENT no such file')?.kind === 'not-found'
      && m.diagnose('ETIMEDOUT after 5000ms')?.kind === 'timeout'
      && m.diagnose('随便什么') === null) pass('diagnose 五类识别 + 认不出返回 null');
  else fail('diagnose 不对');
  if ((m.diagnose('EACCES')?.nextSteps.length ?? 0) >= 2) pass('诊断带下一步');
  else fail('诊断没下一步');
  // ⑨异平台路径
  if (m.foreignPath(['--file', 'C:\\Users\\a.txt'], 'darwin') === 'C:\\Users\\a.txt'
      && m.foreignPath(['--file', '/usr/local/bin/x'], 'win32') === '/usr/local/bin/x'
      && m.foreignPath(['--file', '/usr/local/bin/x'], 'darwin') === null
      && m.foreignPath(['C:\\a'], 'win32') === null) pass('异平台路径四向检测');
  else fail('foreignPath 判定错');
  // ⑧孤儿检测
  fs.mkdirSync(path.join(TMP, 'plugins', 'halfplug'), { recursive: true });
  fs.writeFileSync(path.join(TMP, 'plugins', 'halfplug', 'x.txt'), 'x');
  fs.mkdirSync(path.join(TMP, 'plugins', 'quick.bak'), { recursive: true }); // .bak 应被忽略
  const orphans = m.findOrphanPlugins(path.join(TMP, 'plugins'));
  if (orphans.length === 1 && orphans[0].id === 'halfplug' && orphans[0].hasFiles[0] === 'x.txt') {
    pass('半安装插件检测（.bak 备份不误报）');
  } else fail('orphan 检测不对: ' + JSON.stringify(orphans));
}

// ---- CLI 层
{
  // ①命令建议
  const r = run(['plugn', 'list']);
  if (r.status === 2 && r.stderr.includes('是不是想敲「plugin」')) pass('①打错命令给建议（plugn→plugin）');
  else fail('①命令建议没出');
  const r2 = run(['dctor']);
  if (r2.stderr.includes('「doctor」')) pass('①dctor→doctor');
  else fail('①dctor 建议');
  // ②动作建议
  const r3 = run(['run', 'quick', 'ts2dat']);
  if (r3.status === 1 && r3.stderr.includes('「ts2date」')) pass('②打错动作给建议（ts2dat→ts2date）');
  else fail('②动作建议');
  // ③参数缺失附参数表
  const r4 = run(['run', 'quick', 'b64']);
  if (r4.status === 2 && r4.stderr.includes('--text') && r4.stderr.includes('必填')
      && r4.stderr.includes('--help')) pass('③缺参数附参数表+必填标注+帮助指引');
  else fail('③参数表没出');
  // ⑥失败自诊断
  const fd = path.join(TMP, 'plugins', 'faildemo');
  fs.mkdirSync(fd, { recursive: true });
  fs.writeFileSync(path.join(fd, 'plugin.toml'), `[plugin]\nid = "faildemo"\nname = "失败演示"\nversion = "1.0.0"\nsummary = "演示失败自诊断"\n\n[[action]]\nid = "boom"\ntitle = "必然失败"\ndescription = "跑不存在的文件"\nrisk = "read"\nrun = ["./no-such-helper.sh"]\n`);
  const r5 = run(['run', 'faildemo', 'boom', '--yes']);
  if (r5.status === 1 && r5.stderr.includes('⟐') && r5.stderr.includes('下一步')) {
    pass('⑥失败输出带「下一步」自诊断');
  } else fail('⑥诊断没出：' + r5.stderr.slice(0, 120));
  // ⑧+⑦ doctor 检出 + --fix 清理
  const r6 = run(['doctor']);
  if (r6.stdout.includes('halfplug') && r6.stdout.includes('装了一半')) pass('⑧doctor 报半安装插件');
  else fail('⑧doctor 没报 orphan');
  const r7 = run(['doctor', '--fix']);
  if (r7.stdout.includes('已清理 halfplug') && !fs.existsSync(path.join(TMP, 'plugins', 'halfplug'))
      && r7.stdout.includes('数据目录结构已确保齐全')) pass('⑦--fix 清理孤儿 + 确保目录');
  else fail('⑦--fix 不对');
  // ⑨异平台路径警告
  const r8 = run(['run', 'quick', 'b64', '--text', 'C:\\Users\\a.txt', '--yes']);
  if (r8.stderr.includes('另一个平台的路径')) pass('⑨异平台路径提前点破');
  else fail('⑨foreignPath 警告没出');
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n' + '='.repeat(60));
console.log(`通过 ${passed} / ${passed + failed}`);
if (failed > 0) process.exit(1);
