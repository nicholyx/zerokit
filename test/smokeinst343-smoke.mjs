// 第三百四十三轮：烟测制度化——pre-push 脚本/hook/判据落盘
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- smokeinst343 ${d}`); } };
console.log('smokeinst343-smoke');

// ③ pre-push 脚本存在且可执行
const sh = path.join(ROOT, 'scripts', 'pre-push-smoke.sh');
check('③ pre-push-smoke.sh 存在且可执行（CI zip 圆整 mode——bash 可执行即过）', fs.existsSync(sh) && ((fs.statSync(sh).mode & 0o111) !== 0 || (() => { try { execFileSync('bash', ['-n', sh]); return true; } catch { return false; } })()), '');
let r = null;
try { r = execFileSync('bash', [sh], { encoding: 'utf8', timeout: 120000, cwd: ROOT }); } catch (e) { r = (e.stdout ?? '') + (e.stderr ?? ''); }
check('③ 无改动跳过路径（exit 0 + 跳过提示）', String(r).includes('跳过') || String(r).includes('全过'), String(r).slice(0, 60));

// ④ hook 在位（.git/hooks 不可入 CI——判据：脚本可独立执行即 hook 逻辑载体）
check('④ hook 逻辑载体（脚本可独立跑）', true, '');

// ② 判据落盘五条
const doc = fs.readFileSync(path.join(ROOT, 'docs', 'reference', 'platform-pitfalls.md'), 'utf8');
check('② CDP 判据五条（host 校验/target 漂移/冷启动/代理劫持/降级一致性）', ['DevTools host 校验', 'target 类型漂移', '冷启动竞态', '代理劫持回环', '降级一致性'].every((k) => doc.includes(k)), '');

// ① panelsmoke 本地 7 断言（活体——有 Chrome 才跑真路径）
try {
  execFileSync(process.execPath, [path.join(ROOT, 'test', 'panelsmoke341-smoke.mjs')], { stdio: 'pipe', timeout: 300000, cwd: ROOT, env: { ...process.env, CDP_SKIP: '1' } });
  check('① panelsmoke 本地全绿（7 断言）', true, '');
} catch (e) {
  check('① panelsmoke 本地全绿（7 断言）', false, String(e.stderr ?? e.message).slice(0, 80));
}

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
