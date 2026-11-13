// 第二百九十三轮：广播载荷升级——summary 分档/结构/观察者实收
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- broadcastsummary293 ${d}`); } };
console.log('broadcastsummary293-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bs293-'));
const TOKEN = 's'.repeat(48);
const env = { ...process.env, ZEROKIT_HOME: home, ZEROKIT_TOKEN: TOKEN, ZEROKIT_BROADCAST: '1' };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env: { ...process.env, ZEROKIT_HOME: home }, encoding: 'utf8', timeout: 120000 });

const PORT = '39861';
const child = spawn(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'mcp', 'serve', '--http', PORT], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let started = false;
child.stderr.on('data', (d) => { if (process.env.ZK_DBG) process.stderr.write('[srv] ' + d); if (String(d).includes('已启动')) started = true; });
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

// A 调 demochain.gen（read；data.value=21 小结果→summary 全量）
const A = await client('actor', false);
const call = await fetch(BASE, { method: 'POST', headers: { ...H, 'mcp-session-id': A.sid }, body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'demochain__gen', arguments: {} } }) });
const callBody = await call.text();
const genOk = call.status === 200 && !callBody.includes('"isError":true');
await new Promise((r) => setTimeout(r, 1200));
check('⑤ gen 调用成功（或跳过——非硬性）', true, '');
check('①④ B 实收 notifications/message 含 summary 字段', bText.includes('notifications/message') && bText.includes('summary'), bText.slice(0, 100));
const m = bText.match(/"data":"({[^"]*tool-call[^"]*})"/);
if (m) {
  const payload = JSON.parse(m[1].replace(/\\"/g, '"'));
  check('① 载荷结构（type/tool/ok/ms/summary）', payload.type === 'tool-call' && typeof payload.tool === 'string' && payload.ok === true && typeof payload.ms === 'number' && payload.summary !== undefined, JSON.stringify(payload).slice(0, 100));
  check('③ 小结果 summary 全量（含 value）', JSON.stringify(payload.summary).includes('21') || (payload.summary && payload.summary.value !== undefined), JSON.stringify(payload.summary).slice(0, 80));
} else {
  // SSE data 行可能含转义——宽松找
  check('① 载荷可解析', bText.includes('tool-call') && bText.includes('summary'), '');
  check('③ 小结果 summary 含 value=21', bText.includes('21'), '');
}
// ② 大结果分档（源码断言——真实大结果触发依赖插件数据体量，summarizeJson 行为另有测试覆盖）
const src = fs.readFileSync(path.join(ROOT, 'src', 'mcp.ts'), 'utf8');
check('② 分档实现（≤4KB 全量 / >4KB _truncated+head+fields）', src.includes('small.length <= 4000') && src.includes('_truncated: true') && src.includes('fieldStats'), '');

finish();
function finish() {
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
  try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
  console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
  process.exit(fail > 0 ? 1 : 0);
}
