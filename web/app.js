// zerokit 启动器前端。
// 纯静态、无构建步骤，所以浏览器和 Tauri 壳用的是同一份代码。
// 所有来自插件的文本都经过 esc() 转义再插入 DOM——插件内容属于不可信输入。

import { romanize, scorePinyin } from './pinyin.js';
import { detectContent, matchFires } from './match.js';

const TOKEN = document.querySelector('meta[name=zk-token]').content;
const $ = (id) => document.getElementById(id);

const el = {
  q: $('q'), list: $('list'), empty: $('empty'), count: $('count'), searchRow: $('searchRow'),
  listView: $('listView'), detailView: $('detailView'), workbench: $('workbench'),
  psView: $('psView'), psBtn: $('psBtn'), psCount: $('psCount'), clipBtn: $('clipBtn'),
  modeLabel: $('modeLabel'), modeDot: $('modeDot'), reload: $('reloadBtn'),
};

let plugins = [];
let entries = [];       // 扁平化的动作索引
let filtered = [];
let filteredSmart = new Map();   // entry.order -> 命中的内容类型标签
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

// 内容智能匹配的判定逻辑在 match.js 里（纯函数，可以脱离浏览器直接测）。

// ---------------------------------------------------------------- 最近使用
//
// 纯本地（localStorage）：启动器高频用的是"就那几个"，让它们待在顺手的位置。
// 全在浏览器里，不经过服务端。

const RECENT_KEY = 'zerokit.recent';
const RECENT_MAX = 30;

function loadRecent() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function rememberRecent(pluginId, actionId) {
  const key = `${pluginId}.${actionId}`;
  const list = loadRecent().filter((x) => x !== key);
  list.unshift(key);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch { /* 隐私模式下写不了，忽略 */ }
}

function recentRank(entry) {
  const idx = loadRecent().indexOf(`${entry.plugin.id}.${entry.action.id}`);
  return idx < 0 ? -1 : idx;
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
/**
 * 一条动作在某个词下的得分。
 *
 * 刻意分成**两层**：动作自己这一层，和插件这一层。
 * 原因是一个实测出来的坑：插件的 keywords 里通常列着插件级的关键词
 * （例如「代理 proxy 网络 …」），它的拼音首字母正好以 dl 开头拿到 60 分，
 * 于是同一插件下**所有**动作都得到一样的分，排序立刻退化成字母序，
 * 「查看代理状态」反而排在只是插件沾边的动作后面。
 *
 * 所以：动作级命中直接胜出；只命中插件级的整体降一档。
 */
function scoreEntry(entry, token) {
  const p = entry.plugin;
  const a = entry.action;
  const best = (...pairs) => {
    let m = 0;
    for (const [value, weight] of pairs) if (value * weight > m) m = value * weight;
    return m;
  };

  // 动作自己这一层：名字里直接命中，"打开这个动作"的意图最明确
  const own = best(
    [scoreOne(a.id, token), 1.0],
    [scoreOne(a.title, token), 1.05],
    [scoreOne(entry.hayId, token), 0.9],
    [scorePinyin(entry.py.title, token), 1.05],
  );
  if (own > 0) return own;

  // 插件这一层：命中说明整个插件都相关，但整体降一档
  // 拼音只拿「短而有意图」的字段（插件名、关键词），**不碰 summary/description**：
  // 用首字母去匹配长句子会过松——实测「系统信息」的简介里恰好有「读 du / 零 ling」
  // 两个声母，结果打 dl 把它的三个动作全捞了出来。
  return 0.85 * best(
    [scoreOne(p.id, token), 0.8],
    [scoreOne(p.name, token), 0.85],
    [scoreOne((p.keywords || []).join(' '), token), 0.9],
    [scoreOne(p.summary, token), 0.5],
    [scoreOne(a.description, token), 0.55],
    [scorePinyin(entry.py.name, token), 1.0],
    [scorePinyin(entry.py.keywords, token), 0.9],
  );
}

function search(query) {
  const content = query.trim();
  const sniffed = detectContent(content);
  const tokens = content.toLowerCase().split(/\s+/).filter(Boolean);

  // 空输入：把最近用过的排前面。启动器高频用的就是那几个，让它们待在顺手的位置。
  if (tokens.length === 0) {
    const out = entries.map((entry) => {
      const rank = recentRank(entry);
      return { entry, score: rank < 0 ? 0 : 1000 - rank };
    });
    out.sort((x, y) => y.score - x.score || x.entry.order - y.entry.order);
    return out;
  }

  const out = [];
  for (const entry of entries) {
    let total = 0;
    let ok = true;
    for (const token of tokens) {
      const s = scoreEntry(entry, token);
      if (s <= 0) { ok = false; break; }
      total += s;
    }
    if (!ok) continue;
    const rank = recentRank(entry);
    if (rank >= 0) total += Math.max(0, 12 - rank);   // 用过的略微加分
    out.push({ entry, score: total });
  }

  // 内容智能匹配：命中就置顶。注意它**不依赖文字匹配**——
  // 往框里粘一个链接时，"在浏览器打开"这几个字压根匹配不上那串 URL，
  // 所以这里要单独扫一遍，把漏掉的补进来。
  if (sniffed) {
    const already = new Map(out.map((item) => [item.entry.order, item]));
    for (const entry of entries) {
      if (!matchFires(entry.action.match, content, sniffed)) continue;
      const existing = already.get(entry.order);
      if (existing) {
        existing.smart = sniffed.label;
        existing.score += 500;
      } else {
        out.push({ entry, score: 400, smart: sniffed.label });
      }
    }
  }

  // 并列时按清单里的顺序——那是作者对外的意图顺序，比按 id 字母序有意义
  out.sort((x, y) => y.score - x.score
    || x.entry.plugin.name.localeCompare(y.entry.plugin.name, 'zh')
    || x.entry.order - y.entry.order);
  return out;
}

// ---------------------------------------------------------------- 列表渲染

function renderList() {
  const q = el.q.value;
  mode = 'command';
  el.modeLabel.textContent = '命令';
  el.modeDot.classList.remove('workbench');
  el.workbench.classList.add('hidden');
  el.listView.classList.remove('hidden');
  if (detail) el.detailView.classList.remove('hidden');

  const results = search(q);
  filtered = results.map((r) => r.entry);
  filteredSmart = new Map(results.filter((r) => r.smart).map((r) => [r.entry.order, r.smart]));
  if (active >= filtered.length) active = Math.max(0, filtered.length - 1);

  el.empty.classList.toggle('hidden', filtered.length > 0);
  el.list.innerHTML = filtered.map((entry, i) => {
    const a = entry.action;
    const p = entry.plugin;
    const dep = p.requiresOk ? '' : `<span class="badge destructive">缺依赖</span>`;
    const smart = filteredSmart.get(entry.order);
    return `<li class="item${i === active ? ' active' : ''}${smart ? ' smart' : ''}" data-i="${i}" role="option">
      <span class="plugin">${esc(p.name)}</span>
      <span class="title">
        <span class="name">${esc(a.title)}</span>
        <span class="desc">${smart ? `内容看起来是${esc(smart)}，可以直接用` : esc(a.description || p.summary || '')}</span>
      </span>
      <span class="aid">${esc(a.id)}</span>
      ${smart ? `<span class="badge smart-badge">智能匹配</span>` : ''}
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
    : (loadRecent().length > 0
      ? `最近使用优先 · 共 ${entries.length} 个动作`
      : `${plugins.length} 个插件 · ${entries.length} 个动作`);
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
  if (!entry) return;
  // 智能匹配的条目：把输入框里的内容直接填进它声明的那个参数，
  // 用户按回车就能用，不用再复制粘贴一遍
  const smart = filteredSmart.get(entry.order);
  const prefill = smart && entry.action.match
    ? { [entry.action.match.fills]: el.q.value.trim() }
    : undefined;
  openDetail(entry.plugin, entry.action, prefill);
}

function openDetail(plugin, action, prefill) {
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
    const given = prefill && prefill[f.name] !== undefined ? prefill[f.name] : f.default;
    const def = given === undefined ? '' : ` value="${esc(given)}"`;
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

/** 走一遍完整执行：需要确认就先弹确认框，用户取消时返回 null */
async function executeAction(plugin, action, values, remember = false) {
  let res = await api('/api/run', {
    method: 'POST',
    body: { plugin: plugin.id, action: action.id, values },
  });
  if (res.needConfirm) {
    const ok = await askConfirm(plugin, action, res);
    if (!ok) return null;
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
  return res;
}

async function submit(remember) {
  if (!detail) return;
  const { plugin, action } = detail;
  const btn = $('runBtn');
  if (btn) { btn.disabled = true; btn.textContent = '执行中…'; }
  try {
    const values = collectValues(action);
    const res = await executeAction(plugin, action, values, remember);
    if (!res) return;   // 用户在确认框点了取消，不算失败也不算成功
    lastValues = values;
    lastResult = res;
    renderResult(res);
    rememberRecent(plugin.id, action.id);
    // 刚跑完的动作可能拉起了一个后台进程/服务，徽标要跟着变
    refreshPsCount();
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
  if (res.render === 'web' && detail) {
    // 插件自己的页面渲染结果：沙箱 iframe，无 allow-same-origin——
    // 页面拿不到令牌、fetch 不了宿主 API，执行只能走桥（见下方 zkit 桥）
    body += `<iframe class="web-frame" sandbox="allow-scripts"
      src="/p/${esc(detail.plugin.id)}/index.html" title="${esc(detail.action.title)}"></iframe>`;
  } else if (res.render === 'html' && res.stdout) {
    // output = "html"：stdout 本身就是 HTML 片段，沙箱里直接渲染
    body += `<iframe class="web-frame html" sandbox="allow-scripts" srcdoc="${esc(res.stdout)}"></iframe>`;
  } else if (res.data !== undefined) {
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

  // web 面的 iframe 加载完就发执行上下文（页面里的 hello 握手是双保险）
  const frame = box.querySelector('.web-frame:not(.html)');
  if (frame) frame.addEventListener('load', () => sendContext(frame));
}

// ---------------------------------------------------------------- 插件页面桥（宿主侧）
//
// render = "web" 的动作，结果交给插件的 web/index.html 渲染。
// 页面在 sandbox iframe 里（opaque origin），能和我们说的只有 postMessage：
//   页面 → 这里：hello（请求上下文）/ run（执行动作）/ resize（报告高度）
//   这里 → 页面：context（动作 + 参数 + 结果）/ run:result（run 的应答）
// 令牌永远不会发给插件页面——它要执行动作只能请我们转发，
// 确认弹窗照常弹出，插件页面代替不了用户点头。

let lastValues = {};   // 最近一次执行时用户填的参数
let lastResult = null; // 最近一次执行的结果

function sendContext(frame) {
  if (!frame.contentWindow || !detail || !lastResult) return;
  frame.contentWindow.postMessage({
    __zkit: true,
    type: 'context',
    payload: {
      plugin: { id: detail.plugin.id, name: detail.plugin.name },
      action: { id: detail.action.id, title: detail.action.title },
      params: lastValues,
      result: {
        ok: lastResult.ok, data: lastResult.data, stdout: lastResult.stdout,
        stderr: lastResult.stderr, error: lastResult.error, ms: lastResult.ms,
      },
    },
  }, '*');   // targetOrigin 用 '*'：sandbox 页面是 opaque origin，没有具体源可写（消息不含敏感内容）
}

async function bridgeRun(frame, msg) {
  const reply = (payload) => frame.contentWindow.postMessage({
    __zkit: true, type: 'run:result', callId: msg.callId, payload,
  }, '*');
  const plugin = detail?.plugin;
  const action = plugin?.actions.find((a) => a.id === msg.action);
  if (!action) {
    reply({ ok: false, error: `桥只能调本插件的动作：${plugin ? `没有动作 ${msg.action}` : '详情页已关闭'}` });
    return;
  }
  try {
    const res = await executeAction(plugin, action, msg.values ?? {});
    if (!res) { reply({ ok: false, error: '用户在确认框取消了执行' }); return; }
    lastResult = res;   // 页面后续要 context 时给最新的
    reply({
      ok: res.ok !== false && !res.error,
      data: res.data, stdout: res.stdout, stderr: res.stderr,
      error: res.error, ms: res.ms,
    });
    refreshPsCount();
  } catch (e) {
    reply({ ok: false, error: e.message });
  }
}

window.addEventListener('message', (ev) => {
  const msg = ev.data;
  if (!msg || msg.__zkit !== true) return;
  // 只信我们自己创建的那个 iframe：消息来源必须是当前结果区里的 web-frame
  const frame = document.querySelector('#result .web-frame:not(.html)');
  if (!frame || ev.source !== frame.contentWindow) return;
  if (msg.type === 'hello') {
    sendContext(frame);
  } else if (msg.type === 'resize') {
    // 页面报告自己的内容高度；上限防恶意撑爆，下限防缩没了
    const h = Math.min(720, Math.max(80, Number(msg.height) || 0));
    frame.style.height = `${h}px`;
  } else if (msg.type === 'run') {
    bridgeRun(frame, msg);
  }
});

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

// ---------------------------------------------------------------- 运行中
//
// 「启动了三个插件的服务，我得能看见是哪三个、并且能结束它们」——
// 这是启动器和「一堆快捷方式」的分界线。
//
// 面板里的东西分两类：
//   1. 内核托管的进程：background = true 的动作拉起的，我们直接管着
//   2. 插件声明的服务：像白名单代理那种自己管守护进程的，按端口/PID 检测
//      （检测走系统事实，所以别的程序甚至手动起的也看得见）

let psTimer = null;

function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分 ${s % 60} 秒`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}

async function fetchPs() {
  try {
    const data = await api('/api/ps');
    const running = (data.processes ?? []).filter((p) => p.running).length
      + (data.services ?? []).filter((s) => s.running).length;
    el.psCount.textContent = String(running);
    el.psBtn.classList.toggle('has-items', running > 0);
    return data;
  } catch {
    return null;
  }
}

/** 只更新徽标，轻量，可在动作执行后顺手调 */
async function refreshPsCount() {
  await fetchPs();
}

async function showPs() {
  mode = 'ps';
  el.modeLabel.textContent = '运行中';
  el.searchRow.classList.add('hidden');
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  el.workbench.classList.add('hidden');
  el.psView.classList.remove('hidden');
  if (location.hash !== '#/ps') history.replaceState(null, '', '#/ps');

  await renderPs();
  // 运行中的数据要能自己动：面板开着时每 2 秒刷一次
  clearInterval(psTimer);
  psTimer = setInterval(renderPs, 2000);
}

function exitPs() {
  clearInterval(psTimer);
  psTimer = null;
  mode = 'command';
  el.psView.classList.add('hidden');
  el.searchRow.classList.remove('hidden');
  el.listView.classList.remove('hidden');
  el.modeLabel.textContent = '命令';
  history.replaceState(null, '', location.pathname);
  renderList();
  el.q.focus();
}

async function renderPs() {
  const data = await fetchPs();
  if (!data) {
    el.psView.innerHTML = '<div class="ps-empty">读不到运行状态</div>';
    return;
  }
  const procs = data.processes ?? [];
  const services = data.services ?? [];
  const runningServices = services.filter((s) => s.running);
  const idleServices = services.filter((s) => !s.running);
  const runningProcs = procs.filter((p) => p.running);
  const total = runningProcs.length + runningServices.length;

  const procHtml = runningProcs.map((p) => `
    <div class="ps-item">
      <div class="ps-item-head">
        <span class="ps-dot"></span>
        <span class="ps-item-title">${esc(p.title)}</span>
        <span class="ps-item-meta">PID ${esc(p.pid)} · 已运行 ${esc(fmtDuration(Date.now() - p.startedAt))}</span>
        <span class="badge read">由 zerokit 托管</span>
      </div>
      <div class="cmd-line">${esc(p.command)}</div>
      ${(p.tail ?? []).length ? `<div class="ps-tail">${esc(p.tail.join('\n'))}</div>` : ''}
      <div class="ps-item-actions">
        <button class="ghost" data-kill="${esc(p.id)}">结束</button>
      </div>
    </div>`).join('');

  const svcHtml = runningServices.map((s) => `
    <div class="ps-item">
      <div class="ps-item-head">
        <span class="ps-dot"></span>
        <span class="ps-item-title">${esc(s.title)}</span>
        <span class="ps-item-meta">${s.port ? `端口 ${esc(s.port)}` : 'pid 文件'} · PID ${esc(s.pid ?? '?')}</span>
        <span class="badge mutate">插件声明的服务</span>
      </div>
      ${s.stopCommand ? `<div class="cmd-line">停止命令：${esc(s.stopCommand)}</div>` : ''}
      <div class="ps-item-actions">
        <button class="ghost" data-kill="${esc(`${s.pluginId}.${s.id}`)}">
          ${s.canStop ? '停止' : '结束进程'}
        </button>
      </div>
    </div>`).join('');

  el.psView.innerHTML = `
    <div class="ps-head">
      <h2>运行中（${total}）</h2>
      <span class="sub">每 2 秒自动刷新</span>
      ${total > 0 ? '<button class="ghost" id="psKillAll">全部结束</button>' : ''}
    </div>
    ${total === 0 ? '<div class="ps-empty">现在没有任何在运行的东西。</div>' : ''}
    ${procHtml ? `<div class="ps-group"><h3>由 zerokit 托管的进程</h3>${procHtml}</div>` : ''}
    ${svcHtml ? `<div class="ps-group"><h3>插件声明的服务</h3>${svcHtml}</div>` : ''}
    ${idleServices.length ? `<div class="ps-group"><h3>已声明但未运行的服务</h3>
      ${idleServices.map((s) => `<div class="ps-item dead"><div class="ps-item-head">
        <span class="ps-dot off"></span>
        <span class="ps-item-title">${esc(s.title)}</span>
        <span class="ps-item-meta">${esc(s.pluginId)}.${esc(s.id)}${s.port ? ` · 端口 ${esc(s.port)}` : ''}</span>
        <span class="badge">未运行</span>
      </div></div>`).join('')}
    </div>` : ''}
    <div class="actions"><button class="primary" id="psBack">返回</button></div>`;

  el.psView.querySelectorAll('[data-kill]').forEach((btn) => {
    btn.addEventListener('click', () => killTarget([btn.dataset.kill], btn));
  });
  el.psView.querySelector('#psKillAll')?.addEventListener('click', (e) => killTarget([], e.target, true));
  el.psView.querySelector('#psBack')?.addEventListener('click', exitPs);
}

async function killTarget(ids, btn, all = false) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '结束中…';
  try {
    const res = await api('/api/kill', { method: 'POST', body: all ? { all: true } : { ids } });
    const bad = (res.results ?? []).filter((r) => !r.ok);
    if (bad.length) {
      btn.textContent = '失败';
      btn.title = bad.map((r) => `${r.target}：${r.message}`).join('\n');
      setTimeout(() => { btn.disabled = false; btn.textContent = label; }, 2500);
    }
    setTimeout(renderPs, 400);
  } catch (e) {
    btn.textContent = '失败';
    btn.title = e.message;
    setTimeout(() => { btn.disabled = false; btn.textContent = label; }, 2500);
  }
}

// ---------------------------------------------------------------- 工作台

const wb = {
  sessionId: '',
  model: '',
  busy: false,
  log: null,
  ai: null,
};

/** 从工作台退回命令模式 */
function exitWorkbench() {
  mode = 'command';
  el.workbench.classList.add('hidden');
  el.modeLabel.textContent = '命令';
  el.modeDot.classList.remove('workbench');
  el.searchRow.classList.remove('hidden');
  el.listView.classList.remove('hidden');
  el.q.value = '';
  renderList();
  el.q.focus();
}

function showWorkbench(question) {
  mode = 'workbench';
  el.modeLabel.textContent = '工作台';
  el.modeDot.classList.add('workbench');
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  el.workbench.classList.remove('hidden');
  el.searchRow.classList.add('hidden'); // 工作台有自己的输入框，别和搜索框并排打架

  if (!wb.log) {
    el.workbench.innerHTML = `
      <div class="wb-head">
        <span class="wb-model" id="wbModel">正在检查模型配置…</span>
        <span class="wb-tools" id="wbTools"></span>
        <button class="ghost" id="wbReset">新会话</button>
      </div>
      <div class="wb-log" id="wbLog"></div>
      <div class="wb-input">
        <input id="wbQ" placeholder="要它做什么？例如：看看系统概况" autocomplete="off">
        <button class="primary" id="wbSend">发送</button>
      </div>`;
    wb.log = $('wbLog');
    $('wbSend').addEventListener('click', () => wbSend());
    $('wbQ').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); wbSend(); }
    });
    $('wbReset').addEventListener('click', () => { wb.sessionId = ''; wb.log.innerHTML = ''; });
    loadAiInfo();
  }

  if (question) {
    $('wbQ').value = question;
  }
  el.count.textContent = `${entries.length} 个动作可作为工具`;
  setTimeout(() => $('wbQ')?.focus(), 0);
}

async function loadAiInfo() {
  try {
    const info = await api('/api/ai');
    wb.ai = info;
    wb.model = info.model;
    $('wbModel').textContent = `${info.provider} · ${info.model}`;
    $('wbTools').textContent = `${info.tools} 个工具可用`;
    if (!info.ready) {
      wbBubble('sys',
        `模型还没配置好：${info.reason}\n${info.hint || ''}\n\n`
        + '（想先试界面可以在 config.toml 里写 provider = "mock"，它会用一个假模型把整条链路跑通）');
    }
  } catch (e) {
    $('wbModel').textContent = `读取模型配置失败：${e.message}`;
  }
}

function wbBubble(kind, text, opts = {}) {
  const node = document.createElement('div');
  node.className = `wb-msg ${kind}${opts.thinking ? ' thinking' : ''}`;
  node.innerHTML = `<div class="wb-who">${kind === 'me' ? '你' : kind === 'sys' ? 'zerokit' : ''}</div>
    <div class="wb-text">${esc(text)}</div>`;
  wb.log.appendChild(node);
  wb.log.scrollTop = wb.log.scrollHeight;
  return node.querySelector('.wb-text');
}

/**
 * 工具调用卡片。
 * approvable=true 时带「允许 / 拒绝」按钮（有副作用的动作）；
 * 只读动作不给按钮，因为不需要确认——但它**也必须显示出来**，
 * 否则模型悄悄调了工具，用户完全看不见发生了什么。
 */
function wbToolCard(call, approvable) {
  const node = document.createElement('div');
  node.className = 'wb-tool';
  node.dataset.id = call.id;
  node.innerHTML = `
    <div class="wb-tool-head">
      <span class="badge ${esc(call.risk)}">${esc(RISK_TEXT[call.risk] || call.risk)}</span>
      <span class="wb-tool-name">${esc(call.actionTitle)}</span>
      <span class="wb-tool-src">${esc(call.pluginName)} · ${esc(call.tool)}</span>
      <span class="wb-tool-state" data-state>${approvable ? '等待确认' : '准备执行'}</span>
    </div>
    <div class="cmd-line">${esc(call.command || '(无命令)')}</div>
    ${approvable ? `<div class="wb-tool-actions">
      <button class="primary" data-allow>允许执行</button>
      <button class="ghost" data-deny>拒绝</button>
    </div>` : ''}
    <div class="wb-tool-out"></div>`;
  if (approvable) {
    node.querySelector('[data-allow]').addEventListener('click', () => wbApprove(call.id, true, node));
    node.querySelector('[data-deny]').addEventListener('click', () => wbApprove(call.id, false, node));
  }
  wb.log.appendChild(node);
  wb.log.scrollTop = wb.log.scrollHeight;
  return node;
}

function wbFindCard(id) {
  return wb.log.querySelector(`.wb-tool[data-id="${CSS.escape(id)}"]`);
}

async function wbApprove(callId, allow, node) {
  node.querySelector('.wb-tool-actions').remove();
  node.querySelector('[data-state]').textContent = allow ? '已批准，执行中…' : '已拒绝';
  node.classList.toggle('declined', !allow);
  try {
    await api('/api/chat/approve', {
      method: 'POST',
      body: { sessionId: wb.sessionId, callId, allow },
    });
  } catch (e) {
    node.querySelector('[data-state]').textContent = `审批失败：${e.message}`;
  }
}

async function wbSend() {
  const input = $('wbQ');
  const text = input.value.trim();
  if (!text || wb.busy) return;
  input.value = '';
  wbBubble('me', text);

  wb.busy = true;
  const btn = $('wbSend');
  btn.disabled = true;
  btn.textContent = '…';

  let assistantText = null;
  let thinkingText = null;
  let sawTool = false;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zerokit-token': TOKEN },
      body: JSON.stringify({ message: text, sessionId: wb.sessionId }),
    });

    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      wbBubble('sys', `没法开始：${err.error}${err.hint ? '\n' + err.hint : ''}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i).trim();
        buf = buf.slice(i + 2);
        if (!chunk.startsWith('data:')) continue;
        let evt;
        try { evt = JSON.parse(chunk.slice(5).trim()); } catch { continue; }

        if (evt.type === 'session') {
          wb.sessionId = evt.sessionId;
          if (evt.model) { wb.model = evt.model; $('wbModel').textContent = `${wb.ai?.provider ?? ''} · ${evt.model}`; }
        } else if (evt.type === 'text') {
          if (!assistantText) assistantText = wbBubble('sys', '');
          assistantText.textContent += evt.delta;
          wb.log.scrollTop = wb.log.scrollHeight;
        } else if (evt.type === 'thinking') {
          if (!thinkingText) thinkingText = wbBubble('sys', '', { thinking: true });
          thinkingText.textContent += evt.delta;
        } else if (evt.type === 'tool_pending') {
          sawTool = true;
          assistantText = null;
          wbToolCard(evt.call, true);
        } else if (evt.type === 'tool_start') {
          // 只读动作不会先有 tool_pending，这里补建卡片，保证调用过程可见
          let card = wbFindCard(evt.call.id);
          if (!card) {
            sawTool = true;
            assistantText = null;
            card = wbToolCard(evt.call, false);
          }
          card.querySelector('[data-state]').textContent = '执行中…';
        } else if (evt.type === 'tool_result') {
          const r = evt.result;
          const card = wbFindCard(r.id);
          if (card) {
            card.querySelector('[data-state]').innerHTML = r.declined
              ? '已拒绝'
              : (r.ok ? `✓ ${r.ms} ms` : `✗ ${esc(r.error || '失败')}`);
            card.classList.toggle('declined', !!r.declined);
            card.classList.toggle('failed', !r.ok && !r.declined);
            const out = card.querySelector('.wb-tool-out');
            out.innerHTML = `<details${r.summary.length < 400 ? ' open' : ''}>
              <summary>返回内容</summary><pre class="out">${esc(r.summary)}</pre></details>`;
          }
          assistantText = null;
        } else if (evt.type === 'done') {
          if (!assistantText && !sawTool) wbBubble('sys', '（没有输出）');
          const meta = document.createElement('div');
          meta.className = 'wb-meta';
          meta.textContent = `完成 · ${evt.steps} 步`;
          wb.log.appendChild(meta);
        } else if (evt.type === 'error') {
          wbBubble('sys', `出错了：${evt.message}`);
        }
        wb.log.scrollTop = wb.log.scrollHeight;
      }
    }
  } catch (e) {
    wbBubble('sys', `连接中断：${e.message}`);
  } finally {
    wb.busy = false;
    btn.disabled = false;
    btn.textContent = '发送';
    $('wbQ')?.focus();
  }
}

// ---------------------------------------------------------------- 键盘

document.addEventListener('keydown', (e) => {
  if (mode === 'ps') {
    if (e.key === 'Escape') { e.preventDefault(); exitPs(); }
    return;
  }
  if (mode === 'workbench') {
    if (e.key === 'Escape') {
      e.preventDefault();
      // 先清空输入框，再按一次才退出（避免误触把对话界面关掉）
      const q = $('wbQ');
      if (q && q.value) q.value = '';
      else exitWorkbench();
    }
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

el.clipBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      el.count.textContent = '剪贴板是空的';
      return;
    }
    el.q.value = text.trim();
    active = 0;
    renderList();
  } catch {
    // 浏览器要求授权才能读剪贴板；直接说清楚，别静默失败
    el.count.textContent = '读剪贴板被浏览器拒绝了，请允许剪贴板权限';
  }
});

el.q.addEventListener('input', () => {
  const q = el.q.value;
  // 输入 ? 即切到工作台，后面的内容当作第一个问题带过去
  if (q.startsWith('?') && mode !== 'workbench') {
    el.q.value = '';
    showWorkbench(q.slice(1).trim());
    return;
  }
  active = 0;
  renderList();
});
el.reload.addEventListener('click', () => { load(true); refreshPsCount(); });
el.psBtn.addEventListener('click', () => { if (mode === 'ps') exitPs(); else showPs(); });

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
          order: entries.length,     // 清单顺序，用于并列时的兜底排序
          hayId: `${p.id}.${a.id} ${p.id} ${a.id}`,
          // 拼音形式在装载时算一次，之后每次按键直接用（不重复转换）
          py: {
            name: romanize(p.name),
            title: romanize(a.title),
            keywords: romanize((p.keywords || []).join(' ')),
          },
        });
      }
    }
    if (notify) { active = 0; }
    renderList();
    refreshPsCount();   // 顺手把「运行中」徽标更新一下
    applyHash();
  } catch (e) {
    el.count.textContent = `加载失败：${e.message}`;
  }
}

/** 支持 #/插件/动作 深链直达 */
function applyHash() {
  // #/ps  直接打开「运行中」
  if ((location.hash || '') === '#/ps') {
    showPs();
    return;
  }

  // #/q=...  带一个初始搜索词（命令行、通知、别的程序都能给这么个链接）
  const qHash = /^#\/q=(.*)$/.exec(location.hash || '');
  if (qHash) {
    el.q.value = decodeURIComponent(qHash[1]);
    active = 0;
    renderList();
    return;
  }

  // #/workbench?q=...  直接进工作台并把这个问句发出去
  const wbHash = /^#\/workbench(?:\?(.*))?$/.exec(location.hash || '');
  if (wbHash) {
    const q = new URLSearchParams(wbHash[1] || '').get('q') || '';
    showWorkbench(q);
    if (q) setTimeout(() => wbSend(), 200);
    return;
  }
  const m = /^#\/([\w.-]+)(?:\/([\w.-]+))?/.exec(location.hash || '');
  if (!m) return;
  const entry = entries.find((e) => e.plugin.id === m[1] && (!m[2] || e.action.id === m[2]));
  if (entry) openDetail(entry.plugin, entry.action);
}

window.addEventListener('hashchange', () => { if (!detail) applyHash(); });

// 把内部状态挂出来，便于排查，也方便以后用 CDP 做界面自动化测试
window.__zerokit = {
  get entries() { return entries; },
  get filtered() { return filtered; },
  get mode() { return mode; },
  scoreEntry, search, romanize, scorePinyin, renderList,
};

load();
el.q.focus();