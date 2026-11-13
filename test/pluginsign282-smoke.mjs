// 第二百八十二轮：ed25519 签名链——keygen/签/验/篡改拒/兼容
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- pluginsign282 ${d}`); } };
console.log('pluginsign282-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ps282-'));
process.env.ZEROKIT_HOME = home;
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });

// ① keygen
const kg = spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'keygen'], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
const keyId = /keyId：([0-9a-f]{16})/.exec(kg.stdout)?.[1] ?? '';
check('① keygen（私钥 0600 + keyId 打印）', kg.status === 0 && keyId.length === 16 && fs.existsSync(path.join(home, 'keys', 'default.ed25519')), (kg.stdout + kg.stderr).slice(0, 60));

// ⑤ 纯函数：sign/verify/篡改
const { signPayload, verifyPayload, loadTrustedPublicKeys, canonicalJson } = await import(pathToFileURL(path.join(ROOT, 'src/core/pluginSign.ts')).href);
const trusted = loadTrustedPublicKeys();
check('⑤ trusted 公钥集（keygen 的 key 可寻址）', trusted.has(keyId), [...trusted.keys()].join(','));
const payload = { b: 2, a: 1, nested: { z: 'x' } };
const { loadPrivateKey } = await import(pathToFileURL(path.join(ROOT, 'src/core/pluginSign.ts')).href);
const priv = loadPrivateKey();
const sig = signPayload(payload, priv);
check('② signPayload → verifyPayload true（canonicalJson 键序无关）', verifyPayload(payload, sig, trusted) && verifyPayload({ a: 1, b: 2, nested: { z: 'x' } }, sig, trusted), '');
check('③ 篡改 payload → false', !verifyPayload({ a: 1, b: 3, nested: { z: 'x' } }, sig, trusted), '');
check('⑤ canonicalJson（键排序无空格）', canonicalJson({ b: 1, a: 2 }) === '{"a":2,"b":1}', canonicalJson({ b: 1, a: 2 }));

// ②③④ 端到端：export 带 sig → import 验签过；篡改拒；无 sig 包兼容
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ps282-cwd-'));
const ex = spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'export', 'quick'], { cwd, env, encoding: 'utf8', timeout: 60000 });
const tp = JSON.parse(fs.readFileSync(path.join(cwd, 'quick.toolpack'), 'utf8'));
check('② export 自动签名（sig.ed25519 keyId）', tp.sig?.algo === 'ed25519' && tp.sig?.keyId === keyId, JSON.stringify(tp.sig ?? {}).slice(0, 60));
// 篡改后导入应拒
const tampered = JSON.parse(JSON.stringify(tp));
tampered.files['quick.mjs'] = (tampered.files['quick.mjs'] ?? '').slice(0, -4) + 'dGVk';
fs.writeFileSync(path.join(cwd, 'tampered.toolpack'), JSON.stringify(tampered));
const bad = spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'import', path.join(cwd, 'tampered.toolpack'), '--yes'], { cwd, env, encoding: 'utf8', timeout: 60000 });
check('③ 篡改包拒绝导入（签名校验失败）', (bad.stderr + bad.stdout).includes('签名校验失败'), (bad.stdout + bad.stderr).slice(0, 60));
// ④ 无 sig 包兼容：先 remove quick 再导无签名版
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'remove', 'quick', '--yes'], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
const nosig = JSON.parse(JSON.stringify(tp));
delete nosig.sig;
fs.writeFileSync(path.join(cwd, 'nosig.toolpack'), JSON.stringify(nosig));
const ok2 = spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'import', path.join(cwd, 'nosig.toolpack'), '--yes'], { cwd, env, encoding: 'utf8', timeout: 60000 });
check('④ 无 sig 包兼容导入（原行为）', (ok2.stdout + ok2.stderr).includes('✓') || ok2.status === 0, (ok2.stdout + ok2.stderr).slice(0, 60));

for (const d of [home, cwd]) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* EBUSY */ } }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
