// web/keys.js —— 键盘域（第 241 轮 v4 清债第一步试点：从 app.js 拆出）
// 注入式拆分：app.js 传入 UI 依赖（setCount/esc/t），本文件不 import app——避免循环依赖。
// 拆分方案见 docs/debt/app-split-plan.md 第 1 步（方案已按试点结论更新为注入式）。
import { KEYMAP, KEYMAP_SCOPES, filterKeymap, keymapConflicts, keysGateOn, keysDisabledHint } from './extras.js';

/** 创建键盘域函数集（ui = { setCount, esc, t, lang } 由 app.js 注入） */
export function createKeys(ui) {
  const { setCount, esc, t, lang } = ui;
  let keysHintShownAt = 0;
  function keysGateBlocks(e) {
    if (keysGateOn(localStorage.getItem('zerokit.keys.master'))) return false;
    if (e.key === '?' || e.key === 'Escape') return false;
    const el = e.target;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return false;
    if (Date.now() - keysHintShownAt > 8000) {
      keysHintShownAt = Date.now();
      try { setCount(keysDisabledHint()); } catch { /* el 尚未就绪 */ }
    }
    return true;
  }
  function showHotkeyCheat() {
    document.getElementById('hotkeyCheat')?.remove();
    const ov = document.createElement('div');
    ov.className = 'overlay'; ov.id = 'hotkeyCheat';
    const gateOff = !keysGateOn(localStorage.getItem('zerokit.keys.master'));
    const conflicts = new Set(keymapConflicts());
    const scopeBtns = KEYMAP_SCOPES.map((s) =>
      `<button class="chip${'all' === s.id ? ' on' : ''}" data-kh-scope="${s.id}">${lang === 'en' ? s.en : s.zh}</button>`).join('');
    const renderGroups = (rows) => KEYMAP_SCOPES.filter((s) => s.id !== 'all')
      .filter((s) => rows.some((r) => r.scope === s.id))
      .map((s) => {
        const grp = rows.filter((r) => r.scope === s.id);
        return `<div class="kh-group"><div class="kh-scope">${lang === 'en' ? s.en : s.zh}</div><table class="kh-table"><tbody>${
          grp.map((r) => `<tr${conflicts.has(r.key) ? ' class="kh-conflict"' : ''}><td><kbd>${esc(r.key)}</kbd></td><td>${esc(lang === 'en' ? r.en : r.zh)}</td></tr>`).join('')
        }</tbody></table></div>`;
      }).join('');
    ov.innerHTML = `<div class="modal kh-modal" role="dialog" aria-modal="true">
      <div class="ps-head"><h3>${t('keysManualTitle')}</h3><span class="sub">${t('keysManualSub')}</span></div>
      ${gateOff ? `<div class="help warn">${t('keysGateOffHint')}</div>` : ''}
      <div class="chips">${scopeBtns}</div>
      <input id="khQuery" class="log-query" placeholder="${t('keysSearchPh')}">
      <div id="khBody" class="kh-body"></div>
      <div class="actions"><button class="ghost" id="khClose">${t('close')}</button></div>
    </div>`;
    document.body.appendChild(ov);
    const qEl = ov.querySelector('#khQuery');
    let curScope = 'all';
    const paint = () => {
      ov.querySelector('#khBody').innerHTML = renderGroups(filterKeymap(qEl.value, curScope)) || `<div class="ps-empty">${t('keysNoHit')}</div>`;
      ov.querySelectorAll('[data-kh-scope]').forEach((b) => b.classList.toggle('on', b.dataset.khScope === curScope));
    };
    ov.querySelectorAll('[data-kh-scope]').forEach((b) => b.addEventListener('click', () => { curScope = b.dataset.khScope; paint(); }));
    qEl.addEventListener('input', paint);
    ov.querySelector('#khClose').addEventListener('click', () => ov.remove());
    ov.addEventListener('click', (ev) => { if (ev.target === ov) ov.remove(); });
    document.addEventListener('keydown', function onEsc(ev) {
      if (ev.key === 'Escape') { ov.remove(); document.removeEventListener('keydown', onEsc); }
    });
    qEl.focus();
    paint();
  }
  function showKeyHelp() { showHotkeyCheat(); }
  return { keysGateBlocks, showHotkeyCheat, showKeyHelp };
}
