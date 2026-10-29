// timers78-smoke：第七十八轮定时器第二波——工作日/每周档、错过检测幂等、人话下次、--json、catchup、pause 不删配置
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PKG_ROOT = path.resolve(import.meta.dirname, '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- timers78`); } };
const home = mkdtempSync(path.join(tmpdir(), 't78-'));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home },
});
console.log(`timers78-smoke（${home}）`);
run(['plugin', 'bundled']);

// 种任务。注意：timers.ts 在模块加载时读 ZEROKIT_HOME 固化 HOME——静态 import
// 会被提升到 env 赋值之前，必须动态 import。
process.env.ZEROKIT_HOME = home;
const { upsertTimer, loadTimers, nextFireTime, humanNextFire, missedRun, firesOnDay, markCatchupDone } = await import('../src/core/timers.ts');
const DAY = 86400000;
const now = new Date(2026, 9, 29, 10, 0).getTime(); // 2026-10-29 周四
upsertTimer({ key: 'quick.ts2date', title: '快照', interval: 86400, createdAt: now - 3 * DAY, lastRanAt: now - 3 * DAY, values: { ts: '1760000000' } });
upsertTimer({ key: 'sysinfo.overview', title: '概况', interval: 86400, days: 'workdays', createdAt: now });
upsertTimer({ key: 'sysinfo.top', title: '进程', interval: 86400, days: [1], createdAt: now }); // 每周一

// ① days 纯语义
check('① workdays 周六不触发', firesOnDay({ key: 'x', title: '', interval: 1, createdAt: 0, days: 'workdays' }, new Date(2026, 9, 24)) === false);
check('① workdays 周三触发', firesOnDay({ key: 'x', title: '', interval: 1, createdAt: 0, days: 'workdays' }, new Date(2026, 9, 28)) === true);
check('① [1] 只周一', firesOnDay({ key: 'x', title: '', interval: 1, createdAt: 0, days: [1] }, new Date(2026, 9, 26)) === true
  && firesOnDay({ key: 'x', title: '', interval: 1, createdAt: 0, days: [1] }, new Date(2026, 9, 29)) === false);

// ② 错过检测
const t0 = loadTimers().timers.find((t) => t.key === 'quick.ts2date');
check('② 每天档报错过', (missedRun(t0, now) ?? '').includes('该跑没跑'));
const w = { ...t0, days: 'workdays' };
check('② 工作日档错过报首个工作日', (missedRun(w, now) ?? '').includes('周二'));
const sk = { ...t0, catchup: 'skip' };
check('② skip 策略不报', missedRun(sk, now) === null);
const done = { ...t0, lastCatchupDay: '2026-10-29' };
check('② 今天已补过不重复报', missedRun(done, now) === null);

// 幂等标记
const tMark = { ...t0 };
markCatchupDone(tMark, now);
check('② markCatchupDone 记当天', tMark.lastCatchupDay === '2026-10-29');

// ⑧ 人话下次
check('⑧ 今天档', humanNextFire(new Date(2026, 9, 29, 14, 5).getTime(), now) === '今天 14:05');
check('⑧ 明天档', humanNextFire(new Date(2026, 9, 30, 9, 0).getTime(), now) === '明天 09:00');
check('⑧ 周内星期', humanNextFire(new Date(2026, 10, 4, 9, 0).getTime(), now) === '周三 09:00');
check('⑧ 跨周绝对日期', humanNextFire(new Date(2026, 10, 12, 9, 0).getTime(), now) === '11/12 09:00');

// ① nextFireTime 推到下一个触发日：每周一任务今天(周四)的 next 应落在下周一
const wk = loadTimers().timers.find((t) => t.key === 'sysinfo.top');
wk.lastRanAt = now; // 刚跑过
const nf = nextFireTime(wk, now);
check('① 每周一档 next 落下周一', new Date(nf).getDay() === 1 && nf > now);

// CLI 面（重种为真实时钟——上面用的是固定 2026-10 参照系）
{
  const realNow = Date.now();
  upsertTimer({ key: 'quick.ts2date', title: '快照', interval: 86400, createdAt: realNow - 3 * DAY, lastRanAt: realNow - 3 * DAY, values: { ts: '1760000000' }, lastCatchupDay: undefined });
  upsertTimer({ key: 'sysinfo.overview', title: '概况', interval: 86400, days: 'workdays', createdAt: realNow });
  upsertTimer({ key: 'sysinfo.top', title: '进程', interval: 86400, days: [1], createdAt: realNow });
  const r = run(['timers', 'list']);
  check('⑧ list 人话时间', r.stdout.includes('下次') && (r.stdout.includes('今天') || r.stdout.includes('明天') || r.stdout.includes('周')));
  check('① list 工作日标签', r.stdout.includes('工作日'));
  check('② list 错过提示', r.stdout.includes('⚠ 错过'));
  const j = run(['timers', 'list', '--json']);
  const arr = JSON.parse(j.stdout);
  check('⑥ --json 机读', Array.isArray(arr) && arr.length === 3 && 'nextFireHuman' in arr[0] && 'missed' in arr[0]);
  const c1 = run(['timers', 'catchup', 'quick.ts2date']);
  check('② catchup 执行成功', c1.stdout.includes('补跑') && c1.stdout.includes('2025'));
  const c2 = run(['timers', 'catchup', 'quick.ts2date']);
  check('② catchup 幂等', c2.stdout.includes('没有需要补跑的'));
  const p1 = run(['timers', 'pause', 'sysinfo.overview']);
  check('③ pause 不删配置', p1.stdout.includes('已暂停') && loadTimers().timers.some((t) => t.key === 'sysinfo.overview'));
  const r2 = run(['timers', 'resume', 'sysinfo.overview']);
  check('③ resume 恢复', r2.stdout.includes('已恢复'));
  // ⑦ 定时器 run 走审计（catchup 已执行过一次——审计里应有 quick 记录）
  const logs = run(['logs', '--tail', '5']);
  check('⑦ run 进审计', logs.stdout.includes('quick') || logs.stdout.includes('ts2date'));
}
rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
