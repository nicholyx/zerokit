// zerokit 启动器前端。
// 纯静态、无构建步骤，所以浏览器和 Tauri 壳用的是同一份代码。
// 所有来自插件的文本都经过 esc() 转义再插入 DOM——插件内容属于不可信输入。

import { romanize, scorePinyin } from './pinyin.js';
import { detectContent, matchFires } from './match.js';
import {
  normalizeTheme, resolveTheme, SHORTCUTS, highlightHtml, actionKey,
  toggleFavorite, isFavorite, favoritesFirst, rememberParams, pushRunHistory,
  pluginHealth, PROMPTS,
  ACCENTS, normalizeAccent, FILTERS, filterActions, pushSearch,
  topActions, recentRuns, invocationText, resultMarkdown,
} from './extras.js';

const TOKEN = document.querySelector('meta[name=zk-token]').content;
const $ = (id) => document.getElementById(id);

const el = {
  q: $('q'), list: $('list'), empty: $('empty'), count: $('count'), searchRow: $('searchRow'),
  listView: $('listView'), detailView: $('detailView'), workbench: $('workbench'),
  psView: $('psView'), psBtn: $('psBtn'), psCount: $('psCount'), clipBtn: $('clipBtn'),
  logsView: $('logsView'), doctorView: $('doctorView'), listTools: $('listTools'),
  allowView: $('allowView'),
  plugView: $('plugView'), plugBtn: $('plugBtn'), plugCount: $('plugCount'),
  marketView: $('marketView'), marketBtn: $('marketBtn'), marketCount: $('marketCount'),
  modeLabel: $('modeLabel'), modeDot: $('modeDot'), reload: $('reloadBtn'),
};

let plugins = [];
let entries = [];       // 扁平化的动作索引
let filtered = [];
let filteredSmart = new Map();   // entry.order -> 命中的内容类型标签
let active = 0;
let detail = null;      // { plugin, action }
let mode = 'command';
// 集市面板的状态：全量快照 + 搜索词 + 待确认的安装预览
let marketData = { markets: [], total: 0 };
let marketQuery = '';
let marketPreview = null;

// ---------------------------------------------------------------- 本地偏好
// 主题 / 收藏 / 参数记忆 / 执行历史全部只进 localStorage：
// 这是「这台机器上这个人用起来顺手」的状态，不该同步到插件或服务端。
const PREF = {
  theme: 'zerokit.theme',
  accent: 'zerokit.accent',
  favorites: 'zerokit.favorites',
  params: 'zerokit.params',
  runs: 'zerokit.runs',
  searches: 'zerokit.searches',
};
let favorites = [];
let paramStore = {};
let runStore = {};
let accent = 'ocean';
let searchHistory = [];
let listFilter = 'all';

function readJson(key, fallback) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null');
    return raw ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 隐私模式 */ }
}

function savePrefs() {
  writeJson(PREF.favorites, favorites);
  writeJson(PREF.params, paramStore);
  writeJson(PREF.runs, runStore);
}

function loadPrefs() {
  const favs = readJson(PREF.favorites, []);
  favorites = Array.isArray(favs) ? favs.filter((x) => typeof x === 'string') : [];
  const params = readJson(PREF.params, {});
  paramStore = params && typeof params === 'object' ? params : {};
  const runs = readJson(PREF.runs, {});
  runStore = runs && typeof runs === 'object' ? runs : {};
  accent = normalizeAccent(localStorage.getItem(PREF.accent));
  const searches = readJson(PREF.searches, []);
  searchHistory = Array.isArray(searches) ? searches.filter((x) => typeof x === 'string') : [];
}

function applyAccent() {
  document.documentElement.dataset.accent = normalizeAccent(accent);
}

function applyTheme() {
  const choice = normalizeTheme(localStorage.getItem(PREF.theme));
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
  const resolved = resolveTheme(choice, prefersDark);
  document.documentElement.dataset.theme = resolved;
  const btn = $('themeBtn');
  if (btn) {
    const label = choice === 'system' ? `跟随系统 · ${resolved === 'dark' ? '深色' : '浅色'}`
      : choice === 'dark' ? '深色' : '浅色';
    btn.textContent = `${resolved === 'dark' ? '◐' : '◑'} ${label}`;
    btn.title = '外观：主题与强调色';
  }
}

/** 外观面板：主题三档 + 六个强调色。以前只能循环切换，想回上一档要再点两轮。 */
function openThemePop() {
  const pop = $('themePop');
  if (!pop) return;
  if (!pop.classList.contains('hidden')) {
    pop.classList.add('hidden');
    return;
  }
  const choice = normalizeTheme(localStorage.getItem(PREF.theme));
  pop.innerHTML = `
    <div class="tp-head">主题</div>
    <div class="tp-row">
      ${[['system', '跟随系统'], ['dark', '深色'], ['light', '浅色']].map(([id, label]) => `
        <button data-theme-choice="${id}" class="${choice === id ? 'on' : ''}">${label}</button>`).join('')}
    </div>
    <div class="tp-head">强调色</div>
    <div class="tp-swatches">
      ${ACCENTS.map((a) => `<button data-accent="${a.id}" title="${esc(a.label)}"
        style="background:${a.color}" class="${normalizeAccent(accent) === a.id ? 'on' : ''}"></button>`).join('')}
    </div>`;
  pop.classList.remove('hidden');
  // 选中后就地更新高亮，不重建 DOM、也不收起面板：重建会让本次点击的目标
  // 变成游离节点，document 上的「点外面关掉」判断就会误判成点了外面。
  const paint = () => {
    const choice = normalizeTheme(localStorage.getItem(PREF.theme));
    pop.querySelectorAll('[data-theme-choice]').forEach((b) => {
      b.classList.toggle('on', b.dataset.themeChoice === choice);
    });
    pop.querySelectorAll('[data-accent]').forEach((b) => {
      b.classList.toggle('on', b.dataset.accent === normalizeAccent(accent));
    });
  };
  pop.querySelectorAll('[data-theme-choice]').forEach((b) => {
    b.addEventListener('click', () => {
      try { localStorage.setItem(PREF.theme, b.dataset.themeChoice); } catch { /* 隐私模式 */ }
      applyTheme();
      paint();
    });
  });
  pop.querySelectorAll('[data-accent]').forEach((b) => {
    b.addEventListener('click', () => {
      accent = normalizeAccent(b.dataset.accent);
      try { localStorage.setItem(PREF.accent, accent); } catch { /* 隐私模式 */ }
      applyAccent();
      paint();
    });
  });
}

function cycleTheme() {
  const order = ['system', 'dark', 'light'];
  const now = normalizeTheme(localStorage.getItem(PREF.theme));
  const next = order[(order.indexOf(now) + 1) % order.length];
  try { localStorage.setItem(PREF.theme, next); } catch { /* 隐私模式 */ }
  applyTheme();
}

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

/**
 * 插件多的时候，扁平的动作列表会变成一锅粥。空输入（浏览态）按插件分组：
 * 组头是插件名 + 版本 + 动作数，组内保持排序。搜索时保持扁平——
 * 搜的时候用户找的是「那条动作」，分组反而碍事。
 * 键盘导航不受影响：filtered 仍是扁平序，.item 的 data-i 对应它。
 */
const COLLAPSE_KEY = 'zerokit.collapsed';

function loadCollapsed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

function saveCollapsed(set) {
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set])); } catch { /* 隐私模式 */ }
}

function itemHtml(entry, i, showPlugin, query = '') {
  const a = entry.action;
  const p = entry.plugin;
  const dep = p.requiresOk ? '' : `<span class="badge destructive">缺依赖</span>`;
  const smart = filteredSmart.get(entry.order);
  const key = actionKey(p.id, a.id);
  const fav = isFavorite(favorites, key);
  // 搜索态跨插件，条目里带上插件名；浏览态有分组头就不重复了
  const who = showPlugin ? `<span class="plugin">${highlightHtml(p.name, query, esc)}</span>` : '';
  return `<li class="item${i === active ? ' active' : ''}${smart ? ' smart' : ''}${fav ? ' fav' : ''}" data-i="${i}" role="option">
    ${who}
    <span class="title">
      <span class="name">${highlightHtml(a.title, query, esc)}</span>
      <span class="desc">${smart ? `内容看起来是${esc(smart)}，可以直接用` : esc(a.description || p.summary || '')}</span>
    </span>
    <button class="star${fav ? ' on' : ''}" data-fav="${esc(key)}" title="${fav ? '取消收藏' : '收藏这个动作'}">${fav ? '★' : '☆'}</button>
    <span class="aid">${esc(a.id)}</span>
    ${a.steps?.length ? `<span class="badge">组合 ${a.steps.length} 步</span>` : ''}
    ${smart ? `<span class="badge smart-badge">智能匹配</span>` : ''}
    ${dep}
    <span class="badge ${esc(a.risk)}">${esc(RISK_TEXT[a.risk] || a.risk)}</span>
  </li>`;
}

function hidePanels() {
  for (const v of [el.listView, el.detailView, el.workbench, el.psView,
    el.plugView, el.marketView, el.logsView, el.doctorView, el.allowView]) {
    v.classList.add('hidden');
  }
}

function rememberSearch(query) {
  const q = String(query ?? '').trim();
  if (!q) return;
  searchHistory = pushSearch(searchHistory, q);
  writeJson(PREF.searches, searchHistory);
}

/** 首页「最近执行」：跨动作的最近 5 条，点一下直接回到那条动作。 */
function recentBlockHtml() {
  const rows = recentRuns(runStore, 5);
  if (!rows.length) return '';
  const inner = rows.map((r) => {
    const dot = r.key.lastIndexOf('.');
    const plugin = entries.find((e) => e.plugin.id === r.key.slice(0, dot)
      && e.action.id === r.key.slice(dot + 1));
    if (!plugin) return '';
    return `<div class="recent-row" data-recent="${esc(r.key)}">
      <span class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'}</span>
      <span class="r-what">${esc(plugin.action.title)}</span>
      <span class="r-when">${esc(new Date(r.ts).toLocaleString())}</span>
    </div>`;
  }).join('');
  return `<li class="recent-block"><div class="recent-title">最近执行</div>${inner}</li>`;
}

/** 列表上方的筛选与搜索历史：筛选算的是「当前搜索结果」里的分布。 */
function renderListTools(base, q) {
  const count = (id) => filterActions(base, id, favorites).length;
  const chips = FILTERS.map((f) => `<button class="chip${listFilter === f.id ? ' on' : ''}"
    data-filter="${f.id}">${f.label}<b>${count(f.id)}</b></button>`).join('');
  const hist = q.trim() === '' && searchHistory.length
    ? `<div class="hist-chips"><span class="hist-label">最近搜索</span>${searchHistory
      .map((x) => `<button class="chip quiet" data-hist="${esc(x)}">${esc(x)}</button>`).join('')}
      <button class="chip quiet" id="clearHist">清空</button></div>`
    : '';
  el.listTools.innerHTML = `<div class="chips">${chips}</div>${hist}`;
  el.listTools.querySelectorAll('[data-filter]').forEach((b) => {
    b.addEventListener('click', () => { listFilter = b.dataset.filter; renderList(); });
  });
  el.listTools.querySelectorAll('[data-hist]').forEach((b) => {
    b.addEventListener('click', () => { el.q.value = b.dataset.hist; listFilter = 'all'; renderList(); });
  });
  $('clearHist')?.addEventListener('click', () => {
    searchHistory = [];
    writeJson(PREF.searches, searchHistory);
    renderList();
  });
}

function renderList() {
  const q = el.q.value;
  mode = 'command';
  el.modeLabel.textContent = '命令';
  el.modeDot.classList.remove('workbench');
  el.workbench.classList.add('hidden');
  el.plugView.classList.add('hidden');
  el.psView.classList.add('hidden');
  el.marketView.classList.add('hidden');
  el.logsView.classList.add('hidden');
  el.doctorView.classList.add('hidden');
  el.listView.classList.remove('hidden');
  if (detail) el.detailView.classList.remove('hidden');

  const results = search(q);
  const baseEntries = results.map((r) => r.entry);
  const built = filterActions(baseEntries, listFilter, favorites);
  filtered = q.trim() === '' && favorites.length > 0 && listFilter === 'all'
    ? favoritesFirst(built, new Set(favorites))
    : built;
  filteredSmart = new Map(results
    .filter((r) => r.smart && filtered.includes(r.entry))
    .map((r) => [r.entry.order, r.smart]));
  if (active >= filtered.length) active = Math.max(0, filtered.length - 1);

  if (filtered.length > 0) {
    el.empty.classList.add('hidden');
  } else {
    // 空状态不是死胡同：给出「下一步做什么」的可点建议
    const suggestions = [];
    if (q.trim()) {
      suggestions.push(`<button class="link" data-sug="clear">清空搜索，浏览全部动作</button>`);
      suggestions.push(`<button class="link" data-sug="market">去集市找一个能做这件事的插件</button>`);
      suggestions.push(`<button class="link" data-sug="wb">问 AI 工作台：「${esc(q.trim())}」</button>`);
    } else if (!plugins.length) {
      suggestions.push(`<button class="link" data-sug="market">还没有插件——去集市装一个</button>`);
      suggestions.push(`<button class="link" data-sug="doctor">检查环境哪里没配好</button>`);
    }
    el.empty.innerHTML = suggestions.length
      ? `<div class="empty-title">${q.trim() ? `没有匹配「${esc(q.trim())}」的动作` : '这里还空着'}</div>
         <div class="empty-sugs">${suggestions.join('')}</div>`
      : '没有匹配的插件动作';
    el.empty.classList.remove('hidden');
    el.empty.querySelectorAll('[data-sug]').forEach((b) => b.addEventListener('click', () => {
      const act2 = b.dataset.sug;
      if (act2 === 'clear') { el.q.value = ''; renderList(); el.q.focus(); }
      else if (act2 === 'market') showMarket();
      else if (act2 === 'doctor') showDoctor();
      else if (act2 === 'wb') showWorkbench(el.q.value.trim());
    }));
  }

  if (q.trim() === '' && filtered.length > 0) {
    // 浏览态：按插件分组（组顺序 = 该插件第一个动作在排序里的位置）
    const collapsed = loadCollapsed();
    const groups = new Map();
    filtered.forEach((entry, i) => {
      const id = entry.plugin.id;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push([entry, i]);
    });
    el.list.innerHTML = (listFilter === 'all' ? recentBlockHtml() : '')
      + [...groups.entries()].map(([id, items]) => {
      const p = items[0][0].plugin;
      const isCollapsed = collapsed.has(id);
      const dep = p.requiresOk ? '' : `<span class="badge destructive">缺依赖</span>`;
      return `<li class="group-head${isCollapsed ? ' collapsed' : ''}" data-group="${esc(id)}">
          <span class="g-arrow">${isCollapsed ? '▸' : '▾'}</span>
          <span class="g-name">${esc(p.name)}</span>
          <span class="g-meta">${esc(p.id)} · v${esc(p.version)} · ${items.length} 个动作</span>
          ${dep}
        </li>`
        + (isCollapsed ? '' : items.map(([entry, i]) => itemHtml(entry, i, false, '')).join(''));
    }).join('');
    el.list.querySelectorAll('.group-head').forEach((head) => {
      head.addEventListener('click', () => {
        const id = head.dataset.group;
        const set = loadCollapsed();
        set.has(id) ? set.delete(id) : set.add(id);
        saveCollapsed(set);
        renderList();
      });
    });
  } else {
    el.list.innerHTML = filtered.map((entry, i) => itemHtml(entry, i, true, q)).join('');
  }

  renderListTools(baseEntries, q);
  el.list.querySelectorAll('[data-recent]').forEach((node) => {
    node.addEventListener('click', () => {
      const key = node.dataset.recent;
      const dot = key.lastIndexOf('.');
      const entry = entries.find((e) => e.plugin.id === key.slice(0, dot)
        && e.action.id === key.slice(dot + 1));
      if (entry) openDetail(entry.plugin, entry.action);
    });
  });
  el.list.querySelectorAll('.item').forEach((node) => {
    node.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-fav]')) return;
      active = Number(node.dataset.i);
      openActive();
    });
    node.addEventListener('mousemove', () => {
      const i = Number(node.dataset.i);
      if (i !== active) { active = i; paintActive(); }
    });
  });
  // 星标不打开动作：它只是「把这一条钉在前面」，所以单独拦一层
  el.list.querySelectorAll('[data-fav]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      favorites = toggleFavorite(favorites, btn.dataset.fav);
      savePrefs();
      renderList();
    });
  });
  el.count.textContent = q.trim()
    ? `${filtered.length} / ${entries.length} 个动作`
    : [favorites.length ? `收藏 ${favorites.length} 优先` : '',
      loadRecent().length > 0 ? '最近使用优先' : '']
      .filter(Boolean).concat([`${plugins.length} 个插件`, `${entries.length} 个动作`])
      .join(' · ');
}

function paintActive() {
  el.list.querySelectorAll('.item').forEach((node, i) => {
    node.classList.toggle('active', i === active);
  });
  el.list.querySelector('.item.active')?.scrollIntoView({ block: 'nearest' });
}

// ---------------------------------------------------------------- 详情 / 表单

function openActive() {
  rememberSearch(el.q.value);
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

  const steps = Array.isArray(action.steps) ? action.steps : [];
  const chainInfo = steps.length ? `
    <div class="chain-flow">
      ${steps.map((st, i) => {
        const ps = Object.entries(st.params ?? {});
        const paramTxt = ps.length
          ? ps.map(([k, v]) => `<span class="chain-param">${esc(k)}=${esc(String(v))}</span>`).join(' ')
          : '';
        const ref = i === 0
          ? '动作参数 + 内置占位符'
          : `上一步结果 {${esc(steps[i - 1].as)}} / {prev}`;
        return `
          <div class="chain-step">
            <span class="chain-no">${i + 1}</span>
            <div class="chain-body">
              <div class="chain-use">${esc(st.use)} <span class="aid">→ {${esc(st.as)}}</span></div>
              ${paramTxt ? `<div class="chain-params">${paramTxt}</div>` : ''}
              <div class="chain-src">输入来自：${ref}</div>
            </div>
          </div>
          ${i < steps.length - 1 ? '<div class="chain-arrow">↓</div>' : ''}`;
      }).join('')}
    </div>` : '';

  const favKey = actionKey(plugin.id, action.id);
  const fav = isFavorite(favorites, favKey);
  const mem = paramStore[favKey] ?? {};
  const initial = { ...mem, ...(prefill ?? {}) };
  const memNote = Object.keys(mem).length
    ? `<div class="mem-note">已带入上次参数 · <button class="link" id="forgetParams">清除记忆</button></div>`
    : '';

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
    // 密钥字段：输入框就是 password，既不回显也不进参数记忆
    const type = f.secret ? 'password' : (f.type === 'number' ? 'number' : 'text');
    const given = initial[f.name] !== undefined ? initial[f.name] : f.default;
    const def = given === undefined ? '' : ` value="${esc(given)}"`;
    return `<div class="field"><label>${esc(f.name)}${req}</label>
      <input id="f_${esc(f.name)}" type="${type}"${def} autocomplete="off">${help}</div>`;
  }).join('');

  el.detailView.innerHTML = `
    <div class="detail-head">
      <h2>${esc(action.title)}<button class="star big${fav ? ' on' : ''}" id="favBtn"
        title="${fav ? '取消收藏' : '收藏这个动作'}">${fav ? '★' : '☆'}</button></h2>
      <div class="meta">${esc(plugin.name)} · ${esc(action.id)} ·
        <span class="badge ${esc(action.risk)}">${esc(RISK_TEXT[action.risk] || action.risk)}</span>
        ${steps.length ? `<span class="badge">组合 ${steps.length} 步</span>` : ''}
        <span class="badge">${esc(action.tool)}</span>
      </div>
      <div class="desc">${esc(action.description || '（这个动作没写说明）')}</div>
    </div>
    ${depWarn}
    ${chainInfo}
    ${memNote}
    ${fields}
    <div id="runHistory" class="run-history"></div>
    <div class="actions">
      <button class="primary" id="runBtn">执行</button>
      <button class="ghost" id="previewBtn" title="先看真正会执行的命令行（密钥打码），再决定跑不跑">预览命令</button>
      <button class="ghost" id="invokeBtn" title="这个动作在 CLI / MCP / 深链里怎么调">调用方式</button>
      ${plugin.settings?.length ? '<button class="ghost" id="cfgBtn" title="这个插件的长期配置（端点、密钥等），保存后立即生效">配置插件</button>' : ''}
      <button class="ghost" id="backBtn">返回</button>
    </div>
    <div id="previewBox"></div>
    <div id="invokeBox"></div>
    <div id="detailCfg" class="cmd-box hidden"></div>
    <div id="result"></div>`;

  $('previewBtn').addEventListener('click', async () => {
    $('invokeBox').innerHTML = '';
    const box = $('previewBox');
    box.innerHTML = '<div class="help">读取中…</div>';
    try {
      const r = await api('/api/preview', {
        method: 'POST',
        body: { plugin: plugin.id, action: action.id, values: collectValues(action) },
      });
      box.innerHTML = `<div class="cmd-box">
        <div class="cmd-box-head">将要执行${r.masked ? '（密钥已打码）' : ''}</div>
        <pre>${esc(r.command || '（这个动作没有命令）')}</pre>
        ${r.hasPlaceholders ? '<div class="help">带占位符的动作在真正执行时才会展开引用、时间与路径。</div>' : ''}
      </div>`;
    } catch (e) {
      box.innerHTML = `<div class="help" style="color:var(--bad)">预览失败：${esc(e.message)}</div>`;
    }
  });
  $('cfgBtn')?.addEventListener('click', async () => {
    $('previewBox').innerHTML = '';
    $('invokeBox').innerHTML = '';
    const box = $('detailCfg');
    if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
    box.innerHTML = '<div class="help">读取配置中…</div>';
    box.classList.remove('hidden');
    try {
      const r = await api(`/api/plugin/config?plugin=${encodeURIComponent(plugin.id)}`);
      if (!r.settings?.length) { box.innerHTML = '<div class="help">这个插件没有声明设置项。</div>'; return; }
      box.innerHTML = `
        <div class="cmd-box-head">插件配置 · ${esc(plugin.name)} <span class="sub">保存后立即生效；密钥留空 = 不修改</span></div>
        <div class="detail-cfg">${r.settings.map((x) => `
          <label class="plug-setting">
            <span class="plug-setting-name">${esc(x.title || x.name)}${x.required ? '<b class="req">*</b>' : ''}
              <span class="plug-setting-note">${x.set ? '已设置' : '未设置'}${x.secret ? ' · 密钥' : ''}</span></span>
            ${x.type === 'boolean'
              ? `<input type="checkbox" data-cfg="${esc(x.name)}" ${x.value === true ? 'checked' : ''}>`
              : `<input type="${x.secret ? 'password' : 'text'}" data-cfg="${esc(x.name)}"
                   value="${x.secret ? '' : esc(String(x.value ?? ''))}"
                   placeholder="${x.secret && x.set ? '已设置（留空=不修改）' : ''}"
                   autocomplete="off" spellcheck="false">`}
            ${x.description ? `<span class="plug-setting-help">${esc(x.description)}</span>` : ''}
          </label>`).join('')}
        </div>
        <div class="actions"><button class="primary" id="cfgSave">保存配置</button>
          <span class="sub" id="cfgMsg"></span></div>`;
      $('cfgSave').addEventListener('click', async () => {
        const patch = {};
        box.querySelectorAll('[data-cfg]').forEach((n) => {
          if (n.type === 'checkbox') { patch[n.dataset.cfg] = n.checked; return; }
          if (n.value !== '') patch[n.dataset.cfg] = n.value;  // 留空 = 不修改
        });
        const msg = $('cfgMsg');
        msg.textContent = '保存中…';
        try {
          await api('/api/plugin/config', { method: 'POST', body: { plugin: plugin.id, patch } });
          msg.textContent = '✓ 已保存，下一次执行立即生效';
        } catch (e) {
          msg.textContent = `保存失败：${e.message}`;
        }
      });
    } catch (e) {
      box.innerHTML = `<div class="help" style="color:var(--bad)">读取失败：${esc(e.message)}</div>`;
    }
  });
  $('invokeBtn').addEventListener('click', () => {
    $('previewBox').innerHTML = '';
    const deepLink = `${location.origin}${location.pathname}#/${plugin.id}/${action.id}`;
    const text = invocationText(plugin, action, deepLink);
    $('invokeBox').innerHTML = `<div class="cmd-box">
      <div class="cmd-box-head">三种调用方式</div>
      <pre>${esc(text)}</pre>
      <button class="ghost" id="copyInvoke">复制</button>
    </div>`;
    $('copyInvoke').addEventListener('click', async (ev) => {
      try {
        await navigator.clipboard.writeText(text);
        ev.currentTarget.textContent = '已复制';
      } catch {
        ev.currentTarget.textContent = '复制失败（非 https 环境）';
      }
      setTimeout(() => { ev.currentTarget.textContent = '复制'; }, 1500);
    });
  });
  $('backBtn').addEventListener('click', backToList);
  $('runBtn').addEventListener('click', () => submit(false));
  $('favBtn')?.addEventListener('click', () => {
    favorites = toggleFavorite(favorites, favKey);
    savePrefs();
    const on = isFavorite(favorites, favKey);
    const btn = $('favBtn');
    btn.textContent = on ? '★' : '☆';
    btn.classList.toggle('on', on);
    btn.title = on ? '取消收藏' : '收藏这个动作';
  });
  $('forgetParams')?.addEventListener('click', () => {
    delete paramStore[favKey];
    savePrefs();
    openDetail(plugin, action);
  });
  renderRunHistory(plugin, action);
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
    $('previewBox').innerHTML = '';
    $('invokeBox').innerHTML = '';
    const values = collectValues(action);
    const res = await executeAction(plugin, action, values, remember);
    if (!res) return;   // 用户在确认框点了取消，不算失败也不算成功
    lastValues = values;
    lastResult = res;
    renderResult(res);
    if (res.ok === true && action.risk === 'destructive') renderUndoHint(plugin, action);
    // 结果可能很长，直接把卡片顶部带进视野（否则用户以为「点了没反应」）
    setTimeout(() => $('result')?.scrollIntoView({ block: 'start' }), 0);
    rememberRecent(plugin.id, action.id);
    const secretNames = action.fields.filter((f) => f.secret).map((f) => f.name);
    paramStore = rememberParams(paramStore, actionKey(plugin.id, action.id), values, secretNames);
    runStore = pushRunHistory(runStore, actionKey(plugin.id, action.id), {
      ts: Date.now(), ok: res.ok === true, ms: res.ms ?? 0,
    });
    savePrefs();
    renderRunHistory(plugin, action);
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
    const riskExplain = action.risk === 'destructive'
      ? '这个动作会改动或删除数据，且不可自动撤销。请确认命令行内容与你的预期一致。'
      : '这个动作会改动系统或插件状态（写文件、发请求、起进程等）。';
    overlay.innerHTML = `
      <div class="modal">
        <h3>确认执行</h3>
        <div class="risk-note">
          ${esc(plugin.name)} · ${esc(action.title)} ·
          <span class="badge ${esc(action.risk)}">${esc(RISK_TEXT[action.risk] || action.risk)}</span>
        </div>
        <div class="confirm-explain">${riskExplain}</div>
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

function renderRunHistory(plugin, action) {
  const box = $('runHistory');
  if (!box) return;
  const list = runStore[actionKey(plugin.id, action.id)] ?? [];
  if (!list.length) {
    box.innerHTML = '<div class="run-empty">还没有执行记录——跑一次就会记在这里（只保存在本机）。</div>';
    return;
  }
  box.innerHTML = `<div class="run-head">最近执行</div>${list.map((r) => `
    <div class="run-row">
      <span class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'}</span>
      <span class="run-when">${esc(new Date(r.ts).toLocaleString())}</span>
      <span class="run-ms">${esc(String(r.ms))} ms</span>
      <button class="ghost" data-rerun>重跑</button>
    </div>`).join('')}`;
  box.querySelectorAll('[data-rerun]').forEach((b) => b.addEventListener('click', () => submit(false)));
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
      下次执行前，可以先用「预览命令」看清楚再跑。</div>`;
  box.prepend(hint);
  hint.querySelector('#undoLogs').addEventListener('click', (e) => {
    e.preventDefault();
    showLogs();
  });
}

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

  const copyText = res.data !== undefined ? JSON.stringify(res.data, null, 2) : (res.stdout ?? '');
  box.innerHTML = `
    <div class="card">
      <div class="card-head">${head}
        <span style="margin-left:auto" class="aid">${esc(res.command || '')}</span>
      </div>
      <div class="result-tools">
        <button class="ghost" id="copyRes" title="把结果复制到剪贴板">复制</button>
        <button class="ghost" id="saveRes" title="把结果存成文本文件">下载</button>
        <button class="ghost" id="mdRes" title="导出成 Markdown（表格/代码块），方便贴进文档或 Issue">导出 Markdown</button>
        <button class="ghost" id="againRes" title="用同样的参数再跑一次">再跑一次</button>
        <span class="ms">${esc(ms)}</span>
      </div>
      <div class="card-body">${body}</div>
    </div>`;

  $('copyRes')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    try {
      await navigator.clipboard.writeText(copyText);
      btn.textContent = '已复制';
    } catch {
      btn.textContent = '复制失败';
    }
    setTimeout(() => { btn.textContent = '复制'; }, 1500);
  });
  $('saveRes')?.addEventListener('click', () => {
    const blob = new Blob([copyText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zerokit-${detail ? `${detail.plugin.id}-${detail.action.id}` : 'result'}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('mdRes')?.addEventListener('click', () => {
    const title = detail ? `${detail.plugin.name} · ${detail.action.title}` : 'zerokit 结果';
    const blob = new Blob([resultMarkdown(title, res)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zerokit-${detail ? `${detail.plugin.id}-${detail.action.id}` : 'result'}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const btn = $('mdRes');
    if (btn) { btn.textContent = '已导出'; setTimeout(() => { btn.textContent = '导出 Markdown'; }, 1500); }
  });
  $('againRes')?.addEventListener('click', () => submit(false));

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

// ---------------------------------------------------------------- 插件管理
//
// 「装了什么、从哪装的、能不能更新」的入口。装第三方插件是高权限动作，
// 后端把能力摊开 + 确认令牌（/api/plugin/install），这里只做展示与转发——
// 确认按钮永远弹在摊开的能力清单下面，用户看得到自己刚同意了什么。

// ---------------------------------------------------------------- 集市面板

async function showMarket() {
  hidePanels();
  mode = 'market';
  el.modeLabel.textContent = '集市';
  el.searchRow.classList.add('hidden');
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  el.plugView.classList.add('hidden');
  el.psView.classList.add('hidden');
  el.workbench.classList.add('hidden');
  el.marketView.classList.remove('hidden');
  if (location.hash !== '#/market') history.replaceState(null, '', '#/market');
  await renderMarket();
}

function exitMarket() {
  mode = 'command';
  marketPreview = null;
  el.marketView.classList.add('hidden');
  el.searchRow.classList.remove('hidden');
  el.listView.classList.remove('hidden');
  el.modeLabel.textContent = '命令';
  history.replaceState(null, '', location.pathname);
  renderList();
  el.q.focus();
}

// ---------------------------------------------------------------- 审计日志
// 日志只在本机（~/.zerokit/logs/），这里只读不写；被拒与失败能一眼筛出来。
let logsFile = 'audit';
let logsDecision = '';
let logsQuery = '';

async function showLogs() {
  mode = 'logs';
  el.modeLabel.textContent = '日志';
  el.searchRow.classList.add('hidden');
  hidePanels();
  el.logsView.classList.remove('hidden');
  if (location.hash !== '#/logs') history.replaceState(null, '', '#/logs');
  await renderLogs();
}

function exitLogs() {
  mode = 'command';
  el.logsView.classList.add('hidden');
  el.searchRow.classList.remove('hidden');
  el.listView.classList.remove('hidden');
  el.modeLabel.textContent = '命令';
  history.replaceState(null, '', location.pathname);
  renderList();
  el.q.focus();
}

function logDetailHtml(e, i) {
  return `<div class="log-detail hidden" id="logDetail${i}">
    <pre>${esc(String(e['command'] ?? '（无命令）'))}</pre>
    ${e['error'] ? `<p class="log-error">${esc(String(e['error']))}</p>` : ''}
    <div class="log-extra">决策 ${esc(String(e['decision'] ?? '-'))} · 退出码 ${esc(String(e['exitCode'] ?? '-'))} · 输出 ${esc(String(e['outBytes'] ?? 0))} 字节${e['truncated'] ? ' · 已截断' : ''}</div>
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
  const chips = [['', '全部'], ['allow', '允许'], ['deny', '被拒'], ['error', '失败']]
    .map(([id, label]) => `<button class="chip${logsDecision === id ? ' on' : ''}" data-log-decision="${id}">${label}</button>`).join('');
  el.logsView.innerHTML = `
    <div class="ps-head">
      <h2>审计日志 <span class="aid">${logsFile === 'audit' ? 'audit.log' : 'denied.log'}</span></h2>
      <span class="sub">每次执行、被拒、失败都在这里；只在本机 ~/.zerokit/logs/</span>
    </div>
    <div class="log-tools">
      <div class="chips">${chips}</div>
      <input id="logQuery" class="log-query" placeholder="过滤：插件 / 动作 / 错误" value="${esc(logsQuery)}">
      <button class="ghost" id="logReload">刷新</button>
      <button class="ghost" id="logFile">${logsFile === 'audit' ? '看被拒记录' : '看全部记录'}</button>
    </div>
    <div id="logList" class="log-list"><div class="ps-empty">读取中…</div></div>`;

  el.logsView.querySelectorAll('[data-log-decision]').forEach((b) => {
    b.addEventListener('click', () => { logsDecision = b.dataset.logDecision; renderLogs(); });
  });
  $('logQuery').addEventListener('change', () => { logsQuery = $('logQuery').value.trim(); renderLogs(); });
  $('logReload').addEventListener('click', renderLogs);
  $('logFile').addEventListener('click', () => {
    logsFile = logsFile === 'audit' ? 'denied' : 'audit';
    renderLogs();
  });

  let data;
  try {
    const params = new URLSearchParams({ file: logsFile, limit: '200' });
    if (logsDecision) params.set('decision', logsDecision);
    if (logsQuery) params.set('q', logsQuery);
    data = await api(`/api/logs?${params}`);
  } catch (e) {
    $('logList').innerHTML = `<div class="ps-empty">读日志失败：${esc(e.message)}</div>`;
    return;
  }
  const rows = data.entries ?? [];
  $('logList').innerHTML = rows.length
    ? rows.map(logRowHtml).join('')
    : `<div class="ps-empty">${data.exists ? '没有符合条件的记录' : '还没有日志——执行一次动作就会写进来'}</div>`;
  $('logList').querySelectorAll('[data-log]').forEach((row) => {
    row.addEventListener('click', () => {
      $(`logDetail${row.dataset.log}`)?.classList.toggle('hidden');
    });
  });
}

// ---------------------------------------------------------------- 环境自检
async function showDoctor() {
  mode = 'doctor';
  el.modeLabel.textContent = '自检';
  el.searchRow.classList.add('hidden');
  hidePanels();
  el.doctorView.classList.remove('hidden');
  if (location.hash !== '#/doctor') history.replaceState(null, '', '#/doctor');
  await renderDoctor();
}

function exitDoctor() {
  mode = 'command';
  el.doctorView.classList.add('hidden');
  el.searchRow.classList.remove('hidden');
  el.listView.classList.remove('hidden');
  el.modeLabel.textContent = '命令';
  history.replaceState(null, '', location.pathname);
  renderList();
  el.q.focus();
}

async function renderDoctor() {
  el.doctorView.innerHTML = `<div class="ps-head"><h2>环境自检</h2>
      <span class="sub">解释器、插件依赖、必填配置——有问题的直接给修复命令</span></div>
    <div class="log-tools"><button class="ghost" id="docReload">重新检查</button></div>
    <div id="docBody"><div class="ps-empty">检查中…</div></div>`;
  $('docReload').addEventListener('click', renderDoctor);

  let r;
  try { r = await api('/api/doctor'); } catch (e) {
    $('docBody').innerHTML = `<div class="ps-empty">自检失败：${esc(e.message)}</div>`;
    return;
  }
  const toolRows = (r.tools ?? []).map((t) => `<div class="doc-line ${t.ok ? '' : 'bad'}">
      <span class="doc-mark">${t.ok ? '✓' : '!'}</span>
      <span class="doc-name">${esc(t.name)}</span>
      <span class="doc-val">${esc(t.version ?? '')} ${esc(t.path ?? '')}</span>
    </div>`).join('');
  const pluginRows = (r.plugins ?? []).map((p) => {
    const bad = (p.problems ?? []).some((x) => x.level === 'error');
    const warn = (p.problems ?? []).some((x) => x.level === 'warning');
    const problems = (p.problems ?? []).map((x) => `<div class="doc-problem ${x.level}">
        <span>${esc(x.text)}</span>
        ${x.hint ? `<pre class="doc-hint">${esc(x.hint)}</pre>` : ''}
      </div>`).join('');
    return `<div class="doc-plugin">
      <div class="doc-line ${bad ? 'bad' : warn ? 'warn' : 'ok'}">
        <span class="doc-mark">${bad ? '✗' : warn ? '!' : '✓'}</span>
        <span class="doc-name">${esc(p.name || p.dir)}</span>
        <span class="doc-val">${esc(p.id || p.dir)} · ${p.actions} 个动作</span>
      </div>
      ${problems}
    </div>`;
  }).join('');
  $('docBody').innerHTML = `
    <div class="doc-grid">
      <div class="doc-card"><b>${esc(String(r.summary?.plugins ?? 0))}</b><span>插件</span></div>
      <div class="doc-card"><b>${esc(String(r.summary?.actions ?? 0))}</b><span>动作</span></div>
      <div class="doc-card ${r.summary?.errors ? 'bad' : 'ok'}"><b>${esc(String(r.summary?.errors ?? 0))}</b><span>错误</span></div>
      <div class="doc-card ${r.summary?.warnings ? 'warn' : ''}"><b>${esc(String(r.summary?.warnings ?? 0))}</b><span>提醒</span></div>
    </div>
    <h3 class="plug-home-h">环境</h3>${toolRows}
    <h3 class="plug-home-h">插件</h3>${pluginRows || '<div class="ps-empty">还没装插件</div>'}`;
}

function marketMsg(text, kind = '') {
  const box = $('marketMsg');
  if (!box) return;
  box.textContent = text || '';
  box.className = `market-msg ${kind}`;
}

function marketCardHtml(m) {
  const local = m.local ? '<span class="badge">本地目录</span>' : '';
  return `
    <div class="plug-card market-card" data-market="${esc(m.name)}">
      <div class="plug-card-head">
        <b>${esc(m.name)}</b>
        <span class="aid">${esc(m.url)}</span>
        <span class="badge">${(m.plugins || []).length} 个插件</span>${local}
        <span class="plug-ops">
          <button class="ghost" data-op="refresh">刷新</button>
          <button class="ghost" data-op="remove">移除</button>
        </span>
      </div>
      <div class="plug-card-body">${esc(m.description || '')}</div>
    </div>`;
}

function marketEntryHtml(m, e) {
  const tags = (e.tags || []).length
    ? `<span class="market-tags">${(e.tags || []).map(esc).join(' · ')}</span>` : '';
  const installed = Boolean(e.installedVersion);
  return `
    <div class="plug-card market-entry" data-id="${esc(e.id)}" data-market="${esc(m.name)}">
      <div class="plug-card-head">
        <b>${esc(e.name)}</b>
        <span class="aid">${esc(e.id)}${e.version ? ` · v${esc(e.version)}` : ''}</span>
        <span class="badge">${esc(m.name)}</span>
        ${installed ? `<span class="badge read">已装${e.installedVersion ? ` v${esc(e.installedVersion)}` : ''}</span>` : ''}
        <span class="plug-ops">
          ${installed ? '' : '<button class="ghost" data-op="preview">安装</button>'}
        </span>
      </div>
      <div class="plug-card-body">${esc(e.summary || '')}${tags}</div>
    </div>`;
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
        <td class="cmd-inline" title="${esc(a.command)}">${esc(a.command)}</td></tr>`).join('');
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
        <thead><tr><th>动作</th><th>风险</th><th>真实命令</th></tr></thead>
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
  if (btn) { btn.disabled = true; btn.textContent = '安装中…'; }
  try {
    const withDeps = $('marketWithDeps')?.checked === true;
    const res = await api('/api/market/install', {
      method: 'POST',
      body: { id: p.id || p.entry?.id, market: p.market, confirm: p.confirm, withDeps },
    });
    if (!res.ok) throw new Error(res.message || '安装失败');
    marketPreview = null;
    await load(false);          // 插件列表与徽标刷新
    await renderMarket();
    marketMsg(`已安装「${p.entry?.name || p.id}」`, 'ok');
  } catch (e) {
    marketMsg(`安装失败：${e.message}`, 'err');
    if (btn) { btn.disabled = false; btn.textContent = '确认安装'; }
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
  try {
    marketData = await api('/api/markets');
  } catch (e) {
    el.marketView.innerHTML = `<div class="ps-empty">读不到集市列表：${esc(e.message)}</div>
      <div class="actions"><button class="primary" id="marketBack">返回</button></div>`;
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
    <div class="plug-install">
      <input id="marketSrc" placeholder="添加集市：git 地址、owner/repo 或本地目录，回车添加"
             autocomplete="off" spellcheck="false">
      <button class="primary" id="marketAddBtn">添加</button>
    </div>
    ${marketData.markets.length === 0
      ? '<div class="ps-empty">还没有添加任何集市。先用上面的输入框加一个，或者在终端 <code>zkit market add &lt;地址&gt;</code>。</div>'
      : `<div class="plug-install">
           <input id="marketQ" placeholder="搜索集市里的插件（id / 名称 / 摘要 / 标签）"
                  value="${esc(marketQuery)}" autocomplete="off" spellcheck="false">
         </div>`}
    <div id="marketMsg" class="market-msg"></div>
    ${marketData.markets.map(marketCardHtml).join('')}
    ${entries.length ? entries.map(([m, e]) => marketEntryHtml(m, e)).join('')
      : (marketData.markets.length && q ? '<div class="ps-empty">没有匹配的插件。</div>' : '')}
    <div id="marketPreview"></div>
    <div class="actions"><button class="primary" id="marketBack">返回</button></div>`;

  $('marketAddBtn').addEventListener('click', doMarketAdd);
  if ($('marketSrc')) {
    $('marketSrc').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); doMarketAdd(); }
    });
  }
  if ($('marketQ')) {
    $('marketQ').addEventListener('input', (e) => {
      marketQuery = e.target.value;
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

function exitPlugins() {
  mode = 'command';
  el.plugView.classList.add('hidden');
  el.searchRow.classList.remove('hidden');
  el.listView.classList.remove('hidden');
  el.modeLabel.textContent = '命令';
  history.replaceState(null, '', location.pathname);
  renderList();
  el.q.focus();
}

async function showPlugins() {
  hidePanels();
  mode = 'plugins';
  el.modeLabel.textContent = '插件';
  el.searchRow.classList.add('hidden');
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  el.workbench.classList.add('hidden');
  el.psView.classList.add('hidden');
  el.plugView.classList.remove('hidden');
  if (location.hash !== '#/plugins') history.replaceState(null, '', '#/plugins');
  await renderPlugins();
}

/** 插件主页：一个插件在四个面里到底是什么——动作、设置、依赖、来源，一页看完 */
async function showPluginHome(id) {
  hidePanels();
  mode = 'plugins';
  el.modeLabel.textContent = '插件';
  el.searchRow.classList.add('hidden');
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  el.workbench.classList.add('hidden');
  el.psView.classList.add('hidden');
  el.marketView.classList.add('hidden');
  el.plugView.classList.remove('hidden');
  if (location.hash !== `#/plugins/${id}`) history.replaceState(null, '', `#/plugins/${id}`);

  let p = plugins.find((x) => x.id === id);
  if (!p) {
    try { p = ((await api('/api/plugins')).plugins ?? []).find((x) => x.id === id); } catch { p = undefined; }
  }
  if (!p) {
    el.plugView.innerHTML = `<div class="ps-empty">找不到插件 ${esc(id)}</div>
      <div class="actions"><button class="primary" id="homeBackList">返回插件列表</button></div>`;
    $('homeBackList').addEventListener('click', showPlugins);
    return;
  }

  const settings = p.settings ?? [];
  const deps = p.pluginDeps ?? [];
  el.plugView.innerHTML = `
    <div class="ps-head">
      <h2>${esc(p.name)} <span class="aid">${esc(p.id)} · v${esc(p.version)}</span></h2>
      <span class="sub">${esc(p.sourceText)}</span>
    </div>
    <div class="plug-home-desc">${esc(p.description || p.summary || '')}</div>
    <div class="plug-home-meta">
      <span class="badge">${p.actions.length} 个动作</span>
      ${deps.length ? `<span class="badge">插件依赖 ${deps.map((d) => `${esc(d.id)}${d.installed ? '' : '（未装）'}`).join('、')}</span>` : ''}
      ${settings.length ? `<span class="badge warn">${settings.filter((x) => x.missing).length} 项未填</span>` : ''}
      ${p.requiresOk ? '' : '<span class="badge destructive">缺命令依赖</span>'}
    </div>
    <h3 class="plug-home-h">动作</h3>
    <div class="plug-home-actions">
      ${p.actions.map((a) => `
        <button class="plug-action" data-action="${esc(a.id)}">
          <span class="pa-title">${esc(a.title)}</span>
          <span class="badge ${esc(a.risk)}">${esc(RISK_TEXT[a.risk] || a.risk)}</span>
          ${a.steps?.length ? `<span class="badge">组合 ${a.steps.length} 步</span>` : ''}
        </button>`).join('')}
    </div>
    ${settings.length ? `<h3 class="plug-home-h">设置项</h3>
      <div class="plug-home-settings">
        ${settings.map((s) => `<div class="home-setting">
          <span class="hs-name">${esc(s.title || s.name)}</span>
          <span class="hs-val">${s.secret ? (s.set ? '已设置 · ******' : '未设置') : (s.set ? '已设置' : '未设置')}</span>
          ${s.missing ? '<span class="badge destructive">缺</span>' : ''}
        </div>`).join('')}
      </div>` : ''}
    <div class="actions">
      <button class="ghost" id="homeBackList">返回插件列表</button>
      <button class="primary" id="homeBack">返回</button>
    </div>`;

  el.plugView.querySelectorAll('[data-action]').forEach((btn) => {
    const a = p.actions.find((x) => x.id === btn.dataset.action);
    btn.addEventListener('click', () => openDetail(p, a));
  });
  $('homeBackList').addEventListener('click', showPlugins);
  $('homeBack').addEventListener('click', exitPlugins);
}

async function renderPlugins() {
  let plugins = [];
  try {
    plugins = (await api('/api/plugins')).plugins ?? [];
  } catch (e) {
    el.plugView.innerHTML = `<div class="ps-empty">读不到插件列表：${esc(e.message)}</div>
      <div class="actions"><button class="primary" id="plugBack">返回</button></div>`;
    $('plugBack').addEventListener('click', exitPlugins);
    return;
  }

  el.plugCount.textContent = String(plugins.length);
  const health = pluginHealth(plugins);
  el.plugView.innerHTML = `
    <div class="ps-head">
      <h2>插件（${plugins.length}）</h2>
      <span class="sub">来源与版本 · 安装 · 更新</span>
    </div>
    <div class="stat-row">
      <div class="stat-card"><b>${health.actions}</b><span>个动作</span></div>
      <div class="stat-card${health.chains ? '' : ' mute'}"><b>${health.chains}</b><span>个组合动作</span></div>
      <div class="stat-card${health.missingDeps.length ? ' warn' : ''}">
        <b>${health.missingDeps.length}</b><span>缺命令依赖</span>
        ${health.missingDeps.length ? `<i>${esc(health.missingDeps.join('、'))}</i>` : ''}
      </div>
      <div class="stat-card${health.missingPluginDeps.length ? ' warn' : ''}">
        <b>${health.missingPluginDeps.length}</b><span>缺插件依赖</span>
        ${health.missingPluginDeps.length ? `<i>${esc(health.missingPluginDeps.join('、'))}</i>` : ''}
      </div>
      <div class="stat-card${health.missingSettings.length ? ' warn' : ''}">
        <b>${health.missingSettings.length}</b><span>缺配置</span>
      </div>
    </div>
    ${health.healthy ? '<div class="health-note ok">全部插件都齐了，没有缺依赖或未填的配置。</div>'
      : '<div class="health-note">带 ⚠ 的数字点得进去——上面列的就是要补的东西。</div>'}
    ${(() => {
      const top = topActions(runStore, 5);
      if (!top.length) return '<div class="usage-empty">还没有执行记录——用几次之后，这里会出现你的「最常用动作」。</div>';
      const max = top[0].runs || 1;
      return `<div class="usage-panel"><div class="usage-title">最常用动作</div>
        ${top.map((t) => {
          const dot = t.key.lastIndexOf('.');
          const entry = entries.find((e) => e.plugin.id === t.key.slice(0, dot)
            && e.action.id === t.key.slice(dot + 1));
          return `<div class="usage-row">
            <span class="u-name">${esc(entry ? entry.action.title : t.key)}</span>
            <span class="u-bar"><i style="width:${Math.max(6, Math.round(t.runs / max * 100))}%"></i></span>
            <span class="u-count">${t.runs} 次</span>
          </div>`;
        }).join('')}</div>`;
    })()}
    <div class="plug-install">
      <input id="installSrc" placeholder="粘贴 git 仓库地址（https://github.com/…）或本地目录，回车安装"
             autocomplete="off" spellcheck="false">
      <button class="primary" id="installBtn">安装</button>
    </div>
    <div id="installBox"></div>
    ${plugins.map((p) => `
      <div class="plug-card" data-id="${esc(p.id)}">
        <div class="plug-card-head">
          <b>${esc(p.name)}</b>
          <span class="aid">${esc(p.id)} · v${esc(p.version)}</span>
          <span class="badge">${esc(p.sourceText)}</span>
          ${p.requiresOk ? '' : '<span class="badge destructive">缺依赖</span>'}
          ${p.pluginDepsOk === false ? '<span class="badge destructive">缺插件依赖</span>' : ''}
          ${(p.settings || []).some((x) => x.missing) ? '<span class="badge warn">缺配置</span>' : ''}
          <span class="plug-ops">
            <button class="ghost" data-op="home">主页</button>
            ${(p.settings || []).length > 0 ? '<button class="ghost" data-op="config">配置</button>' : ''}
            ${p.sourceUrl ? '<button class="ghost" data-op="share" title="生成一条安装命令，发给同事就能装同一个插件">分享</button>' : ''}
            <button class="ghost" data-op="check">检查更新</button>
            <button class="ghost" data-op="remove">卸载</button>
          </span>
        </div>
        <div class="plug-card-body">${esc(p.summary || '')} · ${p.actions.length} 个动作${
          (p.pluginDeps ?? []).length
            ? ` · 依赖 ${p.pluginDeps.map((d) => (d.installed ? esc(d.id) : `${esc(d.id)}（未装）`)).join('、')}`
            : ''}</div>
        <div class="plug-config" hidden></div>
        <div class="plug-card-foot" hidden></div>
      </div>`).join('')}
    <div class="actions"><button class="primary" id="plugBack">返回</button></div>`;

  $('installSrc').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); doInstall(); }
  });
  $('installBtn').addEventListener('click', doInstall);
  $('plugBack').addEventListener('click', exitPlugins);

  el.plugView.querySelectorAll('.plug-card').forEach((card) => {
    card.querySelector('[data-op="home"]').addEventListener('click', () => showPluginHome(card.dataset.id));
    card.querySelector('[data-op="check"]').addEventListener('click', () => doCheck(card));
    card.querySelector('[data-op="remove"]').addEventListener('click', () => doRemove(card));
    const cfgBtn = card.querySelector('[data-op="config"]');
    if (cfgBtn) {
      const p = plugins.find((x) => x.id === card.dataset.id);
      cfgBtn.addEventListener('click', () => toggleSettings(card, p));
    }
    const shareBtn = card.querySelector('[data-op="share"]');
    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        const p = plugins.find((x) => x.id === card.dataset.id);
        const cmd = `zkit plugin add ${p.sourceUrl}`;
        try {
          await navigator.clipboard.writeText(cmd);
          shareBtn.textContent = '已复制';
        } catch {
          shareBtn.textContent = '复制失败';
        }
        setTimeout(() => { shareBtn.textContent = '分享'; }, 1500);
      });
    }
  });
}

/** 设置项表单：密钥呈现为 password 且留空=不修改，避免把掩码写回去 */
function settingField(s) {
  const common = `data-setting="${esc(s.name)}" data-stype="${esc(s.type)}"`;
  let control;
  if (s.type === 'boolean') {
    control = `<input type="checkbox" ${s.value === true ? 'checked' : ''} ${common}>`;
  } else if (s.type === 'enum') {
    const opts = (s.enum || []).map((v) =>
      `<option value="${esc(v)}" ${String(s.value ?? '') === v ? 'selected' : ''}>${esc(v)}</option>`).join('');
    control = `<select ${common}><option value="">（未设置）</option>${opts}</select>`;
  } else {
    const type = s.secret ? 'password' : (s.type === 'integer' || s.type === 'number' ? 'number' : 'text');
    const value = s.secret ? '' : String(s.value ?? '');
    const ph = s.secret && s.masked ? '已设置（留空=不修改）' : (s.description || '');
    control = `<input type="${type}" value="${esc(value)}" placeholder="${esc(ph)}" ${common}`
      + ' autocomplete="off" spellcheck="false">';
  }
  const note = s.source === 'default' ? '默认值'
    : s.source === 'stored' ? (s.secret ? '已设置 · 密钥' : '已设置')
      : '未设置';
  return `
    <label class="plug-setting">
      <span class="plug-setting-name">${esc(s.title || s.name)}${s.required ? '<b class="req">*</b>' : ''}
        <span class="plug-setting-note">${esc(note)}${s.error ? ' · ' + esc(s.error) : ''}</span></span>
      ${control}
      ${s.description ? `<span class="plug-setting-help">${esc(s.description)}</span>` : ''}
    </label>`;
}

function toggleSettings(card, p) {
  const box = card.querySelector('.plug-config');
  if (!p) return;
  if (!box.hidden) { box.hidden = true; return; }
  box.innerHTML = `
    <div class="plug-card-body plug-settings">
      <div class="plug-settings-head">设置项 <span class="sub">保存后立即生效；密钥只以掩码回显，留空表示不修改</span></div>
      ${p.settings.map(settingField).join('')}
      <div class="plug-settings-ops">
        <button class="primary" data-op="save-settings">保存</button>
        <span class="sub" data-role="settings-msg"></span>
      </div>
    </div>`;
  box.hidden = false;
  box.querySelector('[data-op="save-settings"]').addEventListener('click', () => saveSettings(card));
}

async function saveSettings(card) {
  const box = card.querySelector('.plug-config');
  const msg = box.querySelector('[data-role="settings-msg"]');
  const patch = {};
  box.querySelectorAll('[data-setting]').forEach((node) => {
    const name = node.dataset.setting;
    if (node.dataset.stype === 'boolean') { patch[name] = node.checked; return; }
    const value = node.value;
    if (value === '') return; // 留空 = 不修改；要清空请用 zkit config <插件> unset <项>
    patch[name] = value;
  });
  if (Object.keys(patch).length === 0) { msg.textContent = '没有改动'; return; }
  msg.textContent = '保存中…';
  try {
    const r = await api('/api/plugin/config', {
      method: 'POST', body: { plugin: card.dataset.id, patch },
    });
    if (r.ok === false) throw new Error(r.error || '保存失败');
    await renderPlugins();
  } catch (e) {
    msg.textContent = '保存失败：' + e.message;
  }
}

/** 安装：预览摊开 → 确认 → 落地。预览卡固定在安装框下面，确认前看得见全部能力 */
async function doInstall() {
  const input = $('installSrc');
  const box = $('installBox');
  const source = input.value.trim();
  if (!source) return;
  input.value = '';
  box.innerHTML = '<div class="plug-card"><div class="plug-card-body">正在解析来源…</div></div>';
  try {
    const pv = await api('/api/plugin/install', { method: 'POST', body: { source } });
    if (!pv.needConfirm) throw new Error(pv.error || '预览失败');
    const p = pv.plugin;
    box.innerHTML = `
      <div class="plug-card installing">
        <div class="plug-card-head">
          <b>${esc(p.name)}</b>
          <span class="aid">${esc(p.id)} · v${esc(p.version)}</span>
          <span class="plug-ops">
            <button class="primary" id="pvOk">确认安装</button>
            <button class="ghost" id="pvCancel">取消</button>
          </span>
        </div>
        <div class="plug-card-body">${esc(p.summary || '')}</div>
        <table class="grid">
          <thead><tr><th>动作</th><th>风险</th><th>真实命令</th></tr></thead>
          <tbody>${p.actions.map((a) => `
            <tr>
              <td>${esc(a.id)} · ${esc(a.title)}</td>
              <td><span class="badge ${esc(a.risk)}">${esc(RISK_TEXT[a.risk] || a.risk)}</span></td>
              <td class="cmd-inline">${esc(a.command)}</td>
            </tr>`).join('')}</tbody>
        </table>
        ${(p.pluginDeps ?? []).length ? `
          <div class="plug-card-body">
            插件依赖：${p.pluginDeps.map((d) => (d.installed
              ? `<span class="ok">${esc(d.id)} ✓</span>`
              : `<span style="color:var(--bad)">${esc(d.id)} 未安装</span>`)).join('、')}
          </div>
          ${(p.missingPluginDeps ?? []).length
            ? `<label class="plug-setting"><input type="checkbox" id="pvDeps" checked>
                 一并安装缺失的依赖（${esc(p.missingPluginDeps.join('、'))}）</label>`
            : ''}` : ''}
        ${(pv.warnings ?? []).length ? `<div class="plug-warn">${pv.warnings.map((w) => `! ${esc(w)}`).join('<br>')}</div>` : ''}
      </div>`;
    $('pvCancel').addEventListener('click', () => { box.innerHTML = ''; });
    $('pvOk').addEventListener('click', async () => {
      $('pvOk').disabled = true;
      $('pvOk').textContent = '安装中…';
      try {
        const withDeps = $('pvDeps')?.checked ?? false;
        const r = await api('/api/plugin/install', {
          method: 'POST', body: { source, confirm: pv.confirm, withDeps },
        });
        if (!r.ok) throw new Error(r.message || '安装失败');
        const depNote = (r.depsInstalled ?? []).length
          ? `<br><span class="ok">已补装依赖：${esc(r.depsInstalled.join('、'))}</span>` : '';
        const depWarn = (r.depsMissing ?? []).length
          ? `<br><span style="color:var(--bad)">仍缺依赖：${esc(r.depsMissing.join('、'))}（zkit plugin install …）</span>` : '';
        box.innerHTML = `<div class="plug-card"><div class="plug-card-body">✓ ${esc(r.message)}${depNote}${depWarn}</div></div>`;
        await load(true);
        await renderPlugins();
      } catch (e) {
        $('pvOk').disabled = false;
        $('pvOk').textContent = '确认安装';
        box.querySelector('.plug-warn')?.remove();
        box.insertAdjacentHTML('beforeend', `<div class="plug-warn">${esc(e.message)}</div>`);
      }
    });
  } catch (e) {
    box.innerHTML = `<div class="plug-card"><div class="plug-warn">✗ ${esc(e.message)}</div></div>`;
  }
}

/** 检查更新：结果与「更新」按钮放在卡片底部的展开区里 */
async function doCheck(card) {
  const id = card.dataset.id;
  const foot = card.querySelector('.plug-card-foot');
  const btn = card.querySelector('[data-op="check"]');
  btn.disabled = true;
  btn.textContent = '检查中…';
  foot.hidden = false;
  foot.innerHTML = '<div class="plug-card-body">正在检查来源处的版本…</div>';
  try {
    const c = await api('/api/plugin/check', { method: 'POST', body: { id } });
    if (!c.available) {
      foot.innerHTML = `<div class="plug-card-body">✓ ${esc(c.reason || '已是最新版本')}</div>`;
      return;
    }
    const diffBits = [
      c.addedActions?.length ? `<span class="ok">新增动作：${esc(c.addedActions.join(', '))}</span>` : '',
      c.removedActions?.length ? `<span style="color:var(--bad)">移除动作：${esc(c.removedActions.join(', '))}</span>` : '',
    ].filter(Boolean).join('<br>');
    foot.innerHTML = `
      <div class="plug-card-body">
        有更新：v${esc(c.current)} → <b>v${esc(c.latest)}</b>
        ${diffBits ? `<br>${diffBits}` : ''}
      </div>
      <div class="plug-ops">
        <button class="primary" id="updOk">更新到 v${esc(c.latest)}</button>
      </div>`;
    $('updOk').addEventListener('click', async () => {
      const b = $('updOk');
      b.disabled = true;
      b.textContent = '更新中…';
      try {
        const r = await api('/api/plugin/update', { method: 'POST', body: { id, confirm: c.confirm } });
        if (!r.ok) throw new Error(r.message || '更新失败');
        await load(true);
        await renderPlugins();
      } catch (e) {
        b.disabled = false;
        b.textContent = '重试更新';
        foot.insertAdjacentHTML('beforeend', `<div class="plug-warn">✗ ${esc(e.message)}</div>`);
      }
    });
  } catch (e) {
    foot.innerHTML = `<div class="plug-warn">✗ ${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '检查更新';
  }
}

/** 卸载：两步确认（后端令牌 + 前端弹窗），删的是整个插件目录 */
async function doRemove(card) {
  const id = card.dataset.id;
  const ok = await new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>卸载插件</h3>
        <div class="risk-note">插件目录会被整个删掉；数据目录里的历史数据保留。</div>
        <div class="cmd-line">${esc(id)}</div>
        <div class="actions">
          <button class="ghost" id="rmCancel">取消</button>
          <button class="primary" id="rmOk">确认卸载</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (v) => { overlay.remove(); resolve(v); };
    overlay.querySelector('#rmCancel').addEventListener('click', () => done(false));
    overlay.querySelector('#rmOk').addEventListener('click', () => done(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
    overlay.querySelector('#rmOk').focus();
  });
  if (!ok) return;
  try {
    const first = await api('/api/plugin/remove', { method: 'POST', body: { id } });
    const token = first.needConfirm ? first.confirm : null;
    const r = token
      ? await api('/api/plugin/remove', { method: 'POST', body: { id, confirm: token } })
      : first;
    if (!r.ok) throw new Error(r.message || '卸载失败');
    await load(true);
    await renderPlugins();
  } catch (e) {
    card.querySelector('.plug-card-foot').hidden = false;
    card.querySelector('.plug-card-foot').innerHTML = `<div class="plug-warn">✗ ${esc(e.message)}</div>`;
  }
}


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
  hidePanels();
  mode = 'ps';
  el.modeLabel.textContent = '运行中';
  el.searchRow.classList.add('hidden');
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  el.workbench.classList.add('hidden');
  el.plugView.classList.add('hidden');
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
  hidePanels();
  mode = 'workbench';
  el.modeLabel.textContent = '工作台';
  el.modeDot.classList.add('workbench');
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  el.workbench.classList.remove('hidden');
  el.plugView.classList.add('hidden');
  el.psView.classList.add('hidden');
  el.searchRow.classList.add('hidden'); // 工作台有自己的输入框，别和搜索框并排打架

  if (!wb.log) {
    el.workbench.innerHTML = `
      <div class="wb-head">
        <span class="wb-model" id="wbModel">正在检查模型配置…</span>
        <span class="wb-tools" id="wbTools"></span>
        <button class="ghost" id="wbReset">新会话</button>
      </div>
      <div class="wb-suggest" id="wbSuggest"></div>
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
    renderPrompts();
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
  $('wbSuggest')?.remove();
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



// ---------------------------------------------------------------- MCP 授权面板

/** MCP 授权：哪些「有副作用」的动作允许 AI 直接调。只读动作默认放行，不在这里。 */
async function showMcpAllow() {
  mode = 'mcp';
  el.modeLabel.textContent = 'MCP 授权';
  el.searchRow.classList.add('hidden');
  hidePanels();
  el.allowView.classList.remove('hidden');
  const view = el.allowView;
  if (location.hash !== '#/mcp') history.replaceState(null, '', '#/mcp');

  const render = (data, err) => {
    if (err) {
      view.innerHTML = `<div class="ps-empty">读不到授权状态：${esc(err)}</div>`;
      return;
    }
    const groups = new Map();
    for (const it of data.items) {
      if (!groups.has(it.pluginName)) groups.set(it.pluginName, []);
      groups.get(it.pluginName).push(it);
    }
    view.innerHTML = `
      <div class="ps-head"><h2>MCP 授权</h2>
        <span class="sub">有副作用的动作默认拒绝 AI 调用；在这里显式放行。只读动作不需要授权。</span></div>
      <div class="allow-summary">${data.allowedCount} / ${data.items.length} 已授权</div>
      ${[...groups.entries()].map(([name, items]) => `
        <div class="allow-group">
          <div class="allow-group-name">${esc(name)}</div>
          ${items.map((it) => `
            <div class="allow-row">
              <span class="badge ${esc(it.risk)}">${esc(RISK_TEXT[it.risk] || it.risk)}</span>
              <span class="allow-title">${esc(it.title)}</span>
              <span class="aid">${esc(it.key)}</span>
              <button class="ghost ${it.allowed ? 'on' : ''}" data-key="${esc(it.key)}"
                data-allowed="${it.allowed}">${it.allowed ? '撤销授权' : '允许 AI 调用'}</button>
            </div>`).join('')}
        </div>`).join('')}`;
    view.querySelectorAll('[data-key]').forEach((btn) => btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api('/api/mcp/allow', {
          method: 'POST',
          body: { key: btn.dataset.key, revoke: btn.dataset.allowed === 'true' },
        });
        await showMcpAllow();  // 重画
      } catch (e) {
        btn.disabled = false;
        view.querySelector('.allow-summary').textContent = `操作失败：${e.message}`;
      }
    }));
  };
  try {
    render(await api('/api/mcp/allow'));
  } catch (e) { render(null, e.message); }
}

function exitMcpAllow() {
  mode = 'command';
  el.allowView.classList.add('hidden');
  el.searchRow.classList.remove('hidden');
  el.listView.classList.remove('hidden');
  el.modeLabel.textContent = '命令';
  history.replaceState(null, '', location.pathname);
  renderList();
  el.q.focus();
}

// ---------------------------------------------------------------- 全局命令面板（Ctrl+P）

let paletteMode = false;

/** 命令面板：一个输入框直达任何动作 / 页面。数据全是本地，不新增接口。 */
function showPalette() {
  if (paletteMode) return;
  paletteMode = true;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'paletteOverlay';
  const pages = [
    { icon: '⌘', label: 'AI 工作台', hint: '自然语言指挥插件干活', act: () => showWorkbench('') },
    { icon: '▶', label: '运行中', hint: '看正在跑的进程/服务，可结束', act: () => showPs() },
    { icon: '⚙', label: '插件管理', hint: '安装/更新/卸载/配置', act: () => showPlugins() },
    { icon: '🛍', label: '插件集市', hint: '浏览并一键安装集市插件', act: () => showMarket() },
    { icon: '▤', label: '审计日志', hint: '每次执行/被拒/失败', act: () => showLogs() },
    { icon: '✓', label: '环境自检', hint: '解释器/依赖/配置问题', act: () => showDoctor() },
    { icon: '🔑', label: 'MCP 授权', hint: '哪些动作允许 AI 调用', act: () => showMcpAllow() },
  ];
  overlay.innerHTML = `
    <div class="modal palette">
      <input id="paletteQ" type="text" placeholder="输入动作名、插件名或页面名…" autocomplete="off" spellcheck="false">
      <ul id="paletteList" role="listbox"></ul>
      <div class="palette-foot">↑↓ 选择 · Enter 打开 · Esc 关闭</div>
    </div>`;
  document.body.appendChild(overlay);
  const q = overlay.querySelector('#paletteQ');
  const list = overlay.querySelector('#paletteList');
  let sel = 0;
  let items = [];

  const paint = () => {
    list.innerHTML = items.map((x, i) => `
      <li class="palette-item${i === sel ? ' on' : ''}" data-i="${i}">
        <span class="palette-icon">${x.icon}</span>
        <span class="palette-label">${x.label}</span>
        <span class="palette-hint">${x.hint}</span>
      </li>`).join('') || '<li class="palette-item none">没有匹配的项</li>';
    list.querySelectorAll('.palette-item.on').forEach((n) => n.scrollIntoView({ block: 'nearest' }));
  };
  const refill = () => {
    const needle = q.value.trim().toLowerCase();
    const actionItems = entries.map((e) => ({
      icon: '⚡', label: e.action.title, hint: `${e.plugin.name} · ${e.action.id}`,
      act: () => { exitPalette(); openDetail(e.plugin, e.action); },
    }));
    const all = [...pages.map((x) => ({ ...x, act: (() => { const f = x.act; return () => { exitPalette(); f(); }; })() })),
      ...actionItems];
    items = !needle ? all.slice(0, 20) : all.filter((x) =>
      x.label.toLowerCase().includes(needle) || x.hint.toLowerCase().includes(needle)).slice(0, 20);
    sel = 0;
    paint();
  };
  const exitPalette = () => { paletteMode = false; overlay.remove(); };

  q.addEventListener('input', refill);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); exitPalette(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); items[sel]?.act(); }
  });
  list.addEventListener('click', (e) => {
    const li = e.target.closest('.palette-item[data-i]');
    if (li) items[Number(li.dataset.i)]?.act();
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) exitPalette(); });
  refill();
  q.focus();
}

// ---------------------------------------------------------------- 键盘

document.addEventListener('keydown', (e) => {
  if (mode === 'plugins') {
    if (e.key === 'Escape') { e.preventDefault(); exitPlugins(); }
    return;
  }
  if (mode === 'ps') {
    if (e.key === 'Escape') { e.preventDefault(); exitPs(); }
    return;
  }
  if (mode === 'logs') {
    if (e.key === 'Escape') { e.preventDefault(); exitLogs(); }
    return;
  }
  if (mode === 'doctor') {
    if (e.key === 'Escape') { e.preventDefault(); exitDoctor(); }
    return;
  }
  if (mode === 'mcp') {
    if (e.key === 'Escape') { e.preventDefault(); exitMcpAllow(); }
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
  // Ctrl+P / Ctrl+K：全局命令面板（键盘党不用碰鼠标）
  if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P' || e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    showPalette();
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (filtered.length) { active = Math.min(active + 1, filtered.length - 1); paintActive(); }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (filtered.length) { active = Math.max(active - 1, 0); paintActive(); }
  } else if (e.key === 'Home') {
    e.preventDefault();
    if (filtered.length) { active = 0; paintActive(); }
  } else if (e.key === 'End') {
    e.preventDefault();
    if (filtered.length) { active = filtered.length - 1; paintActive(); }
  } else if (e.key === 'PageDown') {
    e.preventDefault();
    if (filtered.length) { active = Math.min(active + 10, filtered.length - 1); paintActive(); }
  } else if (e.key === 'PageUp') {
    e.preventDefault();
    if (filtered.length) { active = Math.max(active - 10, 0); paintActive(); }
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
el.plugBtn.addEventListener('click', () => { if (mode === 'plugins') exitPlugins(); else showPlugins(); });
el.marketBtn.addEventListener('click', () => { if (mode === 'market') exitMarket(); else showMarket(); });

// ---------------------------------------------------------------- 快捷键速查

function showShortcuts() {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="modal help-modal">
      <h3>快捷键</h3>
      <div class="keys">
        ${SHORTCUTS.map((s) => `<div class="key-row">
          <span class="key-combo">${s.keys.map((k) => `<kbd>${esc(k)}</kbd>`).join('')}</span>
          <span class="key-what">${esc(s.what)}</span>
        </div>`).join('')}
      </div>
      <h3>直达页面（深链接，收藏或发给同事都行）</h3>
      <div class="keys deep-links">
        ${[
          ['#/ps', '运行中', '看正在跑的进程与服务'],
          ['#/plugins', '插件管理', '安装 / 更新 / 卸载 / 配置'],
          ['#/market', '插件集市', '浏览并一键安装'],
          ['#/logs', '审计日志', '每次执行、被拒、失败'],
          ['#/doctor', '环境自检', '解释器 / 依赖 / 配置问题'],
          ['#/mcp', 'MCP 授权', '允许 AI 调用哪些动作'],
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

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === '/') {
    e.preventDefault();
    showShortcuts();
  } else if (mod && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    el.q.focus();
    el.q.select();
  }
});

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
    el.plugCount.textContent = String(plugins.length);
    api('/api/markets')
      .then((m) => { el.marketCount.textContent = String((m.markets || []).length); })
      .catch(() => { /* 集市读不到不影响命令面 */ });
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

  // #/plugins/<插件id>  插件主页
  const ph = /^#\/plugins\/([\w.-]+)$/.exec(location.hash || '');
  if (ph) {
    showPluginHome(ph[1]);
    return;
  }

  // #/plugins  直接打开「插件管理」
  if ((location.hash || '') === '#/plugins') {
    showPlugins();
    return;
  }

  // #/logs  审计日志
  if ((location.hash || '') === '#/logs') {
    showLogs();
    return;
  }

  // #/doctor  环境自检
  if ((location.hash || '') === '#/doctor') {
    showDoctor();
    return;
  }

  // #/market  直接打开「集市」
  if ((location.hash || '') === '#/market') {
    showMarket();
    return;
  }

  // #/mcp  直接打开「MCP 授权」
  if ((location.hash || '') === '#/mcp') {
    showMcpAllow();
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
  get favorites() { return favorites; },
  get theme() { return document.documentElement.dataset.theme; },
  get health() { return pluginHealth(plugins); },
  cycleTheme, showShortcuts, showPluginHome, renderPrompts, showLogs, showDoctor,
};

loadPrefs();
applyTheme();
applyAccent();
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
$('themeBtn')?.addEventListener('click', openThemePop);
document.addEventListener('click', (e) => {
  const pop = $('themePop');
  if (!pop || pop.classList.contains('hidden')) return;
  if (pop.contains(e.target) || e.target.closest('#themeBtn')) return;
  pop.classList.add('hidden');
});
$('logsBtn')?.addEventListener('click', showLogs);
$('doctorBtn')?.addEventListener('click', showDoctor);
$('helpBtn')?.addEventListener('click', showShortcuts);

load();
el.q.focus();