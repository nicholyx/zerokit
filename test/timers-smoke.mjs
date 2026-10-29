// 第六十三轮：定时任务持久化——timers.json 读写、nextFireTime 窗口推算、孤儿检测、CLI 四命令。
// 自包含：临时 ZEROKIT_HOME，结束清理。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = path.resolve(import.meta.dirname, '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'zk-timers-'));
process.env.ZEROKIT_HOME = HOME;

const results = [];
const check = (name, cond, detail = '') => {
  results.push([name, !!cond]);
  if (!cond) console.error(`FAIL  ${name}   <- ${detail}`);
};

const timers = await import(pathToFileURL(path.join(REPO, 'src/core/timers.ts')).href);
const cli = path.join(REPO, 'src/cli.ts');
const run = (args) => spawnSync(process.execPath, [cli, ...args], {
  encoding: 'utf8', env: { ...process.env, ZEROKIT_HOME: HOME },
});

try {
  run(['plugin', 'bundled']);

  // ---------- ① 持久化 roundtrip ----------
  const file1 = timers.upsertTimer({
    key: 'quick.ts2date', title: '小工具 · 时间戳转换', interval: 60,
    win: '09:00-18:00', createdAt: Date.now(),
  });
  check('① upsert 落盘 1 条', file1.timers.length === 1, JSON.stringify(file1.timers.length));
  check('① timers.json 存在', fs.existsSync(path.join(HOME, 'timers.json')));
  const reloaded = timers.loadTimers();
  check('① 重读回来字段齐', reloaded.timers[0]?.key === 'quick.ts2date' && reloaded.timers[0]?.interval === 60,
    JSON.stringify(reloaded.timers[0]));

  // 同 key upsert 不重复
  timers.upsertTimer({ key: 'quick.ts2date', title: '改名', interval: 120, createdAt: Date.now() });
  check('① 同 key upsert 覆盖不重复', timers.loadTimers().timers.length === 1
    && timers.loadTimers().timers[0]?.interval === 120);

  // ---------- ⑦ nextFireTime ----------
  const now = Date.now();
  const t1 = { key: 'a', title: 'a', interval: 60, createdAt: now - 30_000, lastRanAt: now - 30_000 };
  const nf1 = timers.nextFireTime(t1, now);
  check('⑦ 节奏内下次=last+60s', nf1 === now - 30_000 + 60_000, String(nf1));
  // 错过整段：对齐到下一个整间隔
  const t2 = { key: 'b', title: 'b', interval: 60, createdAt: now - 300_000, lastRanAt: now - 300_000 };
  const nf2 = timers.nextFireTime(t2, now);
  // last=now-300s 恰好整除：ceil 不进位，nf2==now（不是 >now）——对齐性用模零断言，前向性允许等于
  check('⑦ 错过整段对齐节奏（不连环补）', nf2 !== null && nf2 >= now - 1000 && (nf2 - (now - 300_000)) % 60_000 === 0, String(nf2));
  // 窗口外顺延到窗口开点
  const d = new Date(now);
  const tomorrow9 = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 9, 0, 0, 0).getTime();
  const t3 = { key: 'c', title: 'c', interval: 60, createdAt: now - 30_000, lastRanAt: now - 30_000, win: '09:00-10:00' };
  const nf3 = timers.nextFireTime(t3, tomorrow9 - 3600_000);   // 明早 8 点问
  check('⑦ 窗口外顺延到 9 点开窗', nf3 === tomorrow9, `${nf3} vs ${tomorrow9}`);
  // 暂停返回 null
  const t4 = { ...t1, paused: true };
  check('⑦ 暂停返回 null', timers.nextFireTime(t4, now) === null);
  // 跨午夜窗口
  check('⑦ 跨午夜窗口 23:30 在 22:00-06:00 内', timers.inWindowAt(new Date(2026, 9, 29, 23, 30), '22:00-06:00'));
  check('⑦ 跨午夜窗口 12:00 在窗口外', !timers.inWindowAt(new Date(2026, 9, 29, 12, 0), '22:00-06:00'));

  // ---------- ② CLI list ----------
  const list1 = run(['timers', 'list']);
  check('② list 显示任务与节奏', list1.status === 0 && list1.stdout.includes('quick.ts2date') && /每 120s/.test(list1.stdout), list1.stdout);

  // ---------- ③ pause/resume ----------
  const pa = run(['timers', 'pause', 'quick.ts2date']);
  check('③ pause 成功', pa.status === 0 && pa.stdout.includes('已暂停'), pa.stdout);
  check('③ 持久化暂停态', timers.loadTimers().timers[0]?.paused === true);
  const rs = run(['timers', 'resume', 'quick.ts2date']);
  check('③ resume 成功', rs.status === 0 && rs.stdout.includes('已恢复'));
  const paBad = run(['timers', 'pause', 'nope.nope']);
  check('③ 不存在的 key 报错 exit 1', paBad.status === 1);

  // ---------- ④ remove ----------
  timers.upsertTimer({ key: 'sysinfo.overview', title: '系统概况', interval: 300, createdAt: Date.now() });
  const rm = run(['timers', 'remove', 'sysinfo.overview']);
  check('④ remove 成功', rm.status === 0 && rm.stdout.includes('已删除'));
  check('④ 删后只剩 1 条', timers.loadTimers().timers.length === 1);

  // ---------- ⑤ run（走 runner，产出进审计） ----------
  timers.upsertTimer({ key: 'quick.ts2date', title: '小工具 · 时间戳转换', interval: 120, createdAt: Date.now(), values: { ts: '1760000000' } });
  const rn = run(['timers', 'run', 'quick.ts2date']);
  check('⑤ run 立即执行 exit 0', rn.status === 0, rn.stdout + rn.stderr);
  check('⑤ 节奏未被 run 重置', timers.loadTimers().timers[0]?.lastRanAt === undefined);

  // ---------- ⑧ 孤儿检测 ----------
  const orphans = timers.orphanTimers(['quick']);   // sysinfo 已删任务不在；只装 quick
  check('⑧ 无孤儿', orphans.length === 0, JSON.stringify(orphans));
  timers.upsertTimer({ key: 'ghost.haunt', title: '幽灵', interval: 60, createdAt: Date.now() });
  const orphans2 = timers.orphanTimers(['quick']);
  check('⑧ 卸载插件的孤儿被点名', orphans2.includes('ghost.haunt'), JSON.stringify(orphans2));
  // doctor 联动
  const doc = run(['doctor', '--json']);
  let docJson = null;
  try { docJson = JSON.parse(doc.stdout); } catch { /* 保持 null */ }
  check('⑧ doctor 报孤儿任务', doc.status === 0 && docJson !== null
    && Array.isArray(docJson.orphanTimerKeys) && docJson.orphanTimerKeys.includes('ghost.haunt'),
    doc.stdout.slice(0, 200));
} finally {
  fs.rmSync(HOME, { recursive: true, force: true });
}

const pass = results.filter((r) => r[1]).length;
console.log(`通过 ${pass} / ${results.length}`);
if (pass !== results.length) {
  console.log('失败：' + results.filter((r) => !r[1]).map((r) => r[0]).join('、'));
  process.exit(1);
}
process.exit(0);
