// zerokit 启动器前端。
// 纯静态、无构建步骤，所以浏览器和 Tauri 壳用的是同一份代码。
// 所有来自插件的文本都经过 esc() 转义再插入 DOM——插件内容属于不可信输入。

const TOKEN = document.querySelector('meta[name=zk-token]').content;
const $ = (id) => document.getElementById(id);

const el = {
  q: $('q'), list: $('list'), empty: $('empty'), count: $('count'),
  listView: $('listView'), detailView: $('detailView'), workbench: $('workbench'),
  modeLabel: $('modeLabel'), modeDot: $('modeDot'), reload: $('reloadBtn'),
};

let plugins = [];
let entries = [];       // 扁平化的动作索引
let filtered = [];
let active = 0;
let detail = null;      // { plugin, action }
let mode = 'command';

const RISK_TEXT = { read: '只读', mutate: '会改动', destructive: '高风险' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function api(path, options = {}) {
  const headers = { 'x-zerokit-token': TOKEN };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await res.json().catch(() => ({ error: '返回内容不是 JSON' }));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---------------------------------------------------------------- 搜索

/** 单个词的匹配得分：完全相等 > 前缀 > 词首 > 子串 > 子序列 */
function scoreOne(text, token) {
  if (!text) return 0;
  const t = String(text).toLowerCase();
  if (t === token) return 100;
  const i = t.indexOf(token);
  if (i === 0) return 82;
  if (i > 0) {
    // 词首命中（空格、-、_、. 之后）给得高一些
    const prev = t[i - 1];
    return (/[\s\-_.、，/]/.test(prev) ? 66 : 48) - Math.min(i, 20) * 0.4;
  }
  let ti = 0;
  for (const ch of token) {
    ti = t.indexOf(ch, ti);
    if (ti < 0) return 0;
    ti += 1;
  }
  return 10;
}

/** 一条动作在某个词下的得分：取各字段加权后的最大值 */
function scoreEntry(entry, token) {
  const p = entry.plugin;
  const a = entry.action;
  const fields = [
    [a.id, 1.0], [a.title, 1.05], [p.id, 0.95], [p.name, 1.0],
    [a.description, 0.55], [p.summary, 0.5], [(p.keywords || []).join(' '), 0.7],
    [entry.hayId, 0.9],
  ];
  let best = 0;
  for (const [text, weight] of fields) {
    const s = scoreOne(text, token) * weight;
    if (s > best) best = s;
  }
  return best;
}

function search(query) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return entries.map((e) => ({ entry: e, score: 0 }));
  const out = [];
  for (const entry of entries) {
    let total = 0;
    let ok = true;
    for (const token of tokens) {
      const s = scoreEntry(entry, token);
      if (s <= 0) { ok = false; break; }
      total += s;
    }
    if (ok) out.push({ entry, score: total });
  }
  out.sort((x, y) => y.score - x.score
    || x.entry.plugin.name.localeCompare(y.entry.plugin.name, 'zh')
    || x.entry.action.id.localeCompare(y.entry.action.id));
  return out;
}

// ---------------------------------------------------------------- 列表渲染

function renderList() {
  const q = el.q.value;
  if (q.startsWith('?')) { showWorkbench(q.slice(1)); return; }
  mode = 'command';
  el.modeLabel.textContent = '命令';
  el.modeDot.classList.remove('workbench');
  el.workbench.classList.add('hidden');
  el.listView.classList.remove('hidden');
  if (detail) el.detailView.classList.remove('hidden');

  filtered = search(q).map((r) => r.entry);
  if (active >= filtered.length) active = Math.max(0, filtered.length - 1);

  el.empty.classList.toggle('hidden', filtered.length > 0);
  el.list.innerHTML = filtered.map((entry, i) => {
    const a = entry.action;
    const p = entry.plugin;
    const dep = p.requiresOk ? '' : `<span class="badge destructive">缺依赖</span>`;
    return `<li class="item${i === active ? ' active' : ''}" data-i="${i}" role="option">
      <span class="plugin">${esc(p.name)}</span>
      <span class="title">
        <span class="name">${esc(a.title)}</span>
        <span class="desc">${esc(a.description || p.summary || '')}</span>
      </span>
      <span class="aid">${esc(a.id)}</span>
      ${dep}
      <span class="badge ${esc(a.risk)}">${esc(RISK_TEXT[a.risk] || a.risk)}</span>
    </li>`;
  }).join('');

  el.list.querySelectorAll('.item').forEach((node) => {
    node.addEventListener('click', () => { active = Number(node.dataset.i); openActive(); });
    node.addEventListener('mousemove', () => {
      const i = Number(node.dataset.i);
      if (i !== active) { active = i; paintActive(); }
    });
  });
  el.count.textContent = q.trim()
    ? `${filtered.length} / ${entries.length} 个动作`
    : `${plugins.length} 个插件 · ${entries.length} 个动作`;
}

function paintActive() {
  el.list.querySelectorAll('.item').forEach((node, i) => {
    node.classList.toggle('active', i === active);
  });
  el.list.querySelector('.item.active')?.scrollIntoView({ block: 'nearest' });
}

// ---------------------------------------------------------------- 详情 / 表单

function openActive() {
  const entry = filtered[active];
  if (entry) openDetail(entry.plugin, entry.action);
}

function openDetail(plugin, action) {
  detail = { plugin, action };
  // 深链：CLI / MCP / 别人的消息里可以直接给 #/插件/动作 让界面跳到这一条
  const wanted = `#/${plugin.id}/${action.id}`;
  if (location.hash !== wanted) history.replaceState(null, '', wanted);
  el.listView.classList.add('hidden');
  el.workbench.classList.add('hidden');
  el.detailView.classList.remove('hidden');

  const depWarn = plugin.requiresOk ? '' : `
    <div class="cmd-line" style="color:var(--bad)">
      ✗ 缺少依赖：${esc(plugin.missingDeps.join(', '))}　先装上它，这个动作才能跑
    </div>`;

  const fields = action.fields.map((f) => {
    const req = f.required ? ' <span class="req">*</span>' : '';
    const help = f.help ? `<div class="help">${esc(f.help)}</div>` : '';
    if (f.type === 'checkbox') {
      return `<div class="field check">
        <input type="checkbox" id="f_${esc(f.name)}" ${f.default ? 'checked' : ''}>
        <label for="f_${esc(f.name)}">${esc(f.name)}${req}</label>
      </div>${help}`;
    }
    if (f.type === 'select') {
      return `<div class="field"><label>${esc(f.name)}${req}</label>
        <select id="f_${esc(f.name)}">
          ${(f.options || []).map((o) => `<option${o === f.default ? ' selected' : ''}>${esc(o)}</option>`).join('')}
        </select>${help}</div>`;
    }
    const type = f.type === 'number' ? 'number' : 'text';
    const def = f.default === undefined ? '' : ` value="${esc(f.default)}"`;
    return `<div class="field"><label>${esc(f.name)}${req}</label>
      <input id="f_${esc(f.name)}" type="${type}"${def} autocomplete="off">${help}</div>`;
  }).join('');

  el.detailView.innerHTML = `
    <div class="detail-head">
      <h2>${esc(action.title)}</h2>
      <div class="meta">${esc(plugin.name)} · ${esc(action.id)} ·
        <span class="badge ${esc(action.risk)}">${esc(RISK_TEXT[action.risk] || action.risk)}</span>
        <span class="badge">${esc(action.tool)}</span>
      </div>
      <div class="desc">${esc(action.description || '（这个动作没写说明）')}</div>
    </div>
    ${depWarn}
    ${fields}
    <div class="actions">
      <button class="primary" id="runBtn">执行</button>
      <button class="ghost" id="backBtn">返回</button>
    </div>
    <div id="result"></div>`;

  $('backBtn').addEventListener('click', backToList);
  $('runBtn').addEventListener('click', () => submit(false));
  el.detailView.querySelectorAll('input, select').forEach((node) => {
    node.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') submit(false); });
  });
  el.detailView.querySelector('input, select')?.focus();
}

function backToList() {
  detail = null;
  history.replaceState(null, '', location.pathname);
  el.detailView.classList.add('hidden');
  el.detailView.innerHTML = '';
  el.listView.classList.remove('hidden');
  renderList();
  el.q.focus();
}

function collectValues(action) {
  const values = {};
  for (const f of action.fields) {
    const node = document.getElementById(`f_${f.name}`);
    if (!node) continue;
    if (f.type === 'checkbox') values[f.name] = node.checked;
    else if (node.value !== '') values[f.name] = node.value;
  }
  return values;
}

// ---------------------------------------------------------------- 执行与确认

async function submit(remember) {
  if (!detail) return;
  const { plugin, action } = detail;
  const btn = $('runBtn');
  if (btn) { btn.disabled = true; btn.textContent = '执行中…'; }
  try {
    const values = collectValues(action);
    let res = await api('/api/run', {
      method: 'POST',
      body: { plugin: plugin.id, action: action.id, values },
    });
    if (res.needConfirm) {
      const ok = await askConfirm(plugin, action, res);
      if (!ok) return;
      if (remember && action.risk !== 'destructive') {
        await api('/api/approve', {
          method: 'POST',
          body: { plugin: plugin.id, action: action.id },
        }).catch(() => {});
      }
      res = await api('/api/run', {
        method: 'POST',
        body: { plugin: plugin.id, action: action.id, values, confirm: res.confirm },
      });
    }
    renderResult(res);
  } catch (e) {
    renderResult({ ok: false, error: e.message, render: 'text' });
  } finally {
    const b = $('runBtn');
    if (b) { b.disabled = false; b.textContent = '执行'; }
  }
}

function askConfirm(plugin, action, res) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const rememberable = action.risk !== 'destructive';
    overlay.innerHTML = `
      <div class="modal">
        <h3>确认执行</h3>
        <div class="risk-note">
          ${esc(plugin.name)} · ${esc(action.title)} ·
          <span class="badge ${esc(action.risk)}">${esc(RISK_TEXT[action.risk] || action.risk)}</span>
        </div>
        <div class="cmd-line">${esc(res.command || '(无命令)')}</div>
        ${rememberable ? `<div class="remember">
          <input type="checkbox" id="rememberBox" checked>
          <label for="rememberBox">记住这个动作，以后不再询问</label>
        </div>` : `<div class="remember">高风险动作每次都需确认，不支持记住。</div>`}
        <div class="actions">
          <button class="ghost" id="cancelBtn">取消</button>
          <button class="primary" id="okBtn">确认执行</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (v) => { overlay.remove(); resolve(v); };
    overlay.querySelector('#cancelBtn').addEventListener('click', () => done(false));
    overlay.querySelector('#okBtn').addEventListener('click', () => {
      const box = overlay.querySelector('#rememberBox');
      done(true);
      if (box && box.checked && rememberable) {
        api('/api/approve', {
          method: 'POST', body: { plugin: plugin.id, action: action.id },
        }).catch(() => {});
      }
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
    overlay.querySelector('#okBtn').focus();
  });
}

// ---------------------------------------------------------------- 结果渲染

function renderResult(res) {
  const box = $('result');
  if (!box) return;
  const head = res.ok
    ? `<span class="ok">✓ 成功</span>`
    : `<span class="bad">✗ 失败</span>`;
  const ms = res.ms !== undefined ? `${res.ms} ms` : '';

  let body = '';
  if (res.error) {
    body += `<pre class="out" style="color:var(--bad)">${esc(res.error)}</pre>`;
  }
  if (res.data !== undefined) {
    body += renderData(res.data, res.render);
  } else if (res.stdout) {
    body += `<pre class="out">${esc(res.stdout)}</pre>`;
  }
  if (res.truncated && res.artifactPath) {
    body += `<div class="cmd-line">输出过长已截断，完整内容：${esc(res.artifactPath)}</div>`;
  }
  if (res.stderr && !res.ok) {
    body += `<pre class="out" style="color:var(--fg-dim)">${esc(res.stderr)}</pre>`;
  }
  if (!body) body = `<div class="help">（没有输出）</div>`;

  box.innerHTML = `
    <div class="card">
      <div class="card-head">${head}<span>${esc(ms)}</span>
        <span style="margin-left:auto" class="aid">${esc(res.command || '')}</span>
      </div>
      <div class="card-body">${body}</div>
    </div>`;
}

function renderData(data, render) {
  if (Array.isArray(data)) {
    if (data.length === 0) return `<div class="help">（空结果）</div>`;
    if (typeof data[0] === 'object' && data[0] !== null) return renderTable(data);
    return `<pre class="out">${esc(data.join('\n'))}</pre>`;
  }
  if (data && typeof data === 'object') {
    if (render === 'json') {
      return `<pre class="out">${esc(JSON.stringify(data, null, 2))}</pre>`;
    }
    return renderKV(data);
  }
  return `<pre class="out">${esc(String(data))}</pre>`;
}

function renderKV(obj) {
  const rows = Object.entries(obj).map(([k, v]) => {
    const val = (v && typeof v === 'object') ? JSON.stringify(v) : String(v);
    const num = typeof v === 'number' || /^[\d.,\s%]+$/.test(val) ? ' class="num"' : '';
    return `<tr><td>${esc(k)}</td><td${num}>${esc(val)}</td></tr>`;
  }).join('');
  return `<table class="kv">${rows}</table>`;
}

function renderTable(rows) {
  const cols = [];
  for (const row of rows) {
    for (const k of Object.keys(row)) if (!cols.includes(k)) cols.push(k);
  }
  const head = cols.map((c) => `<th>${esc(c)}</th>`).join('');
  const body = rows.map((row) => `<tr>${cols.map((c) => {
    const v = row[c];
    const val = (v && typeof v === 'object') ? JSON.stringify(v) : String(v ?? '');
    const num = typeof v === 'number' ? ' class="num"' : '';
    return `<td${num}>${esc(val)}</td>`;
  }).join('')}</tr>`).join('');
  return `<table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// ---------------------------------------------------------------- 工作台（占位）

function showWorkbench(question) {
  mode = 'workbench';
  el.modeLabel.textContent = '工作台';
  el.modeDot.classList.add('workbench');
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  el.workbench.classList.remove('hidden');
  el.count.textContent = `${entries.length} 个动作可作为工具`;
  el.workbench.innerHTML = `
    <div class="ph">
      <b>工作台还没接上模型。</b><br><br>
      它和启动器共用同一份插件清单——清单里的每个动作在这里就是一个工具。
      输入框里以 <code>?</code> 开头即进入本模式。<br>
      ${question ? `<br>你刚才问的是：<code>${esc(question)}</code><br>` : ''}
      <br>当前可用工具：<code>${esc(entries.map((e) => e.action.tool).slice(0, 6).join(', '))}</code> …<br><br>
      要在命令行先把这些工具交给别的 AI 用，见 <code>zkit mcp config</code>。
    </div>`;
}

// ---------------------------------------------------------------- 键盘

document.addEventListener('keydown', (e) => {
  if (mode === 'workbench') {
    if (e.key === 'Escape') { el.q.value = ''; renderList(); el.q.focus(); }
    return;
  }
  if (detail) {
    if (e.key === 'Escape') { e.preventDefault(); backToList(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(true); }
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (filtered.length) { active = Math.min(active + 1, filtered.length - 1); paintActive(); }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (filtered.length) { active = Math.max(active - 1, 0); paintActive(); }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) { openActive(); setTimeout(() => submit(true), 0); }
    else openActive();
  } else if (e.key === 'Escape') {
    el.q.value = '';
    renderList();
  }
});

el.q.addEventListener('input', () => { active = 0; renderList(); });
el.reload.addEventListener('click', () => load(true));

// ---------------------------------------------------------------- 启动

async function load(notify) {
  try {
    const data = await api('/api/plugins');
    plugins = data.plugins || [];
    entries = [];
    for (const p of plugins) {
      for (const a of p.actions) {
        entries.push({
          plugin: p, action: a,
          hayId: `${p.id}.${a.id} ${p.id} ${a.id}`,
        });
      }
    }
    if (notify) { active = 0; }
    renderList();
    applyHash();
  } catch (e) {
    el.count.textContent = `加载失败：${e.message}`;
  }
}

/** 支持 #/插件/动作 深链直达 */
function applyHash() {
  const m = /^#\/([\w.-]+)(?:\/([\w.-]+))?/.exec(location.hash || '');
  if (!m) return;
  const entry = entries.find((e) => e.plugin.id === m[1] && (!m[2] || e.action.id === m[2]));
  if (entry) openDetail(entry.plugin, entry.action);
}

window.addEventListener('hashchange', () => { if (!detail) applyHash(); });

load();
el.q.focus();