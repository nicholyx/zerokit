// 第二百八十三轮：发布通道——publish-check / publish-ready 指引 / 签名提示
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- publish283 ${d}`); } };
console.log('publish283-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pb283-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });

// ④⑤ publish-check：脚手架插件目录干跑
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'new', 'pb283', '--dir', path.join(home, 'work')], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
const pc = spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'publish-check', path.join(home, 'work', 'pb283')], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
check('④⑤ publish-check（清单/risk/版本 ✓ + 签名 warn + 汇总行）', pc.status === 0 && (pc.stdout + '').includes('清单可加载') && (pc.stdout + '').includes('签名密钥') && (pc.stdout + '').includes('可发布'), (pc.stdout + pc.stderr).slice(0, 80));

// ②③ publish-ready 通道指引（装后）
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'add', path.join(home, 'work', 'pb283')], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
const pr = spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'publish-ready', 'pb283'], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
const out = pr.stdout + '';
check('②③ 通道指引（keygen 提示 + market index + export + market add 收尾）', out.includes('zkit keygen') && out.includes('zkit market index') && out.includes('zkit plugin export') && out.includes('market add'), out.slice(0, 100));

// 有密钥时提示 ✓
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'keygen'], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
const pr2 = spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'publish-ready', 'pb283'], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
check('③ 有密钥 → ✓ 已有签名密钥', (pr2.stdout + '').includes('已有签名密钥'), (pr2.stdout + '').slice(0, 60));

try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
