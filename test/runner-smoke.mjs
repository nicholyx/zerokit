// 执行路径的回归测试。
//
// 重点是两条：worker 与 spawn 必须产出**完全一样**的结果（否则"快"就没有意义），
// 以及 worker 路径不适用时要能**干净地退回** spawn，而不是失败。
//
// 全部在临时目录里跑，不碰正式环境、不联网。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const PKG_ROOT = path.resolve(import.meta.dirname, '..');
process.env['ZEROKIT_HOME'] = path.join(os.tmpdir(), 'zerokit-runner-test');

const { loadPlugin } = await import('../src/core/manifest.ts');
const { runAction } = await import('../src/core/runner.ts');
const { registerProcess, listProcesses, killProcess } = await import('../src/core/runtime.ts');

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   <- ' + String(detail).slice(0, 300)}`);
};

const TMP = path.join(os.tmpdir(), 'zerokit-runner-test', 'plugins');
fs.rmSync(path.dirname(TMP), { recursive: true, force: true });

const SCRIPT = `
const args = process.argv.slice(2);
process.stdout.write(JSON.stringify({ args, cwd: process.cwd().replace(/\\\\\\\\/g, '/') }) + '\\n');
if (args[0] === 'fail') { process.stderr.write('故意失败\\n'); process.exit(3); }
if (args[0] === 'json') { process.stdout.write('{"a":1}\\n'); }
`;

function makePlugin(id, runtime, extra = '') {
  const dir = path.join(TMP, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'runner.mjs'), SCRIPT);
  fs.writeFileSync(path.join(dir, 'plugin.toml'), `
[plugin]
id      = "${id}"
name    = "${id}"
summary = "执行路径测试"
runtime = "${runtime}"

[[action]]
id          = "echo"
title       = "回显参数"
description = "把参数回显出来"
run         = ["{node}", "runner.mjs", "{word}"]
output      = "json"
risk        = "read"

  [[action.param]]
  name        = "word"
  type        = "string"
  default     = "hi"
  description = "要说的话"

[[action]]
id          = "fail"
title       = "故意失败"
description = "用来看退出码与 stderr 有没有传出来"
run         = ["{node}", "runner.mjs", "fail"]
output      = "text"
risk        = "read"

[[action]]
id          = "notnode"
title       = "非 node 命令"
description = "worker 路径不适用，应当干净地退回 spawn"
run         = ["{git}", "--version"]
output      = "text"
risk        = "read"
${extra}
`);
  const loaded = loadPlugin(dir);
  if (!loaded.plugin) throw new Error(`插件 ${id} 没通过校验：${loaded.errors.join('; ')}`);
  return loaded.plugin;
}

const spawnPlugin = makePlugin('spawnly', 'spawn');
const workerPlugin = makePlugin('workery', 'worker');

// ---- 1. 两条路径都能跑，且结果一致 ----
{
  const a = await runAction(spawnPlugin, spawnPlugin.actions[0], { caller: 'cli', values: { word: 'hello' } });
  const b = await runAction(workerPlugin, workerPlugin.actions[0], { caller: 'cli', values: { word: 'hello' } });
  check('spawn 路径执行成功', a.ok && a.stdout.trim().startsWith('{'), a.stdout + a.error);
  check('worker 路径执行成功', b.ok && b.stdout.trim().startsWith('{'), b.stdout + b.error);

  const ja = JSON.parse(a.stdout.trim());
  const jb = JSON.parse(b.stdout.trim());
  check('两条路径拿到的参数一致', JSON.stringify(ja.args) === JSON.stringify(jb.args),
    `${JSON.stringify(ja.args)} vs ${JSON.stringify(jb.args)}`);
  check('参数确实传进去了', JSON.stringify(jb.args) === JSON.stringify(['hello']), JSON.stringify(jb.args));
}

// ---- 2. worker 更快（这是它存在的理由）----
{
  const time = async (plugin, n = 4) => {
    const samples = [];
    for (let i = 0; i < n; i++) {
      const t = performance.now();
      await runAction(plugin, plugin.actions[0], { caller: 'cli', values: { word: 'x' } });
      samples.push(performance.now() - t);
    }
    samples.shift();               // 丢掉首次（冷启动）
    return samples.reduce((a, b) => a + b, 0) / samples.length;
  };
  const s = await time(spawnPlugin);
  const w = await time(workerPlugin);
  check('worker 比 spawn 快（实测应快 2 倍以上）', w < s / 2,
    `spawn ${s.toFixed(0)}ms vs worker ${w.toFixed(0)}ms`);
  console.log(`      spawn ${s.toFixed(0)}ms / worker ${w.toFixed(0)}ms （${(s / w).toFixed(1)}x）`);
}

// ---- 3. 失败信息要能传出来 ----
{
  const a = await runAction(spawnPlugin, spawnPlugin.actions[1], { caller: 'cli', values: {} });
  const b = await runAction(workerPlugin, workerPlugin.actions[1], { caller: 'cli', values: {} });
  check('spawn 路径传出退出码与 stderr',
    a.ok === false && a.exitCode === 3 && /故意失败/.test(a.stderr), `${a.exitCode} ${a.stderr}`);
  check('worker 路径传出退出码与 stderr',
    b.ok === false && b.exitCode === 3 && /故意失败/.test(b.stderr), `${b.exitCode} ${b.stderr}`);
}

// ---- 4. 形态不匹配时干净退回 spawn，而不是报错 ----
{
  const r = await runAction(workerPlugin, workerPlugin.actions[2], { caller: 'cli', values: {} });
  check('worker 插件跑非 node 命令时自动退回 spawn 且成功',
    r.ok && /git version/.test(r.stdout), r.stdout + r.error);
}

// ---- 5. 后台动作被托管，可结束 ----
{
  const dir = path.join(TMP, 'bgly');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'loop.mjs'), 'setInterval(()=>console.log("tick"), 200);\n');
  fs.writeFileSync(path.join(dir, 'plugin.toml'), `
[plugin]
id      = "bgly"
name    = "后台测试"
summary = "后台动作测试"

[[action]]
id          = "run"
title       = "常驻"
description = "一直跑"
run         = ["{node}", "loop.mjs"]
output      = "text"
risk        = "mutate"
background  = true
`);
  const plugin = loadPlugin(dir).plugin;
  const r = await runAction(plugin, plugin.actions[0], { caller: 'cli', values: {} });
  check('后台动作立即返回并带上托管的 id 与 PID',
    r.ok && r.background?.id && r.background.pid > 0, JSON.stringify(r.background));

  const listed = listProcesses().find((p) => p.id === r.background.id);
  check('它出现在托管列表里', Boolean(listed?.running), JSON.stringify(listed));
  const killed = killProcess(r.background.id);
  check('能结束它', killed.ok, killed.message);
  await new Promise((res) => setTimeout(res, 900));
  check('结束后不再出现在托管列表里',
    !listProcesses().some((p) => p.id === r.background.id));
}

// ---- 6. 常驻宿主（只对非一次性调用启用）----
{
  const { hostCount, shutdownHosts } = await import('../src/core/host.ts');
  const { resolveTool } = await import('../src/core/resolve.ts');
  const python = resolveTool('python');

  if (!python) {
    console.log('SKIP  常驻宿主的用例（本机没有 python）');
  } else {
    const dir = path.join(TMP, 'hostly');
    fs.mkdirSync(dir, { recursive: true });
    // 故意做一个"import 很贵"的脚本：常驻宿主的意义就是这笔钱只付一次
    fs.writeFileSync(path.join(dir, 'slow_import.py'), 'import ssl, ctypes, subprocess, asyncio\n');
    fs.writeFileSync(path.join(dir, 'script.py'), `
import json, sys
import slow_import                      # 冷启动时这笔 import 很贵
print(json.dumps({"argv": sys.argv[1:], "ok": True}))
`);
    fs.writeFileSync(path.join(dir, 'plugin.toml'), `
[plugin]
id      = "hostly"
name    = "常驻测试"
summary = "常驻宿主测试"
runtime = "host"

[[action]]
id          = "echo"
title       = "回显"
description = "把参数回显出来"
run         = ["{python}", "script.py", "{word}"]
output      = "json"
risk        = "read"

  [[action.param]]
  name        = "word"
  type        = "string"
  default     = "hi"
  description = "要说的话"
`);
    const plugin = loadPlugin(dir).plugin;
    const action = plugin.actions[0];

    // 一次性调用（cli）**不该**用常驻宿主：宿主冷启动比直接起进程还慢
    const cliOnce = await runAction(plugin, action, { caller: 'cli', values: { word: 'a' } });
    check('一次性调用(cli)仍能正确执行', cliOnce.ok && cliOnce.stdout.includes('"a"'),
      cliOnce.stdout + cliOnce.error);
    check('一次性调用(cli)不启用常驻宿主（避免冷启动反而更慢）',
      hostCount() === 0, `hostCount=${hostCount()}`);

    // 长生命周期调用（ui）走常驻宿主
    const first = await runAction(plugin, action, { caller: 'ui', values: { word: 'b' } });
    check('长生命周期调用(ui)走常驻宿主', hostCount() > 0, `hostCount=${hostCount()}`);
    check('常驻路径输出正确', first.ok && first.stdout.includes('"b"'), first.stdout + first.error);

    const timeCall = async () => {
      const t = performance.now();
      const r = await runAction(plugin, action, { caller: 'ui', values: { word: 'c' } });
      return [performance.now() - t, r];
    };
    const [ms1, r1] = await timeCall();
    const [ms2, r2] = await timeCall();
    check('复用宿主后结果依然正确', r1.ok && r2.ok && r1.stdout.includes('"c"'), r1.stdout + r1.error);

    // 三条路径的输出必须一致——否则"快"就没有意义
    const spawned = await runAction(plugin, action, { caller: 'cli', values: { word: 'same' } });
    const hosted = await runAction(plugin, action, { caller: 'ui', values: { word: 'same' } });
    const parse = (s) => JSON.parse(s.trim());
    check('常驻与子进程两条路径结果一致',
      JSON.stringify(parse(spawned.stdout)) === JSON.stringify(parse(hosted.stdout)),
      `${spawned.stdout.trim()} vs ${hosted.stdout.trim()}`);

    console.log(`      常驻复用耗时 ${ms1.toFixed(0)}ms / ${ms2.toFixed(0)}ms（对比子进程约 ${spawned.ms ?? '?'}ms）`);

    // 常驻宿主必须在「运行中」里看得见——用户有权知道有个进程一直在
    const listed = listProcesses().find((p) => p.actionId === '__host__');
    check('常驻宿主出现在「运行中」里（可见、可结束）', Boolean(listed?.running),
      JSON.stringify(listProcesses().map((p) => p.actionId)));

    // 测试进程不能被宿主一直撑着不退
    shutdownHosts();
    check('收工后宿主已关闭', hostCount() === 0, `hostCount=${hostCount()}`);
  }
}

console.log('\n' + '='.repeat(60));
const failed = results.filter(([, ok]) => !ok).map(([n]) => n);
console.log(`通过 ${results.length - failed.length} / ${results.length}`);
if (failed.length) console.log('失败：' + failed.join(', '));
process.exit(failed.length ? 1 : 0);