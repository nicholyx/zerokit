// 第二百九十五轮：watch 触发 chain——tick 钩子/徽标/表单字段/静默执行
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- watchchain295 ${d}`); } };
console.log('watchchain295-smoke');

const wt = fs.readFileSync(path.join(ROOT, 'web', 'watchtimers.js'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'web', 'app.js'), 'utf8');

// ②③ tick 钩子
check('②③ tick 钩子（w.chain && changed → runChainQuiet + lastChainRun 记录）', wt.includes('w.chain && changed') && wt.includes('runChainQuiet') && wt.includes('w.lastChainRun = { ok'), '');
// ② runChainQuiet 信封
check('② runChainQuiet（/api/run POST + token 头 + values {}）', wt.includes("async function runChainQuiet") && wt.includes("plugin: pluginId, action: actionId, values: {}"), '');
// ④ 面板徽标
check('④ 面板徽标（⛓ chain 名 + lastChainRun ✓/✗/待触发）', wt.includes('⛓') && wt.includes('待触发') && wt.includes('w.lastChainRun.ok'), '');
// ① 表单字段
check('① 配置表单 chain 字段（wChain input + reg 条目带 chain）', app.includes('id="wChain"') && app.includes('chain: chainKey'), '');
// ③ 持久化含 lastChainRun（persistWatch 全量序列化条目——源码层面确认 reg 直写即持久化）
check('③ chain/lastChainRun 随 persistWatch 落盘（字段序列化）', wt.includes('{ chain: w.chain }') && wt.includes('{ lastChainRun: w.lastChainRun }'), '');

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
