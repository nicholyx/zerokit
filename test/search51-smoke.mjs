/**
 * 第五十一轮：搜索体验深化冒烟。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0; let fail = 0;
const ok = (cond, label, extra = '') => { if (cond) pass++; else { fail++; console.error(`FAIL: ${label} ${extra}`); } };
const REPO = path.resolve(import.meta.dirname, '..');

const { suggestNext, comboLabel } = await import(pathToFileURL(path.join(REPO, 'web/extras.js')).href);
{
  const es = [{ hay: '系统概况 磁盘 使用率' }, { hay: '磁盘 清理' }];
  const r1 = suggestNext(['磁盘', '整理', '系统'], es);
  ok(r1.length === 1 && r1[0].drop === '整理' && r1[0].hit === 1, '丢词建议命中');
  ok(suggestNext(['a'], es).length === 0, '单词不给建议');
  ok(suggestNext(null, es).length === 0, 'null 兜底');
  ok(suggestNext(['x', 'y'], [{ hay: 'z' }]).length === 0, '全灭不给建议');
  ok(comboLabel('磁盘', 'safe') === '磁盘 [safe]', '组合标签');
  ok(comboLabel('磁盘', 'all') === '磁盘', 'all 不算组合');
  ok(comboLabel('', 'safe') === '', '空词不记');
}

{
  const app = fs.readFileSync(path.join(REPO, 'web/app.js'), 'utf8');
  ok(app.includes('suggestNext(rawTokens') && app.includes('data-sug="dropword"'), '①丢词建议接线');
  ok(app.includes('comboLabel(query, listFilter)'), '②组合记忆');
  ok(app.includes('data-gtoggle'), '③搜索态分组折叠');
  ok(app.includes("highlightHtml(a.description || p.summary || '', query, esc)"), '④desc 高亮');
  ok(app.includes('项 · 来自'), '⑤计数徽标');
  ok(app.includes('qClear'), '⑥清空按钮');
  ok(app.includes("digitPick(e.key"), '⑦数字快捷选择在位');
  ok(app.includes('data-hist-x'), '⑨历史单条删');
  const html = fs.readFileSync(path.join(REPO, 'web/index.html'), 'utf8');
  ok(html.includes('id="qClear"'), '⑥清空按钮 DOM');
  const css = fs.readFileSync(path.join(REPO, 'web/style.css'), 'utf8');
  ok(css.includes('.chip-x') && css.includes('.q-clear'), '样式');
}

console.log(`通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
