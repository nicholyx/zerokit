import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- mcplock299 ${d}`); } };
console.log('mcplock299-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lk299-'));
const TOKEN = 'l'.repeat(48);
const env = { ...process.env, ZEROKIT_HOME: home, ZEROKIT_TOKEN: TOKEN, ZEROKIT_BROADCAST: '1' };

spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env: { ...process.env, ZEROKIT_HOME: home }, encoding: 'utf8', timeout: 120000 });

// 务实：临时插件 slowmut（sleep 2s 的 mutate）
const dir = path.join(home, 'plug', 'slowmut');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "slowmut"
name = "慢写"
version = "0.1.0"
summary = "x"

[[action]]
id = "write-slow"
title = "慢写"
description = "慢写"
run = ["{node}", "-e", "setTimeout(()=>console.log(JSON.stringify({done:1})),1500)"]
risk = "mutate"
output = "json"
`);
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });

spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'mcp', 'allow', 'slowmut.write-slow'], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });

const PORT = '39891';
const child = spawn(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'mcp', 'serve', '--http', PORT], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let started = false;
child.stderr.on('data', (d) => { if (process.env.ZK_DBG) process.stderr.write('[srv] ' + d); if (String(d).includes('已启动')) started = true; });
for (let i = 0; i < 40 && !started; i++) await new Promise((r) => setTimeout(r, 250));
if (!started) { check('server 启动', false, ''); finish(); }

const BASE = `http://127.0.0.1:${PORT}/mcp`;
const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-zerokit-token': TOKEN };
async function client(cid) {
  const r = await fetch(BASE, { method: 'POST', headers: { ...H, 'x-client-id': cid }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: cid, version: '0' } } }) });
  const sid = r.headers.get('mcp-session-id');
  await fetch(BASE, { method: 'POST', headers: { ...H, 'mcp-session-id': sid }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  return { sid };
}
async function callTool(sid, id, tool, args = {}) {
  const r = await fetch(BASE, { method: 'POST', headers: { ...H, 'mcp-session-id': sid }, body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: args } }) });
  return { status: r.status, body: await r.text() };
}

const A = await client('alice');
const B = await client('bob');
  const tl = await fetch(BASE, { method: 'POST', headers: { ...H, 'mcp-session-id': A.sid }, body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/list' }) }).then((r) => r.text());
  check('tools/list 含 slowmut（装序正确）', tl.includes('slowmut__write-slow'), tl.slice(0, 60));
await new Promise((r) => setTimeout(r, 300));

// A 发起慢写（不等完成）
const slowPromise = (async () => {
  const r = await callTool(A.sid, 10, 'slowmut__write-slow');  // 完整消费（text() 等 handler 跑完）
  // 298 规范：POST 响应必须消费（SSE 流模式下不消费会让 server 端写流 RST——handler 卡死）
  return r.body;
})();
await new Promise((r) => setTimeout(r, 400));  // A 已在途

// ② B 同时调同工具 → busy
const bRes = await callTool(B.sid, 11, 'slowmut__write-slow');
check('② 互斥：B 调同 mutate 收 busy-locked（含 holder）', bRes.body.includes('busy-locked') && (bRes.body.includes('alice') || bRes.body.includes('session-')), bRes.body.slice(0, 120));

// ⑤ sessions 显示锁
const sess1 = await fetch(`http://127.0.0.1:${PORT}/mcp/sessions`, { headers: { 'x-zerokit-token': TOKEN } }).then((r) => r.json());
check('⑤ sessions 带锁（slowmut__write-slow 由 alice 持有）', (sess1.locks ?? []).some((l) => l.tool === 'slowmut__write-slow'), JSON.stringify(sess1.locks));

// ③ A 完成后锁释放 → B 可调
// 294：POST 响应是立即 200（SSE 流模式）——runAction 完成的真实信号是锁释放；轮询等待
let doneSeen = false;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 250));
  const s2 = await fetch(`http://127.0.0.1:${PORT}/mcp/sessions`, { headers: { 'x-zerokit-token': TOKEN } }).then((r) => r.json());
  if (i % 8 === 0) console.error(`  poll${i}: locks=${JSON.stringify(s2.locks)} sessions=${s2.count}`);
  if ((s2.locks ?? []).length === 0) { doneSeen = true; break; }
}
check('③ 完成释放（轮询 locks 空）', doneSeen, '5s 内未释放');
check('③ B 重试应在锁释放后', doneSeen, '');
const bRetry = await callTool(B.sid, 12, 'slowmut__write-slow');
check('③ B 重试成功（非 busy）', !bRetry.body.includes('busy-locked'), bRetry.body.slice(0, 200));

// ④ read 不锁：双客户端并发 sysinfo（都 200 非 busy）
const [r1, r2] = await Promise.all([callTool(A.sid, 13, 'sysinfo__overview'), callTool(B.sid, 14, 'sysinfo__overview')]);
check('④ read 不互斥（双方都成功）', r1.status === 200 && r2.status === 200 && !r1.body.includes('busy-locked') && !r2.body.includes('busy-locked'), `${r1.status}/${r2.status}`);

// ③ 断连释放：A 再持锁中途 DELETE
const slow2 = callTool(A.sid, 15, 'slowmut__write-slow');
await new Promise((r) => setTimeout(r, 400));
await fetch(BASE, { method: 'DELETE', headers: { ...H, 'mcp-session-id': A.sid } });
await new Promise((r) => setTimeout(r, 300));
const sess3 = await fetch(`http://127.0.0.1:${PORT}/mcp/sessions`, { headers: { 'x-zerokit-token': TOKEN } }).then((r) => r.json());
check('③ 断连释放该会话的锁', (sess3.locks ?? []).length === 0, JSON.stringify(sess3.locks));
void slow2;

finish();
function finish() {
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
  try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
  console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
  process.exit(fail > 0 ? 1 : 0);
}
