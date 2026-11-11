// text175-smoke：第一百七十五轮——结果区文本工具
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- text175 ${extra}`); } };
console.log('text175-smoke');

const E = await import('../web/extras.js');
const app = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
const css = readFileSync(path.join(PKG_ROOT, 'web', 'style.css'), 'utf8');

// ② 行模型
{
  const small = E.textLines('a\nb\nc');
  check('② 小文本不折叠', small.collapsed === false && small.total === 3 && small.rows.length === 3);
  const big = E.textLines(Array.from({ length: 250 }, (_, i) => `line${i}`).join('\n'));
  check('② >200 行折叠到 50', big.collapsed === true && big.rows.length === 50 && big.hidden === 200 && big.total === 250);
  const edge = E.textLines(Array.from({ length: 200 }, (_, i) => 'x').join('\n'));
  check('② 恰 200 行不折', edge.collapsed === false);
  check('② 行号从 1', E.textLines('x').rows[0].no === 1);
}
// ⑤ 统计
{
  const st = E.textStats('hello\nworld!!\nfoo');
  check('⑤ 字符数', st.chars === 17);
  check('⑤ 行数', st.lines === 3);
  check('⑤ 最长行', st.longest === 7);
  check('⑤ 空文本', E.textStats('').chars === 0 && E.textStats('').lines === 1);
}
// ⑥ 复制三形态
{
  check('⑥ 原文', E.copyTextRaw('a\nb') === 'a\nb');
  const num = E.copyWithNumbers('a\nb').split('\n');
  check('⑥ 带行号', num[0].includes('1') && num[0].includes('a') && num[1].includes('2') && num[1].includes('b'));
  const titled = E.copyWithTitle('正文', '我的标题');
  check('⑥ 首行标题', titled.startsWith('# 我的标题') && titled.includes('正文'));
  check('⑥ 标题截 60', E.copyWithTitle('x', '标'.repeat(80)).split('\n')[0].length <= 62);
}
// ⑦ URL 提取
{
  const us = E.extractUrls('见 https://a.dev/x?y=1 和 http://b.com/z（括号后）');
  check('⑦ 提取两条', us.length === 2 && us[0].url === 'https://a.dev/x?y=1');
  check('⑦ 中文括号断开', us[1].url === 'http://b.com/z');
  check('⑦ 无 URL 空数组', E.extractUrls('没有链接').length === 0);
}
// 接线
check('① string data 分支', app.includes("typeof res.data === 'string'") && app.includes('renderTextView(rawText'));
check('② 折叠展开按钮', app.includes('展开全部') && app.includes("data-tv-act=\"expand\""));
check('③ wrap 持久化', app.includes("zerokit.textview.wrap"));
check('④ 行选+Enter 复制', app.includes("classList.toggle('sel')") && app.includes('shiftKey') && app.includes('已复制'));
check('⑤ 统计条（250 轮起 renderTextView 在 web/panels.js）', readFileSync(path.join(PKG_ROOT, 'web', 'panels.js'), 'utf8').includes('tv-stat') && readFileSync(path.join(PKG_ROOT, 'web', 'panels.js'), 'utf8').includes('最长'));
check('⑥ 三复制形态', app.includes('copy-raw') && app.includes('copy-num') && app.includes('copy-title'));
check('⑦ URL 可点', app.includes('linkifyText') && app.includes('target="_blank" rel="noopener noreferrer"'));
check('⑧ 另存 .txt', app.includes('save-txt') && app.includes("a.download = `zerokit-"));
check('CSS 接线', css.includes('.text-view') && css.includes('.tv-row.sel') && css.includes('.tv-url'));
check('renderResult 尾绑交互', app.includes('bindTextView(res)'));

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
