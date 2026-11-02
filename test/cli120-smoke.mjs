// cli120-smoke：第一百二十轮——CLI 反馈与执行细节
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- cli120`); } };
const home = mkdtempSync(path.join(tmpdir(), 'c120-'));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home } });
console.log(`cli120-smoke（${home}）`);
run(['plugin', 'bundled']);

// faildemo 插件（boom-read 只读失败 / boom-mutate 非只读失败）
const fd = path.join(home, 'pkgs', 'faildemo');
mkdirSync(fd, { recursive: true });
writeFileSync(path.join(fd, 'plugin.toml'), `[plugin]
id = "faildemo"
name = "faildemo"
version = "1.0.0"

[[action]]
id = "boom-read"
title = "boom read"
description = "always exit 1"
risk = "read"
run = ["node", "-e", "process.exit(1)"]

[[action]]
id = "boom-mutate"
title = "boom mutate"
description = "always exit 1"
risk = "mutate"
run = ["node", "-e", "process.exit(1)"]
`);
run(['plugin', 'add', fd]);

// ① --retry：只读失败重试 N 次后仍失败，输出重试轨迹
{
  const r = run(['run', 'faildemo', 'boom-read', '--retry', '2']);
  const all = r.stdout + r.stderr;
  check('① 只读失败重试轨迹（第 1 次失败）', all.includes('第 1 次') || all.includes('重试'));
  check('① 最终失败退出码 1', r.status === 1);
}
// ① 非只读拒绝 --retry（非交互先被 --yes 门拦，加 --yes 后到 --retry 拒绝）
{
  const r = run(['run', 'faildemo', 'boom-mutate', '--retry', '2', '--yes']);
  const all = r.stdout + r.stderr;
  check('① 非只读拒绝 --retry', all.includes('--retry 只用于只读动作'));
}
// ① 钳制：--retry 99 不炸（当 5 处理）
{
  const r = run(['run', 'faildemo', 'boom-read', '--retry', '99', '--quiet']);
  check('① retry 钳制不炸（退出码仍 1）', r.status === 1);
}

// ② --avg：连跑多次报 min/avg/max
{
  const r = run(['run', 'sysinfo', 'overview', '--avg', '3', '--quiet']);
  check('② 连跑汇总 min/avg/max', /min \d+ms · avg \d+ms · max \d+ms/.test(r.stdout));
}

// ④ follow --json：流式 JSONL（无信封），跟读段每行一个对象
{
  const script = `const {spawn}=require('node:child_process');
const p=spawn(process.execPath,[${JSON.stringify(CLI)},'audit','--follow','--json'],{env:process.env,stdio:['pipe','pipe','inherit']});
let out='';p.stdout.on('data',d=>out+=d);
setTimeout(()=>{spawn(process.execPath,[${JSON.stringify(CLI)},'run','quick','b64','--text','x'],{env:process.env});},800);
setTimeout(()=>{const ls=out.split('\\n').filter(l=>l.startsWith('{')&&l.includes('"action"'));
const ok=ls.some(l=>{try{return JSON.parse(l).plugin==='quick'}catch{return false}});
console.log('STREAM:'+ok+' LINES:'+ls.length);p.kill();process.exit(0);},6500);`;
  writeFileSync(path.join(home, 'follow.cjs'), script);
  const r = spawnSync(process.execPath, [path.join(home, 'follow.cjs')], { encoding: 'utf8', timeout: 30000, env: { ...process.env, ZEROKIT_HOME: home } });
  check('④ follow --json 流式行', (r.stdout ?? '').includes('STREAM:true'));
}

// ⑤ timers run <id> 既有（负例：不存在的 id 报错）
{
  const r = run(['timers', 'run', 'nope.nope']);
  check('⑤ timers run 负例报错', r.status !== 0 || (r.stdout + r.stderr).includes('没有') || (r.stdout + r.stderr).includes('不'));
}

// ⑥ stats --action 单动作统计（断言宽松匹配：冒号分隔可能全角/半角）
{
  run(['run', 'quick', 'b64', '--text', 'a']); run(['run', 'quick', 'b64', '--text', 'b']);
  const r = run(['stats', '--action', 'quick.b64']);
  const all = r.stdout;
  check('⑥ 单动作次数与成功率', /quick\.b64[：:]\s*[1-9]\d*\s*次/.test(all) && all.includes('100%'));
  check('⑥ p50/p95/max', all.includes('p50') && all.includes('p95') && (all.includes('max') || all.includes('最慢')));
}

// ⑦ audit --export csv：表头+行+字段序
{
  const r = run(['audit', '--export', 'csv', '--last', '3']);
  const lines = r.stdout.trimEnd().split('\n');
  check('⑦ CSV 表头', lines[0] === 'ts,decision,caller,plugin,action,ms,error');
  check('⑦ CSV 行数=3+表头', lines.length === 4);
  check('⑦ CSV 引号转义（error 含逗号安全）', lines.slice(1).every((l) => l.split(',').length === 7 || l.includes('"')));
}
// ⑦ 只支持 csv
{
  const r = run(['audit', '--export', 'xlsx']);
  check('⑦ 非_csv 拒绝', (r.stdout + r.stderr).includes('只支持'));
}

// ⑧ market doctor：两种状态都算验收（有源→探活 ✓；无源→明确指引）
{
  const r = run(['market', 'doctor']);
  const all = r.stdout + r.stderr;
  check('⑧ 市场源探活或空源指引', all.includes('✓') || all.includes('个插件') || all.includes('没有可体检的'));
}

// ③ doctor --fix --yes 既有（第三十三轮）——核实存在
{
  const r = run(['doctor', '--fix', '--yes', '--json']);
  const j = (() => { try { return JSON.parse(r.stdout); } catch { return null; } })();
  check('③ doctor --fix --yes 既有', j != null && typeof j.ok === 'boolean');
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
