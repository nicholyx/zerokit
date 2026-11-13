// 第二百八十轮：MCP 资源订阅——能力声明 / handler 接线 / SSE 推送（活体）
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- mcpsubscribe280 ${d}`); } };
console.log('mcpsubscribe280-smoke');

const src = fs.readFileSync(path.join(ROOT, 'src', 'mcp.ts'), 'utf8');

// ① 能力声明
check('① 订阅能力（subscribe: true + listChanged: true）', src.includes('subscribe: true, listChanged: true'), '');
// ②③ handler 接线
check('②③ Subscribe/Unsubscribe handler + 版本计数', src.includes('SubscribeRequestSchema') && src.includes('resourceVersions') && src.includes('subscribers.add'), '');
// ⑤ 成功后 bump
check('⑤ 执行成功后 bump 推送（sendResourceUpdated）', src.includes('sendResourceUpdated'), '');
// ④ GET SSE 打开
check('④ GET SSE 长连接（不再一律 405）', src.includes("req.method === 'GET'") && src.includes('先 POST initialize'), '');

// 活体：起 --http server，initialize + subscribe + GET SSE + 触发 run → 收 updated 推送
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ms280-'));
const env = { ...process.env, ZEROKIT_HOME: home, ZEROKIT_TOKEN: 's'.repeat(48) };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env: { ...process.env, ZEROKIT_HOME: home }, encoding: 'utf8', timeout: 120000 });
const child = spawn(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'mcp', 'serve', '--http', '39821'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let started = false;
child.stderr.on('data', (d) => { if (String(d).includes('已启动')) started = true; });
for (let i = 0; i < 40 && !started; i++) await new Promise((r) => setTimeout(r, 250));
if (!started) { check('活体 server 启动', false, '10s 未就绪'); finish(); } else {
  const BASE = 'http://127.0.0.1:39821/mcp';
  const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-zerokit-token': env.ZEROKIT_TOKEN };
  const init = await fetch(BASE, { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'sub-t', version: '0' } } }) });
  const sid = init.headers.get('mcp-session-id');
  const HS = { ...H, 'mcp-session-id': sid };
  check('活体 initialize（capabilities 含 subscribe）', init.status === 200 && (await init.text()).includes('subscribe'), sid ?? 'no-sid');
  await fetch(BASE, { method: 'POST', headers: HS, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  // GET SSE 长连接（手动 reader 收推送）
  const sseCtrl = new AbortController();
  const sseRes = await fetch(BASE, { method: 'GET', headers: { ...HS, accept: 'text/event-stream' }, signal: sseCtrl.signal });
  check('④ GET SSE 建立（200 + event-stream）', sseRes.status === 200 && (sseRes.headers.get('content-type') ?? '').includes('event-stream'), `${sseRes.status} ${sseRes.headers.get('content-type')}`);
  // 订阅资源
  const sub = await fetch(BASE, { method: 'POST', headers: HS, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'resources/subscribe', params: { uri: 'zerokit://plugins' } }) });
  check('② resources/subscribe 200', sub.status === 200, String(sub.status));
  // 触发一次 run（工具执行 → bump）
  let sseText = '';
  const reader = sseRes.body.getReader();
  const pump = (async () => { try { while (true) { const { done, value } = await reader.read(); if (done) break; sseText += new TextDecoder().decode(value); } } catch { /* abort */ } })();
  const call = await fetch(BASE, { method: 'POST', headers: HS, body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'sysinfo__overview', arguments: {} } }) });
  check('⑤ 触发工具执行（run 后 bump）', call.status === 200, String(call.status));
  await new Promise((r) => setTimeout(r, 1500));
  sseCtrl.abort();
  await Promise.race([pump, new Promise((r) => setTimeout(r, 500))]);
  check('③ 收到 notifications/resources/updated 推送', sseText.includes('resources/updated') && sseText.includes('zerokit://plugins'), sseText.slice(0, 120) || '(SSE 空)');
  finish();
}
function finish() {
  child.kill();
  try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
  console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
  process.exit(fail > 0 ? 1 : 0);
}
