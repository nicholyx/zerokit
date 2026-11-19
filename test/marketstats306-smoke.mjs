// 第三百零六轮：市场安装计数——计数/幂等/排序/卸载不减/端点
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- marketstats306 ${d}`); } };
console.log('marketstats306-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ms306-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (a) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });

// 本仓库当集市
run(['market', 'add', ROOT]);

// ⑥ 装两次（同版幂等）
run(['plugin', 'install', 'demochain', '--yes']);
run(['plugin', 'remove', 'demochain']);
run(['plugin', 'install', 'demochain', '--yes']);
const stats = JSON.parse(fs.readFileSync(path.join(home, 'market-stats.json'), 'utf8'));
check('⑥② 同版装两次 installs=1（幂等）', stats.demochain?.installs === 1, JSON.stringify(stats.demochain));

// ⑤ 卸载不减
run(['plugin', 'remove', 'demochain']);
const stats2 = JSON.parse(fs.readFileSync(path.join(home, 'market-stats.json'), 'utf8'));
check('⑤ 卸载不减（历史累积）', stats2.demochain?.installs === 1, JSON.stringify(stats2.demochain));

// ③ 排序视图
const r = run(['market', 'list', '--by-installs']);
check('③ --by-installs 热度视图（demochain 1 次）', r.status === 0 && (r.stdout + '').includes('1 次') && (r.stdout + '').includes('demochain'), (r.stdout + r.stderr).slice(0, 80));

// ④ 端点存在（openapi 白名单）
const server = fs.readFileSync(path.join(ROOT, 'src', 'server.ts'), 'utf8');
check('④ GET /api/market-stats 端点（白名单+handler）', server.includes("'/api/market-stats': ['GET']") && server.includes('/api/market-stats'), '');
const ui = fs.readFileSync(path.join(ROOT, 'web', 'market.js'), 'utf8');
check('④ UI 热度徽标（api/market-stats + hotFor）', ui.includes('/api/market-stats') && ui.includes('hotFor'), '');

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
