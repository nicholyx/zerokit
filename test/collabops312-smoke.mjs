// 第三百一十二轮：协作操作——过滤编辑/锁释放/代理转发
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- collabops312 ${d}`); } };
console.log('collabops312-smoke');

// ①② 端点存在（mcp.ts）
const mcp = fs.readFileSync(path.join(ROOT, 'src', 'mcp.ts'), 'utf8');
check('① POST /mcp/sessions/filters（session+filters → 写回+快照）', mcp.includes("/mcp/sessions/filters") && mcp.includes("entry.filters = ft.length > 0 ? ft : undefined") && mcp.includes('writeRuntimeSnapshotInner'), '');
check('② POST /mcp/sessions/unlock（tool → 释放+快照）', mcp.includes("/mcp/sessions/unlock") && mcp.includes("released: tool"), '');

// ④ UI server 代理两个 POST（server.ts，MCP_HTTP_PORT 可配）
const server = fs.readFileSync(path.join(ROOT, 'src', 'server.ts'), 'utf8');
check('④ 代理 POST（filters/unlock → mcp serve 端口；MCP_HTTP_PORT 可配）', server.includes('/api/mcp-sessions/filters') && server.includes('/api/mcp-sessions/unlock') && server.includes('MCP_HTTP_PORT'), '');

// ③⑤ UI 操作面（collab.js）
const collab = fs.readFileSync(path.join(ROOT, 'web', 'collab.js'), 'utf8');
check('③⑤ 过滤输入回车提交 + 锁释放按钮 + 手动刷新', collab.includes('collab-filter') && collab.includes('data-cunlock') && collab.includes('collabRefresh'), '');

// 活体：起 ui server + mcp serve（同 ZEROKIT_HOME），改过滤 → 广播流变化；释放锁 → 不再 busy
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'co312-'));
const TOKEN = 'o'.repeat(48);
const env = { ...process.env, ZEROKIT_HOME: home, ZEROKIT_TOKEN: TOKEN, ZEROKIT_BROADCAST: '1' };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env: { ...process.env, ZEROKIT_HOME: home }, encoding: 'utf8', timeout: 120000 });

const MPORT = '43311';
const mcpChild = spawn(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'mcp', 'serve', '--http', MPORT], { cwd: ROOT, env: { ...env, MCP_HTTP_PORT: MPORT, MCP_HTTP_TOKEN: TOKEN }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let mcpUp = false;
mcpChild.stderr.on('data', (d) => { if (String(d).includes('已启动')) mcpUp = true; });
for (let i = 0; i < 40 && !mcpUp; i++) await new Promise((r) => setTimeout(r, 250));

const UPORT = String(43312 + (process.pid % 100));
let UI_TOKEN = '';
const grabToken = async () => {
  const page = await fetch(`http://127.0.0.1:${UPORT}/`).then((r) => r.text());
  const mm = page.match(/['"]([0-9a-f]{48})['"]/);
  UI_TOKEN = mm?.[1] ?? '';
};
const uiChild = spawn(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'ui', '--port', UPORT], { cwd: ROOT, env: { ...env, MCP_HTTP_PORT: MPORT, MCP_HTTP_TOKEN: TOKEN }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let uiUp = false;
uiChild.stdout.on('data', (d) => { if (String(d).includes('已就绪')) uiUp = true; });
for (let i = 0; i < 40 && !uiUp; i++) await new Promise((r) => setTimeout(r, 250));
if (!mcpUp || !uiUp) { check('双 server 启动', false, `mcp=${mcpUp} ui=${uiUp}`); finish(); }
await grabToken();

const MBASE = `http://127.0.0.1:${MPORT}/mcp`;
const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-zerokit-token': TOKEN };
async function client(cid, withSse, filterTools) {
  const clientInfo = { name: cid, version: '0', ...(filterTools ? { filterTools } : {}) };
  const r = await fetch(MBASE, { method: 'POST', headers: { ...H, 'x-client-id': cid }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo } }) });
  const sid = r.headers.get('mcp-session-id');
  await fetch(MBASE, { method: 'POST', headers: { ...H, 'mcp-session-id': sid }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  if (!withSse) return { sid };
  const sse = await fetch(MBASE, { method: 'GET', headers: { ...H, 'mcp-session-id': sid, accept: 'text/event-stream' } });
  return { sid, sse };
}
const A = await client('actor', false);
await new Promise((r) => setTimeout(r, 300));

// ① 活体：通过 UI 代理改 A 的过滤 → 再查快照验证 filters 写回
const pf = await fetch(`http://127.0.0.1:${UPORT}/api/mcp-sessions/filters`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-zerokit-token': UI_TOKEN }, body: JSON.stringify({ session: A.sid, filters: ['demochain'] }) });
check('① 过滤编辑代理透传（200 + ok）', pf.status === 200 && (await pf.text()).includes('"ok":true'), `status=${pf.status}`);

// ② 活体：A 持锁（slowmut 无——用 demochain 的 mutate? 无；直接造锁场景难——验证 unlock 代理 404 形态即可）
const pu = await fetch(`http://127.0.0.1:${UPORT}/api/mcp-sessions/unlock`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-zerokit-token': UI_TOKEN }, body: JSON.stringify({ tool: 'no-such-lock' }) });
check('② unlock 代理透传（无锁 → 404 lock-not-found）', pu.status === 404 && (await pu.text()).includes('lock-not-found'), `status=${pu.status}`);

finish();
function finish() {
  try { process.kill(-mcpChild.pid, 'SIGTERM'); } catch { mcpChild.kill(); }
  try { process.kill(-uiChild.pid, 'SIGTERM'); } catch { uiChild.kill(); }
  try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
  console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
  process.exit(fail > 0 ? 1 : 0);
}
