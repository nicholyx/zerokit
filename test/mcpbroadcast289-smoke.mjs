// 第二百八十九轮：多客户端会话广播——双客户端实收/风暴/清理/开关
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- mcpbroadcast289 ${d}`); } };
console.log('mcpbroadcast289-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mb289-'));
const env = { ...process.env, ZEROKIT_HOME: home, ZEROKIT_TOKEN: 'b'.repeat(48) };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env: { ...process.env, ZEROKIT_HOME: home }, encoding: 'utf8', timeout: 120000 });

// 源码断言（①④⑤ 结构）
const src = fs.readFileSync(path.join(ROOT, 'src', 'mcp.ts'), 'utf8');
check('① 会话表（SessionEntry 元数据 clientId/connectedAt）', src.includes('interface SessionEntry') && src.includes('clientId') && src.includes('connectedAt'), '');
check('④ --broadcast 开关默认关（broadcastEnabled 才 notifyOthers）', src.includes('broadcastEnabled') && src.includes('if (!broadcastEnabled) return;'), '');
check('⑤ DELETE 断连清出（close + transports.delete——290 轮离开广播插入后仍在）', src.includes('entry.transport.close();') && src.includes('transports.delete(sid as string)'), '');
check('③ 广播风暴防护（hook 调用点=3：工具广播 1 + presence 加入/离开 2）', (src.match(/broadcastHook\('notifications\/message'/g) ?? []).length === 3, '');
check('④ CLI flag（--broadcast 进 serveHttp）', src.includes("process.argv.push('--broadcast')"), '');

// 活体：双客户端（--broadcast 开）——B 收到 A 的 tool-call 通知
const child = spawn(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'mcp', 'serve', '--http', '39841'], { cwd: ROOT, env: { ...env, ZEROKIT_BROADCAST: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let started = false;
child.stderr.on('data', (d) => { const t = String(d); if (process.env.ZEROKIT_BROADCAST_DEBUG) process.stderr.write('[srv] ' + t); if (t.includes('已启动')) started = true; });
for (let i = 0; i < 40 && !started; i++) await new Promise((r) => setTimeout(r, 250));
if (!started) { check('活体 server 启动', false, '10s 未就绪'); finish(); } else {
  const BASE = 'http://127.0.0.1:39841/mcp';
  const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-zerokit-token': env.ZEROKIT_TOKEN };
  const initClient = async (cid, withSse) => {
    const r = await fetch(BASE, { method: 'POST', headers: { ...H, 'x-client-id': cid }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: cid, version: '0' } } }) });
    const sid = r.headers.get('mcp-session-id');
    await fetch(BASE, { method: 'POST', headers: { ...H, 'mcp-session-id': sid }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    if (!withSse) return { sid, sse: null };
    // GET SSE 长连接（收通知的载体）
    const sse = await fetch(BASE, { method: 'GET', headers: { ...H, 'mcp-session-id': sid, accept: 'text/event-stream' } });
    return { sid, sse };
  };
  let A, B;
  try {
    A = await initClient('client-A', false);  // A 只 POST 交互（避免与 call 的 GET/POST 并发冲突）
    B = await initClient('client-B', true);    // B 建 SSE 收广播
  } catch (e) {
    console.error('客户端建立失败于：', JSON.stringify({ aSid: A?.sid ?? null, step: A ? 'B' : 'A' }), String(e).slice(0, 60));
    child.kill();
    console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
    process.exit(1);
  }
  check('活体 双客户端各自建会话', !!A.sid && !!B.sid && A.sid !== B.sid, `${A.sid}/${B.sid}`);
  // B 侧收流
  let bText = '';
  const reader = B.sse.body.getReader();
  const pump = (async () => { try { while (true) { const { done, value } = await reader.read(); if (done) break; bText += new TextDecoder().decode(value); } } catch { /* abort */ } })();
  // A 执行工具
  const call = await fetch(BASE, { method: 'POST', headers: { ...H, 'mcp-session-id': A.sid }, body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'sysinfo__overview', arguments: {} } }) });
  const callBody = await call.text();
  check('活体 A 执行工具成功（响应含系统信息非 isError）', call.status === 200 && !callBody.includes('\"isError\":true'), (callBody.slice(0, 100)));
  await new Promise((r) => setTimeout(r, 1500));
  check('② B 收到 A 的 tool-call 广播（notifications/message 含 tool 名）', bText.includes('notifications/message') && bText.includes('sysinfo__overview'), bText.slice(0, 120) || '(SSE 空)');
  check('③ 广播不含 A 自身会话重复（B 流中 tool-call 出现次数=1）', (bText.match(/tool-call/g) ?? []).length === 1, String((bText.match(/tool-call/g) ?? []).length));
  finish();
}
function finish() {
  child.kill();
  try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
  console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
  process.exit(fail > 0 ? 1 : 0);
}
