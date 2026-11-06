// journey156-smoke：第一百五十六轮——文档旅程一致性（点分简写 + 文档命令实跑）
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- journey156 ${extra}`); } };
console.log('journey156-smoke');

const home = mkdtempSync(path.join(tmpdir(), 'j156-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env });
run(['plugin', 'bundled']);

// ① 点分简写：无参数
{
  const r = run(['run', 'sysinfo.overview']);
  check('① 点分无参', r.status === 0 && r.stdout.includes('主机名'), r.stdout.slice(0, 100) + r.stderr.slice(0, 100));
}
// ② 点分 + 旗标与值
{
  const r = run(['run', 'quick.b64', '--text', 'hi', '--quiet']);
  check('② 点分带参', r.status === 0 && r.stdout.includes('aGk='), r.stdout.slice(0, 100));
}
// ③ 三段点不猜（报插件不存在而非崩）
{
  const r = run(['run', 'a.b.c']);
  check('③ 三段点不猜', r.status === 2 || (r.stderr || '').includes('没有找到插件'), r.stderr.slice(0, 80));
}
// ④ 老形态不回归
{
  const r = run(['run', 'quick', 'b64', '--text', 'hi']);
  check('④ 两段形态照旧', r.status === 0 && r.stdout.includes('aGk='));
}
// ⑤ 未知点分报插件名（错误信息更准）
{
  const r = run(['run', 'nothere.x']);
  check('⑤ 报错点名插件', (r.stderr || '').includes('nothere') && !(r.stderr || '').includes('nothere.x'));
}
// ⑥ README 旅程（fresh 目录视角，--yes 全自动）
{
  const h2 = mkdtempSync(path.join(tmpdir(), 'j156b-'));
  const env2 = { ...process.env, ZEROKIT_HOME: h2 };
  const run2 = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env: env2 });
  const m = run2(['market', 'add', '.']);
  check('⑥ market add', m.status === 0);
  const p = run2(['plugin', 'install', 'sysinfo', '--yes']);
  check('⑥ install --yes', p.status === 0 && !p.stdout.includes('确认'), p.stdout.slice(-120));
  const rr = run2(['run', 'sysinfo.overview']);
  check('⑥ 装完即跑', rr.status === 0 && rr.stdout.includes('主机名'));
  rmSync(h2, { recursive: true, force: true });
}
// ⑦ man 列的命令都存在
{
  const man = run(['man']);
  const cmds = [...man.stdout.matchAll(/^  zkit ([a-z][a-z0-9-]*)/gm)].map((m) => m[1]);
  check('⑦ man 命令非空', cmds.length >= 15, String(cmds.length));
  const miss = [];
  for (const c of ['run', 'list', 'show', 'doctor', 'history', 'plugin', 'market', 'ui', 'mcp', 'logs', 'ps', 'stats']) {
    if (!cmds.includes(c)) miss.push(c);
  }
  check('⑦ 核心命令全列', miss.length === 0, miss.join(','));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
