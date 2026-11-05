// round150-smoke：哨兵与可观测——--diff/--alert/server 日志
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- round150 ${extra}`); } };
const home = mkdtempSync(path.join(tmpdir(), 'r150-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env });
console.log(`round150-smoke（${home}）`);
run(['plugin', 'bundled']);

// ---- 纯函数直测 ----
const cliX = await import('../src/core/cliX.ts');

// ① diffResult
{
  const a = { 主机名: 'mbp', 内存: 8, 磁盘: 512 };
  const b = { 主机名: 'mbp', 内存: 16, IP: '1.2.3.4' };
  const d = cliX.diffResult(a, b);
  check('① 变更识别', d.some((x) => x.key === '内存' && x.kind === 'changed' && x.a === 8 && x.b === 16));
  check('① 新增识别', d.some((x) => x.key === 'IP' && x.kind === 'added'));
  check('① 消失识别', d.some((x) => x.key === '磁盘' && x.kind === 'removed'));
  check('① 一致为空', cliX.diffResult(a, { ...a }).length === 0);
  check('① 标量包装', cliX.diffResult('x', 'y').length === 1 && cliX.diffResult('x', 'y')[0]?.key === '值');
}

// ② alertEval
{
  const data = { 内存占用: 85, 状态: 'ok' };
  check('② 数字大于', cliX.alertEval('内存占用>80', data, 10).ok === true);
  check('② 数字不满足', cliX.alertEval('内存占用>90', data, 10).ok === false);
  check('② 实际值带回', cliX.alertEval('内存占用>90', data, 10).actual === '85');
  check('② 字符串相等', cliX.alertEval('状态=ok', data).ok === true);
  check('② 子串', cliX.alertEval('状态~k', data).ok === true);
  check('② ms 伪列', cliX.alertEval('ms<500', data, 120).ok === true);
  check('② 标量伪列', cliX.alertEval('值=hello', 'hello').ok === true);
  check('② 未知列报错', cliX.alertEval('不存在>1', data).error !== undefined);
  check('② 坏表达式报错', cliX.alertEval('garbage', data).error !== undefined);
}

// ---- CLI 实跑 ----
// ① --diff 首次/一致
{
  const r1 = run(['run', 'quick', 'b64', '--text', 'aa', '--diff']);
  check('① 首次执行提示', (r1.stdout + r1.stderr).includes('首次执行，无基线'));
  const r2 = run(['run', 'quick', 'b64', '--text', 'aa', '--diff']);
  check('① 一致 0 变化', (r2.stdout + r2.stderr).includes('0 处变化'));
  // 变化检出：直接种一份过期基线（不同参数=不同命令指纹，首次提示才是正确行为——比较不同命令没意义）
  {
    const { createHash } = await import('node:crypto');
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const fp = createHash('sha1').update('quick.b64|--text aa').digest('hex').slice(0, 12);
    const dir = path.join(home, 'baselines');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${fp}.json`), JSON.stringify({ 方向: '文本 → Base64', 结果: 'OLD=', 长度: 4 }));
    const r3 = run(['run', 'quick', 'b64', '--text', 'aa', '--diff']);
    const out3 = r3.stdout + r3.stderr;
    check('① 变化列出（种过期基线）', out3.includes('变化') && out3.includes('OLD='), out3.slice(-200));
  }
  // 基线文件落盘
  const baseDir = path.join(home, 'baselines');
  check('① 基线目录生成', existsSync(baseDir));
}
// ② --alert 三态
{
  const r1 = run(['run', 'quick', 'b64', '--text', 'x', '--alert', 'ms<5000']);
  check('② 哨兵通过 exit0', r1.status === 0 && r1.stdout.includes('哨兵通过'));
  const r2 = run(['run', 'quick', 'b64', '--text', 'x', '--alert', 'ms>99999']);
  check('② 不满足 exit2', r2.status === 2 && r2.stdout.includes('哨兵不满足'));
  const r3 = run(['run', 'quick', 'b64', '--text', 'x', '--alert', '坏表达式']);
  check('② 坏表达式 exit1', r3.status === 1 && (r3.stdout + r3.stderr).includes('看不懂'));
}
// ④⑤⑥ server 日志
{
  const { spawn } = await import('node:child_process');
  const proc = spawn(process.execPath, [CLI, 'ui', '--log', '--port', '28997'], { env, stdio: ['ignore', 'pipe', 'pipe'], });
  await new Promise((r) => setTimeout(r, 3000));
  let hit = false;
  try { await fetch('http://127.0.0.1:28997/api/plugins?secret=abc'); hit = true; } catch { /* 可能没起来 */ }
  await new Promise((r) => setTimeout(r, 600));
  const logFile = path.join(home, 'logs', 'server.log');
  const content = hit && existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
  check('④ 启动行含 pid', /=== 启动 .*pid=\d+/.test(content));
  check('⑧ 请求行 method path status ms', /GET \/api\/plugins 200 \d+/.test(content));
  check('⑧ query 脱敏（不含 secret 值）', hit === false || !content.includes('secret=abc'));
  proc.kill();
  await new Promise((r) => setTimeout(r, 500));
  const r6 = run(['logs', 'server']);
  check('⑥ logs server 可读', (r6.stdout ?? '').includes('/api/plugins'));
  const r7 = run(['logs', 'server', '--tail', '1']);
  check('⑥ --tail 生效', (r7.stdout ?? '').trim().split('\n').length <= 1);
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
