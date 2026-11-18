// 第三百零三轮：web 严格度巡检——getter 误用可被抓 / 全量 0 处 / cdp 回归
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- webstrict303 ${d}`); } };
console.log('webstrict303-smoke');

// ① 巡检脚本自身：注入 getter 误用应非零退出
const script = path.join(ROOT, 'scripts', 'web-strict-check.mjs');
const tmpd = fs.mkdtempSync(path.join(os.tmpdir(), 'ws303-'));
const fakedir = path.join(tmpd, 'web');
fs.mkdirSync(fakedir);
const real = fs.readFileSync(script, 'utf8');
// 用注入样本替换扫描根（临时脚本副本）
const injected = real.replace("readdirSync(path.join(ROOT, 'web'))", `readdirSync(${JSON.stringify(fakedir)})`);
fs.writeFileSync(path.join(fakedir, 'bad.js'), "state().get('k') = 1;\n");
const tmpScript = path.join(tmpd, 'check.mjs');
fs.writeFileSync(tmpScript, injected);
let caught = false;
try { execFileSync(process.execPath, [tmpScript], { stdio: 'pipe', timeout: 30000 }); } catch { caught = true; }
check('① getter 误用注入被巡检抓住（exit≠0）', caught, '');

// ② 全量当前 0 处（真仓库跑）
let allClean = true;
try { execFileSync(process.execPath, [script], { stdio: 'pipe', timeout: 60000 }); } catch { allClean = false; }
check('② web/*.js 当前 0 处 getter 误用', allClean, '');

// ③ 299 修复保持（logs.js 无 .get(k) = 残留）
const logs = fs.readFileSync(path.join(ROOT, 'web', 'logs.js'), 'utf8');
check('③ logs.js 无 .get(...) = 残留（299 修复保持）', !/\.\s*get\s*\([^)]*\)\s*=(?![=>])/.test(logs), '');

// ④ cdp-smoke 异常捕获带 URL（299 升级保持）
const cdp = fs.readFileSync(path.join(ROOT, 'test', 'cdp-smoke.mjs'), 'utf8');
check('④ cdp-smoke 异常捕获带 URL/堆栈首帧', cdp.includes('url') && cdp.includes('callFrames'), '');

// ⑤ lint.sh 挂载巡检线
const lint = fs.readFileSync(path.join(ROOT, 'scripts', 'lint.sh'), 'utf8');
check('⑤ lint.sh 挂 web-strict-check 线', lint.includes('web-strict-check'), '');

try { fs.rmSync(tmpd, { recursive: true, force: true }); } catch { /* */ }
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
