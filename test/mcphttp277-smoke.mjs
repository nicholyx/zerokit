// 第二百七十七轮：MCP 远程化正式接入——CLI flag/鉴权/会话/报告标注
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- mcphttp277 ${d}`); } };
console.log('mcphttp277-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mh277-'));
const env = { ...process.env, ZEROKIT_HOME: home, ZEROKIT_TOKEN: 't'.repeat(48) };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env: { ...process.env, ZEROKIT_HOME: home }, encoding: 'utf8', timeout: 120000 });

// ①②⑤ 源码结构断言：serve 拆分 + serveHttp + 默认 127.0.0.1
const src = fs.readFileSync(path.join(ROOT, 'src', 'mcp.ts'), 'utf8');
check('① serve 拆分（buildMcpServer 独立构造）', src.includes('function buildMcpServer(): Server'), '');
check('②⑤ serveHttp（streamable-http + 默认 127.0.0.1 + GET 405）', src.includes('export async function serveHttp(port = 31800, host = \'127.0.0.1\')') && src.includes('writeHead(405)'), '');

// ③④ 活体端到端：起 server → 错 token 401 → initialize → 复用会话 tools/list
const child = spawn(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'mcp', 'serve', '--http', '39811'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let started = false;
child.stderr.on('data', (d) => { if (String(d).includes('已启动')) started = true; });
for (let i = 0; i < 40 && !started; i++) await new Promise((r) => setTimeout(r, 250));
const BASE = 'http://127.0.0.1:39811/mcp';
const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-zerokit-token': env.ZEROKIT_TOKEN };
if (started) {
  const bad = await fetch(BASE, { method: 'POST', headers: { ...H, 'x-zerokit-token': 'x' }, body: '{}' });
  check('④ 错 token 401', bad.status === 401, String(bad.status));
  const init = await fetch(BASE, { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } }) });
  const sid = init.headers.get('mcp-session-id');
  check('③ initialize 200 拿 session-id', init.status === 200 && !!sid, `${init.status} sid=${sid}`);
  if (sid) {
    await fetch(BASE, { method: 'POST', headers: { ...H, 'mcp-session-id': sid }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    const tools = await fetch(BASE, { method: 'POST', headers: { ...H, 'mcp-session-id': sid }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) });
    const t = await tools.text();
    check('③ 会话复用 tools/list（含 zerokit_welcome）', tools.status === 200 && t.includes('zerokit_welcome'), `${tools.status}`);
  }
} else {
  check('server 启动', false, '60s 内未见启动横幅');
}
child.kill();

// ⑧ spike 报告「已落地」标注
const report = fs.readFileSync(path.join(ROOT, 'docs', 'debt', 'mcp-remote-spike.md'), 'utf8');
check('⑧ spike 报告已落地标注', report.includes('已落地（277 轮：zkit mcp serve --http）'), '');

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY 容错 */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
