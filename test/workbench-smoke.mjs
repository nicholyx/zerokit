// 工作台冒烟测试：用 mock provider（不联网、不花钱）验证整条 agent 循环，
// 重点是「有副作用的动作必须先拿到用户批准才执行」这条安全行为。
//
// **完全自包含**：临时 ZEROKIT_HOME + 一个只为测试造的插件。
// 早期版本直接用了仓库里的示例插件，结果 mock 模型调用 proxy.stop 时
// 真的把开发机上正在运行的代理停掉了（动作里写的是绝对路径，隔离的 HOME 兜不住）。
// 测试绝不该碰真实系统，所以现在测试插件只做无副作用的事。
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PKG_ROOT = path.resolve(import.meta.dirname, '..');
const SERVER = path.join(PKG_ROOT, 'src', 'server.ts');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
const TMP = path.join(os.tmpdir(), 'zerokit-workbench-test');
const HOME = path.join(TMP, 'home');
const PLUGINS = path.join(HOME, 'plugins');
const PORT = 28911;

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   <- ' + String(detail).slice(0, 300)}`);
};

// ---- 隔离的 HOME + 只为测试存在的插件 ----
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(PLUGINS, 'testkit'), { recursive: true });
fs.writeFileSync(path.join(HOME, 'config.toml'), '[ai]\nprovider = "mock"\nmodel = "mock-1"\n');
fs.writeFileSync(path.join(PLUGINS, 'testkit', 'plugin.toml'), `
[plugin]
id       = "testkit"
name     = "测试工具包"
summary  = "只给自动化测试用，不做任何有真实副作用的事"
keywords = ["test", "测试"]

[[action]]
id          = "ping"
title       = "只读动作"
description = "回一声 pong"
run         = ["{node}", "-e", "console.log('pong')"]
output      = "text"
risk        = "read"

[[action]]
id          = "touch"
title       = "会改动的动作"
description = "打印 touched，不碰任何真实东西"
run         = ["{node}", "-e", "console.log('touched')"]
output      = "text"
risk        = "mutate"

[[action]]
id          = "spin"
title       = "后台动作"
description = "每秒打印一次 tick，直到被结束"
run         = ["{node}", "-e", "setInterval(()=>console.log('tick'),300)"]
output      = "text"
risk        = "mutate"
background  = true
`);

const server = spawn(process.execPath, [SERVER, 'ui', '--port', String(PORT)], {
  cwd: PKG_ROOT,
  env: { ...process.env, ZEROKIT_HOME: HOME },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let serverErr = '';
server.stderr.on('data', (c) => { serverErr += c.toString('utf8'); });

const base = `http://127.0.0.1:${PORT}`;
let token = '';

async function waitReady(timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base + '/');
      if (res.ok) {
        token = (await res.text()).match(/zk-token" content="([^"]+)"/)?.[1] ?? '';
        return;
      }
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`服务端没起来。stderr:\n${serverErr}`);
}

async function chat(message, sessionId, onEvent) {
  const res = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-zerokit-token': token },
    body: JSON.stringify({ message, sessionId }),
  });
  if (!res.ok) return { events: [], httpError: await res.text() };

  const events = [];
  let buf = '';
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i).trim();
      buf = buf.slice(i + 2);
      if (!chunk.startsWith('data:')) continue;
      try {
        const evt = JSON.parse(chunk.slice(5).trim());
        events.push(evt);
        if (onEvent) await onEvent(evt);
      } catch { /* 忽略坏行 */ }
    }
  }
  return { events };
}

const approve = (sessionId, callId, allow) => fetch(base + '/api/chat/approve', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-zerokit-token': token },
  body: JSON.stringify({ sessionId, callId, allow }),
}).then((r) => r.ok);

const post = (p, body) => fetch(base + p, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-zerokit-token': token },
  body: JSON.stringify(body ?? {}),
}).then((r) => r.json());

const get = (p) => fetch(base + p, { headers: { 'x-zerokit-token': token } }).then((r) => r.json());

const textOf = (events) => events.filter((e) => e.type === 'text').map((e) => e.delta).join('');
const typesOf = (events) => events.map((e) => e.type);

try {
  await waitReady();

  const ai = await get('/api/ai');
  check('服务端报告 mock provider 就绪且带工具数',
    ai.provider === 'mock' && ai.ready === true && ai.tools > 0, JSON.stringify(ai));

  // ---- 1. 只读动作：不该弹确认，直接执行 ----
  const readRun = await chat('调用 testkit__ping', 'r1');
  const readTypes = typesOf(readRun.events);
  check('只读动作直接执行，没有出现 tool_pending',
    readTypes.includes('tool_start') && !readTypes.includes('tool_pending'), readTypes.join(','));
  const readResult = readRun.events.find((e) => e.type === 'tool_result')?.result;
  check('只读动作拿到真实输出',
    readResult?.ok === true && /pong/.test(readResult.summary ?? ''), readResult?.summary);
  check('文本是流式分片到达的（不是一次性）',
    readRun.events.filter((e) => e.type === 'text').length > 20,
    readRun.events.filter((e) => e.type === 'text').length);
  check('中文正常，没有替换字符', !textOf(readRun.events).includes('�'), textOf(readRun.events));

  // ---- 2. 有副作用的动作 + 用户批准 ----
  let pendingSeen = null;
  const approveRun = await chat('调用 testkit__touch', 'r2', async (evt) => {
    if (evt.type === 'tool_pending') {
      pendingSeen = evt.call;
      await approve('r2', evt.call.id, true);
    }
  });
  const approveTypes = typesOf(approveRun.events);
  check('有副作用的动作先弹确认，再执行',
    approveTypes.indexOf('tool_start') > approveTypes.indexOf('tool_pending'),
    approveTypes.join(','));
  check('确认框里给的是解析后的完整命令',
    typeof pendingSeen?.command === 'string' && /node/.test(pendingSeen.command), pendingSeen?.command);
  check('确认框标出了风险等级与动作身份',
    pendingSeen?.risk === 'mutate' && pendingSeen?.actionId === 'touch', JSON.stringify(pendingSeen));
  const approveResult = approveRun.events.find((e) => e.type === 'tool_result')?.result;
  check('批准后真的执行了（带耗时）',
    approveResult?.ok === true && approveResult.ms > 0, JSON.stringify(approveResult)?.slice(0, 200));

  // ---- 3. 用户拒绝 ----
  // 上一步的「批准」把 testkit.touch 记住了（mutate 的语义就是首次确认后记住），
  // 所以这里必须先清掉记忆，否则它不会再问、直接执行——那样就验证不到拒绝路径了。
  fs.rmSync(path.join(HOME, 'approvals.json'), { force: true });

  const denyRun = await chat('调用 testkit__touch', 'r3', async (evt) => {
    if (evt.type === 'tool_pending') await approve('r3', evt.call.id, false);
  });
  const denyTypes = typesOf(denyRun.events);
  check('拒绝后不执行该工具（没有 tool_start）',
    denyTypes.includes('tool_pending') && !denyTypes.includes('tool_start'), denyTypes.join(','));
  const denyResult = denyRun.events.find((e) => e.type === 'tool_result')?.result;
  check('拒绝会作为结果回填给模型，且标记 declined',
    denyResult?.declined === true && /拒绝/.test(denyResult.summary ?? ''),
    JSON.stringify(denyResult)?.slice(0, 200));
  check('模型收到拒绝后正常收尾（走到 done）', denyTypes.includes('done'), denyTypes.join(','));

  // ---- 4. 后台动作会被托管，能在「运行中」里看到并结束 ----
  const spinRun = await chat('调用 testkit__spin', 'r4', async (evt) => {
    if (evt.type === 'tool_pending') await approve('r4', evt.call.id, true);
  });
  const spinResult = spinRun.events.find((e) => e.type === 'tool_result')?.result;
  check('后台动作立即返回（不等它退出）',
    spinResult?.ok === true, JSON.stringify(spinResult)?.slice(0, 200));

  const ps1 = await get('/api/ps');
  const procs = ps1.processes ?? [];
  const spun = procs.find((p) => p.actionId === 'spin');
  check('托管的进程出现在「运行中」里', Boolean(spun), JSON.stringify(ps1).slice(0, 300));
  check('「运行中」里有它的 PID 和真实命令',
    spun?.pid > 0 && /node/.test(spun?.command ?? ''), JSON.stringify(spun));

  // 它确实在持续输出（说明进程真的活着）
  await new Promise((r) => setTimeout(r, 1200));
  const ps2 = await get('/api/ps');
  const spun2 = (ps2.processes ?? []).find((p) => p.id === spun?.id);
  check('后台进程仍在运行且能看到它的输出', spun2?.running === true && (spun2.tail ?? []).some((l) => /tick/.test(l)),
    JSON.stringify(spun2)?.slice(0, 300));

  // 跨进程可见性：登记表是**落盘**的，所以另一个进程（终端里的 zkit ps）也该看得见。
// 这是实测踩出来的坑——只记在内存里的话，界面启动的进程在终端里是隐形的。
{
  const out = spawnSync(process.execPath, [CLI, 'ps'], {
    cwd: PKG_ROOT,
    env: { ...process.env, ZEROKIT_HOME: HOME, PYTHONIOENCODING: 'utf-8' },
    encoding: 'utf8', timeout: 90000, windowsHide: true,
  });
  check('另一个进程（zkit ps）也能看见这个后台进程',
    out.status === 0 && (out.stdout ?? '').includes(String(spun.pid)),
    (out.stdout ?? '') + (out.stderr ?? ''));
}

const killed = await post('/api/kill', { ids: [spun.id] });
  check('能把它结束掉', killed.ok === true, JSON.stringify(killed));
  await new Promise((r) => setTimeout(r, 900));
  const ps3 = await get('/api/ps');
  check('结束后不再出现在「运行中」里',
    !(ps3.processes ?? []).some((p) => p.id === spun.id && p.running),
    JSON.stringify(ps3).slice(0, 300));

  // ---- 5. 没配密钥时给的是可操作的提示 ----
  fs.writeFileSync(path.join(HOME, 'config.toml'), '[ai]\nprovider = "anthropic"\napi_key = ""\n');
  const notReady = await get('/api/ai');
  check('anthropic 但没填密钥时明确报告未就绪并给出指引',
    notReady.ready === false && /api_key/.test(notReady.hint ?? ''), JSON.stringify(notReady));
  const blocked = await chat('你好', 'r5');
  check('未就绪时发消息返回明确错误而不是静默失败',
    blocked.httpError && /密钥|api_key/.test(blocked.httpError), blocked.httpError);
} catch (e) {
  check('测试执行未抛异常', false, e.stack ?? e.message);
} finally {
  server.kill('SIGKILL');
}

console.log('\n' + '='.repeat(60));
const failed = results.filter(([, ok]) => !ok).map(([n]) => n);
console.log(`通过 ${results.length - failed.length} / ${results.length}`);
if (failed.length) console.log('失败：' + failed.join(', '));
process.exit(failed.length ? 1 : 0);