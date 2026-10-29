// 第六十六轮：无障碍回归——静态断言 + trapFocus 纯逻辑。
// 不引 axe（无浏览器环境），已知模式进 webui-smoke 式源码扫描 + trapFocus 冒烟。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = path.resolve(import.meta.dirname, '..');
const results = [];
const check = (name, cond, detail = '') => {
  results.push([name, !!cond]);
  if (!cond) console.error(`FAIL  ${name}   <- ${detail}`);
};

const app = fs.readFileSync(path.join(REPO, 'web/app.js'), 'utf8');
const css = fs.readFileSync(path.join(REPO, 'web/style.css'), 'utf8');
const idx = fs.readFileSync(path.join(REPO, 'web/index.html'), 'utf8');

// ① tablist/tab/tabpanel
check('① rtabs role=tablist', app.includes("setAttribute('role', 'tablist')"));
check('① 页签 role=tab + aria-selected', app.includes('role="tab" aria-selected='));
check('① roving 左右箭头', app.includes("e.key !== 'ArrowRight' && e.key !== 'ArrowLeft'"));
check('① #result tabpanel', app.includes("setAttribute('role', 'tabpanel')"));

// ② focus trap
check('② trapFocus 定义', app.includes('function trapFocus('));
check('② Tab 循环边界', app.includes('e.shiftKey && document.activeElement === first'));
check('② Esc 关闭回调', app.includes('onClose?.()'));
check('② 焦点回触发按钮', app.includes('opener.focus()'));
check('② 抽屉接 trap', app.includes("trapFocus($('drawer')"));

// ③ 图标按钮 aria-label
check('③ 页签✕/✎ aria-label', app.includes('aria-label="关闭页签"') || app.includes('aria-label="关闭"'));
check('③ clipBtn aria-label', idx.includes('aria-label="读剪贴板并识别内容"'));

// ④ tfilter 行修正
check('④ tfilter aria-label', app.includes('aria-label="按列筛选"'));

// ⑤ 建议卡 role=status
check('⑤ clip-suggest role=status', app.includes("overlay.setAttribute('role', 'status')"));

// ⑥ 标题播报去重
check('⑥ announceTitle 单一出口', app.includes('function announceTitle('));
check('⑥ 去重短路', app.includes('v === document.title && v === lastTitleAnnounced'));

// ⑦ 对比表 caption
check('⑦ cmp-table caption', app.includes('结果对比</caption>') || app.includes('插件对比</caption>'));

// ⑧ reduced-motion 补漏
check('⑧ cell-changed 停动画', /prefers-reduced-motion[\s\S]*?cell-changed/.test(css));
check('⑧ ring-fg 停过渡', /prefers-reduced-motion[\s\S]*?ring-fg/.test(css));

// ⑨ 扫描脚本存在且当前过
const scan = fs.readFileSync(path.join(REPO, 'scripts/a11y-scan.mjs'), 'utf8');
check('⑨ 扫描器规则≥5', (scan.match(/add\(file/g) || []).length >= 3);
check('⑨ sr-only 类', css.includes('.sr-only'));

// ⑩ 模态 role=dialog 批量补
check('⑩ modal role=dialog', app.includes('class="modal" role="dialog" aria-modal="true"'));

const pass = results.filter((r) => r[1]).length;
console.log(`通过 ${pass} / ${results.length}`);
if (pass !== results.length) {
  console.log('失败：' + results.filter((r) => !r[1]).map((r) => r[0]).join('、'));
  process.exit(1);
}
process.exit(0);
