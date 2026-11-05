// mobile143-smoke：第一百四十三轮——移动与窄屏体验（静态断言）
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(path.join(PKG_ROOT, 'web', 'style.css'), 'utf8');
const APP = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
const HTML = readFileSync(path.join(PKG_ROOT, 'web', 'index.html'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- mobile143`); } };
console.log('mobile143-smoke');

// ① 拇指操作条
check('① mobileBar 容器+双按钮（文案 JS 填）', HTML.includes('id="mobileBar"') && HTML.includes('mbBack') && HTML.includes('mbRun') && APP.includes("mbBack.textContent = t('mbBack')"));
check('① CSS fixed+safe-area', CSS.includes('#mobileBar') && CSS.includes('safe-area-inset-bottom') && CSS.includes('.has-mobilebar'));
check('① JS 返回/执行镜像', APP.includes("mbBack.addEventListener('click'") && APP.includes("document.getElementById('runBtn')"));

// ② 惯性滚动+滚动条隐藏
check('② touch 滚动', CSS.includes('#list { -webkit-overflow-scrolling: touch') && CSS.includes('overscroll-behavior-y'));
check('② 窄屏藏滚动条', /#list::-webkit-scrollbar { display: none; }/.test(CSS) && CSS.includes('scrollbar-width: none'));

// ③ 44px 触控目标
check('③ pointer:coarse 44px', CSS.includes('@media (pointer: coarse) and (max-width: 720px)') && CSS.includes('min-height: 44px') && CSS.includes('min-height: 40px'));

// ④ 无键盘隐藏快捷键提示
check('④ hover:none 藏 kbd-hint', CSS.includes('@media (hover: none) and (pointer: coarse)') && CSS.includes('.kbd-hint, .shortcut-row { display: none; }'));

// ⑤ 下拉刷新
check('⑤ touchstart/move/end 三段', APP.includes('touchstart') && APP.includes('touchmove') && APP.includes('touchend'));
check('⑤ 阈值 64px 松手触发', APP.includes('dy > 64') && APP.includes("hint.textContent = dy > 64 ? t('pullRelease') : t('pullDown');"));

// ⑥ 过渡区双栏提示
check('⑥ 721–1080 提示条', CSS.includes('(min-width: 721px) and (max-width: 1080px)') && CSS.includes('#splitHint') && APP.includes("id = 'splitHint'"));

// ⑦ 表格横滑提示
check('⑦ slideable 挂类+scrolled 消失', APP.includes("wrap.classList.add('slideable')") && CSS.includes('.tbl-wrap.slideable::after') && CSS.includes('.tbl-wrap.slideable.scrolled::after { display: none; }'));

// ⑧ 命令面板窄屏全屏
check('⑧ palette 全屏化（动态 #paletteOverlay）', CSS.includes('#paletteOverlay { padding: 0; }') && CSS.includes('#paletteOverlay .palette-box { width: 100%; height: 100vh;'));

// ⑨ hover 退化按压
check('⑨ hover:none 按压替代', CSS.includes('@media (hover: none)') && CSS.includes('li.item:active'));

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
