// pipe91-smoke：第九十一轮——管道与脚本协作
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- pipe91`); } };
const home = mkdtempSync(path.join(tmpdir(), 'p91-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (args, input) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, input, env });
console.log(`pipe91-smoke（${home}）`);
run(['plugin', 'bundled']);

// ① 补全三 shell + 动作名补全
for (const sh of ['bash', 'zsh', 'fish']) {
  const r = run(['completion', sh]);
  check(`① ${sh} 补全生成`, r.status === 0 && r.stdout.includes('zkit') && r.stdout.length > 100);
}
check('① 补全含新命令 which/env', run(['completion', 'bash']).stdout.includes('which') && run(['completion', 'bash']).stdout.includes('env'));
// ⑧ 补全脚本语法：临时文件再查（/dev/stdin 的 -n 语义各平台不一；CI runner 可能没装 zsh——缺 shell 只跳过不失败）
{
  const { writeFileSync } = await import('node:fs');
  writeFileSync(path.join(home, 'comp.bash'), run(['completion', 'bash']).stdout);
  writeFileSync(path.join(home, 'comp.zsh'), run(['completion', 'zsh']).stdout);
  const hasSh = (sh) => process.platform === 'win32' ? sh === 'bash' : spawnSync('which', [sh], { encoding: 'utf8' }).status === 0;
  if (hasSh('bash')) check('⑧ bash 语法', spawnSync('bash', ['-n', path.join(home, 'comp.bash')]).status === 0);
  else console.log('  - bash 不在本机，跳过语法检查');
  if (hasSh('zsh')) check('⑧ zsh 语法', spawnSync('zsh', ['-n', path.join(home, 'comp.zsh')]).status === 0);
  else console.log('  - zsh 不在本机，跳过语法检查');
}

// ② --stdin-json
{
  const r = run(['run', 'quick', 'b64', '--stdin-json'], '{"text":"hi"}');
  const all = r.stdout + r.stderr;
  check('② stdin-json 成功', r.status === 0 && all.includes('aGk='));
  const bad = run(['run', 'quick', 'b64', '--stdin-json'], '{oops');
  check('② 坏 JSON 拒绝 exit 2', bad.status === 2 && (bad.stdout + bad.stderr).includes('解析失败'));
  const arr = run(['run', 'quick', 'b64', '--stdin-json'], '[1,2]');
  check('② 数组拒绝', arr.status === 2);
  const empty = run(['run', 'quick', 'b64', '--stdin-json'], '');
  check('② 空 stdin 拒绝', empty.status === 2);
}

// ③ which
{
  const r = run(['which', 'quick', 'ts2date']);
  const all = r.stdout + r.stderr;
  check('③ which 解析不执行', r.status === 0 && all.includes('插件目录') && all.includes('风险      read') && all.includes('命令行') && all.includes('只解析不执行'));
  check('③ which 坏动作 exit 2', run(['which', 'quick', 'nope']).status === 2);
}

// ④ env
{
  const r = run(['env']);
  const all = r.stdout + r.stderr;
  check('④ env 一览', r.status === 0 && all.includes('ZEROKIT_HOME') && all.includes('已设置') && all.includes(process.platform));
}

// ⑤ 退出码语义
{
  check('⑤ 用法错误=2', run(['run', 'nope', 'x']).status === 2);
  check('⑤ 帮助含退出码段', run(['--help']).stdout.includes('退出码：0 成功 / 1 执行失败 / 2 用法错误'));
}

// ⑥ history --csv
{
  run(['run', 'quick', 'b64', '--text', 'x']);
  const r = run(['history', '--csv']);
  check('⑥ CSV 表头+行', r.status === 0 && r.stdout.startsWith('ts,plugin,action,exitCode,argv') && r.stdout.includes('"quick","b64"'));
}

// ⑦ 未知参数建议
{
  const r = run(['run', 'quick', 'b64', '--tetx', 'hi']);
  check('⑦ 打错参数名给建议', (r.stdout + r.stderr).includes('是不是想敲「text」'));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
