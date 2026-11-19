// 第三百二十四轮：安装计数读侧——doctor 信号/热度徽标独立/排序入口
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- signalread324 ${d}`); } };
console.log('signalread324-smoke');

// ①② 活体：有数据/无数据两态
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sr324-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'market', 'add', ROOT], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
const run = (a) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
run(['plugin', 'install', 'demochain', '--yes']);
const r1 = run(['doctor']);
check('② 有数据态（1 个插件有安装记录）', (r1.stdout + '').includes('1 个插件有安装记录'), (r1.stdout + '').slice(0, 60).replace(/\n/g, '|'));
// 无数据态
const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sr324b-'));
const env2 = { ...process.env, ZEROKIT_HOME: home2 };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env: env2, encoding: 'utf8', timeout: 120000 });
const r2 = spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'doctor'], { cwd: ROOT, env: env2, encoding: 'utf8', timeout: 120000 });
check('② 无数据态（暂无安装记录提示）', (r2.stdout + '').includes('暂无安装记录'), '');
check('① 无数据不算 error（doctor exit 0）', r2.status === 0, String(r2.status));
const rj = run(['doctor', '--json']);
const j = JSON.parse((rj.stdout + '').match(/\{[\s\S]*\}/)?.[0] ?? '{}');
check('① json 带 signal 字段（plugins/totalInstalls/hasData）', j.signal && j.signal.plugins === 1 && j.signal.hasData === true, JSON.stringify(j.signal));

// ③④ UI 面（源码级）
const mk = fs.readFileSync(path.join(ROOT, 'web', 'market.js'), 'utf8');
check('③ 热度徽标独立（未装也显示 🔥）', mk.includes("hotFor(e.id) ? `<span class=\"badge\"") && !mk.includes("installed ? `<span class=\"badge read\">✓ 已装${e.installedVersion ? ` v${esc(e.installedVersion)}` : ''}${hotFor"), '');
check('④ 排序入口（toggleSortByInstalls + renderEntries + mkSortBtn）', mk.includes('toggleSortByInstalls') && mk.includes('renderEntries') && mk.includes('mkSortBtn'), '');

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); fs.rmSync(home2, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
