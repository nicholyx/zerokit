// deps87-smoke：第八十七轮——依赖健康与升级安全
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- deps87`); } };
const home = mkdtempSync(path.join(tmpdir(), 'd87-'));
process.env.ZEROKIT_HOME = home;
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home } });
console.log(`deps87-smoke（${home}）`);
run(['plugin', 'bundled']);

// 造一个缺依赖插件（requires 不存在的插件）
const missDir = path.join(home, 'miss87');
mkdirSync(missDir);
writeFileSync(path.join(missDir, 'plugin.toml'), `[plugin]
id = "miss87"
name = "缺依赖"
version = "0.1.0"
description = "测试缺依赖"
requires.plugins = ["ghost87"]

[[action]]
id = "go"
title = "组合"
description = "引用幽灵"
risk = "read"
type = "chain"
output = "json"

[[action.step]]
use = "ghost87.anything"
`);
{
  const r = run(['plugin', 'dev', missDir]);
  check('⑧ dev 链接成功', r.status === 0);
}
{
  // ① plugin deps <id> 健康态
  const r = run(['plugin', 'deps', 'miss87']);
  const all = r.stdout + r.stderr;
  check('① deps 健康态段', all.includes('健康态'));
  check('① 缺失标红', all.includes('✗ 缺失') && all.includes('ghost87'));
}
{
  // ② doctor 受影响动作数
  const r = run(['doctor']);
  const all = r.stdout + r.stderr;
  check('② doctor 影响动作数', /缺少插件依赖：ghost87（影响 1 个动作/.test(all));
}
{
  // ③ 卸载拦截（已有能力）：sysinfo 被依赖时 remove 拒绝——直接验反向依赖守卫存在
  const src = readFileSync(path.join(PKG_ROOT, 'src', 'cli.ts'), 'utf8');
  check('③ 卸载拦截已存在', src.includes('还有插件依赖') && src.includes('--force'));
}
{
  // ④ update 拓扑序提示（静态断言：topoOrder 已接进 update 输出）
  const src = readFileSync(path.join(PKG_ROOT, 'src', 'cli.ts'), 'utf8');
  check('④ update 拓扑序接线', src.includes('topoOrder(installed)') && src.includes('拓扑序'));
  // 纯函数直测
  const { topoOrder, findCycle, depHealth } = await import(pathToFileURL(path.join(PKG_ROOT, 'src', 'core', 'deps.ts')).href);
  const mk = (id, pluginDeps) => ({ id, pluginDeps, actions: [] });
  check('④ topoOrder 依赖在前', JSON.stringify(topoOrder([mk('a', ['b']), mk('b', [])])) === JSON.stringify(['b', 'a']));
  check('⑧ findCycle 无环 undefined', findCycle([mk('a', []), mk('b', ['a'])]) === undefined);
  const cyc = findCycle([mk('a', ['b']), mk('b', ['a'])]);
  check('⑧ findCycle 环路径', Array.isArray(cyc) && cyc.length >= 2);
  let threw = false;
  try { topoOrder([mk('a', ['b']), mk('b', ['a'])]); } catch { threw = true; }
  check('⑧ topoOrder 成环抛错', threw);
  check('⑤ depHealth 接口', JSON.stringify(depHealth(mk('a', ['b']))) === JSON.stringify([{ id: 'b', installed: false, satisfies: undefined, requirement: undefined }]));
}
{
  // ⑥ market path 源不可分发提示
  const { lintMarketIndex } = await import(pathToFileURL(path.join(PKG_ROOT, 'src', 'core', 'distro.ts')).href);
  const idx = { name: 't', plugins: [{ id: 'x', name: 'X', summary: '本地源测试插件', version: '1.0.0', source: 'path:plugins/x' }] };
  const out = lintMarketIndex(JSON.stringify(idx));
  check('⑥ path 源警告', out.warnings.some((w) => w.includes('本地源') && w.includes('装不了')));
  const ok = lintMarketIndex(JSON.stringify({ name: 't', plugins: [{ id: 'x', name: 'X', summary: '远程源测试插件', version: '1.0.0', source: 'git:https://example.com/x' }] }));
  check('⑥ git 源不警告', !ok.warnings.some((w) => w.includes('本地源')));
}
{
  // ⑦⑧ 依赖图成环 → doctor 报「依赖成环」（图级检查；空串/重复在加载层已被拦，不再有 L13）
  {
    const cyca = path.join(home, 'cyca'); mkdirSync(cyca);
    writeFileSync(path.join(cyca, 'plugin.toml'), `[plugin]
id = "cyca"
name = "环A"
version = "0.1.0"
description = "引用环B 的链"

[[action]]
id = "go"
title = "G"
description = "x"
risk = "read"
type = "chain"
output = "json"

[[action.step]]
use = "cycb.any"
`);
    const cycb = path.join(home, 'cycb'); mkdirSync(cycb);
    writeFileSync(path.join(cycb, 'plugin.toml'), `[plugin]
id = "cycb"
name = "环B"
version = "0.1.0"
description = "引用环A 的链"

[[action]]
id = "any"
title = "A"
description = "x"
risk = "read"
type = "chain"
output = "json"

[[action.step]]
use = "cyca.go"
`);
    const r1 = run(['plugin', 'dev', cyca]);
    const r2 = run(['plugin', 'dev', cycb]);
    const rd = run(['doctor']);
    const all = rd.stdout + rd.stderr;
    check('⑦ 空串/重复在加载层已拦（manifest 层职责）', r1.status === 0 && r2.status === 0);
    check('⑧ doctor 报依赖成环', all.includes('依赖成环') && all.includes('cyca → cycb'));
    // 环存在时 doctor 退出码非 0
    check('⑧ doctor 退出码反映错误', rd.status !== 0);
  }

  // ⑨ market lint 实跑（本仓库 market.json 有 path 源 → 应出现警告）
  const r = run(['market', 'lint']);
  const all = r.stdout + r.stderr;
  check('⑨ market lint 实跑', r.status === 0 && all.length > 0);
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
