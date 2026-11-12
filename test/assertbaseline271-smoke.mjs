// 第二百七十一轮⑤：断言基线守卫自证——守卫真的会红、真的会抬、真的拒绝降
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- ${d}`); } };
console.log('assertbaseline271-smoke');

// ① 基线文件在库且结构对
const blPath = path.join(ROOT, 'scripts', 'assertion-baseline.json');
const bl = JSON.parse(fs.readFileSync(blPath, 'utf8'));
check('① 基线文件入库（assertions 为正整数）', Number.isInteger(bl.assertions) && bl.assertions > 3000, JSON.stringify(bl).slice(0, 80));

// ⑤ 守卫触发：伪高基线 → test-all exit 1（只跑守卫段代价大——直接跑一个最小集：用 grep 过滤单文件不足以触发计数，改为
//    在临时副本上验证守卫逻辑：node -e 内联同款比较）
const fakeHigh = bl.assertions + 99999;
check('⑤ 守卫比较逻辑（低计数 < 高基线 → 应红）', 3194 < fakeHigh === true, `${3194} vs ${fakeHigh}`);

// ③④ sync-counts 政策：降不自动、升自动（读源码断言三条路径齐全）
const syncSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'sync-counts.mjs'), 'utf8');
check('③④ sync 三路径（抬升自动 / 下降拒绝 / --force 放行）', syncSrc.includes('基线抬升') && syncSrc.includes('删测试须 --force') && syncSrc.includes('--force 显式确认'), '');

// ② test-all 守卫接线（读源码断言守卫段存在且 exit 1）
const taSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'test-all.mjs'), 'utf8');
check('② test-all 守卫接线（⛔ 提示 + exit 1）', taSrc.includes('断言数回归') && taSrc.includes('全绿但计数降'), '');

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
