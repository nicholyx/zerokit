/**
 * 第五十二轮：键盘流冒烟。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0; let fail = 0;
const ok = (cond, label, extra = '') => { if (cond) pass++; else { fail++; console.error(`FAIL: ${label} ${extra}`); } };
const REPO = path.resolve(import.meta.dirname, '..');

const { keyHelpList } = await import(pathToFileURL(path.join(REPO, 'web/extras.js')).href);
{
  const rows = keyHelpList();
  ok(Array.isArray(rows) && rows.length >= 15, `键位表 ${rows.length} 行`);
  ok(rows.every((r) => typeof r.key === 'string' && typeof r.what === 'string' && r.key && r.what), '每行有 key+what');
  ok(rows.some((r) => r.key.includes('PgUp')), '含 PgUp/PgDn');
  ok(rows.some((r) => r.key === 'F'), '含 F 收藏');
  ok(rows.some((r) => r.key === 'T'), '含 T 标签');
  ok(rows.some((r) => r.key === '?'), '含 ? 帮助');
}

{
  const app = fs.readFileSync(path.join(REPO, 'web/app.js'), 'utf8');
  ok(app.includes("e.key === 'PageDown'") && app.includes("e.key === 'Home'"), '①②翻页/首尾已在位');
  ok(app.includes("key === 'y'") && app.includes("key === 'e'"), '③结果区 Y/E');
  ok(app.includes("toggleFavorite(favorites, key)") && app.includes("t('favOn')"), '④F 收藏');
  ok(app.includes('showTagPanel') && app.includes('data-tg'), '⑤T 标签面板');
  ok(app.includes('batchFocus') && app.includes("e.altKey && (e.key === 'ArrowDown'"), '⑥Alt+↑↓ 篮内移位');
  ok(app.includes('showKeyHelp'), '⑧? 帮助浮层');
  const css = fs.readFileSync(path.join(REPO, 'web/style.css'), 'utf8');
  ok(css.includes('.kh-table') && css.includes('.tag-panel'), '样式');
}

console.log(`通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
