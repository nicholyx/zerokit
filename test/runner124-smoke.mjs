// runner124-smoke：第一百二十四轮——执行面可观测性
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- runner124`); } };
const home = mkdtempSync(path.join(tmpdir(), 'r124-'));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home } });
console.log(`runner124-smoke（${home}）`);
run(['plugin', 'bundled']);

// ① --profile：耗时分解三段
{
  const r = run(['run', 'sysinfo', 'overview', '--profile']);
  const all = r.stdout + r.stderr;
  check('① --profile 出 spawn/首字节/总 三段', all.includes('⏱ spawn') && all.includes('首字节') && all.includes('总 '));
  const m = all.match(/⏱ spawn (\d+)ms · 首字节 (\d+)ms · 总 (\d+)ms/);
  check('① 数值单调（spawn ≤ 首字节 ≤ 总）', m ? Number(m[1]) <= Number(m[2]) && Number(m[2]) <= Number(m[3]) : false);
  check('① --profile 不进动作参数（执行成功）', r.stdout.includes('"ok"') || r.stdout.includes('{'));
}

// ① --json 也带 timing
{
  const r = run(['run', 'sysinfo', 'overview', '--json']);
  const j = JSON.parse(r.stdout);
  check('① --json 带 timing 三键', j.timing && typeof j.timing.spawnMs === 'number' && typeof j.timing.firstByteMs === 'number' && typeof j.timing.totalMs === 'number');
}

// ③ 退出码透出：造一个退出码 2 的插件动作
{
  const dir = path.join(home, 'plugins', 'exit124');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "exit124"
name = "退出码测试"
version = "0.1.0"
summary = "退出码透出"

[[action]]
id = "two"
title = "退出码 2"
description = "stdout 有内容但退出码是 2"
risk = "read"
run = ["{node}", "-e", "console.log('部分输出'); process.exit(2)"]
`);
  const r = run(['run', 'exit124', 'two']);
  const all = r.stdout + r.stderr;
  check('③ 非零退出码 exit=2 可见', all.includes('exit=2'));
  check('③ stdout 部分输出仍在', all.includes('部分输出'));

  // ② stderr 分流：stdout 与 stderr 都有内容时两段都在
  writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "exit124"
name = "退出码测试"
version = "0.1.0"
summary = "退出码透出"

[[action]]
id = "both"
title = "双流"
description = "stdout 与 stderr 都写"
risk = "read"
run = ["{node}", "-e", "console.log('正常输出'); console.error('警示输出')"]
`);
  const r2 = run(['run', 'exit124', 'both']);
  const all2 = r2.stdout + r2.stderr;
  check('② stdout 正常输出保留', all2.includes('正常输出'));
  check('② stderr 警示输出保留', all2.includes('警示输出'));
}

// ④ --measure 3 次对照表（只读）
{
  const r = run(['run', 'quick', 'b64', '--text', 'hi', '--measure', '3']);
  const all = r.stdout + r.stderr;
  check('④ --measure 表头', all.includes('measure quick.b64 ×3'));
  check('④ 三行样本+中位行', (all.match(/spawn\s+\d+ms/g) ?? []).length >= 3 && all.includes('← 中位'));
  check('④ 中位汇总行', all.includes('中位：spawn'));
}

// ④ --measure 拒绝非只读
{
  const r = run(['run', 'clipboard', 'clear', '--measure', '3', '--yes']);
  check('④ 非只读拒绝 --measure', (r.stdout + r.stderr).includes('--measure 只用于只读动作'));
}

// ⑤ 超时部分输出保留：sleep 5s 打一行后睡，timeout 1s 杀
{
  const dir = path.join(home, 'plugins', 'slow124');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "slow124"
name = "慢动作测试"
version = "0.1.0"
summary = "超时部分输出"

[[action]]
id = "partial"
title = "先输出再睡"
description = "打一行进度然后睡 5 秒"
risk = "read"
timeout = 1
run = ["{node}", "-e", "console.log('跑了 0.1 秒的进度'); setTimeout(()=>{}, 5000)"]
`);
  const r = run(['run', 'slow124', 'partial']);
  const all = r.stdout + r.stderr;
  check('⑤ 超时被杀', all.includes('超时'));
  check('⑤ 被杀前部分输出保留', all.includes('跑了 0.1 秒的进度'));
  // partial === stdout（runner 把已收到的 stdout 原样保留并标 partial），
  // CLI 已打印 stdout 本体，标注行只在 stdout 未走打印路径时补示——这里验 --json 面
  const rj = run(['run', 'slow124', 'partial', '--json']);
  const jj = JSON.parse(rj.stdout);
  check('⑤ --json 带 partial 字段（已收输出不丢）', typeof jj.partial === 'string' && jj.partial.includes('跑了 0.1 秒的进度'));
}

// ⑥ 审计带 stderrHead：失败动作进 audit.log 后读回
{
  const { readFileSync } = await import('node:fs');
  const log = readFileSync(path.join(home, 'logs', 'audit.log'), 'utf8');
  const lines = log.trim().split('\n').map((l) => JSON.parse(l));
  const withErr = lines.find((x) => x.plugin === 'exit124' && x.stderrHead);
  check('⑥ 审计带 stderrHead', Boolean(withErr));
}

// ⑦ --dry 别名
{
  const r = run(['mcp', '--dry', 'quick.b64', '--params', '{"text":"x"}']);
  const all = r.stdout + r.stderr;
  check('⑦ mcp --dry 别名等价 dry-run', all.includes('"risk"') && all.includes('quick.b64'));
}

// ⑧ logs --slow N
{
  // 种一条慢记录（ms=9999 手写进 audit.log）
  const logPath = path.join(home, 'logs', 'audit.log');
  const { appendFileSync } = await import('node:fs');
  appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), plugin: 'slow124', action: 'partial', tool: 'slow124.partial', risk: 'read', caller: 'cli', decision: 'deny', reason: 'timeout', ms: 9999, error: '执行超时（1 秒）已被强制结束' }) + '\n');
  const r = run(['logs', '--slow', '5000']);
  const all = r.stdout;
  check('⑧ --slow 只看慢执行（命中含 slow124）', all.includes('slow124') && all.includes('9999ms'));
  const r2 = run(['logs', '--slow', '99999']);
  check('⑧ 阈值外全部过滤（0 命中）', !r2.stdout.split('\n').some((l) => l.includes('✓') && l.includes('slow124')));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
