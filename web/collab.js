// 第三百一十一轮：协作面板——在线会话 / 当前锁 / 频控计数（读 /api/mcp-sessions 快照）
let collabTimer = null;

export function createCollab() {
  return { showCollab, stopCollab };
}

export function showCollab() {
  hidePanels();
  modeRef.set('collab');
  el.modeLabel.textContent = '协作';
  if (location.hash !== '#/collab') history.replaceState(null, '', '#/collab');
  el.allowView.innerHTML = `
    <h2 class="ps-title">协作（--broadcast 实时面）</h2>
    <div class="help" id="collabState">读取中…</div>
    <div id="collabBody"></div>`;
  const refresh = async () => {
    try {
      const snap = await api('/api/mcp-sessions');
      const body = document.getElementById('collabBody');
      const state = document.getElementById('collabState');
      if (!snap?.running) {
        if (state) state.textContent = 'mcp serve 未运行（或 15 秒无心跳）。';
        if (body) body.innerHTML = `<div class="ps-empty" role="status">启动协作面：<code>zkit mcp serve --broadcast --http 31800</code>，然后本面板自动显示在线会话/锁/频控计数。</div>`;
        return;
      }
      if (state) state.textContent = `运行中 · ${snap.count} 个在线会话 · 最近心跳 ${String(snap.ts).slice(11, 19)}`;
      const sessRows = (snap.sessions ?? []).map((s2) => `<tr><td>${esc(s2.clientId)}</td><td>${esc(String(s2.connectedAt).slice(11, 19))}</td><td>${esc((s2.filters ?? []).join(', ') || '全收')}</td></tr>`).join('');
      const lockRows = (snap.locks ?? []).map((l) => `<tr><td>${esc(l.tool)}</td><td>${esc(l.holder)}</td><td>${esc(l.since)}</td></tr>`).join('');
      if (body) body.innerHTML = `
        <table><thead><tr><th>在线会话</th><th>连于</th><th>过滤</th></tr></thead>
        <tbody>${sessRows || '<tr><td colspan="3" class="ps-empty">无</td></tr>'}</tbody></table>
        <table style="margin-top:12px"><thead><tr><th>持有的锁</th><th>持有者</th><th>自</th></tr></thead>
        <tbody>${lockRows || '<tr><td colspan="3" class="ps-empty">无锁在持</td></tr>'}</tbody></table>
        <div class="help" style="margin-top:12px">频控丢弃 ${snap.droppedBroadcasts ?? 0} 条 · 过滤拦截 ${snap.filteredBroadcasts ?? 0} 条</div>`;
    } catch (e) {
      const state = document.getElementById('collabState');
      if (state) state.textContent = `读取失败：${e.message}`;
    }
  };
  void refresh();
  clearInterval(collabTimer);
  collabTimer = setInterval(refresh, 3000);
}

export function stopCollab() { clearInterval(collabTimer); collabTimer = null; }
