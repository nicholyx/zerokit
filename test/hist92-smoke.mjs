// hist92-smoke：第九十二轮——执行历史第二面
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- hist92`); } };
const home = mkdtempSync(path.join(tmpdir(), 'h92-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env });
console.log(`hist92-smoke（${home}）`);
run(['plugin', 'bundled']);

// 种历史：今天 3 条（2 成功 quick + 1 成功 sysinfo）+ 一条昨天（直接写 history.json）
run(['run', 'quick', 'b64', '--text', 'a']);
run(['run', 'quick', 'ts2date', '--ts', '1760000000']);
run(['run', 'sysinfo', 'overview']);
{
  const { readFileSync, writeFileSync: wf } = await import('node:fs');
  const hp = path.join(home, 'history.json');
  const arr = JSON.parse(readFileSync(hp, 'utf8'));
  const yest = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
  arr.push({ ts: yest, plugin: 'quick', action: 'b64', argv: ['--text', 'old'], exitCode: 0 });
  wf(hp, JSON.stringify(arr));
}

// ① --failed 已有（第七十一轮）——负例：无失败时友好提示
{
  const r = run(['history', '--failed']);
  check('① --failed 无失败友好提示', r.status === 0 && (r.stdout + r.stderr).includes('没有失败'));
}

// ② --today：只有今天 4 条（不含昨天那条）
{
  const r = run(['history', '--today']);
  const out = r.stdout + r.stderr;
  check('② --today 含今天动作', out.includes('共') && out.includes('ts2date') && out.includes('overview'));
  check('② --today 排除昨天', !out.includes('old'));
}

// ③ --plugin
{
  const r = run(['history', '--plugin', 'sysinfo']);
  const out = r.stdout + r.stderr;
  check('③ --plugin 过滤', out.includes('overview') && !out.includes('ts2date'));
  // ⑧ 空结果不静默
  const r2 = run(['history', '--plugin', 'ghost']);
  check('⑧ 空结果提示', (r2.stdout + r2.stderr).includes('过滤后 0 条'));
}

// ④ --action 插件.动作
{
  const r = run(['history', '--action', 'quick.ts2date']);
  const out = r.stdout + r.stderr;
  check('④ --action 过滤', out.includes('ts2date') && !out.includes('--text a') && !out.includes('overview'));
}

// ⑤ stats 概览行
{
  const r = run(['stats']);
  const out = r.stdout + r.stderr;
  check('⑤ stats 总次数+成功率', out.includes('执行概览') && out.includes('成功率'));
  check('⑤ stats 最常用 top', out.includes('最常用') && out.includes('quick.b64'));
  check('⑤ stats 最慢 top', out.includes('最慢（P95）'));
}

// ⑥ --json 机读（组合过滤）
{
  const r = run(['history', '--today', '--plugin', 'quick', '--json']);
  const j = JSON.parse(r.stdout);
  check('⑥ --json 组合过滤', Array.isArray(j) && j.length === 2 && j.every((e) => e.plugin === 'quick'));
}

// ⑨ 静态接线：日志页 chip
{
  const app = (await import('node:fs')).readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
  const srv = (await import('node:fs')).readFileSync(path.join(PKG_ROOT, 'src', 'server.ts'), 'utf8');
  check('⑨ 日志页今天/插件 chip', app.includes('data-log-today') && app.includes('data-log-plugin'));
  check('⑨ 服务端 plugin 过滤', srv.includes("searchParams.get('plugin')") && srv.includes("e['plugin'] === pluginF"));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
