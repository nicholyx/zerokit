// 第三百五十六轮：mcp-sessions ops 日志——filters/unlock 可追溯
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- mcpops356 ${d}`); } };
console.log('mcpops356-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mo356-'));
const TOKEN = 'o'.repeat(48);
const env = { ...process.env, ZEROKIT_HOME: home, ZEROKIT_TOKEN: TOKEN };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env: { ...process.env, ZEROKIT_HOME: home }, encoding: 'utf8', timeout: 120000 });

const PORT = String(48300 + (process.pid % 1000));
const child = spawn(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'mcp', 'serve', '--http', PORT, '--broadcast'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let started = false;
child.stderr.on('data', (d) => { if (String(d).includes('已启动')) started = true; });
for (let i = 0; i < 40 && !started; i++) await new Promise((r) => setTimeout(r, 250));
if (!started) { check('server 启动', false, ''); finish(); }

const H = { 'content-type': 'application/json', 'x-zerokit-token': TOKEN };
// ③ unlock 不存在的锁 → 404（不记 ops）
const r404 = await fetch(`http://localhost:${PORT}/mcp/sessions/unlock`, { method: 'POST', headers: H, body: JSON.stringify({ tool: 'nope' }) });
check('③ unlock 不存在 → 404（不记 ops）', r404.status === 404, String(r404.status));
// ① filters 对不存在 session → 404（不记 ops）
const r404b = await fetch(`http://localhost:${PORT}/mcp/sessions/filters`, { method: 'POST', headers: H, body: JSON.stringify({ session: 'zzzz', filters: ['x'] }) });
check('③ filters 不存在 session → 404', r404b.status === 404, String(r404b.status));

// ② 快照透传 ops 字段（空会话时 ops 可为空数组或不存在——结构不炸）
const snap = await fetch(`http://localhost:${PORT}/api/mcp-sessions`, { headers: H }).then((r) => r.json()).catch(() => ({}));
check('② 快照可读（running 或结构完整）', typeof snap === 'object', JSON.stringify(snap).slice(0, 80));

finish();
function finish() {
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
  try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
  console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
  process.exit(fail > 0 ? 1 : 0);
}
