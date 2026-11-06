// round155-smoke：第一百五十五轮——哨兵通知与审计保留
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- round155 ${extra}`); } };
console.log('round155-smoke');

const E = await import('../src/core/cliX.ts');

// ⑦ alertLine / parseAlertLine 稳定格式
{
  const line = E.alertLine('zkit run quick ts2date', '星期=五', '四', new Date('2026-11-06T04:00:00Z'));
  check('⑦ 告警行四段格式', line === '[ALERT] 2026-11-06T04:00:00.000Z | zkit run quick ts2date | 星期=五 | 四', line);
  const p = E.parseAlertLine(line);
  check('⑦ 解析回读', p?.cmd === 'zkit run quick ts2date' && p?.rule === '星期=五' && p?.actual === '四');
  check('⑦ 坏行返回 null', E.parseAlertLine('not an alert') === null);
}
// ③ auditKeepSplit
{
  const old = JSON.stringify({ ts: '2020-01-01T00:00:00Z' });
  const fresh = JSON.stringify({ ts: new Date().toISOString() });
  const bad = 'not-json';
  const r = E.auditKeepSplit([old, fresh, bad], 30 * 86400e3);
  check('③ 过期行挑出', r.expire.length === 1 && r.expire[0] === old);
  check('③ 新行保留', r.keep.includes(fresh));
  check('③ 坏行保守保留', r.keep.includes(bad));
  check('③ 空行过滤', E.auditKeepSplit(['', '  '], 1000).keep.length === 0);
}
// ④ parseKeepArg
{
  check('④ 30d', E.parseKeepArg('30d') === 30 * 86400e3);
  check('④ 12h', E.parseKeepArg('12h') === 12 * 3600e3);
  check('④ permanent', E.parseKeepArg('permanent') === Infinity);
  check('④ 坏值 null', E.parseKeepArg('forever') === null && E.parseKeepArg('30') === null);
}

// CLI 端到端
const home = mkdtempSync(path.join(tmpdir(), 'r155-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env });
run(['plugin', 'bundled']);
// ① --notify 收到告警行
{
  const nf = path.join(home, 'notify.txt');
  const r = run(['run', 'quick', 'ts2date', '--ts', '1760000000', '--alert', '星期=五', '--notify', `cat > ${JSON.stringify(nf)}`]);
  check('① exit 2', r.status === 2);
  check('① 告警行经 stdin 到命令', existsSync(nf) && readFileSync(nf, 'utf8').startsWith('[ALERT] '), r.stdout.slice(-200));
}
// ② 通知失败不吞告警
{
  const r = run(['run', 'quick', 'ts2date', '--ts', '1760000000', '--alert', '星期=五', '--notify', 'exit 3']);
  check('② 通知失败仍 exit 2', r.status === 2);
  check('② 失败提示可见', (r.stderr || '').includes('通知命令退出码 3'));
}
// ⑥ --notify-file
{
  const nf = path.join(home, 'nf.txt');
  const r = run(['run', 'quick', 'b64', '--text', 'hi', '--alert', '长度>100', '--notify-file', nf]);
  check('⑥ 追加写文件', r.status === 2 && existsSync(nf) && readFileSync(nf, 'utf8').includes('长度>100'));
}
// ③④ logs --keep + 幂等
{
  const audit = path.join(home, 'logs', 'audit.log');
  run(['run', 'quick', 'b64', '--text', 'seed1']);
  run(['run', 'quick', 'b64', '--text', 'seed2']);
  const lines = readFileSync(audit, 'utf8').trimEnd().split('\n');
  const recs = lines.map((l) => JSON.parse(l));
  const oldTs = new Date(Date.now() - 40 * 86400e3).toISOString();
  recs[0].ts = oldTs;
  const { writeFileSync } = await import('node:fs');
  writeFileSync(audit, recs.map((r2) => JSON.stringify(r2)).join('\n') + '\n');
  const k1 = run(['logs', '--keep', '30d']);
  check('③ 删旧备份', k1.stdout.includes('删除 1 条过期记录') && existsSync(path.join(home, 'logs', 'audit-' + new Date().toISOString().slice(0, 10) + '.bak')));
  const k2 = run(['logs', '--keep', '30d']);
  check('④ 幂等复跑不删', k2.stdout.includes('无需清理'));
  const k3 = run(['logs', '--keep', 'bogus']);
  check('③ 坏参数拒绝', k3.status === 1);
  const k4 = run(['logs', '--keep', 'permanent']);
  check('③ permanent 不动', k4.status === 0 && k4.stdout.includes('不删'));
}
// ⑤ doctor 审计规模行
{
  const d = run(['doctor']);
  check('⑤ doctor 报审计规模', d.stdout.includes('审计：') && /\d+ 条记录/.test(d.stdout));
}
// ⑧ --watch 与 --notify 组合（首跑即评估告警，无需等轮询）
{
  const nf2 = path.join(home, 'nf2.txt');
  const r = run(['run', 'quick', 'b64', '--text', 'hi', '--watch', '3600', '--alert', '长度>100', '--notify-file', nf2]);
  // 首跑失败即告警外发后 return 2（watch 只在 ok 时进入，这里 alert 不满足 return 2 先行）
  check('⑧ 组合可用（告警先行）', existsSync(nf2) || r.stdout.includes('哨兵'));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
