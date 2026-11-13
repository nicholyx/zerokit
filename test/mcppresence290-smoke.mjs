// 第二百九十轮：协作 presence——加入/离开广播、在线清单、CLI 查询、重连去重
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- mcppresence290 ${d}`); } };
console.log('mcppresence290-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mp290-'));
const TOKEN = 'p'.repeat(48);
const env = { ...process.env, ZEROKIT_HOME: home, ZEROKIT_TOKEN: TOKEN, ZEROKIT_BROADCAST: '1' };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env: { ...process.env, ZEROKIT_HOME: home }, encoding: 'utf8', timeout: 120000 });

const PORT = '39851';
const child = spawn(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'mcp', 'serve', '--http', PORT], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let started = false;
child.stderr.on('data', (d) => { if (process.env.ZK_DBG) process.stderr.write('[srv] ' + d); if (String(d).includes('已启动')) started = true; });
for (let i = 0; i < 40 && !started; i++) await new Promise((r) => setTimeout(r, 250));
if (!started) { check('活体 server 启动', false, '10s 未就绪'); finish(); }

const BASE = `http://127.0.0.1:${PORT}/mcp`;
const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-zerokit-token': TOKEN };

// 观察者 B 先上线（SSE 收 presence）
async function client(cid, withSse) {
  const r = await fetch(BASE, { method: 'POST', headers: { ...H, 'x-client-id': cid }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: cid, version: '0' } } }) });
  const sid = r.headers.get('mcp-session-id');
  await fetch(BASE, { method: 'POST', headers: { ...H, 'mcp-session-id': sid }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  if (!withSse) return { sid };
  const sse = await fetch(BASE, { method: 'GET', headers: { ...H, 'mcp-session-id': sid, accept: 'text/event-stream' } });
  return { sid, sse };
}
let bText = '';
const B = await client('watcher-B', true);
const reader = B.sse.body.getReader();
const pump = (async () => { try { while (true) { const { done, value } = await reader.read(); if (done) break; bText += new TextDecoder().decode(value); } } catch { /* abort */ } })();

// ① C 加入 → B 收 session-joined
const C = await client('guest-C', false);
await new Promise((r) => setTimeout(r, 800));
check('① C 加入 → B 收 session-joined（含 clientId）', bText.includes('session-joined') && bText.includes('guest-C'), bText.slice(0, 120));

// ③ 在线清单
const sess = await fetch(`http://127.0.0.1:${PORT}/mcp/sessions`, { headers: { 'x-zerokit-token': TOKEN } }).then((r) => r.json());
check('③ 在线清单（B/C 两会话 + clientId + connectedAt）', sess.count === 2 && sess.sessions.some((x) => x.clientId === 'watcher-B') && sess.sessions.some((x) => x.clientId === 'guest-C'), JSON.stringify(sess).slice(0, 100));

// ② C DELETE 离开 → B 收 session-left
await fetch(BASE, { method: 'DELETE', headers: { ...H, 'mcp-session-id': C.sid } });
await new Promise((r) => setTimeout(r, 800));
check('② C 离开 → B 收 session-left', bText.includes('session-left') && bText.includes('guest-C'), '');

// ③ 清单减一
const sess2 = await fetch(`http://127.0.0.1:${PORT}/mcp/sessions`, { headers: { 'x-zerokit-token': TOKEN } }).then((r) => r.json());
check('③ 离开后清单 count=1', sess2.count === 1 && sess2.sessions[0]?.clientId === 'watcher-B', JSON.stringify(sess2).slice(0, 80));

// ④ CLI 查询
const cli = spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'mcp', 'sessions', '--http', PORT], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
check('④ zkit mcp sessions（watcher-B 一行）', cli.status === 0 && (cli.stdout + '').includes('watcher-B'), (cli.stdout + cli.stderr).slice(0, 80));

// ⑤ presence 广播不含自身（B 的流里没有 watcher-B 的 joined——B 是第一个，无他人；且 session-joined 恰一次）
check('⑤ 风暴/自排除（B 流中 joined 计数=1 且不含 watcher-B 的 joined）', (bText.match(/session-joined/g) ?? []).length === 1 && !bText.includes('"clientId":"watcher-B"'), String((bText.match(/session-joined/g) ?? []).length));

finish();
function finish() {
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
  try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
  console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
  process.exit(fail > 0 ? 1 : 0);
}
