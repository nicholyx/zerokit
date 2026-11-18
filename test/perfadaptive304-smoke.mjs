// 第三百零四轮：perf 阈值机器自适应——基线存在/阈值公式/豁免保留/报告信息
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- perfadaptive304 ${d}`); } };
console.log('perfadaptive304-smoke');

const src = fs.readFileSync(path.join(ROOT, 'scripts', 'perf-guard.mjs'), 'utf8');

// ① 基线采样（预热 3 + 取样 5 取中位）
check('① 机器基线采样（预热 3 + 5 取样 [2] 中位）', src.includes('i < 3') && src.includes('i < 5') && src.includes('bt.sort((a, b) => a - b)[2]'), '');
// ② 阈值公式 max(300, base*2.5)
check('② 阈值 max(300 硬线, 基线×2.5)', src.includes('Math.max(300, base * 2.5)'), '');
// ③ load 豁免保留
check('③ load>3 抢占豁免保留', src.includes('load > 3') && src.includes('抢占豁免'), '');
// ④ 报告带基线
check('④ 报告带基线/实测/阈值来源', src.includes('基线') && src.includes('自适应') && src.includes('硬线'), '');

// 活体：跑一次应全过（自适应下不误伤）——失败时打印 perf-guard 尾部输出帮助定位
let ok = true;
let tail = '';
try {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'perf-guard.mjs')], { stdio: 'pipe', timeout: 600000, encoding: 'utf8' });
  tail = out;
} catch (e) {
  ok = false;
  tail = ((e.stdout ?? '') + '\n' + (e.stderr ?? '')).slice(-500);
}
check('⑧ 活体全过（自适应下不误伤）', ok, tail.replace(/\n/g, ' | ').slice(0, 180));

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
