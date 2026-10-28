/**
 * 第五十轮：主题与视觉打磨冒烟。
 * 纯函数 + CSS 静态断言，自包含。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0; let fail = 0;
const ok = (cond, label, extra = '') => { if (cond) pass++; else { fail++; console.error(`FAIL: ${label} ${extra}`); } };
const REPO = path.resolve(import.meta.dirname, '..');

const { contrastRatio, typeScaleStep } = await import(pathToFileURL(path.join(REPO, 'web/extras.js')).href);
{
  ok(Math.abs(contrastRatio('#000', '#fff') - 21) < 0.01, '黑白=21');
  ok(Math.abs(contrastRatio('#fff', '#000') - 21) < 0.01, '参数顺序无关');
  ok(Math.abs(contrastRatio('#123', '#123') - 1) < 0.01, '同色=1（#rgb 短格式）');
  const dim = contrastRatio('#99a1b0', '#0e1013');
  ok(dim >= 4.5, `暗色次要文字 AA（实测 ${dim.toFixed(2)}）`);
  const bad = contrastRatio('#f0685f', '#161a20');
  ok(bad >= 3, `危险色按钮大字 AA（实测 ${bad.toFixed(2)}）`);
  ok(typeScaleStep(14, 0) === 14, 'step=0 原样');
  ok(typeScaleStep(14, 2) === 22, 'step=+2 → 22px');
  ok(typeScaleStep(14, -1) === 11, 'step=-1 → 11px');
  ok(typeScaleStep(16, 1) === 20, '16→+1 → 20px');
}

{
  const css = fs.readFileSync(path.join(REPO, 'web/style.css'), 'utf8');
  ok(css.includes('--fs-lg') && css.includes('--fs-sm'), '①字号阶梯变量');
  ok(css.includes('--sp-1') && css.includes('--sp-4'), '②间距阶梯变量');
  ok(css.includes('--fg-dim: #99a1b0'), '③暗色次要文字提亮');
  ok(css.includes('tbody tr:nth-child(even)'), '④斑马纹');
  ok(css.includes('--danger') && css.includes('.btn-danger'), '⑤危险语义色');
  ok(css.includes('::-webkit-scrollbar'), '⑥滚动条细化');
  ok(css.includes('--tr-fast') && css.includes('--tr-slow'), '⑦过渡时长变量');
  ok(css.includes('@media print'), '⑧打印样式');
}

console.log(`通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
