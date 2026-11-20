// 第三百三十四轮：stats --trend 周环比——分窗/箭头/新标/开关
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- trendstats334 ${d}`); } };
console.log('trendstats334-smoke');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ts334-'));
const env = { ...process.env, ZEROKIT_HOME: home };
spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), 'plugin', 'bundled'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
const run = (a) => spawnSync(process.execPath, [path.join(ROOT, 'src/cli.ts'), ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });

// 造数据：gen×3（本周）
for (let i = 0; i < 3; i++) run(['run', 'demochain.gen']);

// ①②③ 活体：--trend 输出分窗行 + 「新」标记
const r1 = run(['stats', '--trend']);
const out1 = r1.stdout + '';
check('①②③ 分窗输出 + 新标记（本周×3 上周×0 新）', r1.status === 0 && out1.includes('周环比') && out1.includes('本周×3') && out1.includes('上周×0') && out1.includes('新'), out1.split('\n').filter((l) => l.includes('周环比') || l.includes('demochain')).slice(0, 3).join(' | ').slice(0, 120));

// ④ 默认关（无 --trend 不出趋势节）
const r2 = run(['stats']);
check('④ 默认无 --trend 不出趋势节', r2.status === 0 && !(r2.stdout + '').includes('周环比'), '');

// 双周注：时间窗逻辑（7d 内 / 前 7d）在源码断言固化
const src = fs.readFileSync(path.join(ROOT, 'src', 'cli.ts'), 'utf8');
check('① 分窗逻辑（7d 内 / 7-14d）', src.includes('< 7 * 86400000') && src.includes('< 14 * 86400000'), '');

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
