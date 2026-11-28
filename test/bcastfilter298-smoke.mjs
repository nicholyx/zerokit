// 第二百九十八轮：广播过滤订阅——声明/过滤/presence 豁免/filtered 计数
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- bcastfilter298 ${d}`); } };
console.log('bcastfilter298-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bf298-'));
const TOKEN = 'f'.repeat(48);
const env = { ...process.env, ZEROKIT_HOME: home, ZEROKIT_TOKEN: TOKEN, ZEROKIT_BROADCAST: '1' };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env: { ...process.env, ZEROKIT_HOME: home }, encoding: 'utf8', timeout: 120000 });

const PORT = '39881';
const child = spawn(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'mcp', 'serve', '--http', PORT], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let started = false;
child.stderr.on('data', (d) => { if (process.env.ZK_DBG) process.stderr.write('[srv] ' + d); if (String(d).includes('已启动')) started = true; });
for (let i = 0; i < 40 && !started; i++) await new Promise((r) => setTimeout(r, 250));
if (!started) { check('server 启动', false, ''); finish(); }

const BASE = `http://127.0.0.1:${PORT}/mcp`;
const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-zerokit-token': TOKEN };
// B 声明只收 demochain 前缀
async function client(cid, withSse, filterTools) {
  const clientInfo = { name: cid, version: '0', ...(filterTools ? { filterTools } : {}) };
  const r = await fetch(BASE, { method: 'POST', headers: { ...H, 'x-client-id': cid }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo } }) });
  const sid = r.headers.get('mcp-session-id');
  await fetch(BASE, { method: 'POST', headers: { ...H, 'mcp-session-id': sid }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  if (!withSse) return { sid };
  const sse = await fetch(BASE, { method: 'GET', headers: { ...H, 'mcp-session-id': sid, accept: 'text/event-stream' } });
  return { sid, sse };
}
const B = await client('picky', true, ['demochain']);
let bText = '';
const reader = B.sse.body.getReader();
const pump = (async () => { try { while (true) { const { done, value } = await reader.read(); if (done) break; bText += new TextDecoder().decode(value); } } catch { /* abort */ } })();
const A = await client('actor', false);
await new Promise((r) => setTimeout(r, 300));

// A 调 sysinfo（B 过滤 demochain → 不应收）
await fetch(BASE, { method: 'POST', headers: { ...H, 'mcp-session-id': A.sid }, body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'sysinfo__overview', arguments: {} } }) });
await new Promise((r) => setTimeout(r, 900));
check('③ sysinfo 被过滤（B 不收 tool-call）', !(bText.includes('sysinfo__overview')) || !bText.includes('tool-call'), `bText=${bText.slice(0, 100)}`);

// A 再调 demochain（B 应收）——等节流窗口过后发，收流用轮询（Windows 时序余量）
// 408：2600→3200ms——默认节流 2000ms，CI 慢机上两次请求间隔实测可缩到 <2000ms
// （b98d562 run：demochain 广播被节流丢弃，B 永远收不到 → hit=false 偶发）
// 426：固定 sleep 的边界补全——节流窗从服务端第一次广播时刻起算，测试从发出起等；
// Windows runner 上 sysinfo 处理可超 1200ms，3200 仍不够（PR #1265 Windows run 实证）。
// 改为「等到第一次广播确已发生（filteredBroadcasts ≥1）再等满窗口」——不靠猜处理耗时。
// 428：循环扩到 60×500=30s——广播发生在 tool 执行完成后（mcp.ts L679-686），
// Windows 慢机上 sysinfo 全量扫描可超 12s（40×300 原窗口）——超时即回到 426 前的老 bug
// 534：窗口 30s→120s（150×800ms）——Windows CI 全量挤兑时 sysinfo 执行可 > 30s
// （422/469/534 三次同断言失败实证：信号等待窗口本身不足）；800ms 粒度减轮询请求压力
for (let i = 0; i < 150; i++) {
  const snap = await fetch(`http://127.0.0.1:${PORT}/mcp/sessions`, { headers: { 'x-zerokit-token': TOKEN } }).then((r) => r.json()).catch(() => ({}));
  if ((snap.filteredBroadcasts ?? 0) >= 1) break;
  await new Promise((r) => setTimeout(r, 800));
}
// 556：③ 的等待窗口 20×400=8s 在 Windows 全量挤兑下不够（556-PR1603 第 4 次同断言偶发实证——
// demochain__gen 的执行+广播在挤兑时可 > 8s）。扩到 75×400=30s。
// 注意：2400ms 节流等待必须保留——sysinfo 与 demochain 广播同为 notifications/message，
// 共享 lastBroadcast 节流键（mcp.ts L803），删掉它 demochain 广播会被节流丢弃（本地三连实证）。
await new Promise((r) => setTimeout(r, 2400));  // 节流窗 2000ms + 20% 余量（从广播时刻起算）
await fetch(BASE, { method: 'POST', headers: { ...H, 'mcp-session-id': A.sid }, body: JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'demochain__gen', arguments: {} } }) });
let hit = false;
for (let i = 0; i < 75; i++) {
  if (bText.includes('demochain__gen') && bText.includes('tool-call')) { hit = true; break; }
  await new Promise((r) => setTimeout(r, 400));
}
check('③ demochain 命中过滤（B 收到 tool-call）', hit, bText.slice(0, 100));

// ⑤ filtered 计数
const sess = await fetch(`http://127.0.0.1:${PORT}/mcp/sessions`, { headers: { 'x-zerokit-token': TOKEN } }).then((r) => r.json());
check('⑤ filteredBroadcasts ≥1（sysinfo 那次被滤）', (sess.filteredBroadcasts ?? 0) >= 1, JSON.stringify({ d: sess.droppedBroadcasts, f: sess.filteredBroadcasts }));

// ④ presence 豁免：B 自己的 SSE 里应有 A 的 session-joined（A 无过滤声明也行——joined 广播给所有人）
check('④ presence 不受过滤（B 流含 session-joined）', bText.includes('session-joined'), '');

finish();
function finish() {
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
  try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
  console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
  process.exit(fail > 0 ? 1 : 0);
}
