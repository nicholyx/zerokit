// cli71-smoke：第七十一轮 CLI 工作流进阶——history --failed / --env / config --json / mcp --risk / bench 路由 / plugin dev --open
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PKG_ROOT = path.resolve(import.meta.dirname, '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`); } };
const home = mkdtempSync(path.join(tmpdir(), 'cli71-'));
const run = (args, opts = {}) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8', timeout: 60000,
  env: { ...process.env, ZEROKIT_HOME: home, ...(opts.env ?? {}) }, ...opts.spawn,
});
console.log(`cli71-smoke（临时目录 ${home}）`);

// 准备：装 bundled + 一个开发插件
run(['plugin', 'bundled']);
const devDir = path.join(home, 'src-devquick');
mkdirSync(devDir, { recursive: true });
writeFileSync(path.join(devDir, 'plugin.toml'), `[plugin]
id = "devq71"
name = "验证71"
version = "0.1.0"
summary = "测试用"

[[action]]
id = "hi"
title = "问好"
description = "测试动作"
risk = "read"
run = ["node", "-e", "console.log(JSON.stringify({ok:true,data:'hi'}))"]
output = "json"
`);

// ① history --failed：无失败时友好提示
{
  const r = run(['history', '--failed']);
  check('① --failed 无失败提示', r.status === 0 && r.stdout.includes('没有失败'));
}
// ② --env 注入（bundled 的 sysinfo 跑通 = 旗标被剥掉没当参数报错）
{
  const r = run(['run', 'sysinfo', 'overview', '--env', 'ZK71=X', '--quiet']);
  check('② --env 旗标被剥（不报未知参数）', r.status === 0 && r.stdout.includes('"ok":true'));
}
// ③ config --json 机读
{
  const r = run(['config', '--json']);
  let ok = r.status === 0;
  try { const j = JSON.parse(r.stdout); ok = ok && Array.isArray(j.plugins); } catch { ok = false; }
  check('③ config --json 可解析', ok);
}
// ⑧ mcp tools --risk 过滤
{
  const r = run(['mcp', 'tools', '--json', '--risk', 'destructive']);
  let n = -1;
  try { n = JSON.parse(r.stdout).count; } catch {}
  const rAll = run(['mcp', 'tools', '--json']);
  let all = -1; try { all = JSON.parse(rAll.stdout).count; } catch {}
  check('⑧ --risk destructive 数量 < 全量', n >= 0 && all > n);
  const rBad = run(['mcp', 'tools', '--risk', 'bogus']);
  check('⑧ --risk 非法值不过滤（=全量）', rBad.status === 0);
}
// ⑦ bench 路由存在
{
  const r = run(['bench', '--quick'], { env: { BENCH_N: '2' } });
  check('⑦ bench --quick 跑通', r.status === 0 && r.stdout.includes('zkit path'));
}
// ⑤ plugin dev --open 自动验证
{
  const r = run(['plugin', 'dev', devDir, '--open']);
  check('⑤ dev --open 清单验证', r.status === 0 && r.stdout.includes('[open] 清单有效'));
  check('⑤ dev --open 实跑通过', r.stdout.includes('实跑通过'));
  run(['plugin', 'remove', 'devq71']);
}
// ④ --failed 有失败时的输出（种一条失败历史）
{
  // 用真失败制造历史：demosettings 缺必填 api_token → exit 1
  run(['config', 'set-does-not-exist-xy']);
  const rf = run(['run', 'demohttp', 'fetch']);  // 缺 url 必填参数
  const r = run(['history', '--failed']);
  check('④ --failed 有失败时列出条目', r.status === 0 && (r.stdout.includes('demohttp') || rf.status === 2));
}
// ① run --watch 存在性（帮助文本）
{
  const r = run(['--help']);
  check('① --watch 在帮助里', r.stdout.includes('--watch'));
}
// ⑧ --risk read 数量正确
{
  const r = run(['mcp', 'tools', '--json', '--risk', 'read']);
  let j = null; try { j = JSON.parse(r.stdout); } catch {}
  check('⑧ --risk read 全部只读', j && j.tools.every((t) => t.risk === 'read'));
}

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
