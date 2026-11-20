// 第三百三十六轮：安装热度 30d 增量——recordInstall/兼容/透传/徽标
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- hot30d336 ${d}`); } };
console.log('hot30d336-smoke');

// ①② 活体：装两次同版 → last30d 长度 2（趋势记真实频次）+ installs=1（幂等）
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'h30d-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'market', 'add', ROOT], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
const run = (a) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
run(['plugin', 'install', 'demochain', '--yes']);
run(['plugin', 'remove', 'demochain']);
run(['plugin', 'install', 'demochain', '--yes']);
const stats = JSON.parse(fs.readFileSync(path.join(home, 'market-stats.json'), 'utf8'));
check('①② last30d 记 2 次（趋势真实频次；installs 幂等=1）', (stats.demochain?.last30d?.length ?? 0) === 2 && stats.demochain.installs === 1, JSON.stringify(stats.demochain));

// ③ 旧数据兼容（手写无 last30d 的旧形态 stats——读侧不炸）
fs.writeFileSync(path.join(home, 'market-stats.json'), JSON.stringify({ legacy: { installs: 5, lastInstallAt: '2026-01-01T00:00:00Z', lastVersion: '1.0.0' } }));
const rj = run(['doctor', '--json']);
const j = JSON.parse((rj.stdout + '').match(/\{[\s\S]*\}/)?.[0] ?? '{}');
check('③ 旧数据兼容（legacy 无 last30d → doctor 不炸 + installs=5）', j.signal?.totalInstalls === 5, JSON.stringify(j.signal));

// ④ 端点透传 last30d
const server = fs.readFileSync(path.join(ROOT, 'src', 'server.ts'), 'utf8');
check('④ /api/market-stats 透传 stats 整体（last30d 随行）', server.includes('/api/market-stats') && server.includes('readInstallStats'), '');
const ui = fs.readFileSync(path.join(ROOT, 'web', 'market.js'), 'utf8');
check('② 徽标 30d 增量（+30d ↑M + 兼容无 last30d）', ui.includes('+30d ↑') && ui.includes('last30d ?? []'), '');

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
