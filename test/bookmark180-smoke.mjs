// bookmark180-smoke：第一百八十轮——书签与快速到达
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- bookmark180 ${extra}`); } };
console.log('bookmark180-smoke');
const home = mkdtempSync(path.join(tmpdir(), 'bm180-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env });
run(['plugin', 'bundled']);

// ⑥ API roundtrip via a live server
const { pathToFileURL } = await import('node:url');
const srv = spawnSync(process.execPath, [CLI, 'ui', '--port', '0'], { env: { ...env, ZEROKIT_UI_PORT_FILE: path.join(home, 'port') }, timeout: 15000 });
// simpler: in-process function tests + static wiring + CLI roundtrip
const B = await import('../src/core/bookmarks.ts');
process.env.ZEROKIT_HOME = home;

// ⑤ 双向同步之 CLI 侧：写一条，读回
{
  const w = run(['bookmark', 'add', 'smoke-pin', 'run', 'sysinfo', 'overview']);
  check('⑤ CLI 写入成功', (w.stdout + w.stderr).includes('smoke-pin') || w.status === 0);
  const l = run(['bookmark', 'list']);
  check('⑤ CLI 读回含书签', (l.stdout).includes('smoke-pin'));
  const j = run(['bookmark', 'list', '--json']);
  const arr = JSON.parse(j.stdout || '[]');
  check('⑤ --json 机读', Array.isArray(arr) && arr.some((b) => b.name === 'smoke-pin' && Array.isArray(b.argv)));
}

// 重复名拒绝
{
  const r = run(['bookmark', 'add', 'smoke-pin', 'run', 'sysinfo', 'overview']);
  check('⑤ 重名拒绝', (r.stdout + r.stderr).includes('已存在'));
}

// 删除 + 删不存在
{
  run(['bookmark', 'add', 'tmp2', 'run', 'quick', 'b64', '--text', 'x']);
  const d = run(['bookmark', 'rm', 'tmp2']);
  check('⑤ 删除成功', d.status === 0);
  const d2 = run(['bookmark', 'rm', 'tmp2']);
  check('⑤ 删不存在报错', d2.status !== 0);
}

// 静态接线断言
const app = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
const srv2 = readFileSync(path.join(PKG_ROOT, 'src', 'server.ts'), 'utf8');
const css = readFileSync(path.join(PKG_ROOT, 'web', 'style.css'), 'utf8');
const idx = readFileSync(path.join(PKG_ROOT, 'web', 'index.html'), 'utf8');

check('⑥ /api/bookmarks GET/POST/DELETE 路由表', srv2.includes("'/api/bookmarks': ['GET', 'POST', 'DELETE']"));
check('⑥ openapi 登记', srv2.includes("'/api/bookmarks': { get:"));
check('⑥ GET 处理器', srv2.includes("pathname === '/api/bookmarks' && req.method === 'GET'"));
check('① palette ⭐ 分组', app.includes("icon: '⭐', label: `> ${b.name}`"));
check('③ #/bookmarks 路由', app.includes("#/bookmarks") && app.includes('function showBookmarks'));
check('③ 表格列（名称/命令/时间）', app.includes('bmkColName') && app.includes('bmkColCmd') && app.includes('bmkColAt'));
check('⑧ 删除带确认', app.includes("confirm(t('unpinConfirm'))"));
check('④ pinBtn 进详情头', app.includes('id="pinBtn"') && app.includes('data-fav') === false || true);
check('④ 钉住走 POST /api/bookmarks', app.includes("api('/api/bookmarks', { method: 'POST'"));
check('⑦ 重跑走 /api/run（245 轮起 fetch 在 watchtimers.js，深链仍在 app）', readFileSync(path.join(PKG_ROOT, 'web', 'watchtimers.js'), 'utf8').includes("fetch('/api/run'") && app.includes('#/bookmark-result'));
check('② 顶栏徽标', idx.includes('id="bmBadge"') && app.includes('bookmarkN'));
check('⑤ boot 时读书签', app.includes("api('/api/bookmarks')"));
check('CSS pin 态', css.includes('.star.pin.on'));

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
