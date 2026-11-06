// completion159-smoke：第一百五十九轮——shell 补全
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- completion159 ${extra}`); } };
console.log('completion159-smoke');

const home = mkdtempSync(path.join(tmpdir(), 'c159-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env });
run(['plugin', 'bundled']);
run(['bookmark', 'add', 'daily', 'run', 'sysinfo', 'overview']);

// zkit 包装成 PATH 可执行（书签候选走 $(zkit ...) 运行时替换，需要真命令）
const bin = path.join(home, 'bin'); mkdirSync(bin, { recursive: true });
const zkitSh = path.join(bin, 'zkit');
writeFileSync(zkitSh, `#!/bin/bash\nZEROKIT_HOME=${home} exec ${process.execPath} ${CLI} "$@"\n`);
chmodSync(zkitSh, 0o755);
const bashEnv = { ...env, PATH: `${bin}:${process.env.PATH}` };
const bash = (script) => spawnSync('/bin/bash', ['-c', script], { encoding: 'utf8', timeout: 30000, env: bashEnv });

// ① bash 结构与安装指引
{
  const out = run(['completion', 'bash']).stdout;
  check('① complete -F 接线', out.includes('complete -F _zkit zkit'));
  check('① eval 指引一行', out.includes('eval "$(zkit completion bash)"'));
  check('① 动作词表含点分动作', out.includes('sysinfo.overview'));
  check('① 命令表全量', out.includes('history') && out.includes('bookmark') && out.includes('completion'));
}
// ② zsh 结构
{
  const out = run(['completion', 'zsh']).stdout;
  check('② #compdef 头', out.startsWith('#compdef zkit'));
  check('② 安装指引', out.includes('~/.zfunc/_zkit'));
  check('② 动作词表（构建时展开）', out.includes('sysinfo.overview'));
  check('② 无 python3 运行时依赖', !out.includes('python3'));
  // CI 的 ubuntu runner 不装 zsh：没有 zsh 时跳过语法检查（结构断言仍覆盖）
  const syn = spawnSync('zsh', ['-n'], { input: out, encoding: 'utf8' });
  const hasZsh = !(syn.error && (syn.error.code === 'ENOENT'));
  check('② zsh -n 语法过（无 zsh 环境跳过）', !hasZsh || syn.status === 0, String(syn.stderr || '').slice(0, 80));
}
// ③ fish 结构
{
  const out = run(['completion', 'fish']).stdout;
  check('③ complete -c zkit', out.includes('complete -c zkit'));
  check('③ 安装指引', out.includes('~/.config/fish/completions/zkit.fish'));
  check('③ 动作词表', out.includes('sysinfo.overview'));
  check('③ 书签动态候选', out.includes('zkit bookmark names'));
}
// ④ 实跑：bash run <TAB> 动作候选
{
  const r = bash(`eval "$(zkit completion bash)"; COMP_WORDS=(zkit run sysin); COMP_CWORD=2; _zkit; echo "\${COMPREPLY[*]}"`);
  check('④ run 候选含点分', (r.stdout || '').includes('sysinfo.overview'), r.stdout + r.stderr);
}
// ⑤ 实跑：书签候选（bookmark run <TAB>）
{
  const r = bash(`eval "$(zkit completion bash)"; COMP_WORDS=(zkit bookmark run da); COMP_CWORD=3; _zkit; echo "\${COMPREPLY[*]}"`);
  check('⑤ 书签候选命中', (r.stdout || '').trim() === 'daily', r.stdout + r.stderr);
}
// ⑥ bookmark 子命令候选
{
  const r = bash(`eval "$(zkit completion bash)"; COMP_WORDS=(zkit bookmark r); COMP_CWORD=2; _zkit; echo "\${COMPREPLY[*]}"`);
  check('⑥ bookmark 子命令', (r.stdout || '').includes('run'));
}
// ⑦ --keep 枚举候选
{
  const r = bash(`eval "$(zkit completion bash)"; COMP_WORDS=(zkit logs --keep); COMP_CWORD=2; _zkit; echo "\${COMPREPLY[*]}"`);
  check('⑦ --keep 枚举', (r.stdout || '').includes('--keep30d') || (r.stdout || '').includes('30d'));
}
// ⑧ 旗标候选
{
  const r = bash(`eval "$(zkit completion bash)"; COMP_WORDS=(zkit --js); COMP_CWORD=1; _zkit; echo "\${COMPREPLY[*]}"`);
  check('⑧ --json 旗标', (r.stdout || '').includes('--json'));
}
// ⑨ bookmark names 机读端点
{
  const r = run(['bookmark', 'names']);
  check('⑨ names 一行一个', r.stdout.trim().split('\n').includes('daily') && r.status === 0);
}
// ⑩ 负例：不认识的 shell
{
  const r = run(['completion', 'tcsh']);
  check('⑩ 未知 shell 用法提示 exit 2', r.status === 2 && (r.stderr || '').includes('用法'));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
