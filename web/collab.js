// 第三百一十一轮：协作面板——在线会话 / 当前锁 / 频控计数（读 /api/mcp-sessions 快照）
// 341 修：工厂接 deps 注入（原版直接引用外部名——运行时 ReferenceError，CDP 烟测首抓）
let collabTimer = null;
let collabDeps = null;

export function createCollab(deps) {
  collabDeps = deps;
  return { showCollab, stopCollab };
}

export function showCollab() {
  const { esc, el, api, hidePanels, modeRef } = collabDeps;
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
      if (state) state.innerHTML = `运行中 · ${snap.count} 个在线会话 · 最近心跳 ${String(snap.ts).slice(11, 19)} <button class="ghost mini" id="collabRefresh">手动刷新</button>`;
      document.getElementById('collabRefresh')?.addEventListener('click', () => void refresh());
      const sessRows = (snap.sessions ?? []).map((s2) => `<tr><td>${esc(s2.clientId)}</td><td>${esc(String(s2.connectedAt).slice(11, 19))}</td><td>${esc((s2.filters ?? []).join(', ') || '全收')}</td></tr>`).join('');
      const lockRows = (snap.locks ?? []).map((l) => `<tr><td>${esc(l.tool)}</td><td>${esc(l.holder)}</td><td>${esc(l.since)}</td></tr>`).join('');
      if (body) body.innerHTML = `
        <table><thead><tr><th>在线会话</th><th>连于</th><th>过滤</th></tr></thead>
        <tbody>${(snap.sessions ?? []).map((s2) => `<tr><td>${esc(s2.clientId)}</td><td>${esc(String(s2.connectedAt).slice(11, 19))}</td><td><input class="collab-filter" data-csession="${esc(s2.session)}" value="${esc((s2.filters ?? []).join(', '))}" placeholder="全收（逗号分隔前缀）" aria-label="过滤前缀"></td></tr>`).join('') || '<tr><td colspan="3" class="ps-empty">无</td></tr>'}</tbody></table>
        <table style="margin-top:12px"><thead><tr><th>持有的锁</th><th>持有者</th><th>自</th><th></th></tr></thead>
        <tbody>${(snap.locks ?? []).map((l) => `<tr><td>${esc(l.tool)}</td><td>${esc(l.holder)}</td><td>${esc(l.since)}</td><td><button class="ghost mini" data-cunlock="${esc(l.tool)}">释放</button></td></tr>`).join('') || '<tr><td colspan="4" class="ps-empty">无锁在持</td></tr>'}</tbody></table>
        <div class="help" style="margin-top:12px">频控丢弃 ${snap.droppedBroadcasts ?? 0} 条 · 过滤拦截 ${snap.filteredBroadcasts ?? 0} 条</div>
        ${(snap.ops ?? []).length ? `<h3 class="sec-title" style="margin-top:12px">最近操作</h3><table><thead><tr><th>时间</th><th>操作</th><th>目标</th></tr></thead><tbody>${snap.ops.map((o) => `<tr><td>${esc(o.ts)}</td><td>${esc(o.op)}</td><td>${esc(o.target)}</td></tr>`).join('')}</tbody></table>` : ''}`;
      // 312③⑤ 操作面（341 重写时补回）：过滤输入回车提交 + 锁释放按钮
      body.querySelectorAll('.collab-filter').forEach((inp) => {
        inp.addEventListener('keydown', (ev) => {
          if (ev.key !== 'Enter') return;
          const filters = inp.value.split(',').map((x) => x.trim()).filter(Boolean);
          void api('/api/mcp-sessions/filters', { method: 'POST', body: { session: inp.getAttribute('data-csession'), filters } });
        });
      });
      body.querySelectorAll('[data-cunlock]').forEach((b) => {
        b.addEventListener('click', () => { void api('/api/mcp-sessions/unlock', { method: 'POST', body: { tool: b.getAttribute('data-cunlock') } }).then(() => void refresh()); });
      });
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
