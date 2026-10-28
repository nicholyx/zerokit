/**
 * 第五十四轮：时间线与执行复盘冒烟。
 */
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

let pass = 0; let fail = 0;
const ok = (cond, label, extra = '') => { if (cond) pass++; else { fail++; console.error(`FAIL: ${label} ${extra}`); } };
const REPO = path.resolve(import.meta.dirname, '..');

const { timelineDays, groupByHour, weekCompare, topActionsFlat } = await import(pathToFileURL(path.join(REPO, 'web/extras.js')).href);
{
  const day = (dn, h, extra = {}) => { const d = new Date(2026, 9, dn, h, 0, 0); return { ts: d.getTime(), ok: true, ms: 100, plugin: 'p', action: 'a', ...extra }; };
  const runs = [day(27, 9), day(27, 10, { ok: false, ms: 300 }), day(26, 14), day(26, 15), day(26, 23)];
  const days = timelineDays(runs);
  ok(days.length === 2 && days[0].day === '2026-10-27', '按天分组倒序');
  ok(days[0].total === 2 && days[0].fails === 1, '当日汇总');
  ok(days[1].total === 3 && days[1].fails === 0, '前日汇总');
  ok(timelineDays(null).length === 0, '空输入兜底');
  ok(timelineDays([{ noTs: 1 }]).length === 0, '无 ts 跳过');

  const hours = groupByHour(runs);
  ok(hours[9] === 1 && hours[10] === 1 && hours[14] === 1 && hours[23] === 1, '时段分布');
  ok(hours.length === 24, '24 桶');

  // 2026-10-26 是周一？验证：new Date(2026,9,26).getDay() —— 用锚定 now
  // 2026-10-26 是周一：26 日属本周，27/28 也属本周——把 runs 的 26 日样例当「上周」需另造
  const now = new Date(2026, 9, 28, 12, 0, 0).getTime(); // 周三
  const wcRuns = [day(28, 9), day(28, 10, { ok: false, ms: 300 }), day(20, 14), day(20, 15)]; // 20 日=上周二
  const wc = weekCompare(wcRuns, now);
  ok(wc.cur.total === 2 && wc.prev.total === 2, '本周 vs 上周切分');
  ok(wc.cur.failRate === 0.5 && wc.prev.failRate === 0, '失败率两侧');
  ok(wc.prev.failRate === 0, '上周零失败');
  ok(wc.totalDelta === null || typeof wc.totalDelta === 'number', 'delta 类型');

  const tops = topActionsFlat(runs);
  ok(tops.length === 1 && tops[0].count === 5, 'top 计数');
  const mixed = [{ plugin: 'a', action: 'x' }, { plugin: 'a', action: 'x' }, { plugin: 'b', action: 'y' }, null];
  const tops2 = topActionsFlat(mixed, 1);
  ok(tops2.length === 1 && tops2[0].label === 'a·x', 'top 排序与 null 跳过');
}

{
  const app = fs.readFileSync(path.join(REPO, 'web/app.js'), 'utf8');
  ok(app.includes('function showTimeline'), '①面板函数');
  ok(app.includes("#/timeline') { showTimeline()"), '路由');
  ok(app.includes('timeline-collapsed'), '③折叠记忆');
  ok(app.includes('tl-ok') && app.includes('tl-fail'), '④成败条');
  ok(app.includes('tl-week-card'), '⑤周对比卡');
  ok(app.includes('tl-hfill'), '⑥时段柱');
  ok(app.includes('topActionsFlat(flat'), '⑦Top 榜');
  ok(app.includes('时间线就会在这里长出来'), '⑧空态引导');
  ok(app.includes("label: '时间线'"), '命令面板入口');
}

console.log(`通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
