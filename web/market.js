// web/market.js —— 插件市场域（第 246 轮 v4 清债第六步：从 app.js 注入式迁出）
// 9 个函数整域迁出（showMarket/renderMarket 系列 + 安装三态流）。注入式 + 整域内聚（245 轮模式）。

export function createMarket(ui) {
  const { esc, t, lang, api, setCount, hidePanels, panelDescBar, skeletonRows, marketRiskMix, load, risk } = ui;

function marketMsg(text, kind = '') {
  const box = $('marketMsg');
  if (!box) return;
  box.textContent = '';
  box.className = `market-msg ${kind}`;
  box.append(document.createTextNode(text || ''));
  // 第一百二十二轮⑤：安装成功的提示带「查看插件主页」深链——装完第一件事就是去看装了什么
  if (kind === 'ok' && arguments.length > 2 && arguments[2]) {
    const link = document.createElement('button');
    link.className = 'ghost market-msg-link';
    link.textContent = '查看插件主页';
    link.addEventListener('click', () => { location.hash = `#/plugins/${encodeURIComponent(arguments[2])}`; });
    box.append(link);
  }
}

function marketEntryHtml(m, e) {
  const tags = (e.tags || []).length
    ? `<span class="market-tags">${(e.tags || []).map(esc).join(' · ')}</span>` : '';
  const installed = Boolean(e.installedVersion);
  // 第一百二十二轮②：风险构成徽标——装之前先看清这个插件里有什么级别的动作
  const mix = marketRiskMix(e);
  const mixHtml = mix ? `<span class="market-risk-mix" title="动作风险构成">${mix.read ? `<span class="badge read">读 ×${mix.read}</span>` : ''}${mix.mutate ? `<span class="badge warn">写 ×${mix.mutate}</span>` : ''}${mix.destructive ? `<span class="badge destructive">毁 ×${mix.destructive}</span>` : ''}</span>` : '';
  return `
    <div class="plug-card market-entry" data-id="${esc(e.id)}" data-market="${esc(m.name)}">
      <div class="plug-card-head">
        <b>${esc(e.name)}</b>
        <span class="aid">${esc(e.id)}${e.version ? ` · v${esc(e.version)}` : ''}${typeof e.actionCount === 'number' ? ` · ${e.actionCount} 个动作` : ''}</span>
        <span class="badge market-src" title="来源集市">🏪 ${esc(m.name)}</span>${mixHtml}
        ${installed ? `<span class="badge read">✓ 已装${e.installedVersion ? ` v${esc(e.installedVersion)}` : ''}</span>` : ''}
        <span class="plug-ops">
          ${installed ? '' : '<button class="primary mini" data-op="preview">安装</button>'}
        </span>
      </div>
      <div class="plug-card-body">${esc(e.summary || '')}${tags}</div>
    </div>`;
}

async function showMarket() {
  hidePanels();
  mode = 'market';
  el.modeLabel.textContent = t('modeMarket');
  el.searchRow.classList.add('hidden');
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  el.plugView.classList.add('hidden');
  el.psView.classList.add('hidden');
  el.workbench.classList.add('hidden');
  __panels().showPanelAnimated(el.marketView);
  if (location.hash !== '#/market') history.replaceState(null, '', '#/market');
  await renderMarket();
}

function renderMarketPreviewBox() {
  const box = $('marketPreview');
  if (!box) return;
  const p = marketPreview;
  if (!p) { box.innerHTML = ''; return; }
  const risk = (r) => `<span class="badge ${esc(r)}">${esc(RISK_TEXT[r] || r)}</span>`;
  const rows = (p.actions || []).map((a) => `
    <tr><td>${esc(a.title)}<span class="aid"> ${esc(a.id)}</span></td>
        <td>${risk(a.risk)}</td>
        <td class="cmd-inline" title="${esc(a.command)}">${esc(a.command)}</td>
        <td>${a.risk === 'read' ? `<button class="ghost" data-tryrun="${esc(a.id)}">装前试跑</button>` : '<span class="sub" title="有副作用的动作只在安装后、经过确认才执行">—</span>'}</td></tr>
        <tr class="tryrun-out" data-out="${esc(a.id)}" hidden><td colspan="4"></td></tr>`).join('');
  const problems = [...(p.errors || []), ...(p.warnings || [])];
  const missing = p.missingPluginDeps || [];
  box.innerHTML = `
    <div class="plug-card">
      <div class="plug-card-head">
        <b>审查「${esc(p.entry?.name || p.id)}」</b>
        <span class="aid">来自集市 ${esc(p.market)}</span>
        <span class="badge ${p.errors?.length ? 'destructive' : ''}">${(p.actions || []).length} 个动作</span>
      </div>
      ${problems.length ? `<div class="plug-card-body"><div class="plug-warn">${problems.map(esc).join('<br>')}</div></div>` : ''}
      <table class="grid">
        <thead><tr><th>动作</th><th>风险</th><th>真实命令</th><th>试跑</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3">清单没有可用动作</td></tr>'}</tbody>
      </table>
      <div class="plug-card-foot">
        ${missing.length ? `<label class="market-check"><input type="checkbox" id="marketWithDeps" checked>
          一并安装缺失的插件依赖：${missing.map((d) => esc(typeof d === 'string' ? d : d.id)).join('、')}</label>` : ''}
        <div class="plug-ops">
          <button class="ghost" id="marketCancel">取消</button>
          <button class="primary" id="marketInstall" ${p.errors?.length ? 'disabled' : ''}>确认安装</button>
        </div>
      </div>
    </div>`;
  box.querySelectorAll('[data-tryrun]').forEach((btn) => btn.addEventListener('click', async () => {
    const actionId = btn.dataset.tryrun;
    const out = box.querySelector(`[data-out="${actionId}"]`);
    if (!out) return;
    btn.disabled = true;
    btn.textContent = '试跑中…';
    out.hidden = false;
    out.querySelector('td').innerHTML = '<div class="help">正在用临时目录里的代码运行（只读动作，装前先看结果）…</div>';
    try {
      const r = await api('/api/market/tryrun', {
        method: 'POST',
        body: { id: p.id, market: p.market, action: actionId },
      });
      const head = r.ok
        ? `<span class="ok">✓ 成功 · ${esc(String(r.ms ?? ''))} ms</span>`
        : `<span class="bad">${esc(t('rsFailBadge'))}</span>`;
      const bodyText = r.error
        ? `<pre class="out" style="color:var(--bad)">${esc(r.error)}</pre>`
        : (r.stdout ? `<pre class="out">${esc(r.stdout)}</pre>` : (r.stderr ? `<pre class="out">${esc(r.stderr)}</pre>` : '<div class="help">（没有输出）</div>'));
      out.querySelector('td').innerHTML = `<div class="tryrun-head">${head}
        <span class="aid">${esc(r.command || '')}</span></div>${bodyText}`;
    } catch (e) {
      out.querySelector('td').innerHTML = `<div class="help" style="color:var(--bad)">试跑失败：${esc(e.message)}</div>`;
    }
    btn.disabled = false;
    btn.textContent = '再试一次';
  }));
  $('marketCancel').addEventListener('click', () => { marketPreview = null; renderMarketPreviewBox(); });
  $('marketInstall').addEventListener('click', () => doMarketInstall());
}

async function doMarketPreview(id, market) {
  try {
    const res = await api('/api/market/preview', { method: 'POST', body: { id, market } });
    marketPreview = res;
    renderMarketPreviewBox();
    marketPreview.scrollIntoView?.({ block: 'nearest' });
  } catch (e) {
    marketMsg(`预览失败：${e.message}`, 'err');
  }
}

async function doMarketInstall() {
  const p = marketPreview;
  if (!p) return;
  const btn = $('marketInstall');
  // 第一百三十七轮⑧：安装进度三阶段（拉取校验 → 落盘 → 自检）；189 轮⑤：图标化状态前缀
  if (btn) { btn.disabled = true; btn.classList.add('busy'); btn.textContent = '⏳ ① 拉取与校验…'; }
  try {
    const withDeps = $('marketWithDeps')?.checked === true;
    if (btn) btn.textContent = '⏳ ② 落盘安装…';
    const res = await api('/api/market/install', {
      method: 'POST',
      body: { id: p.id || p.entry?.id, market: p.market, confirm: p.confirm, withDeps },
    });
    if (!res.ok) throw new Error(res.message || '安装失败');
    marketPreview = null;
    await load(false);          // 插件列表与徽标刷新
    await renderMarket();
    // 第一百三十七轮①②：装机自检结果进反馈（装上 ≠ 能跑）
    const sc = res.selfcheck;
    const nm = p.entry?.name || p.id;
    if (sc && sc.probe?.kind === 'run') {
      if (sc.ok) marketMsg(`已安装「${nm}」· 自检 ✓ 能跑（${sc.ms ?? '?'}ms）`, 'ok', p.id || p.entry?.id);
      else marketMsg(`已安装「${nm}」· 但自检 ✗ 跑不起来：${sc.error || '退出码非零'}`, 'warn', p.id || p.entry?.id);
    } else if (sc && sc.probe?.kind === 'skip') {
      marketMsg(`已安装「${nm}」· 自检跳过（${sc.probe.reason}）`, 'ok', p.id || p.entry?.id);
    } else {
      marketMsg(`已安装「${nm}」`, 'ok', p.id || p.entry?.id);
    }
  } catch (e) {
    marketMsg(`✗ 安装失败：${e.message}`, 'err');
    if (btn) { btn.disabled = false; btn.classList.remove('busy'); btn.textContent = '确认安装'; }
  }
}

async function doMarketAdd() {
  const input = $('marketSrc');
  const source = (input?.value || '').trim();
  if (!source) return;
  const btn = $('marketAddBtn');
  if (btn) { btn.disabled = true; btn.textContent = '添加中…'; }
  try {
    const res = await api('/api/market/add', { method: 'POST', body: { source } });
    await renderMarket();
    marketMsg(res.message || '已添加', 'ok');
  } catch (e) {
    marketMsg(`添加失败：${e.message}`, 'err');
    if (btn) { btn.disabled = false; btn.textContent = '添加'; }
  }
}

async function doMarketOp(op, name) {
  if (op === 'remove' && !window.confirm(`移除集市「${name}」？（已装的插件不受影响）`)) return;
  try {
    if (op === 'refresh') {
      marketMsg('刷新中…');
      const res = await api('/api/market/refresh', { method: 'POST', body: { name } });
      await renderMarket();
      marketMsg(res.message || '已刷新', 'ok');
    } else {
      const res = await api('/api/market/remove', { method: 'POST', body: { name } });
      await renderMarket();
      marketMsg(res.message || '已移除', 'ok');
    }
  } catch (e) {
    marketMsg(`${op === 'refresh' ? '刷新' : '移除'}失败：${e.message}`, 'err');
  }
}

async function renderMarket() {
  // 第一百九十轮②：集市请求前骨架
  el.marketView.innerHTML = skeletonRows(4).map(() => '<div class="skel-row" aria-hidden="true"></div>').join('');
  try {
    marketData = await api('/api/markets');
  } catch (e) {
    // 第一百九十轮⑥：失败给明确重试入口（非纯文字）
    el.marketView.innerHTML = `<div class="load-fail" role="status">
      <div class="lf-msg">读不到集市列表：${esc(e.message)}</div>
      <button class="ghost lf-retry" id="marketRetry">↻ 重试</button>
      <button class="ghost" id="marketBack">返回</button></div>`;
    $('marketRetry').addEventListener('click', () => renderMarket());
    $('marketBack').addEventListener('click', exitMarket);
    return;
  }
  el.marketCount.textContent = String(marketData.markets.length);

  const q = marketQuery.trim().toLowerCase();
  const entries = [];
  for (const m of marketData.markets) {
    for (const e of m.plugins || []) {
      const hay = [e.id, e.name, e.summary || '', ...(e.tags || [])].join(' ').toLowerCase();
      if (!q || hay.includes(q)) entries.push([m, e]);
    }
  }

  el.marketView.innerHTML = `
    <div class="ps-head">
      <h2>集市（${marketData.markets.length} 个 · ${marketData.total ?? 0} 个插件）</h2>
      <span class="sub">任何 git 仓库 + market.json 都能当集市</span>
    </div>
  ${panelDescBar('market')}
    <div class="plug-install">
      <input id="marketSrc" placeholder="添加集市：git 地址、owner/repo 或本地目录，回车添加"
             autocomplete="off" spellcheck="false">
      <button class="primary" id="marketAddBtn">添加</button>
    </div>
    ${marketData.markets.length === 0
      ? `<div class="ps-empty" role="status">还没有添加任何集市。<div class="e-hint">第一步：把本仓库当集市——上面的输入框粘 <code>${esc('/Users/你/zerokit')}</code>（本地目录）或任意 git 地址，回车。终端等价：<code>zkit market add &lt;地址&gt;</code>。</div><div class="e-hint">任何 git 仓库根目录放一份 market.json 就是一个集市（zkit market index 一键生成）。</div></div>`
      : `<div class="plug-install">
           <input id="marketQ" placeholder="搜索集市里的插件（id / 名称 / 摘要 / 标签）"
                  value="${esc(marketQuery)}" autocomplete="off" spellcheck="false">
         </div>`}
    <div id="marketMsg" class="market-msg"></div>
    ${marketData.markets.map(marketCardHtml).join('')}
    ${entries.length ? entries.slice(0, marketLimit).map(([m, e]) => marketEntryHtml(m, e)).join('')
      + (entries.length > marketLimit
        ? `<div class="pager"><button class="ghost" id="marketMore">加载更多（已显示 ${Math.min(marketLimit, entries.length)} / ${entries.length}）</button></div>`
        : '')
      : (marketData.markets.length && q ? '<div class="ps-empty" role="status">没有匹配的插件。</div>' : '')}
    <div id="marketPreview"></div>
    <div class="actions"><button class="primary" id="marketBack">返回</button></div>`;

  $('marketMore')?.addEventListener('click', () => { marketLimit += 30; renderMarket(); });

  $('marketAddBtn').addEventListener('click', doMarketAdd);
  if ($('marketSrc')) {
    $('marketSrc').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); doMarketAdd(); }
    });
  }
  if ($('marketQ')) {
    $('marketQ').addEventListener('input', (e) => {
      marketQuery = e.target.value;
      marketLimit = 30;   // 新搜索从第一页开始
      renderMarket().then(() => {
        const box = $('marketQ');
        if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
      });
    });
  }
  $('marketBack').addEventListener('click', exitMarket);
  el.marketView.querySelectorAll('.market-card').forEach((card) => {
    card.querySelector('[data-op="refresh"]').addEventListener('click', () => doMarketOp('refresh', card.dataset.market));
    card.querySelector('[data-op="remove"]').addEventListener('click', () => doMarketOp('remove', card.dataset.market));
  });
  el.marketView.querySelectorAll('.market-entry').forEach((card) => {
    const btn = card.querySelector('[data-op="preview"]');
    if (btn) btn.addEventListener('click', () => doMarketPreview(card.dataset.id, card.dataset.market));
  });
  renderMarketPreviewBox();
}
  return { doMarketAdd, doMarketInstall, doMarketOp, doMarketPreview, marketEntryHtml, marketMsg, renderMarket, renderMarketPreviewBox, showMarket };
}
