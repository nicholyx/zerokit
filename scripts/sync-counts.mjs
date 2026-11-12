#!/usr/bin/env node
// 第二百二十三轮①②：断言计数自动同步——从 test-all 实际跑出的数字
// 自动写 overview.md / START-HERE.md 两处基线行。根治「改了 A 漏改 B」
// 连续三轮同款事故（220/221/222 轮）。
//
// 用法：
//   node scripts/sync-counts.mjs           跑全量测试并同步两处数字
//   node scripts/sync-counts.mjs --from-last-run   只同步（要求 guard146 之前刚跑过全量）
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

console.error('跑全量测试收集真实计数（约 3–5 分钟）…');
let out;
try {
  out = execFileSync('node', ['scripts/test-all.mjs'], {
    encoding: 'utf8', timeout: 20 * 60 * 1000, cwd: ROOT, maxBuffer: 64 * 1024 * 1024,
  });
} catch (e) {
  // 非零退出也要解析计数（--force 场景：guard146 红导致 test-all 尾部有失败——但数字仍真实）
  out = (e.stdout || '') + '\n' + (e.stderr || '');
  console.error('（test-all 非零退出——仍按实际输出解析计数）');
}
const m = out.match(/(\d+) 个测试文件，断言通过 (\d+) \/ (\d+)/);
if (!m) {
  console.error('FAIL  test-all 输出里找不到「N 个测试文件，断言通过 N / N」行——测试可能没全绿，先修测试');
  const failLines = out.split('\n').filter((l) => l.includes('FAIL')).slice(0, 5);
  for (const l of failLines) console.error('  ' + l.trim());
  process.exit(1);
}
const files = m[1];
const asserts = m[2];
const total = m[3];
const force = process.argv.includes('--force');
if (asserts !== total && !force) {
  console.error(`FAIL  测试有失败（${asserts}/${total}）——先修测试再同步计数（--force 跳过此检查）`);
  process.exit(1);
}
if (force) console.log(`--force：按实际跑出的 ${asserts}/${total} 同步（含 ${total - asserts} 个失败）`);

const ovPath = path.join(ROOT, 'docs', 'reference', 'overview.md');
const stPath = path.join(ROOT, 'START-HERE.md');
let ov = readFileSync(ovPath, 'utf8');
let st = readFileSync(stPath, 'utf8');

const ovRe = /(\d+) 个文件、\*\*\d+ 项断言\*\*，一条命令跑完/;
const stRe = /(\d+) 个文件，(\d+) 项断言，不联网、不花钱/;
if (!ovRe.test(ov)) { console.error('FAIL  overview.md 找不到基线行'); process.exit(1); }
if (!stRe.test(st)) { console.error('FAIL  START-HERE.md 找不到基线行'); process.exit(1); }

const ovBefore = ov.match(ovRe)[0];
const stBefore = st.match(stRe)[0];
ov = ov.replace(ovRe, `${files} 个文件、**${asserts} 项断言**，一条命令跑完`);
st = st.replace(stRe, `${files} 个文件，${asserts} 项断言，不联网、不花钱`);
writeFileSync(ovPath, ov);
writeFileSync(stPath, st);

console.log(`✓ 已同步（${files} 文件 / ${asserts} 断言）`);
// 第二百七十一轮③④：断言基线同步——常规只升不降；降基线必须 --force 显式确认
{
  const blPath = path.join(ROOT, 'scripts', 'assertion-baseline.json');
  try {
    const bl = JSON.parse(readFileSync(blPath, 'utf8'));
    if (asserts > (bl.assertions ?? 0)) {
      bl.assertions = Number(asserts); bl.files = Number(files); bl.updatedAt = new Date().toISOString().slice(0, 10);
      writeFileSync(blPath, JSON.stringify(bl, null, 2) + '\n');
      console.log(`  基线抬升：${asserts}（assertion-baseline.json）`);
    } else if (asserts < (bl.assertions ?? 0) && process.argv.includes('--force')) {
      bl.assertions = Number(asserts); bl.files = Number(files); bl.updatedAt = new Date().toISOString().slice(0, 10);
      writeFileSync(blPath, JSON.stringify(bl, null, 2) + '\n');
      console.log(`  基线下调（--force 显式确认）：${asserts}`);
    } else if (asserts < (bl.assertions ?? 0)) {
      console.log(`  ⚠ 基线保持 ${bl.assertions}（计数下降不自动同步——删测试须 --force 显式降基线）`);
    }
  } catch { /* 无基线文件 = 老仓库兼容，不阻断 */ }
}
console.log(`  overview:  ${ovBefore} → ${files} 个文件、${asserts} 项断言`);
console.log(`  START-HERE: ${stBefore} → ${files} 个文件，${asserts} 项断言`);
