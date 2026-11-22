// 第三百二十三轮：v4 健康快照——指纹/分布/清单/导航
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- v4snap323 ${d}`); } };
console.log('v4snap323-smoke');

const doc = fs.readFileSync(path.join(ROOT, 'docs', 'reference', 'v4-health-snapshot.md'), 'utf8');
const bl = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'assertion-baseline.json'), 'utf8'));
check('① 指纹五项（文件/基线/4 内建步/2 组合拳/9 线）', ['205 个', 'assertion-baseline.json 为准', '4 件套', '2 条', '9 线'].every((k) => doc.includes(k)), '');
check('② 主题分布五档（130/19/16/12/11）', ['130', '19', '16', '12', '11'].every((k) => doc.includes(k)), '');
const rows = doc.split('\n').filter((l) => /^\| \d+ \| v4\.\d/.test(l));
check('③ 轮次清单 36 行（288 起航 → 323 本快照）', rows.length === 36 && rows[0].includes('288') && rows[35].includes('323'), String(rows.length));
// 基线一致：快照数字与 assertion-baseline.json 同源
check('① 基线以文件为准（快照不追精确数——防每轮 +1 死循环）', doc.includes('assertion-baseline.json 为准') && bl.assertions > 3400, `${bl.assertions}`);
const rm = fs.readFileSync(path.join(ROOT, 'docs', 'README.md'), 'utf8');
check('④ docs/README 导航', rm.includes('v4-health-snapshot'), '');

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
