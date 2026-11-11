// web/panels.js —— 面板壳域（第 243 轮 v4 清债第三步：从 app.js 注入式迁出）
// 本步子集：15 个零外部状态耦合的纯渲染函数（refs=0 层——方案 docs/debt/app-split-plan.md 第 3 步）。
// 注入式：ui 传入 app 侧函数与依赖，本文件不 import app（避免循环依赖）。

export function createPanels(ui) {
  const { esc, t, lang, actionKey, actionRiskCard, barsScale, diffResults, formatMs, hotkeyMap, maskSecrets, maskState, openDetail, perfMark, resultCompare, riskText, submit, wbSend, notifyLogRef } = ui;

function renderBars(rows) {
  const bars = barsScale(rows);
  if (!bars.length) return `<div class="help">（没有可画的柱子：需要 [{label, value}]）</div>`;
  return `<div class="bar-chart" role="img" aria-label="柱状图，${bars.length} 个类别">${bars.map((b) => `
    <div class="bar-col" title="${esc(b.label)}：${esc(b.display)}">
      <span class="bar-val">${esc(b.display)}</span>
      <i class="bar-stick${b.below ? ' below' : ''}" style="height:${Math.max(b.height, 2)}%"></i>
      <span class="bar-label">${esc(b.label)}</span>
    </div>`).join('')}</div>`;
}

/** ③链步骤条：显示在结果卡上方，点击回看每步结果 */
function renderChainSteps(box) {
  if (chainSteps.length < 1) return;
  let bar = document.getElementById('chainStepsBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'chainStepsBar';
    bar.className = 'chain-bar';
    box.prepend(bar);
  }
  bar.innerHTML = `链：${chainSteps.map((s, i) => `
    <button class="ghost mini chain-step" data-cstep="${i}" title="回看第 ${i + 1} 步结果">${i + 1}. ${esc(s.title)} ✓</button>`).join(' <span class="sub">→</span> ')}`;
  bar.querySelectorAll('[data-cstep]').forEach((b) => b.addEventListener('click', () => {
    const s = chainSteps[Number(b.dataset.cstep)];
    if (s?.res) renderResult(s.res);
  }));
}

function renderKV(obj) {
  const rows = Object.entries(obj).map(([k, v]) => {
    // 第五十三轮⑧：空值灰 —（不占注意力）
    if (v === null || v === undefined || v === '') {
      return `<tr><td>${esc(k)}</td><td class="empty-cell">—</td></tr>`;
    }
    // 第十九轮④：字符串值默认脱敏（长 hex / token 形态打码；结构化对象先 JSON 化）
    const raw = (v && typeof v === 'object') ? JSON.stringify(v) : String(v);
    const val = (maskState() && typeof v === 'string') ? maskSecrets(raw) : raw;
    const num = typeof v === 'number' || /^[\d.,\s%]+$/.test(val) ? ' class="num"' : '';
    // 第五十三轮②：长文本截断 + title 全文 + 点击复制全文
    const isClip = !num && val.length > 48;
    // 第十八轮③④：键级锚点（监控 diff 高亮 / sparkline 挂载用）
    return `<tr><td>${esc(k)}</td><td${num} data-dkv="${esc(k)}"${isClip ? ` class="cell-clip kv-clip" title="点击复制全文" data-full="${esc(val)}"` : ` title="${esc(val)}"`}>${esc(isClip ? `${val.slice(0, 45)}…` : val)}</td></tr>`;
  }).join('');
  return `<table class="kv">${rows}</table>`;
}

function renderList() {
  const t0 = performance.now();
  try {
    renderListInner();
  } finally {
    perfStats.listMs = Math.round((performance.now() - t0) * 10) / 10;
    perfStats.lastRenderAt = Date.now();
    perfMark('zk-renderList');
  }
}

/** 第一百三十二轮⑥：通知记录小节（最近 10 条环）。 */
function renderNotifySection() {
  if (!notifyLogRef().length) return '<div class="watch-notify"><div class="sub">通知记录：还没有——监控发现变化且通过静默/节流闸后会出现在这里。</div></div>';
  return `<div class="watch-notify"><div class="sub">通知记录（最近 ${notifyLogRef().length} 条）：</div>${notifyLogRef().map((e) => `<div class="watch-notify-row">${new Date(e.ts).toLocaleTimeString()} · ${esc(String(e.key))} · ${esc(String(e.note ?? ''))}（第 ${e.changes ?? '?'} 次变化）</div>`).join('')}</div>`;
}

function renderPreNumbered(text) {
  const lines = String(text).split('\n');
  return `<pre class="out numbered"><code>${lines.map((l) => `<span class="ln">${esc(l)}</span>`).join('')}</code></pre>`;
}

/** 空会话时的提问建议：给不会写 prompt 的人一个起点，点一下就直接发 */
function renderPrompts() {
  const box = $('wbSuggest');
  if (!box) return;
  box.innerHTML = `<span class="suggest-label">试试：</span>${PROMPTS.map((p) =>
    `<button class="suggest-chip" data-prompt="${esc(p.prompt)}">${esc(p.label)}</button>`).join('')}`;
  box.querySelectorAll('[data-prompt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('wbQ').value = btn.dataset.prompt;
      wbSend();
    });
  });
}

/** 第十轮④：顶栏快速访问条——前 5 个收藏一键直达。 */
function renderQuickBar() {
  let bar = document.getElementById('quickBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'quickBar';
    bar.className = 'quick-bar';
    const searchRow = document.getElementById('searchRow');
    searchRow?.parentNode?.insertBefore(bar, searchRow);
  }
  // favorites 是 key 数组（'插件.动作'）
  const top = favorites.slice(0, 5);
  bar.innerHTML = top.length
    ? top.map((k) => {
        const e = entries.find((x) => actionKey(x.plugin.id, x.action.id) === k);
        return e ? `<button class="chip" data-quick="${esc(k)}">${esc(e.action.title)}</button>` : '';
      }).join('')
    : '<span class="help">收藏动作后会钉在这里（最多 5 个）</span>';
  bar.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => {
    const e = entries.find((x) => actionKey(x.plugin.id, x.action.id) === b.dataset.quick);
    if (e) openDetail(e.plugin, e.action);
  }));
}

/** ⑥⑨ 危险度提示卡：风险等级横条（红/黄/绿）+ 历史失败率 + 平均耗时 + 为什么危险。 */
function renderRiskCard(plugin, action) {
  const box = $('riskCard');
  if (!box) return;
  const runs = runStore[actionKey(plugin.id, action.id)] ?? [];
  const card = actionRiskCard(runs, action.risk);
  const WHY = {
    read: '只读动作：只读取信息，不改任何状态。随便跑，跑错了也没损失。',
    mutate: '会改动：写文件、发请求或起进程。改动可见、可重做，但先确认参数再跑。',
    destructive: '高风险：改动或删除数据且不可自动撤销。本启动器要求输入动作名才能执行。',
  };
  const why = WHY[action.risk] ?? '未知风险等级。';
  const pct = Math.round(card.failRate * 100);
  const barColor = card.level === 'destruct' ? 'var(--bad, #e5484d)' : (card.level === 'risky' || card.level === 'mutate') ? 'var(--warn, #e8b13a)' : 'var(--ok, #30a46c)';
  box.innerHTML = `
    <div class="risk-bar"><span class="risk-fill" style="width:${action.risk === 'destructive' ? 100 : action.risk === 'mutate' ? 55 : 12}%;background-color:${barColor}"></span></div>
    <div class="risk-line">
      <span class="badge ${esc(action.risk)}">${esc(riskText(action.risk))}</span>
      <span class="sub">${esc(why)}</span>
    </div>
    ${card.runs ? `<div class="risk-stats">历史 ${card.runs} 次 · 失败率 ${pct}%${pct >= 40 ? ' ⚠' : ''} · 平均 ${esc(formatMs(card.avgMs))}</div>` : '<div class="risk-stats sub">还没有执行记录——首次执行没有历史可参考。</div>'}`;
}

/** 高风险动作执行后的「安心提示」：给出审计日志入口，并提示没有自动回滚 */
function renderUndoHint(plugin, action) {
  const box = $('result');
  if (!box) return;
  const hint = document.createElement('div');
  hint.className = 'cmd-box undo-hint';
  hint.innerHTML = `
    <div class="cmd-box-head">刚刚执行了高风险动作</div>
    <div class="help">zerokit 不会猜测怎么撤销——每个插件改的东西不同。如果需要回退：
      ① 打开<a href="#" id="undoLogs" class="link">审计日志</a>确认刚才实际执行了什么；
      ② 用对应的恢复手段（备份、插件自带的还原动作、或系统工具）手动处理。
      ${t('deniedHint')}</div>`;
  box.prepend(hint);
  hint.querySelector('#undoLogs').addEventListener('click', (e) => {
    e.preventDefault();
    showLogs();
  });
}

/** ⑦对比视图：两结果键级并排 diff（object 类型才可比） */
function showCompareView(ta, tb) {
  const rows = resultCompare(ta.res?.data, tb.res?.data);
  const box = $('result');
  if (!box) return;
  const tr = rows.map((r) => `
    <tr class="${r.diff ? 'cmp-diff' : ''}">
      <td>${esc(r.key)}</td>
      <td>${esc(JSON.stringify(r.a ?? '—'))}</td>
      <td>${esc(JSON.stringify(r.b ?? '—'))}</td>
    </tr>`).join('');
  box.innerHTML = `
    <div class="result-card">
      <h4>⇄ 对比：${esc(ta.name)} vs ${esc(tb.name)}</h4>
      <table class="kv-table cmp-table"><caption class="sr-only">结果对比</caption><thead><tr><th>键</th><th>${esc(ta.name)}</th><th>${esc(tb.name)}</th></tr></thead>
      <tbody>${tr || '<tr><td colspan="3">无可比数据（两结果都不是对象）</td></tr>'}</tbody></table>
      <div class="help">黄色行 = 值不同。点任意页签回到结果。</div>
    </div>`;
}

/** 第十九轮②：危险参数黄条——显示哪个字段、命中什么模式、值本身；用户可「仍要执行」或「回去改」。 */
function showDangerNote(field, why, value) {
  const host = $('result') ?? document.querySelector('.detail');
  if (!host) return;
  const note = document.createElement('div');
  note.className = 'danger-note';
  note.innerHTML = `
    <div class="danger-title">⚠ 参数值命中危险模式：${esc(why)}</div>
    <div class="danger-field">字段 <code>${esc(field.name)}</code> 的值：</div>
    <div class="danger-val">${esc(String(value ?? '').slice(0, 200))}</div>
    <div class="help">递归删除、系统目录、格式化磁盘这类操作不可逆。确认动作与预期一致再继续。</div>
    <div class="actions">
      <button class="ghost" id="dangerBack">回去改</button>
      <button class="warn-btn" id="dangerGo">仍要执行</button>
    </div>`;
  host.prepend(note);
  note.querySelector('#dangerBack').addEventListener('click', () => note.remove());
  note.querySelector('#dangerGo').addEventListener('click', () => {
    note.remove();
    window.__zkDangerAck = true;
    submit(false);
  });
  note.scrollIntoView({ block: 'center' });
}

/** 第五十九轮②：显示一个面板并播放入场动效（200ms 淡入上移）。 */
function showPanelAnimated(v) {
  v.classList.remove('hidden');
  // 强制 reflow 重启动画
  void v.offsetWidth;
  v.classList.add('view-anim');
}

/** 两次结果逐格对比：只对对象 / 对象数组有意义，标量给一句话 */
function showResultDiff(a, b, pairMode) {
  // pairMode：{slotA, slotB} 显式两次（A/B 槽）；缺省为「上一次 → 最新」
  const diffs = diffResults(a, b);
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  let onlyChanged = false;
  overlay.innerHTML = `
    <div class="modal diff-modal">
      <h3>结果对比${pairMode ? '（自选两次）' : '（上一次 → 最新）'}</h3>
      <div class="diff-opts">${diffs.length ? `
        <label><input type="checkbox" id="diffOnly"> 仅看变化</label>
        <label><input type="checkbox" id="diffSide"> 并排</label>` : ''}
      </div>
      <div id="diffBody">${renderDiffBody(diffs, false, false)}</div>
      <div class="actions"><button class="primary" id="diffClose">关闭</button>
        ${diffs.length ? '<button class="ghost" id="diffMd">导出 Markdown</button>' : ''}</div>
    </div>`;
  document.body.appendChild(overlay);
  const body = overlay.querySelector('#diffBody');
  overlay.querySelector('#diffOnly')?.addEventListener('change', (e) => {
    onlyChanged = e.target.checked;
    const side = overlay.querySelector('#diffSide')?.checked ?? false;
    body.innerHTML = renderDiffBody(diffs, onlyChanged, side);
  });
  overlay.querySelector('#diffSide')?.addEventListener('change', (e) => {
    body.innerHTML = renderDiffBody(diffs, onlyChanged, e.target.checked);
  });
/** diff 表体：onlyChanged 只留 from!==to 的行（diffResults 已只产出变化行——
 * 开关留给「全部字段对比」的将来扩展，当前行为=只看变化恒真）；side 时每行上下并排 */
function renderDiffBody(diffs, onlyChanged, side) {
  if (diffs.length === 0) return '<div class="help">两次结果完全一致。</div>';
  if (side) {
    return diffs.map((d) => `
      <div class="diff-pair">
        <code class="diff-path">${esc(d.path)}</code>
        <div class="diff-side diff-from">− ${esc(d.from)}</div>
        <div class="diff-side diff-to">+ ${esc(d.to)}</div>
      </div>`).join('');
  }
  return `<table class="grid diff-table"><thead><tr><th>字段</th><th>较早</th><th>最新</th></tr></thead>
    <tbody>${diffs.map((d) => `<tr>
      <td><code>${esc(d.path)}</code></td>
      <td class="diff-from">${esc(d.from)}</td>
      <td class="diff-to">${esc(d.to)}</td></tr>`).join('')}</tbody></table>`;
}

  overlay.querySelector('#diffMd')?.addEventListener('click', () => {
    const md = ['| 字段 | 较早 | 最新 |', '| --- | --- | --- |',
      ...diffs.map((d) => `| \`${String(d.path).replace(/\|/g, '\\|')}\` | ${String(d.from).replace(/\|/g, '\\|')} | ${String(d.to).replace(/\|/g, '\\|')} |`)].join('\n');
    const blob = new Blob([md], { type: exportMime('md') });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'result-diff.md'; link.click();
    URL.revokeObjectURL(url);
  });
  const close = () => overlay.remove();
  overlay.querySelector('#diffClose').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#diffClose').focus();
}

function showShortcuts() {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="modal help-modal">
      <h3>快捷键</h3>
      <div class="keys">
        ${SHORTCUTS.map((s) => `<div class="key-row">
          <span class="key-combo">${s.keys.map((k) => `<kbd>${esc(k)}</kbd>`).join('')}</span>
          <span class="key-what">${esc(t(s.whatKey))}</span>
        </div>`).join('')}
      </div>
      ${(() => {
        const map = hotkeyMap();
        const rows = Object.entries(map).map(([k, keyStr]) => {
          const dot = keyStr.lastIndexOf('.');
          const entry = entries.find((e) => e.plugin.id === keyStr.slice(0, dot)
            && e.action.id === keyStr.slice(dot + 1));
          return { renderTextView, k, name: entry ? `${entry.plugin.name} · ${entry.action.title}` : keyStr };
        });
        if (!rows.length) return '';
        return `<h3>功能键（按一下直达）</h3>
          <div class="keys">
            ${rows.map((r) => `<div class="key-row">
              <span class="key-combo"><kbd>${esc(r.k)}</kbd></span>
              <span class="key-what">${esc(r.name)}</span>
            </div>`).join('')}
          </div>`;
      })()}
      <h3>直达页面（深链接，收藏或发给同事都行）</h3>
      <div class="keys deep-links">
        ${[
          ['#/ps', '运行中', '看正在跑的进程与服务'],
          ['#/plugins', '插件管理', '安装 / 更新 / 卸载 / 配置'],
          ['#/market', '插件集市', '浏览并一键安装'],
          ['#/logs', '审计日志', '每次执行、被拒、失败'],
          ['#/doctor', '环境自检', '解释器 / 依赖 / 配置问题'],
          ['#/mcp', 'MCP 授权', '允许 AI 调用哪些动作'],
          ['#/stats', '使用统计', '总执行数 / 成功率 / 近 7 天趋势'],
          ['#/workbench', 'AI 工作台', '自然语言指挥插件'],
          ['#/q=关键词', '带词搜索', '打开就搜「关键词」'],
        ].map(([h, n, d]) => `<div class="key-row"><a class="link" href="${h}">${n}</a>
          <span class="key-what"><code>${h}</code> — ${d}</span></div>`).join('')}
      </div>
      <div class="actions">
        <button class="primary" id="helpClose">知道了</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#helpClose').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function escClose(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escClose); }
  });
  overlay.querySelector('#helpClose').focus();
}
function renderTextView(rawText, { masked = (x) => x } = {}) {
  const text = String(rawText ?? '');
  const st = textStats(text);
  const tv = textLines(text);      // ①② >200 行折叠到 50
  const wrap = textViewWrapOn();
  const tid = `tv${++resultSeq}`;
  const rowsHtml = tv.rows.map((r) =>
    `<div class="tv-row" data-no="${r.no}"><span class="tv-no">${r.no}</span><span class="tv-line">${linkifyText(masked(r.text)) || '&nbsp;'}</span></div>`).join('');
  return `<div class="text-view" id="${tid}" data-tvraw="${esc(text).replace(/"/g, '&quot;').slice(0, 0) || ''}">
    <div class="tv-bar">
      <span class="tv-stat">${st.chars} 字符 · ${st.lines} 行 · 最长 ${st.longest}</span>
      <button class="ghost mini" data-tv-act="numbers">行号</button>
      <button class="ghost mini" data-tv-act="wrap">${wrap ? '换行：开' : '换行：关'}</button>
      <button class="ghost mini" data-tv-act="copy-raw">复制原文</button>
      <button class="ghost mini" data-tv-act="copy-num">带行号复制</button>
      <button class="ghost mini" data-tv-act="copy-title">首行做标题</button>
      <button class="ghost mini" data-tv-act="save-txt">另存 .txt</button>
    </div>
    <div class="tv-body${wrap ? '' : ' nowrap'}${tv.collapsed ? ' collapsed' : ''}">${rowsHtml}</div>
    ${tv.collapsed ? `<button class="fold-btn" data-tv-act="expand">展开全部 ${tv.total} 行（还有 ${tv.hidden} 行收起）</button>` : ''}
  </div>`;
}
  return { renderBars, renderChainSteps, renderKV, renderList, renderNotifySection, renderPreNumbered, renderPrompts, renderQuickBar, renderRiskCard, renderUndoHint, showCompareView, showDangerNote, showPanelAnimated, showResultDiff, showShortcuts };
}
