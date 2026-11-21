// 第三百三十七轮：50 版本里程碑——四层全景/量化/路线图/快照刷新
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- v50milestone337 ${d}`); } };
console.log('v50milestone337-smoke');

const ol = fs.readFileSync(path.join(ROOT, 'docs', 'guide', 'v4-outlook.md'), 'utf8');
const seg = ol.slice(ol.indexOf('50 版本里程碑'));
check('① 四层全景表（核心 13/深化 13/信号 8/维护 15）', ['核心落地', '深化收官', '信号驱动', '维护节奏', '288-300', '301-313'].every((k) => seg.includes(k)), '');
check('③ 路线图定稿（v4.5x 维护节奏 + v5.0.0 三选一触发 + 稳态不是等待态）', seg.includes('v4.5x') && seg.includes('v5.0.0 触发条件') && seg.includes('稳态不是等待态'), '');
check('③ 判据遗产五条（299/304/324+325/331/335）', ['299 Chrome', '304 Windows', '324+325', '331 spawn', '335 追数'].every((k) => seg.includes(k)), '');
const snap = fs.readFileSync(path.join(ROOT, 'docs', 'reference', 'v4-health-snapshot.md'), 'utf8');
check('② 快照刷新（337 时点——outlook 量化节锚 149→192 / 3284→3506；快照查不变项）', ol.includes('3284→3506') && ol.includes('149→192') && snap.includes('多列+window') && snap.includes('dep-hygiene'), '');

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
