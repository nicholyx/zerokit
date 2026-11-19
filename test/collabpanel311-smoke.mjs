// 第三百一十一轮：UI 协作面板——端点/三块/空态引导/路由
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- collabpanel311 ${d}`); } };
console.log('collabpanel311-smoke');

// ①⑤ 端点存在（白名单 + handler）
const server = fs.readFileSync(path.join(ROOT, 'src', 'server.ts'), 'utf8');
check('① GET /api/mcp-sessions（白名单 + handler + mcp-runtime.json 读）', server.includes("'/api/mcp-sessions': ['GET']") && server.includes('/api/mcp-sessions') && server.includes('mcp-runtime.json'), '');

// ① 快照写入点（mcp.ts：会话建立/断连/锁/频控）
const mcp = fs.readFileSync(path.join(ROOT, 'src', 'mcp.ts'), 'utf8');
check('① 快照写入挂钩（Inner×会话/断连/频控 + writeLocksSnapshot×加锁/释放）', (mcp.match(/writeRuntimeSnapshotInner\(\)/g) ?? []).length >= 3 && (mcp.match(/writeLocksSnapshot\(\)/g) ?? []).length >= 2, `Inner=${(mcp.match(/writeRuntimeSnapshotInner\(\)/g) ?? []).length} Locks=${(mcp.match(/writeLocksSnapshot\(\)/g) ?? []).length}`);

// ②④ 面板三块 + 三态
const collab = fs.readFileSync(path.join(ROOT, 'web', 'collab.js'), 'utf8');
check('②④ 面板三块（会话/锁/频控）+ 三态（未运行引导/错误/运行中）', ['在线会话', '持有的锁', '频控丢弃', '未运行', '读取失败', '运行中'].every((k) => collab.includes(k)), '');

// ③ 引导文案（serve --broadcast 命令）
check('③ 引导命令（zkit mcp serve --broadcast）', collab.includes('mcp serve --broadcast'), '');

// 路由挂载
const app = fs.readFileSync(path.join(ROOT, 'web', 'app.js'), 'utf8');
check('路由挂载（#/collab × applyHash + hashchange + __cb 工厂）', (app.match(/#\/collab/g) ?? []).length >= 2 && app.includes('createCollab'), '');

// 活体：ui server + 伪造快照 → 端点返回 running:true 数据
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cp311-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const PORT = String(43000 + (process.pid % 2000));
const child = spawn(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'ui', '--port', PORT], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let started = false;
child.stdout.on('data', (d) => { if (String(d).includes('已就绪')) started = true; });
for (let i = 0; i < 40 && !started; i++) await new Promise((r) => setTimeout(r, 250));
if (started) {
  // 无快照 → running:false（③ 空态数据源）
  const r1 = await fetch(`http://127.0.0.1:${PORT}/api/mcp-sessions`).then((r) => r.json());
  check('⑤ 端点空态（无快照 → running:false）', r1.running === false, JSON.stringify(r1).slice(0, 60));
  // 伪造快照 → 全量数据透传
  fs.writeFileSync(path.join(home, 'mcp-runtime.json'), JSON.stringify({ ts: new Date().toISOString(), running: true, count: 1, sessions: [{ clientId: 'bob', connectedAt: new Date().toISOString(), session: 'abcd1234', filters: [] }], locks: [{ tool: 'dataflow.append-ts', holder: 'alice', since: '12:00:00' }], droppedBroadcasts: 2, filteredBroadcasts: 1 }, null, 2));
  const r2 = await fetch(`http://127.0.0.1:${PORT}/api/mcp-sessions`).then((r) => r.json());
  check('⑤ 伪造快照透传（bob 会话 + alice 锁 + 计数）', r2.running === true && r2.sessions?.[0]?.clientId === 'bob' && r2.locks?.[0]?.holder === 'alice' && r2.droppedBroadcasts === 2, JSON.stringify(r2).slice(0, 100));
} else {
  check('ui server 启动', false, '');
}
try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
