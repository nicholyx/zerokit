/**
 * 第四十九轮：结果对比与历史分析冒烟。
 * 自包含：临时 ZEROKIT_HOME，不联网。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

let pass = 0; let fail = 0;
const ok = (cond, label, extra = '') => { if (cond) pass++; else { fail++; console.error(`FAIL: ${label} ${extra}`); } };
const REPO = path.resolve(import.meta.dirname, '..');

const { runTrend, failureRate, durationStats } = await import(pathToFileURL(path.join(REPO, 'web/extras.js')).href);
// ⑨ 纯函数
{
  const runs = [
    { ts: 1, ok: true, ms: 10, data: { mem: 100 } },
    { ts: 2, ok: true, ms: 20, data: { mem: 150 } },
    { ts: 3, ok: false, ms: 30, data: { mem: '120 MB' } },
    { ts: 4, ok: true, ms: 40, data: { mem: 90 } },
  ];
  const t = runTrend(runs, 'mem');
  ok(t && t.points.length === 4, 'runTrend 四点（字符串数字也算）');
  ok(t && t.best === 90 && t.worst === 150, 'runTrend best/worst');
  ok(runTrend([{ ts: 1, data: {} }], 'x') === null, 'runTrend 不足两点 null');
  ok(runTrend(null, 'x') === null, 'runTrend 非数组 null');

  const fr = failureRate(runs, 3);
  ok(fr.fails === 1 && fr.total === 3 && Math.abs(fr.rate - 1 / 3) < 1e-9, 'failureRate 最近 3 条');
  ok(failureRate([]).rate === 0, 'failureRate 空历史 rate=0');

  const d = durationStats([10, 20, 30, 40, 100]);
  ok(d.p50 === 30 && d.min === 10 && d.max === 100 && d.count === 5, 'durationStats p50/min/max');
  ok(durationStats([]) === null, 'durationStats 空数组 null');
}

// UI 静态接线
{
  const app = fs.readFileSync(path.join(REPO, 'web/app.js'), 'utf8');
  ok(app.includes('runTrend(') && app.includes('failureRate(') && app.includes('durationStats('), '详情页三函数接线');
  ok(app.includes('#cmpLast') && app.includes('showCompareView({ res: cur }, { res: prev })'), '与上次对比按钮');
  ok(app.includes('data-sel') && app.includes('收藏对比'), '收藏两结果对比');
  ok(app.includes('logCsv') && app.includes('zerokit-logs-'), '日志 CSV 导出');
  const css = fs.readFileSync(path.join(REPO, 'web/style.css'), 'utf8');
  ok(css.includes('.hist-panel') && css.includes('.trend-chip'), '历史卡样式');
}

console.log(`通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
