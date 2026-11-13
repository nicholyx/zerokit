// 第二百八十七轮：runbook 落盘断言——五步/三类事故/幂等/护栏联动全节
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- runbook287 ${d}`); } };
console.log('runbook287-smoke');

const doc = fs.readFileSync(path.join(ROOT, 'docs', 'reference', 'release-runbook.md'), 'utf8');

// ① 五步
check('① 五步齐全（feature/prep/release+tag/资产/收尾）',
  doc.includes('release-chain.sh feature') && doc.includes('release-prep.mjs') && doc.includes('release-chain.sh release') && doc.includes('assets=3'), '');

// ② 三类事故
check('② 网络类（DNS 瞬态/CDN 504/registry）', doc.includes('Temporary failure resolving') && doc.includes('NSIS') || doc.includes('504'), '');
check('② CI 类（cdp flake/断言下降/跨平台差/总览异常/rerun running）', doc.includes('cdp-smoke') && doc.includes('基线守卫') && doc.includes('恒定计数') && doc.includes('already running'), '');
check('② 发布类（draft 422/资产陈旧/30 分钟/总览 pending）', doc.includes('--draft=false') && doc.includes('422') && doc.includes('30 分钟'), '');

// ③ 幂等
check('③ 幂等重入（--failed 先确认瞬态 / draft 先于 edit / tag 删再推）', doc.includes('--failed') && doc.includes('draft=false') && doc.includes(':refs/tags/'), '');

// ④ 护栏联动
check('④ 271 基线联动（≥ 基线 / --force 显式降）', doc.includes('assertion-baseline.json') && doc.includes('--force'), '');

// ⑤ 导航
const readme = fs.readFileSync(path.join(ROOT, 'docs', 'README.md'), 'utf8');
check('⑤ docs/README 导航', readme.includes('release-runbook.md'), '');

// 通用判据
check('通用（代理 unset / 四件套）', doc.includes('unset https_proxy') && doc.includes('四件套'), '');

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
