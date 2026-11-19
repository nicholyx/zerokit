// 第三百零七轮：协作指南——五节/真实载荷/接入清单/互链
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- collabguide307 ${d}`); } };
console.log('collabguide307-smoke');

const doc = fs.readFileSync(path.join(ROOT, 'docs', 'guide', 'collaboration.md'), 'utf8');
check('① 五节（接入/载荷/过滤/频控/锁）+ 会话查询', ['接入五步', '广播载荷', '过滤订阅', '频率控制', '协作锁', '会话查询'].every((k) => doc.includes(k)), '');
check('② 真实载荷形态（tool-call/summary/_truncated/busy-locked）', ['tool-call', 'summary', '_truncated', 'busy-locked', 'holder'].every((k) => doc.includes(k)), '');
check('③ 接入清单五步（token/client-id/initialize/SSE/退避）', ['x-zerokit-token', 'x-client-id', 'initialize', 'text/event-stream', '退避重试'].every((k) => doc.includes(k)), '');
const spec = fs.readFileSync(path.join(ROOT, 'docs', 'reference', 'plugin-spec.md'), 'utf8');
const pipe = fs.readFileSync(path.join(ROOT, 'docs', 'guide', 'data-pipelines.md'), 'utf8');
const rm = fs.readFileSync(path.join(ROOT, 'docs', 'README.md'), 'utf8');
check('④⑤ 互链 + 导航（spec↔guide、pipeline、README）', spec.includes('collaboration.md') && pipe.includes('collaboration.md') && rm.includes('guide/collaboration.md'), '');

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
