// table176-smoke：第一百七十六轮——表格视图进阶
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- table176 ${extra}`); } };
console.log('table176-smoke');

const E = await import('../web/extras.js');
const app = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
const css = readFileSync(path.join(PKG_ROOT, 'web', 'style.css'), 'utf8');

const rows = [
  { name: 'a', ms: 100, tag: 'x' },
  { name: 'b', ms: 300, tag: 'y' },
  { name: 'c', ms: 200, tag: 'x' },
];

// ⑧ colTooltipStats
{
  const tip = E.colTooltipStats(rows, 'ms');
  check('⑧ 数值列 tooltip 五段', tip === '3 项 · x̄ 200 · 100~300 · Σ 600', tip);
  const tip2 = E.colTooltipStats(rows, 'tag');
  check('⑧ 文本列非空计数', tip2 === '3 条非空', tip2);
  check('⑧ 空表不崩', E.colTooltipStats([], 'ms') === '0 条非空');
}
// ⑧ shouldFreeze
{
  check('⑧ ≥4 可见列冻结', E.shouldFreeze(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd']) === true);
  check('⑧ 3 列不冻结', E.shouldFreeze(['a', 'b', 'c'], ['a', 'b', 'c']) === false);
  check('⑧ 7 列隐 5 剩 2 不冻结', E.shouldFreeze([1, 2, 3, 4, 5, 6, 7], [1, 2]) === false);
}
// ⑦ tableSizeBadge
{
  check('⑦ 行×列徽标', E.tableSizeBadge(rows, ['name', 'ms']) === '3 行 × 2 列');
  check('⑦ 空表', E.tableSizeBadge([], []) === '0 行 × 0 列');
}
// ③ batchColVis
{
  const cols = ['name', 'ms', 'tag'];
  const vis = { name: true, ms: true, tag: true };
  const none = E.batchColVis(cols, vis, 'none');
  check('③ 仅主键', none.name === true && none.ms === false && none.tag === false);
  const num = E.batchColVis(cols, vis, 'numeric', ['ms']);
  check('③ 只看数值保主键', num.name === true && num.ms === true && num.tag === false);
  const all = E.batchColVis(cols, { name: true, ms: false }, 'all');
  check('③ 全选恢复', all.ms === true);
}
// 接线
check('⑤ 列头 tooltip 内联', app.includes('title="${esc(colTooltipStats(view, c))}"'));
check('⑦ 徽标进表格', app.includes('tbl-size') && app.includes('tableSizeBadge(view, visCols)'));
check('⑧ freeze 类', app.includes("freeze && ci === 0 ? ' freeze-col'"));
check('③ 批量按钮', app.includes('data-cvb="numeric"') && app.includes('batchColVis(cols, vis, b.dataset.cvb'));
check('⑥ 行高亮记忆', app.includes('tableRowHighlights') && app.includes("classList.toggle('row-hl')"));
check('⑥ 不抢全文弹层', app.includes("ev.target.closest('td.cell-clip')"));
check('CSS freeze/sticky', css.includes('th.freeze-col') && css.includes('position: sticky'));
check('CSS row-hl', css.includes('tr.row-hl > td'));

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
