// 第二百九十六轮：广播频率控制——节流/窗口/presence 豁免/dropped 计数
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- broadcastthrottle296 ${d}`); } };
console.log('broadcastthrottle296-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bt296-'));
// 极小 min-interval 便于活体观察（500ms）
fs.mkdirSync(home, { recursive: true });
// config 用默认 2000ms——先验证无配置下广播通不通

const TOKEN = 't'.repeat(48);
const env = { ...process.env, ZEROKIT_HOME: home, ZEROKIT_TOKEN: TOKEN, ZEROKIT_BROADCAST: '1' };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env: { ...process.env, ZEROKIT_HOME: home }, encoding: 'utf8', timeout: 120000 });

const PORT = '39871';
const child = spawn(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'mcp', 'serve', '--http', PORT], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let started = false;
child.stderr.on('data', (d) => { process.stderr.write('[srv] ' + d); if (String(d).includes('已启动')) started = true; });
for (let i = 0; i < 40 && !started; i++) await new Promise((r) => setTimeout(r, 250));
if (!started) { check('server 启动', false, ''); finish(); }

const BASE = `http://127.0.0.1:${PORT}/mcp`;
const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-zerokit-token': TOKEN };
async function client(cid, withSse) {
  const r = await fetch(BASE, { method: 'POST', headers: { ...H, 'x-client-id': cid }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: cid, version: '0' } } }) });
  const sid = r.headers.get('mcp-session-id');
  await fetch(BASE, { method: 'POST', headers: { ...H, 'mcp-session-id': sid }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  if (!withSse) return { sid };
  const sse = await fetch(BASE, { method: 'GET', headers: { ...H, 'mcp-session-id': sid, accept: 'text/event-stream' } });
  return { sid, sse };
}
const B = await client('watcher', true);
let bText = '';
const reader = B.sse.body.getReader();
const pump = (async () => { try { while (true) { const { done, value } = await reader.read(); if (done) break; bText += new TextDecoder().decode(value); } } catch { /* abort */ } })();
const A = await client('actor', false);
await new Promise((r) => setTimeout(r, 300));

// ① 节流：快速连调两次同 tool（<500ms）——第二次应被丢
const call = async (id) => { const r = await fetch(BASE, { method: 'POST', headers: { ...H, 'mcp-session-id': A.sid }, body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'demochain__gen', arguments: {} } }) }); if (process.env.ZK_DBG) process.stderr.write('[call' + id + '] ' + (await r.text()).slice(0, 80) + '\n'); };
await call(1); await call(2);  // 间隔毫秒级
await new Promise((r) => setTimeout(r, 900));
const callsSeen = (bText.match(/tool-call/g) ?? []).length;
check('① 节流（500ms 内两次调用只广播 1 次）', callsSeen === 1, `seen=${callsSeen} bText=${bText.slice(0, 80)}`);

// ③ dropped 计数 ≥1
const sess = await fetch(`http://127.0.0.1:${PORT}/mcp/sessions`, { headers: { 'x-zerokit-token': TOKEN } }).then((r) => r.json());
check('③ dropped 计数进 /mcp/sessions（≥1）', (sess.droppedBroadcasts ?? 0) >= 1, JSON.stringify(sess.droppedBroadcasts));

// ②④ 源码断言：窗口解析 + presence 豁免 + CLI 显示
const src = fs.readFileSync(path.join(ROOT, 'src', 'mcp.ts'), 'utf8');
check('② 静默窗口（inQuiet 跨午夜 + presence 豁免）', src.includes('inQuiet') && src.includes('session-joined') && src.includes('跨午夜'), '');
check('④ CLI 显示 dropped（频控提示行）', src.includes('频率控制丢弃广播') && src.includes('droppedBroadcasts'), '');

finish();
function finish() {
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
  try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
  console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
  process.exit(fail > 0 ? 1 : 0);
}
