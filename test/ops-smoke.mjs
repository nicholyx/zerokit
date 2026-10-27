// 第三十三轮：内核可观测性与运维面（CLI/内核侧）。
// 全部走临时 ZEROKIT_HOME，自包含；shell 里不联任何网络。
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zerokit-ops-smoke-'));
let passed = 0, failed = 0;
const fail = (m) => { failed++; console.log('FAIL  ' + m); process.exitCode = 1; };
const pass = (m) => { passed++; console.log('PASS  ' + m); };
const run = (args, opts = {}) => spawnSync(process.execPath, ['src/cli.ts', ...args], {
  cwd: ROOT, encoding: 'utf8', timeout: 60000, windowsHide: true,
  env: { ...process.env, ZEROKIT_HOME: TMP }, ...opts,
});

run(['plugin', 'bundled']);

// ---- ⑦审计写入修复：CLI 执行必须落盘（此前 WriteStream+exit 丢行）
run(['run', 'sysinfo', 'overview']);
{
  const auditFile = path.join(TMP, 'logs', 'audit.log');
  const ok = fs.existsSync(auditFile) && fs.readFileSync(auditFile, 'utf8').includes('sysinfo');
  if (ok) pass('⑦CLI 执行写入审计（同步追加修复生效）');
  else fail('⑦审计文件缺失或没内容');
}
run(['run', 'quick', 'b64', '--text', 'ops']);
run(['run', 'quick', 'ts2date', '--ts', '1760000000']);

// ---- ①stats 人读 + ②--json
{
  const human = run(['stats']);
  const j = run(['stats', '--json']);
  let parsed = null;
  try { parsed = JSON.parse(j.stdout); } catch { /* 下行断言 */ }
  const keys = (parsed?.actions ?? []).map((a) => a.key);
  const top = parsed?.actions?.find((a) => a.key === 'sysinfo.overview');
  if (human.status === 0 && human.stdout.includes('sysinfo.overview') && /P50/.test(human.stdout)
      && keys.includes('quick.b64') && top?.count === 1 && typeof top.p50Ms === 'number') {
    pass('①②stats 人读 + --json（P50/P95/次数齐）');
  } else {
    fail('①②stats 输出不对：' + human.stdout.slice(0, 120));
  }
}

// ---- ⑤audit --last / --json
{
  const human = run(['audit', '--last', '2']);
  const j = run(['audit', '--last', '2', '--json']);
  let recs = null;
  try { recs = JSON.parse(j.stdout).records; } catch { /* 下行 */ }
  if (human.stdout.includes('✓') && recs?.length === 2 && recs[0].plugin) {
    pass('⑤audit --last 表格式 + --json');
  } else {
    fail('⑤audit 输出不对：' + human.stdout.slice(0, 120));
  }
}

// ---- ⑦slow 水位线：种一条 4s 记录，stats 带 ⚠、audit 带 ⏱slow
{
  const auditFile = path.join(TMP, 'logs', 'audit.log');
  fs.appendFileSync(auditFile, JSON.stringify({
    ts: new Date().toISOString(), plugin: 'slowdemo', action: 'big', tool: 'slowdemo__big',
    risk: 'read', caller: 'cli', decision: 'allow', ms: 4300, slow: true,
  }) + '\n');
  const stats = run(['stats']);
  const audit = run(['audit', '--last', '1']);
  if (stats.stdout.includes('⚠') && stats.stdout.includes('slowdemo') && audit.stdout.includes('⏱slow')) {
    pass('⑦慢动作水位线（stats ⚠ + audit ⏱slow）');
  } else {
    fail('⑦慢标记没显示：' + stats.stdout.slice(0, 150));
  }
}

// ---- ⑧gc 预览/执行
{
  const preview = run(['gc', '--days', '0']);
  const applied = run(['gc', '--days', '0', '--apply']);
  const after = run(['gc', '--days', '0']);
  if (/预览.*清理 \d+ 条/.test(preview.stdout)
      && /已清理 \d+ 条/.test(applied.stdout)
      && after.stdout.includes('将清理 0 条')) {
    pass('⑧gc --dry-run 预览 + --apply 执行');
  } else {
    fail('⑧gc 输出不对：' + preview.stdout.slice(0, 120) + ' | ' + applied.stdout.slice(0, 120));
  }
}

// ---- ④health：退出码 0、行齐全
{
  const r = run(['health']);
  if (r.status === 0 && /插件：\d+ 个装在案/.test(r.stdout) && /审计记录/.test(r.stdout)) {
    pass('④health 概况 + 退出码语义');
  } else {
    fail('health 输出不对：' + r.stdout.slice(0, 150));
  }
}

// ---- ⑨doctor 带最近错误计数
{
  const r = run(['doctor', '--json']);
  let j = null;
  try { j = JSON.parse(r.stdout); } catch { /* 下行 */ }
  if (j?.recentErrors && typeof j.recentErrors.last24h === 'number') {
    pass('⑨doctor --json 带 recentErrors 计数');
  } else {
    fail('⑨doctor recentErrors 缺失');
  }
  const human = run(['doctor']);
  if (/最近 24 小时(无执行失败|执行失败 \d+ 次)/.test(human.stdout)) pass('⑨doctor 人读错误行');
  else fail('⑨doctor 人读缺最近错误行');
}

// ---- ③logs --follow：起子进程跟读，另起一次 run，看新行出现
{
  const child = spawn(process.execPath, ['src/cli.ts', 'logs', '--follow', '--tail', '0'], {
    cwd: ROOT, env: { ...process.env, ZEROKIT_HOME: TMP }, stdio: ['ignore', 'pipe', 'ignore'],
  });
  let buf = '';
  child.stdout.on('data', (c) => { buf += c.toString('utf8'); });
  setTimeout(() => {
    run(['run', 'quick', 'b64', '--text', 'follow-test']);
  }, 700);
  setTimeout(() => { child.kill('SIGINT'); }, 2200);
  const code = await new Promise((res) => child.on('exit', res));
  if (buf.includes('follow-test') && buf.includes('跟读中')) {
    pass('③logs --follow 实时跟读到新执行');
  } else {
    fail('③follow 没跟到：' + buf.slice(0, 150));
  }
}

// ---- ⑥/api/health：起 server、GET 探活（无 token 也 200）
{
  const child = spawn(process.execPath, ['src/cli.ts', 'ui', '--port', '0', '--no-open'], {
    cwd: ROOT, env: { ...process.env, ZEROKIT_HOME: TMP }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  // 端口随机：从 stdout 读「http://127.0.0.1:PORT」
  const port = await new Promise((resolve) => {
    let out = '';
    const t = setTimeout(() => resolve(null), 8000);
    child.stdout.on('data', (c) => {
      out += c.toString('utf8');
      const m = out.match(/127\.0\.0\.1:(\d+)/);
      if (m) { clearTimeout(t); resolve(Number(m[1])); }
    });
  });
  if (port) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      const j = await res.json();
      if (res.status === 200 && j.app === 'zerokit' && typeof j.uptimeSec === 'number' && /^\d+\.\d+\.\d+/.test(j.version)) {
        pass(`⑥/api/health 无鉴权探活（${j.version}，uptime ${j.uptimeSec}s）`);
      } else {
        fail('⑥/api/health 响应不对：' + JSON.stringify(j));
      }
    } catch (e) {
      fail('⑥/api/health 请求失败：' + e.message);
    }
  } else {
    fail('⑥server 没起来（读不到端口）');
  }
  child.kill('SIGKILL');
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n' + '='.repeat(60));
console.log(`通过 ${passed} / ${passed + failed}`);
if (failed > 0) process.exit(1);
