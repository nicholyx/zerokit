// 第三百二十二轮：协作面组合拳回顾——filter+lock+throttle+快照聚合 单场景串验
// 与 321（数据组合拳）对偶：协作六能力一气呵成。
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- collabcombo322 ${d}`); } };
console.log('collabcombo322-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cc322-'));
const TOKEN = 'c'.repeat(48);
const env = { ...process.env, ZEROKIT_HOME: home, ZEROKIT_TOKEN: TOKEN, ZEROKIT_BROADCAST: '1' };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env: { ...process.env, ZEROKIT_HOME: home }, encoding: 'utf8', timeout: 120000 });
// 慢 mutate 供锁测试
const dir = path.join(home, 'plug', 'slowm');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "slowm"
name = "慢写"
version = "0.1.0"
summary = "x"

[[action]]
id = "write-slow"
title = "w"
description = "w"
run = ["{node}", "-e", "setTimeout(()=>console.log(JSON.stringify({done:1})),1500)"]
risk = "mutate"
output = "json"
`);
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', dir], { cwd: ROOT, env, encoding: 'utf8' });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'mcp', 'allow', 'slowm.write-slow'], { cwd: ROOT, env, encoding: 'utf8' });  // 299 判据：mutate 需授权才走到锁

const PORT = String(45000 + (process.pid % 2000));
const child = spawn(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'mcp', 'serve', '--http', PORT], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let started = false;
child.stderr.on('data', (d) => { if (String(d).includes('已启动')) started = true; });
for (let i = 0; i < 40 && !started; i++) await new Promise((r) => setTimeout(r, 250));
if (!started) { check('server 启动', false, ''); finish(); }

const BASE = `http://127.0.0.1:${PORT}/mcp`;
const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-zerokit-token': TOKEN };
async function client(cid, withSse, filterTools) {
  const clientInfo = { name: cid, version: '0', ...(filterTools ? { filterTools } : {}) };
  const r = await fetch(BASE, { method: 'POST', headers: { ...H, 'x-client-id': cid }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo } }) });
  const sid = r.headers.get('mcp-session-id');
  await fetch(BASE, { method: 'POST', headers: { ...H, 'mcp-session-id': sid }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  if (!withSse) return { sid };
  const sse = await fetch(BASE, { method: 'GET', headers: { ...H, 'mcp-session-id': sid, accept: 'text/event-stream' } });
  return { sid, sse };
}
const snap = () => fetch(`http://127.0.0.1:${PORT}/mcp/sessions`, { headers: { 'x-zerokit-token': TOKEN } }).then((r) => r.json());
const call = (sid, id, tool) => fetch(BASE, { method: 'POST', headers: { ...H, 'mcp-session-id': sid }, body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: {} } }) });

// ① B 声明只收 demochain（排除 sysinfo）——A 调两个工具对照
const B = await client('watcher', true, ['demochain']);
let bText = '';
const reader = B.sse.body.getReader();
const pump = (async () => { try { while (true) { const { done, value } = await reader.read(); if (done) break; bText += new TextDecoder().decode(value); } } catch { /* abort */ } })();
const A = await client('actor', false);
await new Promise((r) => setTimeout(r, 300));

await call(A.sid, 1, 'sysinfo__overview');  // 应被滤
await new Promise((r) => setTimeout(r, 900));
const s1 = await snap();
check('① sysinfo 被滤（filteredBroadcasts≥1 且 B 无 sysinfo）', (s1.filteredBroadcasts ?? 0) >= 1 && !bText.includes('sysinfo'), JSON.stringify({ f: s1.filteredBroadcasts }));
await new Promise((r) => setTimeout(r, 2500));  // 出节流窗
await call(A.sid, 2, 'demochain__gen');  // 应命中
let hit = false;
for (let i = 0; i < 15; i++) { if (bText.includes('demochain__gen')) { hit = true; break; } await new Promise((r) => setTimeout(r, 400)); }
check('① demochain 命中（B 收到 tool-call）', hit, bText.slice(0, 80));

// ③ 1s 内连调两次 → 第二次被节流（dropped 增）且 presence（B 的 joined）早已到
await new Promise((r) => setTimeout(r, 2600));
const d0 = (await snap()).droppedBroadcasts ?? 0;
await call(A.sid, 3, 'demochain__gen'); await call(A.sid, 4, 'demochain__gen');
await new Promise((r) => setTimeout(r, 1200));
const s2 = await snap();
check('③ 连调两次一次被节流（dropped +1）且 presence 已收（session-joined）', (s2.droppedBroadcasts ?? 0) >= d0 + 1 && bText.includes('session-joined'), JSON.stringify({ d0, d1: s2.droppedBroadcasts }));

// ② 锁：A 持 slowm 1.5s → B busy（快照 locks 含 holder=actor）→ 释放 → B 重试成功
await new Promise((r) => setTimeout(r, 2600));
const slowP = (async () => { const r = await call(A.sid, 5, 'slowm__write-slow'); return r; })();
await new Promise((r) => setTimeout(r, 400));
const s3 = await snap();
check('② 持锁快照（locks 含 slowm__write-slow + holder）', (s3.locks ?? []).some((l) => l.tool === 'slowm__write-slow'), JSON.stringify(s3.locks));
const bBusy = await call(B.sid, 6, 'slowm__write-slow');
check('② B busy-locked（holder=actor）', bBusy.status === 200 && (await bBusy.text()).includes('busy-locked'), '');
await slowP;
let unlocked = false;
for (let i = 0; i < 12; i++) { const s4 = await snap(); if ((s4.locks ?? []).length === 0) { unlocked = true; break; } await new Promise((r) => setTimeout(r, 300)); }
check('② A 完成锁释放（locks 空）', unlocked, '');

// ④ 快照三块同一时刻互相印证（sessions ≥2 + filtered ≥1 + dropped ≥1）
const s5 = await snap();
check('④ 快照聚合一致（sessions≥2 + filtered≥1 + dropped≥1 同刻）', (s5.count ?? 0) >= 2 && (s5.filteredBroadcasts ?? 0) >= 1 && (s5.droppedBroadcasts ?? 0) >= 1, JSON.stringify({ c: s5.count, f: s5.filteredBroadcasts, d: s5.droppedBroadcasts }));

finish();
function finish() {
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
  try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
  console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
  process.exit(fail > 0 ? 1 : 0);
}
