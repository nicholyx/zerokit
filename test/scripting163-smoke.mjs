// scripting163-smoke：第一百六十三轮——CLI 脚本化与自动化
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- scripting163 ${extra}`); } };
const home = mkdtempSync(path.join(tmpdir(), 's163-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (args, input) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 90000, env, input });
console.log(`scripting163-smoke（${home}）`);
run(['plugin', 'bundled']);

// ① exit-codes 子命令
{
  const r = run(['exit-codes']);
  check('① exit-codes 说明三档', (r.stdout + r.stderr).includes('0') && (r.stdout + r.stderr).includes('1') && (r.stdout + r.stderr).includes('2'));
}

// ② --stdin 密钥不进 history
{
  const r = run(['run', 'quick', 'b64', '--stdin', 'text', '--quiet'], 'hello-stdin');
  check('② stdin 读一行', r.status === 0 && r.stdout.includes('aGVsbG8tc3RkaW4='), r.stdout.slice(0, 60) + r.stderr.slice(0, 60));
  const bad = run(['run', 'quick', 'b64', '--stdin', 'nosuch', '--quiet'], 'x');
  check('② 未声明参数 exit 2', bad.status === 2, `exit=${bad.status}`);
}

// ③ --timeout 覆盖
{
  const r = run(['run', 'sysinfo', 'overview', '--timeout', '10', '--quiet']);
  check('③ --timeout 覆盖后仍成功', r.status === 0, r.stderr.slice(0, 80));
}

// ⑥ --retries / --retry-delay
{
  const r = run(['run', 'quick', 'b64', '--text', 'x', '--retries', '2', '--retry-delay', '1', '--quiet']);
  check('⑥ 成功不重试（retries 声明被剥离）', r.status === 0);
  const bad = run(['run', 'quick', 'b64', '--retries', '1', '--retry-delay', '0', '--quiet']);
  check('⑥ 失败重试后仍 exit 1（缺参在动作层=用法错 2 不重试）', bad.status === 2, `exit=${bad.status}`);
}

// ⑤ --format 轻模板
{
  const r = run(['run', 'sysinfo', 'overview', '--format', '{{ms}}ms {{rows}}行 {{key}}']);
  check('⑤ 模板三占位', /\d+ms \d+行 sysinfo\.overview/.test(r.stdout), r.stdout.slice(0, 80));
}

// ④ 并发锁
{
  const lockDir = path.join(home, 'locks');
  const lock = path.join(lockDir, 'sysinfo.overview.lock');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(lock, String(process.pid));   // 新鲜锁（刚写，mtime=now）→ 真活锁
  const r = run(['run', 'sysinfo', 'overview', '--quiet']);
  const all = r.stderr + r.stdout;
  check('④ 活锁等待提示+超时拒', all.includes('正在别处执行') || all.includes('没等到'), `exit=${r.status} ${all.slice(0, 100)}`);
  // 活锁超时后锁被 finally 清理 → 陈锁用例重新种
  writeFileSync(lock, '999999');
  const old = new Date(Date.now() - 2 * 3600 * 1000);
  utimesSync(lock, old, old);
  const r2 = run(['run', 'sysinfo', 'overview', '--quiet']);
  check('④ 陈锁（>1h）可抢', r2.status === 0, r2.stderr.slice(0, 80));
  check('④ 执行完锁清理', !existsSync(lock));
  // --no-lock 逃生
  writeFileSync(lock, '1');
  const r3 = run(['run', 'sysinfo', 'overview', '--quiet', '--no-lock']);
  check('④ --no-lock 直闯', r3.status === 0);
  rmSync(lock, { force: true });
}

// ⑦ cron
{
  const r = run(['cron', 'add', '心跳', '--', 'run', 'sysinfo', 'overview', '--quiet']);
  check('⑦ add 登记+接线提示', r.status === 0 && r.stdout.includes('已登记') && r.stdout.includes('crontab -e'), r.stdout.slice(0, 100));
  const dup = run(['cron', 'add', '心跳', '--', 'run', 'sysinfo', 'overview']);
  check('⑦ 重名拒绝 exit 2', dup.status === 2);
  const self = run(['cron', 'add', '自递归', '--', 'cron', 'run']);
  check('⑦ 自递归拒绝', self.status === 2);
  const lst = run(['cron', 'list']);
  check('⑦ list 显示条目', lst.status === 0 && lst.stdout.includes('心跳'));
  const js = run(['cron', 'list', '--json']);
  check('⑦ list --json 机读', (() => { try { const a = JSON.parse(js.stdout); return Array.isArray(a) && a[0]?.name === '心跳' && a[0]?.argv?.[0] === 'run'; } catch { return false; } })());
  const exe = run(['cron', 'run']);
  check('⑦ run 逐条执行+✓', exe.status === 0 && exe.stdout.includes('✓ 心跳'));
  const rmv = run(['cron', 'rm', '心跳']);
  check('⑦ rm 删除', rmv.status === 0 && run(['cron', 'list']).stdout.includes('没有定时任务'));
  const empty = run(['cron', 'run']);
  check('⑦ 空表 run 提示', empty.status === 0 && empty.stdout.includes('没有定时任务'));
}

// ⑧ 文档存在
{
  check('⑧ scripting 指南存在', existsSync(path.join(PKG_ROOT, 'docs', 'guide', 'scripting.md')));
}

// 附：crontab.json 0600
{
  const st = (await import('node:fs')).statSync(path.join(home, 'crontab.json'));
  run(['cron', 'add', 't', '--', 'run', 'sysinfo', 'overview']);
  const mode = (await import('node:fs')).statSync(path.join(home, 'crontab.json')).mode & 0o777;
  check('附 crontab.json 0600（非 Windows）', process.platform === 'win32' || mode === 0o600, `mode=${mode.toString(8)} st=${(st.mode & 0o777).toString(8)}`);
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
