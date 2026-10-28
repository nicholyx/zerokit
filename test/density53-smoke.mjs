/**
 * 第五十三轮：结果区信息密度冒烟。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0; let fail = 0;
const ok = (cond, label, extra = '') => { if (cond) pass++; else { fail++; console.error(`FAIL: ${label} ${extra}`); } };
const REPO = path.resolve(import.meta.dirname, '..');

const { cellDisplay, tableDensity, kvCollapsed } = await import(pathToFileURL(path.join(REPO, 'web/extras.js')).href);
{
  const e = cellDisplay(null); ok(e.kind === 'empty' && e.text === '—', '①空值 —');
  const n = cellDisplay(1234); ok(n.kind === 'num' && n.numeric, '数字判定');
  const t = cellDisplay('正常文本'); ok(t.kind === 'text' && t.full === null, '短文本不截断');
  const c = cellDisplay('x'.repeat(60)); ok(c.kind === 'clip' && c.text.endsWith('…') && c.full.length === 60, '长文本截断+full');
  const d = cellDensity3();
  function cellDensity3() { return tableDensity('compact'); }
  ok(d.row === '30px', '紧凑档');
  ok(tableDensity('normal').row === '38px', '标准档');
  ok(tableDensity('relaxed').row === '48px', '宽松档');
  ok(tableDensity('bogus').row === '38px', '非法档兜底标准');
  const s0 = kvCollapsed([], 'k1', true); ok(s0.includes('k1'), '折叠加入');
  const s1 = kvCollapsed(s0, 'k1', false); ok(!s1.includes('k1'), '展开移除');
  const s2 = kvCollapsed('not-array', 'k2', true); ok(s2.includes('k2'), '脏存储兜底');
}

{
  const app = fs.readFileSync(path.join(REPO, 'web/app.js'), 'utf8');
  ok(app.includes('class="empty-cell"'), '⑧KV 空值 — 接线');
  ok(app.includes('kv-clip') && app.includes('data-full'), '②KV 截断+复制全文');
  ok(app.includes("localStorage.getItem('zerokit.tdensity')"), '③密度记忆读');
  ok(app.includes("localStorage.setItem('zerokit.tdensity'"), '③密度记忆写');
  ok(app.includes('data-dens='), '③密度按钮');
  ok(app.includes('density-'), '③密度容器类');
  ok(app.includes('overFields'), '⑥列超限提示');
  ok(app.includes('rmeta'), '⑤元信息行');
  ok(app.includes('font-variant-numeric: tabular-nums') || fs.readFileSync(path.join(REPO, 'web/style.css'), 'utf8').includes('tabular-nums'), '⑦等宽数字');
}

console.log(`通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
