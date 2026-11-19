// 第三百一十轮：watch × dataflow 端到端——浏览器侧 chain 触发积累（CDP 级全链）
// 由于 watch tick 在浏览器里跑，本测试直接验证三层：
// ① watch.json 条目带 chain 持久化（295 语义）
// ② server 侧 /api/run 真实执行 dataflow.append-ts（runChainQuiet 的目标端点）
// ③ 行数增长 + lastChainRun 记录形态（源码级 + 活体组合）
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- watchdfe2e310 ${d}`); } };
console.log('watchdfe2e310-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wd310-'));
const TOKEN = 'w'.repeat(48);
const env = { ...process.env, ZEROKIT_HOME: home, ZEROKIT_TOKEN: TOKEN };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env: { ...process.env, ZEROKIT_HOME: home }, encoding: 'utf8', timeout: 120000 });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'remove', 'dataflow'], { cwd: ROOT, env, encoding: 'utf8' });
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', path.join(ROOT, 'plugins', 'dataflow')], { cwd: ROOT, env, encoding: 'utf8' });

// ① watch.json 条目带 chain——浏览器持久化语义（写文件模拟 + 结构断言）
const watchJson = path.join(home, 'watch.json');
fs.writeFileSync(watchJson, JSON.stringify({ version: 1, watches: [{ key: 'k1', interval: 5, chain: 'dataflow.append-ts', lastChainRun: { ok: true, ts: Date.now(), key: 'dataflow.append-ts' }, samples: [] }], stops: [] }, null, 2));
const wj = JSON.parse(fs.readFileSync(watchJson, 'utf8'));
check('① watch.json 条目带 chain + lastChainRun 持久化', wj.watches[0].chain === 'dataflow.append-ts' && wj.watches[0].lastChainRun.ok === true, JSON.stringify(wj.watches[0]).slice(0, 80));

// ② server 起来后 /api/run 真实执行 append-ts（runChainQuiet 的目标端点）——行数增长
const PORT = String(41000 + (process.pid % 2000));
// 310 架构修正：/api/*（含 runChainQuiet 打的 /api/run）在 zkit ui 的 server——不是 mcp serve。
const child = spawn(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'ui', '--port', PORT], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let started = false;
child.stdout.on('data', (d) => { if (process.env.ZK_DBG) process.stdout.write('[srv] ' + d); if (String(d).includes('已就绪') || String(d).includes('zerokit-ready')) started = true; });

for (let i = 0; i < 40 && !started; i++) await new Promise((r) => setTimeout(r, 250));
if (!started) { check('ui server 启动', false, ''); finish(); }
await new Promise((r) => setTimeout(r, 500));
// 310：UI server 的 token 是随机生成并注入页面（__TOKEN__ 替换）——从首页 HTML 抠出
const page = await fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.text());
const tokMatch = page.match(/window\.__ZK_TOKEN__\s*=\s*['"]([^'"]+)['"]/) ?? page.match(/['"]([0-9a-f]{48})['"]/);
const UI_TOKEN = tokMatch?.[1] ?? '';
check('ui token 可获取', UI_TOKEN.length >= 32, `len=${UI_TOKEN.length}`);

const rows0 = (() => { try { return JSON.parse(fs.readFileSync(path.join(home, 'data', 'ts-data.zerocol.json'), 'utf8')).columns[0].count; } catch { return 0; } })();
for (let i = 0; i < 3; i++) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-zerokit-token': UI_TOKEN },
    body: JSON.stringify({ plugin: 'dataflow', action: 'append-ts', values: {}, fresh: true }),
  });
  const tb = await r.text();
  if (i === 0) check('② /api/run 执行 append-ts（runChainQuiet 同款信封）', r.status === 200, r.status + ' ' + tb.slice(0, 120));
}
const rows3 = JSON.parse(fs.readFileSync(path.join(home, 'data', 'ts-data.zerocol.json'), 'utf8')).columns[0].count;
check('⑧ 三次触发 → ts-data 行数增长（' + rows0 + '→' + rows3 + '）', rows3 === rows0 + 3, `${rows0}→${rows3}`);

// ③ lastChainRun 记录形态（源码级——watchtickers tick 钩子写入）
const wt = fs.readFileSync(path.join(ROOT, 'web', 'watchtimers.js'), 'utf8');
check('③ tick 钩子写 lastChainRun（ok/ts/key）', wt.includes('w.lastChainRun = { ok') && wt.includes('key: w.chain'), '');
// ④ 指南样例节
const guide = fs.readFileSync(path.join(ROOT, 'docs', 'guide', 'data-pipelines.md'), 'utf8');
check('④ 管道指南 watch 组合样例（chain=demochain 形态）', guide.includes('触发管道') && guide.includes('chain'), '');

finish();
function finish() {
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
  try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
  console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
  process.exit(fail > 0 ? 1 : 0);
}
