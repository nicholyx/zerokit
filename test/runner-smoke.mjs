// 执行路径的回归测试。
//
// 重点是两条：worker 与 spawn 必须产出**完全一样**的结果（否则"快"就没有意义），
// 以及 worker 路径不适用时要能**干净地退回** spawn，而不是失败。
//
// 全部在临时目录里跑，不碰正式环境、不联网。
import { spawn, spawnSync } from 'node:child_process';
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
  // 「快 2 倍以上」曾经是硬断言，但倍数受机器影响太大：CI 的 windows
  // runner 上实测只有 1.3~1.6x（进程冷启动在 runner 上本来就慢）。
  // 常驻 worker 的不变量是「不劣化且有收益」，倍数打印出来供人眼判断。
  check('worker 不劣于 spawn（常驻解释器有收益）', w < s,
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

// ---- 5b. 后台动作"当场就死了"必须被看出来 ----
//
// 后台动作的语义是"不等它结束"，所以启动失败原本是看不见的：返回值永远 ok=true，
// PID 可能是 -1，失败只留在 stderr 里。spawn 对命令不存在（ENOENT）不抛错而是发
// 'error' 事件；插件自己拒绝启动则表现为"立刻非 0 退出"。两种都该是失败。
{
  const dir = path.join(TMP, 'bgfail');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'refuse.mjs'),
    'console.error("已经有监听在跑了，拒绝重复启动\\n"); process.exit(1);\n');
  fs.writeFileSync(path.join(dir, 'detach.mjs'),
    'console.log("已把守护进程 detach 出去\\n");\n');   // 正常退出 0：合法写法
  fs.writeFileSync(path.join(dir, 'plugin.toml'), `
[plugin]
id      = "bgfail"
name    = "后台失败测试"
summary = "看后台动作启动失败能不能从返回值看出来"

[[action]]
id          = "refuse"
title       = "启动即拒绝"
description = "模拟「已经有一个在跑了」这种拒绝启动"
run         = ["{node}", "refuse.mjs"]
output      = "text"
risk        = "mutate"
background  = true

[[action]]
id          = "missing"
title       = "命令不存在"
description = "用来验证 ENOENT 不会被当成启动成功"
run         = ["{plugin_dir}/definitely-not-here-zkit.exe", "--go"]
output      = "text"
risk        = "mutate"
background  = true

[[action]]
id          = "detach"
title       = "正常退出"
description = "拉起守护进程后自己正常退出，这是合法写法，不该被判失败"
run         = ["{node}", "detach.mjs"]
output      = "text"
risk        = "mutate"
background  = true
`);
  const plugin = loadPlugin(dir).plugin;

  const refuse = await runAction(plugin, plugin.actions[0], { caller: 'cli', values: {} });
  check('后台动作"启动即拒绝"返回失败（而不是"已启动"）',
    refuse.ok === false && refuse.exitCode === 1, `ok=${refuse.ok} exit=${refuse.exitCode}`);
  check('它把插件自己写的失败原因带出来了（不是只有一个退出码）',
    /拒绝重复启动/.test(refuse.stderr ?? ''), `stderr=${refuse.stderr}`);

  const missing = await runAction(plugin, plugin.actions[1], { caller: 'cli', values: {} });
  check('后台动作命令不存在（ENOENT）返回失败',
    missing.ok === false && /启动失败/.test(missing.error ?? ''),
    `ok=${missing.ok} pid=${missing.background?.pid} error=${missing.error}`);

  const detached = await runAction(plugin, plugin.actions[2], { caller: 'cli', values: {} });
  check('后台动作"拉起守护进程后正常退出"仍算成功（不能误杀这种写法）',
    detached.ok === true, `ok=${detached.ok} error=${detached.error}`);
  check('但它不会给一个已经不存在的 PID 让人去 kill',
    detached.background === undefined, JSON.stringify(detached.background));

  check('三种情况都没有留下托管记录',
    !listProcesses(true).some((p) => p.pluginId === 'bgfail'),
    JSON.stringify(listProcesses(true).map((p) => p.pluginId)));
}

// ---- 5c. 服务停止命令不能被当后台任务拉起来 ----
//
// services.ts 拼停止命令时拿 plugin.actions[0] 当模板。如果清单里第一个动作是
// 后台动作，模板会把 background = true 一起抄过去，停止命令就被当后台任务拉起——
// 立刻返回、登记进「运行中」、其实什么都没停，而且看起来还是"成功"。
// 这个坑插件作者没法从清单里看出来，只能靠"记得把非后台动作排第一"，必须堵死。
//
// 判定办法：让停止命令先睡 800ms、再留一个标记文件。停止命令被正确等待时，
// stopService 返回时标记一定已经写了；被当后台任务拉起时，返回时标记必然还没有
// （800ms 远大于"spawn 完就返回"的时间）。
{
  const dir = path.join(TMP, 'stopbg');
  fs.mkdirSync(dir, { recursive: true });

  // 一个"活着"的进程：服务检测靠 pid 文件 + 进程在不在，得让它认为服务在运行
  const dummy = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  await new Promise((res) => dummy.once('spawn', res));
  fs.writeFileSync(path.join(dir, 'dummy.pid'), String(dummy.pid));

  const marker = path.join(dir, 'stopped.marker');
  fs.writeFileSync(path.join(dir, 'stop.mjs'), `
import fs from 'node:fs';
await new Promise((r) => setTimeout(r, 800));
fs.writeFileSync(${JSON.stringify(marker)}, 'ok');
`);
  fs.writeFileSync(path.join(dir, 'plugin.toml'), `
[plugin]
id      = "stopbg"
name    = "停止命令模板测试"
summary = "第一个动作是后台动作时，停止命令也不能被当后台任务"

[[action]]
id          = "watch"
title       = "一个后台动作（故意排在第一个）"
description = "用来复现模板继承 background 的陷阱"
run         = ["{node}", "-e", "setInterval(()=>{},1000)"]
output      = "text"
risk        = "mutate"
background  = true

[[service]]
id          = "thing"
title       = "被停的东西"
description = "用 pid 文件判断在不在跑"
pidFile     = "dummy.pid"
stop        = ["{node}", "stop.mjs"]
`);

  const plugin = loadPlugin(dir).plugin;
  check('夹具确实是「第一个动作带 background」（否则这条测试没有意义）',
    plugin.actions[0].background === true);

  const { stopService } = await import('../src/core/services.ts');
  const r = await stopService('stopbg', 'thing');
  check('服务停止命令被真正等待执行完，而不是当后台任务拉起来就返回',
    r.ok === true && fs.existsSync(marker),
    `ok=${r.ok} 标记文件存在=${fs.existsSync(marker)} msg=${r.message}`);

  // 那个"活着"的进程得自己收掉（上面的停止命令是故意不真杀它的）
  dummy.kill();
}

// ---- 5d. 后台进程必须活过"启动它的那个进程" ----
//
// 这是后台托管的**全部意义**所在，而且原来的实现是坏的：子进程用管道 stdio、
// 不 detach，于是启动它的进程一退出它就跟着死。表现是
// `zkit run clipboard watch-start` 报告"已在后台启动"，命令一返回监听就没了。
//
// 这条必须在**子进程里**验证：在本进程里跑，父进程一直活着，测不出这个差别。
{
  const dir = path.join(TMP, 'survivor');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'beat.mjs'), `
import fs from 'node:fs';
const out = process.argv[2];
setInterval(() => {
  try { fs.appendFileSync(out, 'beat\\n'); } catch {}
}, 150);
`);
  fs.writeFileSync(path.join(dir, 'plugin.toml'), `
[plugin]
id      = "survivor"
name    = "存活测试"
summary = "验证后台进程能否活过启动它的进程"

[[action]]
id          = "go"
title       = "常驻并写心跳"
description = "每 150ms 往心跳文件写一行"
run         = ["{node}", "beat.mjs", "{plugin_dir}/beat.log"]
output      = "text"
risk        = "mutate"
background  = true
`);

  // 一个独立的"启动器"进程：跑一次后台动作，然后自己退出
  fs.writeFileSync(path.join(dir, 'launcher.mjs'), `
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = ${JSON.stringify(PKG_ROOT)};
const dir = process.argv[2];
const { loadPlugin } = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'manifest.ts')).href);
const { runAction } = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'runner.ts')).href);
const plugin = loadPlugin(dir).plugin;
const r = await runAction(plugin, plugin.actions[0], { caller: 'cli', values: {} });
process.stdout.write(JSON.stringify({ ok: r.ok, pid: r.background?.pid, error: r.error }) + '\\n');
`);

  const beat = path.join(dir, 'beat.log');
  const beats = () => {
    try { return fs.readFileSync(beat, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; }
  };

  const launched = spawnSync(process.execPath, [path.join(dir, 'launcher.mjs'), dir], {
    encoding: 'utf8', windowsHide: true, timeout: 60000,
  });
  let started = {};
  try { started = JSON.parse((launched.stdout ?? '').trim().split('\n').pop() ?? '{}'); } catch { /* 下面会判 */ }

  check('启动器报告后台动作已启动', started.ok === true && started.pid > 0,
    `stdout=${launched.stdout} stderr=${launched.stderr}`);

  const before = beats();
  await new Promise((r) => setTimeout(r, 1200));
  const after = beats();

  check('启动它的进程已经退出（这条测试才有意义）', launched.status === 0, `status=${launched.status}`);
  check('后台进程活过了启动器退出，并且还在干活',
    before > 0 && after > before, `心跳行数 ${before} → ${after}`);

  if (started.pid > 0) { try { process.kill(started.pid); } catch { /* 已经没了 */ } }
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