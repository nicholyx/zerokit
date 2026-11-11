// web/logs.js —— 日志/审计面板域（第 247 轮 v4 清债第七步：从 app.js 注入式迁出）
// 4 个函数整域迁出（showLogs/renderLogs + 行渲染 logRowHtml/logDetailHtml）。注入式 + 整域内聚。
import { pageSlice } from './extras.js';

export function createLogs(ui) {
  const { esc, t, lang, el, api, TOKEN, setCount, hidePanels, panelDescBar, skeletonRows, maskSecrets, maskState, exportMime, exportFilename, filterAudit, logsState } = ui;
  // logsState() 返回 app 侧 let 状态的实时快照（{ logsFile, logsPage, logsDecision, logsQuery, logsRange, logsPlugin, logsPlugins }）

async function showLogs() {
  mode = 'logs';
  el.modeLabel.textContent = t('modeLogs');
  el.searchRow.classList.add('hidden');
  hidePanels();
  __panels().showPanelAnimated(el.logsView);
  if (location.hash !== '#/logs') history.replaceState(null, '', '#/logs');
  // 第一百九十轮②：骨架屏推广——异步视图加载前统一骨架占位（避免空白一闪）
  el.logsView.innerHTML = skeletonRows(5).map(() => '<div class="skel-row" aria-hidden="true"></div>').join('');
  await renderLogs();
}

function logDetailHtml(e, i) {
  // 第十九轮④：命令与错误信息默认脱敏（密钥可能随命令行/报错回显）
  const mtext = (t) => (maskState() ? maskSecrets(t) : String(t ?? ''));
  return `<div class="log-detail hidden" id="logDetail${i}">
    <pre>${esc(mtext(e['command'] ?? '（无动作）'))}</pre>
    ${e['error'] ? `<p class="log-error">${esc(mtext(e['error']))}</p>` : ''}
    <div class="log-extra">决策 ${esc(String(e['decision'] ?? '-'))} · 退出码 ${esc(String(e['exitCode'] ?? '-'))} · 输出 ${esc(String(e['outBytes'] ?? 0))} 字节${e['truncated'] ? ' · 已截断' : ''}</div>
    ${e['plugin'] && e['action'] && e['decision'] !== 'deny' ? `<div class="log-replay">${esc(t('logReplay'))}：<code>${esc(`zkit run ${String(e['plugin'])} ${String(e['action'])}`)}</code></div>` : ''}
  </div>`;
}

function logRowHtml(e, i) {
  const mark = e['error'] ? '✗' : (e['decision'] === 'deny' ? '⊘' : '✓');
  const kind = e['error'] ? 'bad' : (e['decision'] === 'deny' ? 'warn' : 'ok');
  const when = e['ts'] ? new Date(String(e['ts'])).toLocaleString() : '';
  return `<button class="log-row" data-log="${i}">
      <span class="log-mark ${kind}">${mark}</span>
      <span class="log-what">${esc(String(e['plugin'] ?? '?'))}<span class="aid">${esc(String(e['action'] ?? ''))}</span></span>
      <span class="log-meta">${esc(String(e['caller'] ?? ''))} · ${esc(String(e['ms'] ?? 0))}ms</span>
      <span class="log-when">${esc(when)}</span>
    </button>${logDetailHtml(e, i)}`;
}

async function renderLogs() {
  const chips = [['', t('logAll')], ['allow', t('logAllow')], ['deny', t('logDeny')], ['error', t('logError')]]
    .map(([id, label]) => `<button class="chip${logsState().get('logsDecision') === id ? ' on' : ''}" data-log-decision="${id}">${label}</button>`).join('');
  // 第九十二轮⑦：快捷过滤 chip——今天 + 插件（语义与 CLI --today/--plugin 一致）
  // 第一百一十三轮①：时间范围四档（全部/今天/7天/30天），向后兼容旧 logsToday
  if (logsState().get('logsToday')) logsState().set('logsRange', 'today');
  const quickChips = AUDIT_RANGES.map((r) => {
    const label = lang === 'en' ? r.en : r.zh;
    return `<button class="chip${logsState().get('logsRange') === r.id ? ' on' : ''}" data-log-range="${r.id}">${label}</button>`;
  }).join('');
  const plugChips = (logsState().get('logsPlugins') ?? []).slice(0, 6).map((p) =>
    `<button class="chip${logsState().get('logsPlugin') === p ? ' on' : ''}" data-log-plugin="${esc(p)}">${esc(p)}</button>`).join('');
  // 第十九轮⑤：自动清理提示——启动时算过一遍超期条目数（trimAuditLog），页头亮出来
  const trimInfo = window.__zkAuditTrim
    ? `<div class="trim-note">🧹 ${t('logTrimmed')(window.__zkAuditTrim)}</div>` : '';
  el.logsView.innerHTML = `
    <div class="ps-head">
      <h2>${t('logsTitle')} <span class="aid">${logsState().get('logsFile') === 'audit' ? 'audit.log' : 'denied.log'}</span></h2>
      <span class="sub">${t('logsSub')}</span>
    </div>
    ${panelDescBar('logs')}
    ${trimInfo}
    <div class="log-tools">
      <div class="chips">${chips}${quickChips}${plugChips ? `<span class="chip-sep">·</span>${plugChips}` : ''}</div>
      <input id="logQuery" class="log-query" placeholder="${t('logFilterPh')}" value="${esc(logsState().get('logsQuery'))}">
      <button class="ghost" id="logCsv" title="${t('logCsvTitle')}">⬇ CSV</button>
      <button class="ghost" id="logJson" title="导出当前筛选为 JSON">⬇ JSON</button>
      <button class="ghost" id="logReload">${t('logReload')}</button>
      <button class="ghost" id="logFile">${logsState().get('logsFile') === 'audit' ? t('logShowDenied') : t('logShowAll')}</button>
    </div>
    <div id="logList" class="log-list"><div class="ps-empty" role="status">${t('loading')}</div></div>`;

  el.logsView.querySelectorAll('[data-log-decision]').forEach((b) => {
    b.addEventListener('click', () => { logsState().set('logsDecision', b.dataset.logDecision); logsState().set('logsPage', 1); renderLogs(); });
  });
  el.logsView.querySelectorAll('[data-log-range]').forEach((b) => {
    b.addEventListener('click', () => { logsState().set('logsRange', b.dataset.logRange); logsToday = logsState().get('logsRange') === 'today'; logsState().set('logsPage', 1); renderLogs(); });
  });
  el.logsView.querySelectorAll('[data-log-plugin]').forEach((b) => {
    b.addEventListener('click', () => { logsState().get('logsPlugin') = logsState().get('logsPlugin') === b.dataset.logPlugin ? '' : b.dataset.logPlugin; logsState().set('logsPage', 1); renderLogs(); });
  });
  $('logQuery').addEventListener('change', () => { logsState().set('logsQuery', $('logQuery').value.trim()); logsState().set('logsPage', 1); renderLogs(); });
  $('logReload').addEventListener('click', renderLogs);
  // 第四十九轮⑥：导出当前过滤视图为 CSV（只含元数据，不含输出正文——审计里可能有敏感串）
  $('logCsv').addEventListener('click', async () => {
    try {
      const params = new URLSearchParams({ file: logsState().get('logsFile'), limit: '200' });
      if (logsState().get('logsDecision')) params.set('decision', logsState().get('logsDecision'));
      if (logsState().get('logsQuery')) params.set('q', logsState().get('logsQuery'));
      if (logsState().get('logsPlugin')) params.set('plugin', logsState().get('logsPlugin'));
      const d2 = await api(`/api/logs?${params}`);
      // 第一百一十三轮⑥：导出与所见一致——时间范围也带上
      if (logsState().get('logsRange')) d2.entries = filterAudit(d2.entries ?? [], { range: logsState().get('logsRange') });
      const es = d2.entries ?? [];
      if (!es.length) { setCount('没有可导出的行'); return; }
      const head = 'time,plugin,action,decision,ms,exitCode';
      const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [head, ...es.map((e) => [
        cell(e.ts), cell(e.plugin), cell(e.action), cell(e.decision), cell(e.ms), cell(e.exitCode),
      ].join(','))].join('\n');
      const blob = new Blob([CSV_BOM + csv], { type: exportMime('csv') });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `zerokit-logs-${logsState().get('logsFile')}${logsState().get('logsRange') ? '-' + logsState().get('logsRange') : ''}${logsState().get('logsDecision') ? '-' + logsState().get('logsDecision') : ''}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click(); URL.revokeObjectURL(a.href);
      setCount(`已导出 ${es.length} 条日志`);
    } catch (err) { setCount(`导出失败：${err.message}`); }
  });
  // 第一百一十三轮⑦：JSON 导出——与 CSV 同筛选（时间范围/决策/插件/关键词全带上）
  $('logJson').addEventListener('click', async () => {
    try {
      const params = new URLSearchParams({ file: logsState().get('logsFile'), limit: '200' });
      if (logsState().get('logsDecision')) params.set('decision', logsState().get('logsDecision'));
      if (logsState().get('logsQuery')) params.set('q', logsState().get('logsQuery'));
      if (logsState().get('logsPlugin')) params.set('plugin', logsState().get('logsPlugin'));
      const d2 = await api(`/api/logs?${params}`);
      if (logsState().get('logsRange')) d2.entries = filterAudit(d2.entries ?? [], { range: logsState().get('logsRange') });
      const es = d2.entries ?? [];
      if (!es.length) { setCount('没有可导出的行'); return; }
      const blob = new Blob([JSON.stringify(es, null, 2)], { type: exportMime('json') });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `zerokit-logs-${logsState().get('logsFile')}${logsState().get('logsRange') ? '-' + logsState().get('logsRange') : ''}${logsState().get('logsDecision') ? '-' + logsState().get('logsDecision') : ''}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(a.href);
      setCount(`已导出 ${es.length} 条日志（JSON）`);
    } catch (err) { setCount(`导出失败：${err.message}`); }
  });
  $('logFile').addEventListener('click', () => {
    logsState().get('logsFile') = logsState().get('logsFile') === 'audit' ? 'denied' : 'audit';
    logsState().set('logsPage', 1);
    renderLogs();
  });

  let data;
  try {
    const params = new URLSearchParams({ file: logsState().get('logsFile'), limit: '200' });
    if (logsState().get('logsDecision')) params.set('decision', logsState().get('logsDecision'));
    if (logsState().get('logsQuery')) params.set('q', logsState().get('logsQuery'));
    if (logsState().get('logsPlugin')) params.set('plugin', logsState().get('logsPlugin'));
    data = await api(`/api/logs?${params}`);
    // 第一百一十三轮①：时间范围统一走 filterAudit 纯函数（今天=本地零点、7d/30d=滚动窗）
    if (logsState().get('logsRange')) data.entries = filterAudit(data.entries ?? [], { range: logsState().get('logsRange') });
    // 插件 chip 候选：从当前页数据的插件集合取（去重保序）
    const prevPlugins = logsState().get('logsPlugins').join(',');
    logsState().get('logsPlugins') = [...new Set((data.entries ?? []).map((e) => e.plugin).filter(Boolean))];
    if (logsState().get('logsPlugins').join(',') !== prevPlugins) {
      // 首次拿到集合（或集合变了）：把插件 chip 增补到「今天」chip 之后，再重绑
      const holder = el.logsView.querySelector('.chips');
      if (holder) {
        holder.querySelectorAll('[data-log-plugin]').forEach((n) => n.remove());
        const frag = document.createDocumentFragment();
        for (const pl of logsState().get('logsPlugins').slice(0, 6)) {
          const b = document.createElement('button');
          b.className = 'chip' + (logsState().get('logsPlugin') === pl ? ' on' : '');
          b.dataset.logPlugin = pl;
          b.textContent = pl;
          frag.appendChild(b);
        }
        holder.appendChild(frag);
        holder.querySelectorAll('[data-log-plugin]').forEach((b) => {
          b.addEventListener('click', () => { logsState().get('logsPlugin') = logsState().get('logsPlugin') === b.dataset.logPlugin ? '' : b.dataset.logPlugin; logsState().set('logsPage', 1); renderLogs(); });
        });
      }
    }
  } catch (e) {
    $('logList').innerHTML = `<div class="ps-empty" role="status">读日志失败：${esc(e.message)}</div>`;
    return;
  }
  const rows = data.entries ?? [];
  // 分页：日志会一直涨，一页 50 条翻着看
  let logCur = logsState().get('logsPage');
  if (!Number.isInteger(logCur) || logCur < 1) logCur = 1;
  if (logCur > Math.max(1, Math.ceil(rows.length / 50))) { logCur = 1; logsState().set('logsPage', 1); }
  const pg = pageSlice(rows, logCur, 50);
  logsState().set('logsPage', pg.page);
  const pager = pg.pages > 1 ? `
    <div class="pager" role="navigation" aria-label="日志分页">
      <button class="ghost mini" data-pg="${Math.max(1, pg.page - 1)}" ${pg.page === 1 ? 'disabled' : ''}>‹ 上一页</button>
      <span class="pg-info">第 ${pg.page} / ${pg.pages} 页 · 共 ${rows.length} 条</span>
      <button class="ghost mini" data-pg="${Math.min(pg.pages, pg.page + 1)}" ${pg.page === pg.pages ? 'disabled' : ''}>下一页 ›</button>
    </div>` : '';
  $('logList').innerHTML = pg.slice.length
    ? pg.slice.map((e) => logRowHtml(e, rows.indexOf(e))).join('') + pager
    : `<div class="ps-empty" role="status">${data.exists ? '没有符合条件的记录' : '还没有日志——执行一次动作就会写进来'}</div>`;
  $('logList').querySelectorAll('[data-pg]').forEach((b) => {
    b.addEventListener('click', () => { logsState().set('logsPage', Number(b.dataset.pg)); renderLogs(); });
  });
  $('logList').querySelectorAll('[data-log]').forEach((row) => {
    row.addEventListener('click', () => {
      $(`logDetail${row.dataset.log}`)?.classList.toggle('hidden');
    });
  });
}
  return { logDetailHtml, logRowHtml, renderLogs, showLogs };
}
