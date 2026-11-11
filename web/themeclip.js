// web/themeclip.js —— 设置/主题/剪贴板域（第 249 轮 v4 清债第九步：从 app.js 注入式迁出）
// 5 个函数（applyTheme/applyAccent/applyFontScale/cycleTheme + showClipPanel）。注入式 + 整域内聚。
import { normalizeTheme, resolveTheme, normalizeAccent, classifyClip } from './extras.js';

export function createThemeClip(ui) {
  const { esc, t, lang, el, setCount, hidePanels, PREF, loadClipHist, saveClipHist, pushThemeToFrame, __panels, accentRef } = ui;

/** 字体三档（小/中/大）：html[data-font-scale]，CSS 用 rem 级放大 */
function applyFontScale() {
  const v = localStorage.getItem('zerokit.font-scale') || 'm';
  document.documentElement.dataset.fontScale = v;
  pushThemeToFrame();   // 第一百二十一轮④：字号变化也推给插件页面
}

function applyAccent() {
  document.documentElement.dataset.accent = normalizeAccent(accentRef());
}

function applyTheme() {  const choice = normalizeTheme(localStorage.getItem(PREF.theme));
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
  const resolved = resolveTheme(choice, prefersDark);
  document.documentElement.dataset.theme = resolved;
  // 第一百八十七轮⑥：切换无闪烁——color-scheme 同步原生控件，meta theme-color 同步浏览器框底色
  document.documentElement.style.colorScheme = resolved;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
  meta.content = resolved === 'light' ? '#f4f6fa' : '#0e1013';
  // 第四十七轮：主题按钮收进抽屉（openThemePop 渲染时带当前档位），顶栏不再有 themeBtn
}

function cycleTheme() {
  const order = ['system', 'dark', 'light'];
  const now = normalizeTheme(localStorage.getItem(PREF.theme));
  const next = order[(order.indexOf(now) + 1) % order.length];
  try { localStorage.setItem(PREF.theme, next); } catch { /* 隐私模式 */ }
  applyTheme();
}

/** #/clip 剪贴板历史面板：可回写、单条删、清空。 */
function showClipPanel() {
  loadClipHist();   // 打开即重读——别拿模块加载时的旧快照
  hidePanels();
  mode = 'clip';
  el.modeLabel.textContent = '📋 剪贴板';
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  if (location.hash !== '#/clip') history.replaceState(null, '', '#/clip');
  const panel = el.allowView;   // 复用面板容器（与定时任务同款）
  __panels().showPanelAnimated(panel);
  const rows = clipHist.length
    ? clipHist.map((c, i) => `
      <div class="clip-row" data-i="${i}">
        <span class="clip-kind">${classifyClip(c.text).kind}</span>
        <span class="clip-text" title="${esc(c.text.slice(0, 200))}">${esc(c.text.slice(0, 80))}${c.full > 500 ? ` …（${c.full} 字符）` : ''}</span>
        <span class="clip-at">${new Date(c.at).toLocaleTimeString()}</span>
        <button class="ghost" data-write="${i}" title="${esc(t('tlWriteBack'))}">↩</button>
        <button class="ghost" data-del="${i}" title="${esc(t('tlDelItem'))}" aria-label="${esc(t('tlDelItem'))}">✕</button>
      </div>`).join('')
    : '<div class="empty" role="status">还没有剪贴板历史——复制点东西再点 📋 按钮</div>';
  panel.innerHTML = `
    <div class="panel-head">
      <h2>📋 剪贴板历史</h2>
      <div class="panel-tools">
        <span class="dim">本地保留最近 ${clipHist.length}/20 条 · 不上报</span>
        <button class="ghost" id="clipClear">清空历史</button>
        <button class="ghost" id="clipBack">返回</button>
      </div>
    </div>
    <div class="clip-rows">${rows}</div>`;
  panel.querySelector('#clipBack').addEventListener('click', () => { location.hash = '#/'; });
  panel.querySelector('#clipClear').addEventListener('click', () => {
    clipHist = [];
    saveClipHist();
    showClipPanel();
  });
  panel.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    clipHist.splice(Number(b.dataset.del), 1);
    saveClipHist();
    showClipPanel();
  }));
  panel.querySelectorAll('[data-write]').forEach((b) => b.addEventListener('click', async () => {
    const c = clipHist[Number(b.dataset.write)];
    try { await navigator.clipboard.writeText(c.text); setCount('已写回剪贴板'); }
    catch { setCount('写剪贴板被浏览器拒绝'); }
  }));
}
  return { applyAccent, applyFontScale, applyTheme, cycleTheme, showClipPanel };
}
