// 第三百一十八轮：START-HERE 三条路——路径表/实操/互链
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- startpaths318 ${d}`); } };
console.log('startpaths318-smoke');

const sh = fs.readFileSync(path.join(ROOT, 'START-HERE.md'), 'utf8');
const seg = sh.slice(sh.indexOf('六点五、跑起来之后'));
check('① 三条路表（跑动作/数据管道/协作）+ 指南直达', ['跑更多动作', '搭数据管道', '接入协作', 'data-pipelines.md', 'collaboration.md'].every((k) => seg.includes(k)), '');
check('② 每步 5 分钟实操（run demochain.pipe-export / dataflow.append-ts / mcp serve --broadcast）', seg.includes('zkit run demochain.pipe-export') && seg.includes('zkit run dataflow.append-ts') && seg.includes('zkit mcp serve --broadcast'), '');
const ov = fs.readFileSync(path.join(ROOT, 'docs', 'reference', 'overview.md'), 'utf8');
check('③ overview 首屏路径注（指 START-HERE 六点五）', ov.includes('六点五'), '');

// 实操真实性：pipe-export 与 append-ts 是真实动作（dataflow/demochain 在 market.json）
const mk = JSON.parse(fs.readFileSync(path.join(ROOT, 'market.json'), 'utf8'));
check('② 实操引用的插件都在 market（demochain + dataflow）', ['demochain', 'dataflow'].every((id) => (mk.plugins ?? []).some((e) => e.id === id)), '');

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
