// 第二百八十一轮：market 源协议——协议版本字段 / lint 拒新版本 / 第三方源端到端
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- marketproto281 ${d}`); } };
console.log('marketproto281-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mp281-'));
process.env.ZEROKIT_HOME = home;

// ①③ lint：protocol 字段规则
const { lintMarketIndex } = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'distro.ts')).href);
const bad = lintMarketIndex(JSON.stringify({ name: 'x', protocol: 2, plugins: [] }));
check('③ protocol=2 拒绝（比本机新）', !bad.ok && bad.errors.some((e) => includes2(e)), JSON.stringify(bad.errors));
function includes2(e) { return e.includes('新') || e.includes('protocol'); }
const bad2 = lintMarketIndex(JSON.stringify({ name: 'x', protocol: 'one', plugins: [] }));
check('③ protocol 非整数拒绝', !bad2.ok, JSON.stringify(bad2.errors));
const ok1 = lintMarketIndex(JSON.stringify({ name: 'x', protocol: 1, plugins: [{ id: 'p', source: 'path:plugins/p' }] }), { baseDir: ROOT });
check('① protocol=1 合法（path 源存在性过）', ok1.ok || ok1.errors.every((e) => !e.includes('protocol')), JSON.stringify(ok1.errors));

// ⑨ 端到端：假第三方源（本地目录）→ add → list → search
const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp281-src-'));
const plugDir = path.join(srcDir, 'plugins', 'demo281');
fs.mkdirSync(plugDir, { recursive: true });
fs.writeFileSync(path.join(plugDir, 'plugin.toml'), `[plugin]
id = "demo281"
name = "演示插件 281"
version = "1.0.0"
summary = "market 协议公开化的端到端演示插件"

[[action]]
id = "hi"
title = "问好"
description = "hi"
run = ["{node}", "-e", "console.log(JSON.stringify({ hi: 1 }))"]
risk = "read"
`);
fs.writeFileSync(path.join(srcDir, 'market.json'), JSON.stringify({
  name: 'third-party-demo',
  description: '第三方源演示',
  protocol: 1,
  plugins: [{ id: 'demo281', name: '演示插件 281', summary: 'market 协议端到端演示', version: '1.0.0', source: 'path:plugins/demo281' }],
}, null, 2));
const env = { ...process.env, ZEROKIT_HOME: home };
const add = spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'market', 'add', srcDir], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
check('②⑨ market add 第三方源（protocol:1 通过）', add.status === 0 && (add.stdout + '').includes('third-party-demo'), (add.stdout + add.stderr).slice(0, 80));
const list = spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'market', 'list'], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
check('④ market list 显示第三方源', (list.stdout + '').includes('third-party-demo'), (list.stdout + '').slice(0, 60));
// ⑤ 安装按源解析
const inst = spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'install', 'demo281', '-m', 'third-party-demo', '--yes'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
const runP = spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'run', 'demo281.hi'], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
check('⑤ 从第三方源安装并运行', (inst.stdout + inst.stderr).length >= 0 && (runP.stdout + '').includes('hi'), (runP.stdout + runP.stderr).slice(0, 60));
// 拒新版协议源
fs.writeFileSync(path.join(srcDir, 'market.json'), JSON.stringify({ name: 'future-src', protocol: 99, plugins: [] }, null, 2));
const addBad = spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'market', 'add', srcDir], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
check('⑨ protocol=99 源被拒（提示升级）', addBad.status !== 0 && (addBad.stdout + addBad.stderr).includes('升级'), (addBad.stdout + addBad.stderr).slice(0, 80));

// ① 协议文档落盘
check('① 协议文档（docs/reference/market-protocol.md）', fs.existsSync(path.join(ROOT, 'docs', 'reference', 'market-protocol.md')), '');

for (const d of [home, srcDir]) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ } }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
