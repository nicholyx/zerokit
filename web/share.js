// web/share.js —— 导出/分享域（第 244 轮 v4 清债第四步：从 app.js 注入式迁出）
// showShareView（只读分享页）/ showShareImport（分享包导入）。注入式同前三步。
import { shareAlive, buildZkresult, exportMime } from './extras.js';

export function createShare(ui) {
  const { esc, t, lang, api, setCount, closeDrawer, alert, hidePanels, isNumericColumn, mdTableVis, replayPolicyWeb, replayShareInWeb, webFingerprint, webValidateSharePack } = ui;

/** 第一百七十九轮⑥：分享打开态——只读渲染 + 来源信息条 + 「自己跑一次」。 */
function showShareView(shareId) {
  const env = readJson(`zerokit.share.${shareId}`, null);
  const view = document.getElementById('view') ?? document.body;
  hidePanels();
  if (!env || !shareAlive(env)) {
    view.innerHTML = `<div class="panel"><div class="empty-art"></div><div class="e-title">${t('shareGoneTitle')}</div><div class="e-hint">${t('shareGoneHint')}</div></div>`;
    return;
  }
  const rows = env.rows ?? [];
  const cols = env.cols ?? [];
  const numericCols = cols.filter((c) => isNumericColumn(rows.map((r) => r?.[c])));
  const tableHtml = rows.length ? mdTableVis(rows, cols, numericCols) : '';
  // 第二百二十八轮③：分享快照导出 zkresult（visCols/rows/at 完整落盘——对方可导入回放）
  const zkr = buildZkresult({ data: rows, ok: true }, { plugin: (env.action || '').split('.')[0], action: (env.action || '').split('.')[1] || '', title: env.action || '' }, window.__zkVersion ?? '');
  view.innerHTML = `<div class="panel share-view">
    <div class="share-meta sub">${t('shareFrom')}「${esc(env.action)}」 · ${new Date(env.at).toLocaleString()} · ${rows.length} ${t('shareRows')} × ${cols.length} ${t('shareCols')} · ${t('shareValid')}</div>
    <div class="share-actions"><button class="primary mini" id="shareRerun">${t('shareRerun')}</button><button class="ghost mini" id="shareZkr">${t('shareZkrBtn')}</button></div>
    <pre class="share-table">${esc(tableHtml)}</pre>
  </div>`;
  document.getElementById('shareZkr')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(zkr, null, 2)], { type: exportMime('json') });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zerokit-share-${shareId}-${zkr.savedAt.slice(0, 10)}.zkresult.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.getElementById('shareRerun')?.addEventListener('click', () => {
    location.hash = '#/';
    setTimeout(() => { const q = document.getElementById('q'); if (q) { q.value = (env.action || '').split('.')[0]; q.dispatchEvent(new Event('input', { bubbles: true })); } }, 100);
  });
}

/** ②③④⑤ 导入分享包视图：校验→展示→重放 */
async function showShareImport(file) {
  let raw;
  try { raw = JSON.parse(await file.text()); }
  catch { $('count').textContent = '分享包不是合法 JSON——文件可能损坏或传错了个普通文件'; return; }
  const v = webValidateSharePack(raw);
  if (!v.ok) { setCount(v.error); return; }
  const pack = v.pack;
  const fp = await webFingerprint(pack);
  const replay = replayPolicyWeb(pack);
  const rows = pack.result !== undefined && Array.isArray(pack.result)
    ? `<div class="table-wrap"><table class="tbl"><thead><tr>${Object.keys(pack.result[0] ?? {}).slice(0, 6).map((c) => `<th>${c}</th>`).join('')}</tr></thead>
       <tbody>${pack.result.slice(0, 8).map((r2) => `<tr>${Object.values(r2).slice(0, 6).map((cv) => `<td>${String(cv ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
       ${pack.result.length > 8 ? `<div class="e-hint">${pack.result.length} 行——前 8 行预览，完整数据在包里</div>` : ''}`
    : (pack.result !== undefined ? `<pre class="code">${JSON.stringify(pack.result, null, 2).slice(0, 600)}</pre>` : `<div class="e-hint">不带结果（非只读动作）</div>`);
  const host = $('result');
  if (!host) return;
  host.innerHTML = `
    <div class="view-head">
      <span class="badge from-share">📨 来自分享包</span>
      <b>${pack.action}</b> <span class="risk-dot" data-risk="${pack.risk}"></span>
      <span class="dim">${pack.risk}</span>
    </div>
    <div class="share-meta">
      制作：${String(pack.createdAt).replace('T', ' ').slice(0, 19)} · ${pack.env.os} · zerokit ${pack.env.appVersion}<br>
      指纹：<code>${fp}</code><br>
      命令：<code>${pack.argv.join(' ')}</code>
      ${pack.note ? `<br>备注：${pack.note}` : ''}
    </div>
    ${rows}
    <div class="action-tier">
      ${replay.allowed
        ? `<button class="primary run-main" id="replayShareBtn">▶ 在本机重放</button>`
        : `<span class="e-hint">✗ ${replay.reason}</span>`}
    </div>`;
  const rb = document.getElementById('replayShareBtn');
  if (rb) rb.addEventListener('click', () => replayShareInWeb(pack));
}
  return { showShareView, showShareImport };
}
