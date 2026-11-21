// 第三百四十六轮：MCP zerokit_stats 工具——tools/list / 调用 / 错误面
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- mcpstatstool346 ${d}`); } };
console.log('mcpstatstool346-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mt346-'));
const TOKEN = 'm'.repeat(48);
const env = { ...process.env, ZEROKIT_HOME: home, ZEROKIT_TOKEN: TOKEN };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env: { ...process.env, ZEROKIT_HOME: home }, encoding: 'utf8', timeout: 120000 });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'market', 'add', ROOT], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'install', 'dataflow', '--yes'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
for (let i = 0; i < 3; i++) spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'run', 'dataflow.append-ts'], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });

const PORT = String(48100 + (process.pid % 1000));
const child = spawn(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'mcp', 'serve', '--http', PORT], { cwd: ROOT, env: { ...env, ZEROKIT_TOKEN: TOKEN }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let started = false;
child.stderr.on('data', (d) => { if (String(d).includes('已启动')) started = true; });
for (let i = 0; i < 40 && !started; i++) await new Promise((r) => setTimeout(r, 250));
if (!started) { check('server 启动', false, ''); finish(); }

const BASE = `http://localhost:${PORT}/mcp`;
const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-zerokit-token': TOKEN };
async function client(cid) {
  const r = await fetch(BASE, { method: 'POST', headers: { ...H, 'x-client-id': cid }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: cid, version: '0' } } }) });
  const sid = r.headers.get('mcp-session-id');
  await fetch(BASE, { method: 'POST', headers: { ...H, 'mcp-session-id': sid }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  return { sid };
}
const call = async (sid, id, name, args = {}) => {
  const r = await fetch(BASE, { method: 'POST', headers: { ...H, 'mcp-session-id': sid }, body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) });
  return r.text();
};

const A = await client('ai');
// ① tools/list 含 zerokit_stats
const tl = await fetch(BASE, { method: 'POST', headers: { ...H, 'mcp-session-id': A.sid }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) }).then((r) => r.text());
check('① tools/list 含 zerokit_stats', tl.includes('zerokit_stats'), '');

// ② 调用返回结构化统计
const call2 = await call(A.sid, 3, 'zerokit_stats', { file: 'ts-data', column: 'value', ops: 'min,max,avg,count' });
check('② 统计返回（rows=3 + min/max）', call2.includes('"rows":3') && call2.includes('min'), call2.slice(0, 120));

// ③ 错误面：列不存在
const call3 = await call(A.sid, 4, 'zerokit_stats', { file: 'ts-data', column: 'nope', ops: 'min' });
check('③ 列不存在错误', call3.includes('不存在') || call3.includes('nope'), call3.slice(0, 80));

// ③ 缺参数
const call4 = await call(A.sid, 5, 'zerokit_stats', { column: 'x' });
check('③ 缺 file 参数错误', call4.includes('file'), call4.slice(0, 80));

finish();
function finish() {
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
  try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
  console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
  process.exit(fail > 0 ? 1 : 0);
}
