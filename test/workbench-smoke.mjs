// 工作台冒烟测试：用 mock provider（不联网、不花钱）验证整条 agent 循环，
// 重点是「有副作用的动作必须先拿到用户批准才执行」这条安全行为。
//
// 自带服务端：把 ZEROKIT_HOME 指到临时目录、写一份 provider = "mock" 的配置，
// 再复制现有插件进去，所以不会碰到正式配置和日志。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROXY_PY = path.resolve(import.meta.dirname, '..', 'src', 'server.ts');
const PKG_ROOT = path.resolve(import.meta.dirname, '..');
const REAL_HOME = path.join(os.homedir(), '.zerokit');
const TMP = path.join(os.tmpdir(), 'zerokit-workbench-test');
const PORT = 28911;

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   <- ' + String(detail).slice(0, 300)}`);
};

// ---- 准备隔离的 ZEROKIT_HOME ----
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, 'home'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'home', 'plugins'), { recursive: true });
if (fs.existsSync(path.join(REAL_HOME, 'plugins'))) {
  for (const name of fs.readdirSync(path.join(REAL_HOME, 'plugins'))) {
    fs.cpSync(path.join(REAL_HOME, 'plugins', name), path.join(TMP, 'home', 'plugins', name), {
      recursive: true,
    });
  }
}
fs.writeFileSync(
  path.join(TMP, 'home', 'config.toml'),
  '[ai]\nprovider = "mock"\nmodel = "mock-1"\n',
);

const server = spawn(process.execPath, [PROXY_PY, 'ui', '--port', String(PORT)], {
  cwd: PKG_ROOT,
  env: { ...process.env, ZEROKIT_HOME: path.join(TMP, 'home') },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let serverErr = '';
server.stderr.on('data', (c) => { serverErr += c.toString('utf8'); });

const base = `http://127.0.0.1:${PORT}`;

async function waitReady(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base + '/');
      if (r.ok) return await r.text();
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`服务端没起来。stderr:\n${serverErr}`);
}

/** 打开一次对话流；onEvent 可返回 Promise，用来在事件回调里发审批 */
async function chat(message, sessionId, onEvent) {
  const token = (await (await fetch(base + '/')).text())
    .match(/zk-token" content="([^"]+)"/)?.[1];
  const res = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-zerokit-token': token },
    body: JSON.stringify({ message, sessionId }),
  });
  if (!res.ok) {
    return { events: [], httpError: await res.text() };
  }
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
      let evt;
      try {
        evt = JSON.parse(chunk.slice(5).trim());
      } catch {
        continue;
      }
      events.push(evt);
      if (onEvent) await onEvent(evt, token);
    }
  }
  return { events };
}

async function approve(token, sessionId, callId, allow) {
  const r = await fetch(base + '/api/chat/approve', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-zerokit-token': token },
    body: JSON.stringify({ sessionId, callId, allow }),
  });
  return r.ok;
}

const textOf = (events) => events.filter((e) => e.type === 'text').map((e) => e.delta).join('');
const typesOf = (events) => events.map((e) => e.type);

try {
  await waitReady();

  const token = (await (await fetch(base + '/')).text())
    .match(/zk-token" content="([^"]+)"/)?.[1];

  const ai = await (await fetch(base + '/api/ai', { headers: { 'x-zerokit-token': token } })).json();
  check('服务端报告 mock provider 就绪且带工具数',
    ai.provider === 'mock' && ai.ready === true && ai.tools > 0, JSON.stringify(ai));

  // ---- 1. 只读动作：不该弹确认，直接执行 ----
  const readRun = await chat('用 sysinfo 看看系统概况', 'r1');
  const readTypes = typesOf(readRun.events);
  check('只读动作直接执行，没有出现 tool_pending',
    readTypes.includes('tool_start') && !readTypes.includes('tool_pending'), readTypes.join(','));
  const readResult = readRun.events.find((e) => e.type === 'tool_result')?.result;
  check('只读动作返回了真实系统信息',
    readResult?.ok === true && /核心数|主机名/.test(readResult.summary ?? ''), readResult?.summary);
  check('文本是流式分片到达的（不是一次性）',
    readRun.events.filter((e) => e.type === 'text').length > 20,
    readRun.events.filter((e) => e.type === 'text').length);
  check('中文正常，没有替换字符', !textOf(readRun.events).includes('�'), textOf(readRun.events));

  // ---- 2. 有副作用的动作 + 用户批准 ----
  let pendingSeen = null;
  const approveRun = await chat('调用 jlc-proxy__stop', 'r2', async (evt, tk) => {
    if (evt.type === 'tool_pending') {
      pendingSeen = evt.call;
      await approve(tk, 'r2', evt.call.id, true);
    }
  });
  const approveTypes = typesOf(approveRun.events);
  const pendIdx = approveTypes.indexOf('tool_pending');
  const startIdx = approveTypes.indexOf('tool_start');
  check('有副作用的动作先弹确认，再执行',
    pendIdx >= 0 && startIdx > pendIdx, approveTypes.join(','));
  check('确认框里给的是解析后的完整命令',
    typeof pendingSeen?.command === 'string' && /proxy\.py/.test(pendingSeen.command),
    pendingSeen?.command);
  check('确认框标出了风险等级与动作身份',
    pendingSeen?.risk === 'mutate' && pendingSeen?.actionId === 'stop',
    JSON.stringify(pendingSeen));
  const approveResult = approveRun.events.find((e) => e.type === 'tool_result')?.result;
  check('批准后真的执行了（带耗时）',
    approveResult && approveResult.ok === true && approveResult.ms > 0,
    JSON.stringify(approveResult)?.slice(0, 200));

  // ---- 3. 有副作用的动作 + 用户拒绝 ----
  const denyRun = await chat('调用 jlc-proxy__start', 'r3', async (evt, tk) => {
    if (evt.type === 'tool_pending') await approve(tk, 'r3', evt.call.id, false);
  });
  const denyTypes = typesOf(denyRun.events);
  check('拒绝后不执行该工具（没有 tool_start）',
    denyTypes.includes('tool_pending') && !denyTypes.includes('tool_start'), denyTypes.join(','));
  const denyResult = denyRun.events.find((e) => e.type === 'tool_result')?.result;
  check('拒绝会作为结果回填给模型，且标记 declined',
    denyResult?.declined === true && /拒绝/.test(denyResult.summary ?? ''),
    JSON.stringify(denyResult)?.slice(0, 200));
  check('模型收到拒绝后正常收尾（走到 done）', denyTypes.includes('done'), denyTypes.join(','));

  // ---- 4. 没配密钥时给的是可操作的提示 ----
  fs.writeFileSync(
    path.join(TMP, 'home', 'config.toml'),
    '[ai]\nprovider = "anthropic"\napi_key = ""\n',
  );
  const notReady = await (await fetch(base + '/api/ai', { headers: { 'x-zerokit-token': token } })).json();
  check('anthropic 但没填密钥时明确报告未就绪并给出指引',
    notReady.ready === false && /api_key/.test(notReady.hint ?? ''),
    JSON.stringify(notReady));
  const blocked = await chat('你好', 'r4');
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