// zerokit 启动器前端。
// 纯静态、无构建步骤，所以浏览器和 Tauri 壳用的是同一份代码。
// 所有来自插件的文本都经过 esc() 转义再插入 DOM——插件内容属于不可信输入。

import { romanize, scorePinyin } from './pinyin.js';
import { detectContent, matchFires } from './match.js';
import { qrSvg } from './qrcode.js';
import { pickLang, makeT } from './extras.js';
import { pageJump, explainScore, planBatch, msHistogram, validateFields, dirtyFields, deepLinkParams, recentParamSets } from './extras.js';
import { RESULT_ACTIONS, markdownTable, tsvTable, jsonTreeLines } from './extras.js';
import { dailyBrief, trimRuns, idleSuggest } from './extras.js';
import { barsScale, sparkPoints, formatMs, paletteScore, p95Ms } from './extras.js';
import { filterRows, colStats, unitOf, isUnitColumn, convertUnitColumn, mergeTables, columnValues, toHtmlTable } from './extras.js';
import { renderCopyTemplate, toJsonl, exportFilename, toMarkdownProps } from './extras.js';
import { WATCH_INTERVALS, intervalLabel, cellDiff, sparkSeries, watchStopCondition, tabTitle, watchCsv } from './extras.js';
import { dangerousPattern, maskSecrets, rateLimitHits, trimAuditLog, actionRiskCard } from './extras.js';
import { normalizeTheme, resolveTheme, SHORTCUTS, highlightHtml, actionKey, toggleFavorite, isFavorite, favoritesFirst, rememberParams, pushRunHistory, pluginHealth, PROMPTS, ACCENTS, normalizeAccent, FILTERS, filterActions, pushSearch, topActions, recentRuns, invocationText, resultMarkdown, formatNumber, isNumericColumn, sortRows, toCsv, diffResults, dailyTrend, hourlyHeat, dailyReport, virtualWindow, pageSlice, breadcrumb, listStateQuery, parseListState, digitPick } from './extras.js';

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
let marketLimit = 30;   // 集市条目递增加载：先看 30 条，「加载更多」再 +30
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
  tags: 'zerokit.plugin-tags',
  aliases: 'zerokit.aliases',
  nicknames: 'zerokit.nicknames',
  actionTags: 'zerokit.action-tags',
  saved: 'zerokit.saved-results',
  notes: 'zerokit.run-notes',
  hotkeys: 'zerokit.action-hotkeys',
};
let favorites = [];
let paramStore = {};
let runStore = {};
let batch = [];        // 批量篮：Alt+点击加入的 entry 列表（{plugin, action}）
let savedList = [];   // 收藏的结果（本机）
let notesStore = {};  // 执行备注：actionKey -> { text, ts }
let accent = 'ocean';
let searchHistory = [];
let listFilter = 'all';
let pluginTags = {};
let aliases = {};
let nicknames = {};
let actionTags = {};
let lang = 'zh';
let t = makeT(lang);

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
  writeJson(PREF.tags, pluginTags);
  writeJson(PREF.aliases, aliases);
  writeJson(PREF.nicknames, nicknames);
  writeJson(PREF.actionTags, actionTags);
}

/** 收集可快照的偏好（主题/强调色/收藏/别名/昵称/标签/快捷键/字体） */
function collectPrefsSnapshot() {
  return {
    theme: localStorage.getItem('zerokit.theme'),
    accent: localStorage.getItem('zerokit.accent'),
    fontScale: localStorage.getItem('zerokit.font-scale'),
    favorites, aliases, nicknames, pluginTags,
    hotkeys: readJson('zerokit.hotkeys', {}),
    savedList: readJson('zerokit.saved', []),
  };
}

/** 应用一组偏好快照并立即生效 */
function applyPrefsSnapshot(snap) {
  if (!snap || typeof snap !== 'object') return;
  if (typeof snap.theme === 'string') localStorage.setItem('zerokit.theme', snap.theme);
  if (typeof snap.accent === 'string') localStorage.setItem('zerokit.accent', snap.accent);
  if (typeof snap.fontScale === 'string') localStorage.setItem('zerokit.font-scale', snap.fontScale);
  favorites = Array.isArray(snap.favorites) ? snap.favorites.filter((x) => typeof x === 'string') : [];
  aliases = snap.aliases && typeof snap.aliases === 'object' ? snap.aliases : {};
  nicknames = snap.nicknames && typeof snap.nicknames === 'object' ? snap.nicknames : {};
  pluginTags = snap.pluginTags && typeof snap.pluginTags === 'object' ? snap.pluginTags : {};
  writeJson('zerokit.hotkeys', snap.hotkeys ?? {});
  writeJson('zerokit.saved', Array.isArray(snap.savedList) ? snap.savedList : []);
  applyTheme();
  applyAccent();
  applyFontScale();
  savePrefs();
  renderList();
}

function loadPrefs() {
  const favs = readJson(PREF.favorites, []);
  favorites = Array.isArray(favs) ? favs.filter((x) => typeof x === 'string') : [];
  const params = readJson(PREF.params, {});
  paramStore = params && typeof params === 'object' ? params : {};
  const runs = readJson(PREF.runs, {});
  runStore = runs && typeof runs === 'object' ? runs : {};
  savedList = readJson(PREF.saved, []);
  if (!Array.isArray(savedList)) savedList = [];
  notesStore = readJson(PREF.notes, {});
  if (!notesStore || typeof notesStore !== 'object') notesStore = {};
  accent = normalizeAccent(localStorage.getItem(PREF.accent));
  const searches = readJson(PREF.searches, []);
  searchHistory = Array.isArray(searches) ? searches.filter((x) => typeof x === 'string') : [];
  pluginTags = readJson(PREF.tags) ?? {};
  if (typeof pluginTags !== 'object' || Array.isArray(pluginTags)) pluginTags = {};
  aliases = readJson(PREF.aliases) ?? {};
  nicknames = readJson(PREF.nicknames) ?? {};
  actionTags = readJson(PREF.actionTags) ?? {};
  lang = pickLang(localStorage.getItem('zerokit.lang'));
  t = makeT(lang);
  if (typeof actionTags !== 'object' || Array.isArray(actionTags)) actionTags = {};
  if (typeof nicknames !== 'object' || Array.isArray(nicknames)) nicknames = {};
  if (typeof aliases !== 'object' || Array.isArray(aliases)) aliases = {};
}

/** 字体三档（小/中/大）：html[data-font-scale]，CSS 用 rem 级放大 */
function applyFontScale() {
  const v = localStorage.getItem('zerokit.font-scale') || 'm';
  document.documentElement.dataset.fontScale = v;
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
    </div>
    <div class="tp-head">字体大小</div>
    <div class="tp-row">
      ${[['s', '小'], ['m', '中'], ['l', '大']].map(([id, label]) => `
        <button data-font="${id}" class="${(localStorage.getItem('zerokit.font-scale') || 'm') === id ? 'on' : ''}">${label}</button>`).join('')}
    </div>`;
  pop.classList.remove('hidden');
  // 选中后就地更新高亮，不重建 DOM、也不收起面板：重建会让本次点击的目标
  // 变成游离节点，document 上的「点外面关掉」判断就会误判成点了外面。
  const paint = () => {
    const choice = normalizeTheme(localStorage.getItem(PREF.theme));
    pop.querySelectorAll('[data-font]').forEach((b) => {
    b.addEventListener('click', () => {
      localStorage.setItem('zerokit.font-scale', b.dataset.font);
      applyFontScale();
      pop.querySelectorAll('[data-font]').forEach((x) => x.classList.toggle('on', x === b));
    });
  });
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
function scoreEntry(entry, token, explain) {
  const p = entry.plugin;
  const a = entry.action;
  const best = (...pairs) => {
    let m = 0;
    let mi = -1;
    for (let i = 0; i < pairs.length; i++) {
      if (pairs[i][0] * pairs[i][1] > m) { m = pairs[i][0] * pairs[i][1]; mi = i; }
    }
    if (explain && mi >= 0) explain.push([pairs[mi][2] ?? '命中', pairs[mi][0], pairs[mi][1]]);
    return m;
  };
  // 昵称：用户自己起的名字，权重最高——他们叫它什么，搜它就该第一个出来
  const key0 = actionKey(p.id, a.id);
  const nick = nicknames[key0];
  const atags = actionTags[key0] ?? [];

  // 动作自己这一层：名字里直接命中，"打开这个动作"的意图最明确
  const own = best(
    [nick ? scoreOne(nick, token) * 1.2 : 0, 1.0, '昵称'],
    [scoreOne(a.id, token), 1.0, '动作ID'],
    [scoreOne(a.title, token), 1.05, '动作名'],
    [scoreOne(entry.hayId, token), 0.9, '插件.动作'],
    [scorePinyin(entry.py.title, token), 1.05, '拼音'],
    [atags.length ? scoreOne(atags.join(' '), token) * 0.95 : 0, 1.0, '标签'],
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
    const why = [];
    for (const token of tokens) {
      const s = scoreEntry(entry, token, why);
      if (s <= 0) { ok = false; break; }
      total += s;
    }
    if (!ok) continue;
    entry.lastWhy = why;   // 详情页「为什么命中」用（ WeakMap 更干净但没必要）
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
  return `<li class="item${i === active ? ' active' : ''}${smart ? ' smart' : ''}${fav ? ' fav' : ''}" data-i="${i}" role="option"
    aria-selected="${i === active ? 'true' : 'false'}" tabindex="${i === active ? 0 : -1}">
    ${who}
    <span class="title">
      <span class="name">${highlightHtml(a.title, query, esc)}${nicknames[key] ? `<i class="nick">（${esc(nicknames[key])}）</i>` : ''}</span>
      <span class="desc">${smart ? `内容看起来是${esc(smart)}，可以直接用` : esc(a.description || p.summary || '')}</span>
    </span>
    <button class="star${fav ? ' on' : ''}" data-fav="${esc(key)}" title="${fav ? '取消收藏' : '收藏这个动作'}" aria-label="${fav ? '取消收藏' : '收藏这个动作'}">${fav ? '★' : '☆'}</button>
    <span class="aid">${esc(a.id)}</span>
    ${(actionTags[key] ?? []).map((tg) => `<span class="badge tag">#${esc(tg)}</span>`).join(' ')}
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

/** 批量顺序执行：逐个跑篮子里的动作（destructive 排最后），完成后弹汇总卡片。
 * 每项用已记忆的参数（参数记忆参数不存在时用默认值），失败不阻断后面的项。 */
async function runBatch() {
  if (!batch.length) return;
  // destructive 排最后：失败不至于挡住只读项
  const ordered = [...batch].sort((a, b) =>
    (a.action.risk === 'destructive' ? 1 : 0) - (b.action.risk === 'destructive' ? 1 : 0));
  const results = [];
  const btn = document.getElementById('batchRun');
  if (btn) { btn.disabled = true; btn.textContent = '执行中…'; }
  for (const entry of ordered) {
    const key = actionKey(entry.plugin.id, entry.action.id);
    const values = paramStore[key] ?? {};
    const payload = {
      plugin: entry.plugin.id, action: entry.action.id, values,
    };
    try {
      const r = await fetch('/api/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-zk-token': TOKEN },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({ ok: false, error: '响应不是 JSON' }));
      results.push({ entry, ok: j.ok !== false && r.ok, ms: j.ms ?? 0, error: j.error });
    } catch (err) {
      results.push({ entry, ok: false, ms: 0, error: String(err) });
    }
  }
  if (btn) { btn.disabled = false; btn.textContent = '顺序执行'; }
  batch = [];
  renderList();
  // 汇总卡片：成功 N / 失败 M / 总耗时，失败项可点开
  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  const totalMs = results.reduce((s, r) => s + (r.ms || 0), 0);
  const sum = document.createElement('div');
  sum.id = 'batchSummary';
  sum.className = 'batch-summary';
  sum.innerHTML = `
    <b>批量执行完成</b>
    <span class="${ok ? 'ok' : ''}">✓ ${ok}</span>
    ${failed ? `<span class="bad">✗ ${failed}</span>` : ''}
    <span class="sub">总耗时 ${formatMs(totalMs)}</span>
    ${failed ? `<ul class="batch-fails">${results.filter((r) => !r.ok).map((r, i) => `
      <li data-fail="${i}" title="${esc(r.error || '失败')}">✗ ${esc(r.entry.action.title)}（${esc(r.entry.plugin.name)}）</li>`).join('')}</ul>` : ''}
    <button class="ghost mini" id="batchSumClose">关闭</button>`;
  el.listView.insertBefore(sum, el.list);
  sum.querySelector('#batchSumClose').addEventListener('click', () => sum.remove());
  const failItems = [...sum.querySelectorAll('[data-fail]')];
  const fails = results.filter((r) => !r.ok);
  failItems.forEach((li) => li.addEventListener('click', () => {
    const r = fails[Number(li.dataset.fail)];
    if (r) openDetail(r.entry.plugin, r.entry.action);
  }));
}

function renderList() {
  const aliasHit = aliasEntry(el.q.value);
  if (aliasHit && el.q.value.trim()) {
    filtered = [aliasHit];
    filteredSmart = new Map();
    el.list.innerHTML = filtered.map((entry, i) => itemHtml(entry, i, true, '')).join('');
    el.count.textContent = `别名「${el.q.value.trim()}」→ ${aliasHit.plugin.name} · ${aliasHit.action.title}`;
    el.empty.classList.add('hidden');
    renderQuickBar();
    return;
  }
  // 批量篮浮条（有选中才显示）
  const oldBar = document.getElementById('batchBar');
  if (oldBar) oldBar.remove();
  if (batch.length) {
    const bar = document.createElement('div');
    bar.className = 'batch-bar';
    bar.id = 'batchBar';
    bar.innerHTML = `已选 ${batch.length} 项
      <button class="ghost mini" id="batchRun" aria-label="顺序执行篮子里的 ${batch.length} 个动作">顺序执行</button>
      <button class="ghost mini" id="batchClear" aria-label="清空批量篮">清空</button>
      <span class="help">destructive 排最后</span>`;
    el.listView.insertBefore(bar, el.list);
    bar.querySelector('#batchRun').addEventListener('click', runBatch);
    bar.querySelector('#batchClear').addEventListener('click', () => { batch = []; renderList(); });
  }
  const oldSum = document.getElementById('batchSummary');
  if (oldSum) oldSum.remove();



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
      ? `<div class="empty-art" aria-hidden="true">${q.trim() ? '🔍' : '🌱'}</div>
         <div class="empty-title">${q.trim() ? `没有匹配「${esc(q.trim())}」的动作` : '这里还空着'}</div>
         <div class="empty-why">${q.trim()
           ? '可能是词太具体，也可能这个能力还没装进来。'
           : '装上第一个插件，启动器就会开始认识你的电脑。'}</div>
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
    // 虚拟滚动：条目多时只渲染视口附近（+缓冲），上下用 spacer 撑出总高度。
    // 上百个动作时 DOM 节点从 N 降到 ~20，滚动不再卡。
    if (filtered.length > 60) {
      renderVirtualList(q);
    } else {
      el.list.innerHTML = filtered.map((entry, i) => itemHtml(entry, i, true, q)).join('');
    }
  }

  renderListTools(baseEntries, q);
  bindListItems(q);
  el.count.textContent = q.trim()
    ? `${filtered.length} / ${entries.length} 个动作`
    : [favorites.length ? `收藏 ${favorites.length} 优先` : '',
      loadRecent().length > 0 ? '最近使用优先' : '']
      .filter(Boolean).concat([`${plugins.length} 个插件`, `${entries.length} 个动作`])
      .join(' · ');
  syncListHash();
}

/** 列表条目的事件绑定（渲染后调用；虚拟滚动重渲染窗口后也要再调）。 */
function bindListItems(q) {
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
      // Alt+点击：不打开，而是加入批量篮（巡检/报表场景）
      if (ev.altKey) {
        ev.preventDefault();
        const entry = filtered[Number(node.dataset.i)];
        if (entry) {
          const k = actionKey(entry.plugin.id, entry.action.id);
          if (!batch.some((x) => actionKey(x.plugin.id, x.action.id) === k)) batch.push(entry);
          const bar = document.getElementById('batchBar');
          if (bar) bar.firstChild.textContent = `已选 ${batch.length} 项 `;
        }
        return;
      }
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
}

/** 列表状态写进 URL 的收口（renderList 末尾调用）：搜索词/筛选刷新不丢，
 *  还能把「我筛好的视图」直接分享出去。 */
function syncListHash() {
  const st = listStateQuery({ q: el.q.value, filter: listFilter });
  const wantHash = st ? `#/?${st}` : (location.hash.startsWith('#/?') ? location.pathname : location.hash);
  if ((location.hash || '') !== wantHash && mode === 'command' && !detail) {
    history.replaceState(null, '', wantHash || location.pathname);
  }
}

/** 别名解析：`zz` -> 对应动作 entry；未命中返回 undefined */
function aliasEntry(word) {
  const key = String(word ?? '').trim().toLowerCase();
  if (!key) return undefined;
  const target = aliases[key];
  if (!target) return undefined;
  const dot = target.lastIndexOf('.');
  return entries.find((e) => e.plugin.id === target.slice(0, dot)
    && e.action.id === target.slice(dot + 1));
}

/** 虚拟滚动列表：行高按首屏实测（兜底 64px）。滚动时节流重渲染窗口。 */
function renderVirtualList(q) {
  const ROW_H_FALLBACK = 64;
  el.list.classList.add('virtual');
  const scroller = el.list.parentElement; // listView 是滚动容器
  const viewH = scroller ? scroller.clientHeight : 600;
  const scrollTop = scroller ? scroller.scrollTop : 0;
  // 实测行高：渲染一页后取第一个 .item 的 offsetHeight
  let rowH = ROW_H_FALLBACK;
  const probe = el.list.querySelector('.item');
  if (probe) rowH = Math.max(24, probe.offsetHeight);
  const w = virtualWindow(filtered.length, scrollTop, rowH, viewH);
  const pad = (h) => h > 0 ? `<li class="v-spacer" style="height:${h}px" aria-hidden="true"></li>` : '';
  el.list.innerHTML = pad(w.padTop)
    + filtered.slice(w.start, w.end).map((entry, i) => itemHtml(entry, w.start + i, true, q)).join('')
    + pad(w.padBottom);
  el.count.textContent = `${filtered.length} / ${entries.length} 个动作（虚拟滚动 ${w.start + 1}-${w.end}）`;
}

function setupVirtualScroll() {
  const scroller = el.listView;
  if (!scroller) return;
  let raf = 0;
  scroller.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      // 只有处于「命令态 + 无搜索分组」时才虚拟化；分组浏览保持全量渲染
      if (mode === 'command' && el.q.value.trim() && filtered.length > 60 && !el.list.classList.contains('hidden')) {
        renderVirtualList(el.q.value);
        // 重渲染后把窗口内的监听器补上
        bindListItems(el.q.value);
      }
    });
  }, { passive: true });
}

function paintActive() {
  el.list.querySelectorAll('.item').forEach((node, i) => {
    node.classList.toggle('active', i === active);
    // roving tabindex：只有选中项在 Tab 序里，其余 tabindex=-1（键盘不用按 N 次 Tab）
    node.setAttribute('aria-selected', i === active ? 'true' : 'false');
    node.setAttribute('tabindex', i === active ? '0' : '-1');
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
  // 第十八轮①：切到别的动作，旧监控自动停（一次只盯一个）
  for (const k of Object.keys(watchRegistry())) {
    if (k !== actionKey(plugin.id, action.id)) stopWatch(k);
  }
  // 深链：CLI / MCP / 别人的消息里可以直接给 #/插件/动作 让界面跳到这一条
  const wantedHash = `#/${plugin.id}/${action.id}`;
  if (location.hash !== wantedHash) history.pushState(null, '', wantedHash);
  el.listView.classList.add('hidden');
  el.workbench.classList.add('hidden');
  el.detailView.classList.remove('hidden');

  const depWarn = plugin.requiresOk ? '' : `
    <div class="cmd-line" style="color:var(--bad)">
      ✗ 缺少依赖：${esc(plugin.missingDeps.join(', '))}　先装上它，这个动作才能跑
    </div>`;

  const steps = Array.isArray(action.steps) ? action.steps : [];
  const chainDry = steps.length ? `
    <div class="chain-dry"><button class="ghost" id="chainDryBtn">试走一遍（不执行，只推演每步会拿到什么形状）</button>
      <div id="chainDryOut"></div></div>` : '';

  const chainInfo = steps.length ? `
    <div class="chain-dry-wrap">
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
    </div>${chainDry}</div>` : '';

  const favKey = actionKey(plugin.id, action.id);
  const fav = isFavorite(favorites, favKey);
  const note = notesStore[favKey]?.text ?? '';
  const mem = paramStore[favKey] ?? {};
  const initial = { ...mem, ...(prefill ?? {}) };
  const memNote = Object.keys(mem).length
    ? `<div class="mem-note">已带入上次参数 · <button class="link" id="forgetParams">清除记忆</button></div>`
    : '';

  const aliasKey = actionKey(plugin.id, action.id);
  const aliasName = Object.entries(aliases).find(([, v]) => v === aliasKey)?.[0];
  const nickKey = actionKey(plugin.id, action.id);
  const whyRows = (action.lastWhy ?? [])
    .map((r) => `<tr><td>${esc(r[0])}</td><td>${r[1].toFixed(2)}</td><td>×${r[2]}</td></tr>`).join('');
  const whyNote = whyRows
    ? `<div class="mem-note why-note"><b>为什么命中</b><table class="why-table"><tr><th>信号</th><th>分</th><th>权重</th></tr>${whyRows}</table></div>`
    : '';
  const aliasNote = `<div class="mem-note alias-note">别名：
    <input id="aliasInput" placeholder="起个短名（如 top）" value="${esc(aliasName ?? '')}"
      autocomplete="off" spellcheck="false" style="width:9em">
    <span class="help">之后在搜索框直接输入短名，回车就是这个动作</span></div>
    <div class="mem-note nick-note">昵称：
    <input id="nickInput" placeholder="给这个动作起个自己的名字" value="${esc(nicknames[nickKey] ?? '')}"
      autocomplete="off" spellcheck="false" style="width:14em">
    <span class="help">搜索时优先命中；列表里显示在原名旁</span></div>
    <div class="mem-note tag-note">标签：
    <input id="atagInput" placeholder="逗号分隔，如：巡检, 报表" value="${esc((actionTags[nickKey] ?? []).join(', '))}"
      autocomplete="off" spellcheck="false" style="width:14em">
    <span class="help">#标签可搜索，列表里显示</span></div>`;

  // 上次结果提示：同动作最近一次执行可一键回看（不是缓存复用——那会让「跑一次」
  // 语义变味；只是给「我刚才是不是跑过这个」一个不用翻历史的入口）
  const lastRun = (runStore[aliasKey] ?? []).at(-1);
  const lastRunNote = lastRun
    ? `<div class="mem-note last-run-note">上次：${lastRun.ok ? '✓ 成功' : '✗ 失败'} · ${Math.max(1, Math.round((Date.now() - lastRun.ts) / 60000))} 分钟前
        <button class="ghost mini" id="peekLast" title="回看上次结果">回看</button></div>`
    : '';

  // sparkline：这个动作近 20 次的耗时走势（成功点线、失败点红），有历史才画
  const key = actionKey(plugin.id, action.id);
  const runHist = (runStore[key] ?? []).slice(-20);
  const sparkline = runHist.length >= 3
    ? (() => {
        const pts = sparkPoints(runHist, 24);
        const maxMs = Math.max(1, ...pts.map((p) => p.ms));
        const w = 120, h = 26;
        const path = pts.map((p, i) =>
          `${i === 0 ? 'M' : 'L'}${((i / Math.max(1, pts.length - 1)) * w).toFixed(1)},${(h - (p.ms / maxMs) * (h - 4) - 2).toFixed(1)}`).join(' ');
        const dots = pts.filter((p) => !p.ok).map((p, j) => {
          const i = pts.indexOf(p);
          return `<circle cx="${((i / Math.max(1, pts.length - 1)) * w).toFixed(1)}" cy="${(h - (p.ms / maxMs) * (h - 4) - 2).toFixed(1)}" r="2.2" fill="var(--bad, #e5484d)"/>`;
        }).join('');
        return `<span class="spark" title="近 ${runHist.length} 次耗时走势（最高 ${formatMs(maxMs)}）"><svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><path d="${path}" fill="none" stroke="var(--accent, #5aa9ff)" stroke-width="1.5"/>${dots}</svg></span>`;
      })()
    : '';

  // 深链 query 预填：#/插件/动作?字段=值——比 prefill 更显式的传参方式
  const linkParams = deepLinkParams(location.hash);
  const effectiveInitial = { ...initial, ...linkParams };
  const fields = action.fields.map((f) => {
    const req = f.required ? ' <span class="req">*</span>' : '';
    const help = f.help ? `<div class="help">${esc(f.help)}</div>` : '';
    const errId = `err_${esc(f.name)}`;
    if (f.type === 'checkbox') {
      const checked = effectiveInitial[f.name] !== undefined ? effectiveInitial[f.name] === 'true' || effectiveInitial[f.name] === true : Boolean(f.default);
      return `<div class="field check" data-field="${esc(f.name)}">
        <input type="checkbox" id="f_${esc(f.name)}" ${checked ? 'checked' : ''}>
        <label for="f_${esc(f.name)}">${esc(f.name)}${req}</label>
      </div>${help}`;
    }
    if (f.type === 'select') {
      const sel = effectiveInitial[f.name] !== undefined ? effectiveInitial[f.name] : f.default;
      return `<div class="field" data-field="${esc(f.name)}"><label>${esc(f.name)}${req}</label>
        <select id="f_${esc(f.name)}">
          ${(f.options || []).map((o) => `<option${o === sel ? ' selected' : ''}>${esc(o)}</option>`).join('')}
        </select>${help}</div>`;
    }
    // 密钥字段：输入框就是 password，既不回显也不进参数记忆；带 👁 切换明文
    const type = f.secret ? 'password' : (f.type === 'number' ? 'number' : 'text');
    const given = effectiveInitial[f.name] !== undefined ? effectiveInitial[f.name] : f.default;
    const def = given === undefined ? '' : ` value="${esc(given)}"`;
    const numAttrs = f.type === 'number'
      ? `${f.min !== undefined ? ` min="${esc(f.min)}"` : ''}${f.max !== undefined ? ` max="${esc(f.max)}"` : ''}${f.step !== undefined ? ` step="${esc(f.step)}"` : ''}`
      : '';
    if (f.multiline) {
      return `<div class="field" data-field="${esc(f.name)}"><label>${esc(f.name)}${req}</label>
        <textarea id="f_${esc(f.name)}" rows="3" class="auto-grow">${esc(given ?? '')}</textarea>${help}
        <div class="field-err hidden" id="${errId}"></div></div>`;
    }
    if (f.secret) {
      return `<div class="field secret-field" data-field="${esc(f.name)}"><label>${esc(f.name)}${req}</label>
        <div class="secret-wrap">
          <input id="f_${esc(f.name)}" type="password"${def} autocomplete="off">
          <button type="button" class="ghost mini eye" data-eye="${esc(f.name)}" aria-label="显示或隐藏明文" title="显示/隐藏明文">👁</button>
        </div>${help}
        <div class="field-err hidden" id="${errId}"></div></div>`;
    }
    return `<div class="field" data-field="${esc(f.name)}"><label>${esc(f.name)}${req}</label>
      <input id="f_${esc(f.name)}" type="${type}"${numAttrs}${def} autocomplete="off">${help}
      <div class="field-err hidden" id="${errId}"></div></div>`;
  }).join('');

  el.detailView.innerHTML = `
    <div class="detail-head">
      <h2>${esc(action.title)}<button class="star big${fav ? ' on' : ''}" id="favBtn"
        title="${fav ? '取消收藏' : '收藏这个动作'}" aria-label="${fav ? '取消收藏' : '收藏这个动作'}">${fav ? '★' : '☆'}</button></h2>
      <div class="meta">${esc(plugin.name)} · ${esc(action.id)} ·
        <span class="badge ${esc(action.risk)}">${esc(RISK_TEXT[action.risk] || action.risk)}</span>
        ${steps.length ? `<span class="badge">组合 ${steps.length} 步</span>` : ''}
        <span class="badge">${esc(action.tool)}</span>
        ${sparkline}
      </div>
      <div class="desc">${esc(action.description || '（这个动作没写说明）')}</div>
      ${note ? `<div class="detail-note">📌 ${esc(note)}</div>` : ''}
      <div class="detail-hotkey">
        <button class="ghost" id="hkBtn" title="把 F1–F12 里某个键绑给这个动作，全局按一下就打开">⚡ 绑定快捷键</button>
        <span class="sub" id="hkHint">${hotkeyFor(favKey) ? `当前绑定：${hotkeyFor(favKey)}` : '未绑定（F1–F12）'}</span>
      </div>
    </div>
    ${depWarn}
    ${chainInfo}
    ${memNote}
  ${whyNote}
  ${aliasNote}
  ${lastRunNote}
    ${fields}
    <div id="riskCard" class="risk-card"></div>
    <div id="runHistory" class="run-history"></div>
    <div class="actions">
      <button class="primary" id="runBtn">执行</button>
      <button class="ghost" id="previewBtn" title="先看真正会执行的命令行（密钥打码），再决定跑不跑">预览命令</button>
      <button class="ghost" id="invokeBtn" title="这个动作在 CLI / MCP / 深链里怎么调">调用方式</button>
      ${plugin.settings?.length ? '<button class="ghost" id="cfgBtn" title="这个插件的长期配置（端点、密钥等），保存后立即生效">配置插件</button>' : ''}
      <button class="ghost" id="qrBtn" title="生成深链二维码，手机扫码直达这个动作">二维码</button>
      <button class="ghost" id="shareBtn" title="复制带当前参数的完整深链">分享</button>
      <button class="ghost" id="timerBtn" title="只读动作按间隔自动执行（界面开着才跑）">定时</button>
      <button class="ghost" id="watchBtn" title="监控模式：自动重跑+变更追踪+倒计时环（#/watch 聚合面板）">监控</button>
      <button class="ghost" id="maskBtn" title="结果里的 token/密钥/长十六进制串默认打码——切换显示明文">🕶 脱敏中</button>
      <button class="ghost" id="purgeBtn" title="清除当前结果与本地运行历史（含参数记忆），审计日志不动">🧹 清除痕迹</button>
      <button class="ghost" id="shareCardBtn" title="把这次结果生成一张摘要卡（复制到剪贴板）">分享卡</button>
      <button class="ghost" id="copyJsonBtn" title="复制动作定义 JSON（写文档 / 分享给他人用）">复制 JSON</button>
      <button class="ghost" id="resetBtn" title="把所有参数清回清单默认值">恢复默认</button>
      <button class="ghost" id="backBtn">返回</button>
    </div>
    <div id="queueState" class="queue-note hidden"></div>
    <div id="watchBar" class="watch-bar hidden"></div>
    <div id="previewBox"></div>
    <div id="invokeBox"></div>
    <div id="detailCfg" class="cmd-box hidden"></div>
    <div id="result" aria-live="polite"></div>`;

  // 面包屑：全部 › 插件 › 动作（插件段可点回插件主页）。
  // 必须在 innerHTML 赋值之后注入——模板重写会清掉宿主节点。
  const crumbsHost = document.createElement('div');
  crumbsHost.className = 'crumbs-host';
  el.detailView.insertBefore(crumbsHost, el.detailView.firstChild);
  crumbsHost.innerHTML = '';
  {
    const crumbs = breadcrumb(plugin, action);
    const bc = document.createElement('nav');
    bc.className = 'crumbs';
    bc.setAttribute('aria-label', '路径');
    bc.innerHTML = crumbs.map((c, i) => {
      const last = i === crumbs.length - 1;
      const attrs = c.kind === 'list' ? 'data-crumb="list"' : c.kind === 'plugin' ? `data-crumb="plugin" data-pid="${esc(c.id)}"` : '';
      return `${i > 0 ? '<span class="c-sep" aria-hidden="true">›</span>' : ''}`
        + (last ? `<span class="c-cur" aria-current="page">${esc(c.label)}</span>`
          : `<button class="c-link" ${attrs}>${esc(c.label)}</button>`);
    }).join('');
    crumbsHost.appendChild(bc);
    bc.querySelectorAll('[data-crumb]').forEach((b) => {
      b.addEventListener('click', () => {
        const kind = b.dataset.crumb;
        if (kind === 'list') backToList();
        else if (kind === 'plugin') showPluginHome(b.dataset.pid);
      });
    });
  }

  // ---- 第十四轮：表单与输入体验 ----
  // 即时校验：input/change 时校必填与数字范围，错误就地标红
  const liveValidate = () => {
    const values = collectValues(action);
    const errs = validateFields(action.fields, values);
    el.detailView.querySelectorAll('.field[data-field]').forEach((box) => {
      const name = box.dataset.field;
      const err = errs.find((e) => e.name === name);
      const errEl = document.getElementById(`err_${name}`);
      box.classList.toggle('has-err', Boolean(err));
      if (errEl) { errEl.textContent = err ? `✗ ${err.reason}` : ''; errEl.classList.toggle('hidden', !err); }
    });
    return errs;
  };
  // 即时预览：表单一动就刷新命令预览（防抖 400ms，不打接口风暴）
  let pvTimer = null;
  const livePreview = () => {
    clearTimeout(pvTimer);
    pvTimer = setTimeout(async () => {
      const box = $('previewBox');
      if (!box || !box.dataset.live) return;   // 只有用户点过一次「预览命令」才持续刷新
      try {
        const r = await api('/api/preview', { method: 'POST', body: { plugin: plugin.id, action: action.id, values: collectValues(action) } });
        box.innerHTML = `<div class="cmd-box">
          <div class="cmd-box-head">将要执行${r.masked ? '（密钥已打码）' : ''}</div>
          <pre>${esc(r.command || '（这个动作没有命令）')}</pre></div>`;
      } catch { /* 静默：预览失败不刷屏 */ }
    }, 400);
  };
  const onFormInput = () => { liveValidate(); livePreview(); markDirty(); };
  el.detailView.querySelectorAll('.field input, .field textarea, .field select').forEach((input) => {
    input.addEventListener('input', onFormInput);
    input.addEventListener('change', onFormInput);
  });
  // secret 眼睛切换
  el.detailView.querySelectorAll('.eye[data-eye]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(`f_${btn.dataset.eye}`);
      if (input) input.type = input.type === 'password' ? 'text' : 'password';
    });
  });
  // textarea 自动增高
  el.detailView.querySelectorAll('textarea.auto-grow').forEach((ta) => {
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(320, ta.scrollHeight + 2) + 'px'; };
    ta.addEventListener('input', grow);
    grow();
  });
  // 恢复默认：清回清单默认值（含 select/checkbox）
  $('resetBtn')?.addEventListener('click', () => {
    for (const f of action.fields) {
      const node = document.getElementById(`f_${f.name}`);
      if (!node) continue;
      if (f.type === 'checkbox') node.checked = Boolean(f.default);
      else node.value = f.default === undefined ? '' : String(f.default);
    }
    onFormInput();
  });
  // 历史参数重选：最近 3 次成功组合
  const histSets = recentParamSets((runStore[actionKey(plugin.id, action.id)] ?? []), 3);
  if (histSets.length) {
    const bar = document.createElement('div');
    bar.className = 'param-sets';
    bar.innerHTML = `<span class="help">用上次的参数：</span>` + histSets.map((set, i) =>
      `<button class="chip" data-pset="${i}" title="${esc(new Date(set.ts).toLocaleString())}">${esc(Object.entries(set.params).map(([k, v]) => `${k}=${String(v).slice(0, 18)}`).join(' · ') || '（无参数）')}</button>`).join('');
    const fieldsHost = el.detailView.querySelector('.field')?.parentElement;
    fieldsHost?.insertBefore(bar, detailView.querySelector('.field'));
    bar.querySelectorAll('[data-pset]').forEach((b) => {
      b.addEventListener('click', () => {
        const set = histSets[Number(b.dataset.pset)];
        for (const [k, v] of Object.entries(set.params ?? {})) {
          const node = document.getElementById(`f_${k}`);
          if (!node) continue;
          if (node.type === 'checkbox') node.checked = Boolean(v);
          else node.value = String(v);
        }
        onFormInput();
      });
    });
  }
  // 脏状态：改过参数未执行就点返回 → 确认（标志挂在 DOM 上，避免依赖闭包外层可变对象）
  const markDirty = () => {
    const dirty = dirtyFields(action.fields, collectValues(action), effectiveInitial);
    el.detailView.dataset.formDirty = String(dirty.length > 0);
  };
  markDirty();
  const origBack = $('backBtn');
  origBack?.addEventListener('click', (e) => {
    if (el.detailView?.dataset.formDirty === 'true' && !confirm('参数已修改但还没执行，确定返回？')) {
      e.stopImmediatePropagation();
    }
  }, { capture: true });
  // 执行前校验：拦截并聚焦第一个错误字段
  const origRun = $('runBtn');
  origRun?.addEventListener('click', () => {
    const errs = liveValidate();
    if (errs.length) {
      const first = document.getElementById(`f_${errs[0].name}`);
      first?.focus();
      first?.scrollIntoView({ block: 'center' });
    }
  }, { capture: true });
  // 「预览命令」点过后进入持续刷新模式
  const pb = $('previewBtn');
  pb?.addEventListener('click', () => { if ($('previewBox')) $('previewBox').dataset.live = '1'; });
  liveValidate();

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
  // chain 试走：纯前端推演。真实执行才有真实值——这里只回答「每步的输入从哪来」。
  $('chainDryBtn')?.addEventListener('click', () => {
    const out = $('chainDryOut');
    if (!out) return;
    if (out.innerHTML) { out.innerHTML = ''; return; }
    const rows = steps.map((st, i) => {
      const ps = Object.entries(st.params ?? {});
      const refs = [];
      if (i > 0) refs.push(`{${steps[i - 1].as}}`, '{prev}');
      for (const [, v] of ps) {
        for (const m of String(v).matchAll(/\{([\w.]+)\}/g)) refs.push(`{${m[1]}}`);
      }
      const filled = ps.filter(([, v]) => !/\{/.test(String(v)));
      return `<div class="dry-row">
        <span class="chain-no">${i + 1}</span>
        <code>${esc(st.use)}</code>
        → <code>{${esc(st.as)}}</code>
        <span class="dry-note">
          ${refs.length ? `会引用 ${refs.map((r) => `<code>${esc(r)}</code>`).join(' / ')}` : '只用动作参数'}
          ${filled.length ? `；${filled.length} 个参数是写死的常量` : ''}
        </span>
      </div>`;
    }).join('');
    out.innerHTML = `<div class="cmd-box"><div class="cmd-box-head">推演结果（占位符将在执行时用真实值替换）</div>${rows}</div>`;
  });

  $('hkBtn')?.addEventListener('click', () => bindHotkey(favKey, action.title));
  $('copyJsonBtn').addEventListener('click', async (ev) => {
    const def = {
      plugin: plugin.id, action: action.id, title: action.title,
      type: action.type ?? 'exec', risk: action.risk,
      params: (action.fields ?? []).map((f) => ({ name: f.name, type: f.type, required: f.required ?? false })),
      steps: action.steps ?? undefined,
    };
    const btn = ev.currentTarget;
    try {
      await navigator.clipboard.writeText(JSON.stringify(def, null, 2));
      btn.textContent = '✓ 已复制';
      setTimeout(() => { btn.textContent = '复制 JSON'; }, 1200);
    } catch {
      btn.textContent = '复制失败';
    }
  });
  // 定时任务（界面内）：只读动作可设间隔自动跑。页面开着才执行——这是刻意边界，
  // 不做后台守护：守护需要常驻进程与错过补跑策略，那是一个服务，不是一个启动器功能。
  $('timerBtn')?.addEventListener('click', () => {
    if (action.risk !== 'read') {
      el.count.textContent = '只有只读动作能定时执行（有副作用的自动跑风险太大）';
      return;
    }
    const sec = Number(prompt('每多少秒自动执行一次？（界面开着才会执行；输 0 取消）', '60'));
    if (!Number.isFinite(sec)) return;
    if (sec <= 0) { el.count.textContent = '已取消定时执行'; return; }
    // 第十轮②：定时任务统一进注册表（#/timers 面板可查看/停止）
    const reg = timerRegistry();
    const key = actionKey(plugin.id, action.id);
    if (reg[key]) { clearInterval(reg[key].id); delete reg[key]; }
    reg[key] = {
      id: setInterval(() => {
        // 静默跑：不抢焦点，只更新计数提示
        submit(false).then(() => {}).catch(() => {});
      }, sec * 1000),
      interval: sec,
      title: `${plugin.name} · ${action.title}`,
    };
    el.count.textContent = `已开启定时执行：每 ${sec} 秒一次（#/timers 可管理）`;
  });

  // 第十八轮①–⑨：监控模式——自动重跑 + 变更追踪 + 停止条件 + 聚合面板。
  // 与「定时」的区别：定时只是重复跑；监控记录采样、diff 高亮、趋势线、可设停止条件。
  $('watchBtn')?.addEventListener('click', () => {
    if (action.risk !== 'read') {
      el.count.textContent = '只有只读动作能监控（有副作用的自动跑风险太大）';
      return;
    }
    const reg = watchRegistry();
    const key = actionKey(plugin.id, action.id);
    if (reg[key]) { stopWatch(key); renderWatchBar(); return; }
    openWatchDialog(plugin, action, key);
  });
  // 第十九轮④⑧：脱敏开关 + 一键清除敏感痕迹
  $('maskBtn')?.addEventListener('click', toggleMask);
  $('purgeBtn')?.addEventListener('click', purgeSensitive);
  renderWatchBar();

  // 二维码：深链 → SVG，模态展示（离线生成，不联网）
  $('qrBtn')?.addEventListener('click', () => {
    const deepLink = `${location.origin}${location.pathname}#/${plugin.id}/${action.id}`;
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="modal qr-modal">
        <h3>扫码直达这个动作</h3>
        <div class="qr-box">${qrSvg(deepLink, { scale: 5, margin: 3 })}</div>
        <div class="help" style="word-break:break-all">${esc(deepLink)}</div>
        <div class="actions"><button class="ghost" id="qrClose">关闭</button></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#qrClose').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  });

  // 分享卡：结果摘要（标题/成败/耗时/命令行截断）→ 纯文本，复制到剪贴板
  $('shareCardBtn')?.addEventListener('click', async () => {
    const last = (runStore[actionKey(plugin.id, action.id)] ?? []).at(-1);
    if (!last) {
      el.count.textContent = '还没有执行结果，先跑一次再分享';
      return;
    }
    const card = [
      `【${plugin.name} · ${action.title}】`,
      `结果：${last.ok ? '✓ 成功' : '✗ 失败'}　耗时 ${last.ms} ms`,
      last.stdout ? `输出：${String(last.stdout).slice(0, 200)}` : '',
      `来自 zerokit · ${new Date(last.ts).toLocaleString()}`,
    ].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(card);
      el.count.textContent = '分享卡已复制到剪贴板';
    } catch {
      window.__shareCardFallback = card;
      el.count.textContent = '复制被拒绝；已暂存（__shareCardFallback）';
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

  $('aliasInput')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const name = $('aliasInput').value.trim().toLowerCase();
    if (name) aliases[name] = aliasKey;
    else delete aliases[aliasName ?? ''];
    // 同名指向别的动作时先清掉旧指向
    for (const [k, v] of Object.entries(aliases)) {
      if (k !== name && v === aliasKey) delete aliases[k];
    }
    savePrefs();
    openDetail(plugin, action, prefill);
  });

  // 分享链接：带当前参数的完整深链（收的人打开就是填好的表单）
  $('shareBtn')?.addEventListener('click', () => {
    const vals = collectValues(action);
    const qs = Object.entries(vals).filter(([, v]) => v !== '' && v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
    const link = `${location.origin}${location.pathname}#/${plugin.id}/${action.id}${qs ? `?${qs}` : ''}`;
    navigator.clipboard?.writeText(link).then(() => {
      $('shareBtn').textContent = '已复制链接';
      setTimeout(() => { $('shareBtn').textContent = '分享'; }, 1500);
    }).catch(() => { window.__shareLinkFallback = link; alert('复制失败，链接已暂存：\n' + link); });
  });

  // 昵称：自己的叫法。搜索权重最高，列表里显示在原名旁
  $('nickInput')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const key = actionKey(plugin.id, action.id);
    const v = $('nickInput').value.trim();
    if (v) nicknames[key] = v;
    else delete nicknames[key];
    savePrefs();
    openDetail(plugin, action, prefill);
  });

  // 动作标签：自由打标，搜索与列表都认
  $('atagInput')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const key = actionKey(plugin.id, action.id);
    const list = $('atagInput').value.split(/[,，]/).map((x) => x.trim()).filter(Boolean).slice(0, 8);
    if (list.length) actionTags[key] = list;
    else delete actionTags[key];
    savePrefs();
    openDetail(plugin, action, prefill);
  });

  // 回看上次结果：直接用存的 data 渲染（不再发请求）
  $('peekLast')?.addEventListener('click', () => {
    const rec = (runStore[aliasKey] ?? []).at(-1);
    if (!rec) return;
    lastResult = { ok: rec.ok, ms: rec.ms, data: rec.data, stdout: rec.data === undefined ? '（上次输出未保存结构化数据）' : undefined, render: rec.data === undefined ? 'text' : 'json', ts: rec.ts };
    renderResult(lastResult);
    setTimeout(() => $('result')?.scrollIntoView({ block: 'start' }), 0);
  });

  // 昵称：自己的叫法。搜索权重最高，列表里显示在原名旁
  $('nickInput')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const key = actionKey(plugin.id, action.id);
    const v = $('nickInput').value.trim();
    if (v) nicknames[key] = v;
    else delete nicknames[key];
    savePrefs();
    openDetail(plugin, action, prefill);
  });
    savePrefs();
    openDetail(plugin, action);
  });
  renderRiskCard(plugin, action);
  renderRunHistory(plugin, action);
  el.detailView.querySelectorAll('input, select').forEach((node) => {
    node.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') submit(false); });
  });
  el.detailView.querySelector('input, select')?.focus();
}

function backToList() {
  detail = null;
  // 第十八轮①：离开详情页 = 离开监控对象，翻页自动停（监控只盯着当前动作）
  for (const k of Object.keys(watchRegistry())) stopWatch(k);
  renderWatchBar();
  // 浏览器后退语义：详情是用 pushState 压栈的，返回列表用 back 弹栈，
  // 这样浏览器/鼠标的后退键也能一步步走回来（而不是直接跳出到应用外）。
  if (/#\/[\w.-]+\/[\w.-]+/.test(location.hash || '')) {
    history.back();
    // history.back 是异步的：同步先把界面切回列表，hashchange 到来时幂等
    el.detailView.classList.add('hidden');
    el.detailView.innerHTML = '';
    el.listView.classList.remove('hidden');
    renderList();
    el.q.focus();
    return;
  }
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
  // 高风险动作的最后一道闸：输入动作原名才能跑。确认弹窗看得见命令行，
  // 但「看了一眼就点确认」的肌肉记忆挡不住——输入名字强迫停半秒。
  if (action.risk === 'destructive' && !window.__zkDestructiveOk) {
    const typed = prompt(`这是高风险动作。请输入动作名「${action.title}」以确认执行：`);
    if (typed !== action.title) {
      if (typed !== null) alert('输入的动作名不一致，已取消执行。');
      return null;
    }
    window.__zkDestructiveOk = true;
    setTimeout(() => { window.__zkDestructiveOk = false; }, 10_000);
  }
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

let submitInFlight = 0;

/** 第十九轮③：同动作执行时间戳（限速窗口），key 是 actionKey。 */
const rateWindow = {};

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
    <div class="help">递归删除、系统目录、格式化磁盘这类操作不可逆。确认命令与预期一致再继续。</div>
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

/** 队列可视化：连续触发执行时明确「排队中」，而不是看起来没反应。 */
/** 第十轮⑦：集市来源插件的更新检查——只比较版本号提示，绝不自动装。 */
async function checkPluginUpdate(p) {
  const btn = document.getElementById('plugUpdateBtn');
  if (!btn) return;
  btn.textContent = '检查中…';
  try {
    const token = document.querySelector('meta[name=zk-token]')?.content ?? '';
    const r = await fetch('/api/plugin/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zerokit-token': token },
      body: JSON.stringify({ plugin: p.id, dryRun: true }),
    });
    const j = await r.json();
    const remote = j?.plugin?.version ?? j?.version;
    if (!remote) { btn.textContent = '集市里没有这个插件'; return; }
    if (String(remote) === String(p.version)) { btn.textContent = '已是最新 ' + remote; return; }
    btn.textContent = `集市有新版 ${remote}（当前 ${p.version}）——去集市面板安装`;
    btn.onclick = () => { location.hash = '#/market'; };
  } catch {
    btn.textContent = '检查失败（稍后再试）';
  }
}

/** 第十轮⑤：每日简报——今天跑了多少、成败、最常用 top3、平均耗时。 */
function showBrief() {
  hidePanels();
  mode = 'brief';
  el.modeLabel.textContent = '简报';
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  if (location.hash !== '#/brief') history.replaceState(null, '', '#/brief');
  const b = dailyBrief(runStore, Date.now());
  const names = Object.fromEntries(entries.map((e) => [actionKey(e.plugin.id, e.action.id), e.action.title]));
  el.allowView.innerHTML = `
    <h2 class="ps-title">今日简报</h2>
    <div class="brief-grid">
      <div class="brief-cell">今天执行<b>${b.total}</b>次</div>
      <div class="brief-cell">成功<b class="ok">${b.ok}</b></div>
      <div class="brief-cell">失败<b class="${b.failed ? 'bad' : ''}">${b.failed}</b></div>
      <div class="brief-cell">平均耗时<b>${b.avgMs}ms</b></div>
    </div>
    ${b.top.length ? `<h3 class="plug-home-h">最常用</h3>
      <div class="usage-block">${b.top.map(([k, n]) => `
        <div class="run-row"><span class="run-when">${esc(names[k] ?? k)}</span><span class="badge">${n} 次</span></div>`).join('')}
      </div>` : '<div class="ps-empty" role="status">今天还没有执行记录——跑一个动作，这里就会有数据。</div>'}`;
  el.allowView.classList.remove('hidden');
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

/** 第十轮②：定时任务面板——列出所有在跑的 interval，一键停。 */
function timerRegistry() {
  if (!window.__zkTimers) window.__zkTimers = {};
  return window.__zkTimers;
}

/* ===================== 第十八轮：监控与自动化 ===================== */

/** 监控注册表：key = actionKey，value = { interval, failStreak, matchStr, samples[], title, deadline } */
function watchRegistry() {
  if (!window.__zkWatch) window.__zkWatch = {};
  return window.__zkWatch;
}

function stopWatch(key) {
  const reg = watchRegistry();
  const w = reg[key];
  if (!w) return;
  clearTimeout(w.timerId);
  clearInterval(w.timerId);
  delete reg[key];
  updateWatchTitle();
}

function updateWatchTitle() {
  // ⑦ 标签页标题带上监控数（与运行中进程数合并；fetchPs 也会写 title，两边都调这个）
  const n = Object.keys(watchRegistry()).length;
  const running = Number((document.title.match(/^\((\d+)\)/) ?? [])[1] ?? 0);
  document.title = tabTitle(n, running);
}

/** ①⑤ 监控设置弹窗：间隔档位 + 停止条件（连续失败 N 次 / 结果包含某串） */
function openWatchDialog(plugin, action, key) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const intervalOpts = WATCH_INTERVALS.map((o) =>
    `<option value="${o.sec}" ${o.sec === 30 ? 'selected' : ''}>${o.label}</option>`).join('');
  overlay.innerHTML = `
    <div class="modal">
      <h3>监控「${esc(action.title)}」</h3>
      <div class="help">界面开着才会跑。每次采样记录结果，变化会高亮，可在 #/watch 面板聚合查看。</div>
      <label class="field">重跑间隔
        <select id="wInterval">${intervalOpts}</select>
      </label>
      <label class="field">连续失败几次自动停（0 = 不停）
        <input id="wFail" type="number" min="0" max="10" value="3">
      </label>
      <label class="field">结果包含此串自动停（留空 = 不启用）
        <input id="wMatch" type="text" placeholder="如 error / 90%">
      </label>
      <div class="actions">
        <button class="primary" id="wStart">开始监控</button>
        <button class="ghost" id="wCancel">取消</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#wCancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#wStart').addEventListener('click', () => {
    const sec = Number(overlay.querySelector('#wInterval').value);
    const failStreak = Math.max(0, Number(overlay.querySelector('#wFail').value) || 0);
    const matchStr = overlay.querySelector('#wMatch').value.trim();
    overlay.remove();
    if (!sec) return;
    const reg = watchRegistry();
    reg[key] = {
      interval: sec,
      failStreak,
      matchStr,
      samples: [],
      title: `${plugin.name} · ${action.title}`,
      pluginId: plugin.id,
      actionId: action.id,
      deadline: Date.now() + sec * 1000,
      runs: 0,
      changes: 0,
    };
    scheduleWatch(key, sec);
    updateWatchTitle();
    renderWatchBar();
    el.count.textContent = `监控已开启：每 ${intervalLabel(sec)} 重跑一次（#/watch 面板聚合查看）`;
    // 立即采第一次样（不等第一个间隔），结果同样入序列——diff 要有基线
    submit(false).then(() => {
      const w2 = watchRegistry()[key];
      if (w2 && lastResult) {
        w2.samples.push({ ts: Date.now(), ok: lastResult.ok === true, data: lastResult.data });
        if (w2.samples.length > 30) w2.samples.shift();
      }
    }).catch(() => {});
  });
}

/** 间隔调度：用 setTimeout 链而不是 setInterval——执行耗时不会让两次采样叠在一起 */
function scheduleWatch(key, sec) {
  const reg = watchRegistry();
  const w = reg[key];
  if (!w) return;
  w.timerId = setTimeout(async () => {
    const cur = detail && actionKey(detail.plugin.id, detail.action.id) === key;
    const onPanel = mode === 'watch'; // 监控面板盯着它跑：不算「翻页」
    if (!cur && !onPanel) { // 真翻页了（别的动作/列表）：停掉（① 翻页自动停）
      stopWatch(key);
      renderWatchBar();
      return;
    }
    const prev = lastResult;
    await submit(false).catch(() => {});
    const now = lastResult;
    w.runs += 1;
    if (w.runs > 1 && prev && now && JSON.stringify(prev.data) !== JSON.stringify(now.data)) {
      w.changes += 1;
      notifyWatchChange(w, prev, now);
    }
    w.samples.push({ ts: Date.now(), ok: now?.ok === true, data: now?.data });
    if (w.samples.length > 30) w.samples.shift();
    // ⑤ 停止条件
    const stop = watchStopCondition(
      w.samples.map((s) => ({ ok: s.ok, data: s.data })),
      { failStreak: w.failStreak, matchStr: w.matchStr },
    );
    if (stop) {
      stopWatch(key);
      renderWatchBar();
      el.count.textContent = stop === 'stop-fail'
        ? `监控已自动停：连续 ${w.failStreak} 次失败`
        : '监控已自动停：结果命中了停止串';
      return;
    }
    w.deadline = Date.now() + sec * 1000;
    renderWatchBar();
    scheduleWatch(key, sec);
  }, sec * 1000);
}

/** ⑧ 变更通知：只在结果变化时打扰（不是每次采样都通知） */
function notifyWatchChange(w, prev, next) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    new Notification('zerokit 监控', {
      body: `⇄ ${w.title} 结果有变化（第 ${w.changes} 次）`,
      tag: `zk-watch-${w.title}`,
    });
  } catch { /* 通知失败不影响监控 */ }
}

/** ② 详情页监控条：间隔 + 倒计时环 + 已采样次数/变更次数 + 停止按钮 */
function renderWatchBar() {
  const bar = $('watchBar');
  if (!bar) return;
  const key = detail ? actionKey(detail.plugin.id, detail.action.id) : '';
  const w = key ? watchRegistry()[key] : null;
  if (!w) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  bar.classList.remove('hidden');
  const remain = Math.max(0, (w.deadline ?? Date.now()) - Date.now());
  const pct = Math.round((remain / (w.interval * 1000)) * 100);
  bar.innerHTML = `
    <span class="badge">⏱ 监控中</span>
    <span>每 ${esc(intervalLabel(w.interval))} · 已采样 ${w.runs} 次 · 变更 ${w.changes} 次</span>
    <svg class="watch-ring" viewBox="0 0 36 36" width="22" height="22" aria-hidden="true">
      <circle class="ring-bg" cx="18" cy="18" r="15.9"></circle>
      <circle class="ring-fg" cx="18" cy="18" r="15.9" style="stroke-dasharray:${pct} 100" title="下次执行倒计时"></circle>
    </svg>
    <span class="sub">${Math.ceil(remain / 1000)}s</span>
    <button class="ghost mini" id="watchStopBtn">停止</button>`;
  bar.querySelector('#watchStopBtn')?.addEventListener('click', () => {
    stopWatch(key);
    renderWatchBar();
    el.count.textContent = '监控已停止';
  });
  // 倒计时每秒刷一次环（只重画 bar，不重跑动作）
  clearTimeout(renderWatchBar._tick);
  if (watchRegistry()[key]) {
    renderWatchBar._tick = setTimeout(renderWatchBar, 1000);
  }
}

/** ⑥⑨ 监控聚合面板 #/watch：所有在跑的监控 + 采样 CSV 导出 */
function showWatchPanel() {
  hidePanels();
  mode = 'watch';
  el.modeLabel.textContent = '监控';
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  if (location.hash !== '#/watch') history.replaceState(null, '', '#/watch');
  const reg = watchRegistry();
  const rows = Object.entries(reg).map(([k, w]) => {
    const lastOk = w.samples.at(-1)?.ok !== false;
    const summary = w.samples.length
      ? `最近：${JSON.stringify(w.samples.at(-1)?.data ?? '').slice(0, 80)}`
      : '等待第一次采样…';
    return `
    <div class="run-row watch-row">
      <span class="badge ${lastOk ? 'read' : 'bad'}">⏱</span>
      <span class="run-when">${esc(w.title)}（每 ${esc(intervalLabel(w.interval))}）</span>
      <span class="sub">${w.runs} 次采样 · ${w.changes} 次变更</span>
      <span class="watch-summary">${esc(summary)}</span>
      <button class="ghost mini" data-wstop="${esc(k)}">停止</button>
      <button class="ghost mini" data-wcsv="${esc(k)}">导出 CSV</button>
    </div>`;
  }).join('');
  el.allowView.innerHTML = `
    <h2 class="ps-title">监控面板</h2>
    <div class="help">界面开着才会跑；翻到别的动作自动停。在只读动作详情页点「监控」添加。</div>
    ${rows || '<div class="ps-empty" role="status">没有在跑的监控。</div>'}`;
  el.allowView.classList.remove('hidden');
  el.allowView.querySelectorAll('[data-wstop]').forEach((b) => b.addEventListener('click', () => {
    stopWatch(b.dataset.wstop);
    showWatchPanel();
  }));
  el.allowView.querySelectorAll('[data-wcsv]').forEach((b) => b.addEventListener('click', () => {
    const w = watchRegistry()[b.dataset.wcsv];
    if (!w || !w.samples.length) { el.count.textContent = '还没有采样，导出啥呀'; return; }
    const csv = watchCsv(w.samples);
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `watch-${w.pluginId}-${w.actionId}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    el.count.textContent = `已导出 ${w.samples.length} 次采样 CSV`;
  }));
}

function showTimers() {
  hidePanels();
  mode = 'timers';
  el.modeLabel.textContent = '定时';
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  if (location.hash !== '#/timers') history.replaceState(null, '', '#/timers');
  const reg = timerRegistry();
  const rows = Object.entries(reg).map(([k, t]) => `
    <div class="run-row">
      <span class="badge">⏱</span>
      <span class="run-when">${esc(t.title)}（每 ${esc(String(t.interval))} 秒）</span>
      <button class="ghost mini" data-stop="${esc(k)}">停止</button>
    </div>`).join('');
  el.allowView.innerHTML = `
    <h2 class="ps-title">定时任务</h2>
    <div class="help">界面开着才会跑（关掉页面即停）。在只读动作详情页点「定时」添加。</div>
    ${rows || '<div class="ps-empty" role="status">没有在跑的定时任务。</div>'}`;
  el.allowView.classList.remove('hidden');
  el.allowView.querySelectorAll('[data-stop]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.stop;
    const t = timerRegistry()[k];
    if (t) { clearInterval(t.id); delete timerRegistry()[k]; }
    showTimers();
  }));
}

/** 第十轮①：执行完成桌面通知。授权失败/不支持则静默跳过（通知是增强，不是依赖）。 */
function notifyDone(plugin, action, res) {
  try {
    if (!('Notification' in window)) return;
    const fire = () => {
      try {
        // 第十七轮⑨：点击通知聚焦窗口并滚到结果卡（后台执行完不用再找窗口）
        const n = new Notification('zerokit', {
          body: `${res.ok === true ? '✓' : '✗'} ${plugin.name} · ${action.title}（${res.ms ?? '?'}ms）`,
          tag: 'zerokit-run',
        });
        n.addEventListener('click', () => {
          try { window.focus(); } catch { /* 最小化时可能失败 */ }
          const card = document.getElementById('result');
          if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'start' });
            card.classList.add('flash-card');
            setTimeout(() => card.classList.remove('flash-card'), 1200);
          }
        });
      } catch { /* 通知构造失败不影响主流程 */ }
    };
    if (Notification.permission === 'granted') fire();
    else if (Notification.permission === 'default') Notification.requestPermission().then((p2) => { if (p2 === 'granted') fire(); }).catch(() => {});
  } catch { /* no-op */ }
}

async function submit(remember) {
  submitInFlight++;
  const qEl = $('queueState');
  if (submitInFlight > 1 && qEl) {
    qEl.textContent = `⏳ 已有 ${submitInFlight - 1} 个在执行，本条排队中…`;
    qEl.classList.remove('hidden');
  }
  try {
    await submitInner(remember);
  } finally {
    submitInFlight = Math.max(0, submitInFlight - 1);
    if (submitInFlight === 0 && qEl) qEl.classList.add('hidden');
  }
}

async function submitInner(remember) {
  if (!detail) return;
  const { plugin, action } = detail;
  const btn = $('runBtn');
  if (btn) { btn.disabled = true; btn.textContent = '执行中…'; }
  try {
    $('previewBox').innerHTML = '';
    $('invokeBox').innerHTML = '';
    const values = collectValues(action);
    // 第十九轮②：危险参数值检测（黄条警示，可继续）
    for (const f of action.fields ?? []) {
      const why = dangerousPattern(values?.[f.name]);
      if (why && !window.__zkDangerAck) {
        showDangerNote(f, why, values?.[f.name]);
        return;   // 用户点「仍要执行」后走 __zkDangerAck 通道重进
      }
    }
    window.__zkDangerAck = false;
    // 第十九轮③：限速——同一动作 3 秒内第 3 次起要确认（防手抖连点/宏误触）
    const rk = actionKey(plugin.id, action.id);
    rateWindow[rk] = (rateWindow[rk] ?? []).filter((t) => Date.now() - t < 3000);
    if (rateLimitHits(rateWindow[rk], Date.now(), 3000, 2) && !window.__zkRateAck) {
      const go = confirm('同一个动作 3 秒内已执行 2 次。\n\n可能是手抖连点或宏误触——点「确定」继续执行，点「取消」停下。');
      if (!go) return;
      window.__zkRateAck = true;
      setTimeout(() => { window.__zkRateAck = false; }, 4000);
    }
    rateWindow[rk] = [...(rateWindow[rk] ?? []), Date.now()];
    const res = await executeAction(plugin, action, values, remember);
    if (!res) return;   // 用户在确认框点了取消，不算失败也不算成功
    lastValues = values;
    lastResult = res;
    renderResult(res);
    if (res.ok === true && action.risk === 'destructive') renderUndoHint(plugin, action);
    // 结果可能很长，直接把卡片顶部带进视野（否则用户以为「点了没反应」）
    if (res.ok === false && !window.__zkRetried) {
      const retryNote = document.createElement('div');
      retryNote.className = 'retry-note';
      retryNote.innerHTML = `<button class="ghost mini" id="autoRetryBtn">重试一次</button> <span class="help">失败动作可一键重跑（网络类动作偶发超时很常见）</span>`;
      setTimeout(() => {
        const box2 = $('result') ?? document.querySelector('.detail');
        box2?.appendChild(retryNote);
        retryNote.querySelector('#autoRetryBtn')?.addEventListener('click', () => {
          window.__zkRetried = true;
          try { submit(remember); } finally { setTimeout(() => { window.__zkRetried = false; }, 2000); }
        });
      }, 0);
    }
    setTimeout(() => $('result')?.scrollIntoView({ block: 'start' }), 0);
    rememberRecent(plugin.id, action.id);
    const secretNames = action.fields.filter((f) => f.secret).map((f) => f.name);
    paramStore = rememberParams(paramStore, actionKey(plugin.id, action.id), values, secretNames);
    runStore = pushRunHistory(runStore, actionKey(plugin.id, action.id), {
      ts: Date.now(), ok: res.ok === true, ms: res.ms ?? 0,
      data: res.data,   // 留着给「与最新对比」做逐格 diff
    }, 5);
    // 第十轮⑥：每动作保留最近 20 份（pushRunHistory 只保 5，这里放宽存储、展示仍取前 5）
    runStore[actionKey(plugin.id, action.id)] = trimRuns(runStore[actionKey(plugin.id, action.id)], 20);
    savePrefs();
    // 第十轮①：执行完成桌面通知（页面在后台时最有用；需用户授权）
    notifyDone(plugin, action, res);
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

// ---------------------------------------------------------------- 第十九轮：危险度卡与脱敏

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
    <div class="risk-bar"><span class="risk-fill" style="width:${action.risk === 'destructive' ? 100 : action.risk === 'mutate' ? 55 : 12}%;background:${barColor}"></span></div>
    <div class="risk-line">
      <span class="badge ${esc(action.risk)}">${esc(RISK_TEXT[action.risk] || action.risk)}</span>
      <span class="sub">${esc(why)}</span>
    </div>
    ${card.runs ? `<div class="risk-stats">历史 ${card.runs} 次 · 失败率 ${pct}%${pct >= 40 ? ' ⚠' : ''} · 平均 ${esc(formatMs(card.avgMs))}</div>` : '<div class="risk-stats sub">还没有执行记录——首次执行没有历史可参考。</div>'}`;
}

/** ④ 脱敏开关：默认打码。状态挂在 body data 上，renderResult / 日志渲染都读它。 */
function maskState() { return document.body.dataset.zkMask !== 'off'; }
function toggleMask() {
  document.body.dataset.zkMask = maskState() ? 'off' : 'on';
  const btn = $('maskBtn');
  if (btn) btn.textContent = maskState() ? '🕶 脱敏中' : '👁 已显示明文';
  // 当前结果重画一遍（历史记录里存的是原始 data，重画走同一脱敏管线）
  if (lastResult) renderResult(lastResult);
}

/** ⑧ 一键清除敏感痕迹：当前结果 + 运行历史参数（secret 字段）+ 导出记录。 */
function purgeSensitive() {
  if (!confirm('清除当前结果与本地运行历史（含参数记忆）？\n\n不可恢复。审计日志不受影响（那是插件的执行凭证）。')) return;
  lastResult = null;
  $('result')?.replaceChildren();
  for (const k of Object.keys(runStore)) {
    runStore[k] = runStore[k].map((r) => ({ ...r, data: undefined }));
  }
  localStorage.removeItem('zerokit.params');
  paramStore = {};
  savePrefs();
  renderRunHistory(detail?.plugin, detail?.action);
  el.count.textContent = '已清除：当前结果 + 运行历史数据 + 参数记忆';
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
  box.innerHTML = `<div class="run-head">最近执行${list.filter((r) => Array.isArray(r.data)).length >= 2 ? ' <button class="ghost mini" id="mergeHist" title="把最近两次表格结果按共同键列拼成一张表（左连接）">⊕ 合并视图</button>' : ''}</div>${list.map((r, i) => `
    <div class="run-row">
      <span class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'}</span>
      <span class="run-when">${esc(new Date(r.ts).toLocaleString())}</span>
      <span class="run-ms">${esc(String(r.ms))} ms</span>
      <button class="ghost" data-rerun>重跑</button>${list.length >= 2 ? `
      <button class="ghost" data-diff="${i}" ${i === 0 ? 'disabled title="这就是最新一次，选更早的一条来对比"' : 'title="和最新一次的结果逐格对比"'}>与最新对比</button>` : ''}
      <button class="ghost mini" data-pick="${i}" title="选进 A/B 对比槽">选比</button>
    </div>`).join('')}
    <div class="help" id="diffPickHint" style="margin-top:4px"></div>`;
  box.querySelectorAll('[data-rerun]').forEach((b) => b.addEventListener('click', () => submit(false)));
  // A/B 槽：任选两次对比（第九轮④）
  if (!window.__diffPicks) window.__diffPicks = [];
  box.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    const i2 = Number(b.dataset.pick);
    const picks = window.__diffPicks;
    if (picks.includes(i2)) { picks.splice(picks.indexOf(i2), 1); }
    else { picks.push(i2); if (picks.length > 2) picks.shift(); }
    const hint = $('diffPickHint');
    if (hint) hint.textContent = picks.length === 2
      ? `已选第 ${picks[0] + 1}、${picks[1] + 1} 条（从上往下数）——再点一次任意已选条目取消`
      : `已选 ${picks.length}/2 条`;
    if (picks.length === 2) {
      const [ia, ib] = picks;
      if (list[ia]?.data !== undefined && list[ib]?.data !== undefined) showResultDiff(list[ia].data, list[ib].data, { slotA: ia, slotB: ib });
      else alert('这两次记录没存结果数据（可能是老记录），重跑一次后再对比。');
      window.__diffPicks = [];
      if (hint) hint.textContent = '';
    }
  }));
  box.querySelectorAll('[data-diff]').forEach((b) => b.addEventListener('click', () => {
    const older = list[Number(b.dataset.diff)];
    const latest = list[0];
    const a = latest.data ?? currentResult?.data;
    if (a === undefined || older.data === undefined) {
      alert('这两次记录没存结果数据（可能是老记录），重跑一次后再对比。');
      return;
    }
    showResultDiff(a, older.data);
  }));
  // 第十六轮⑤：合并视图——勾两条记录按共同键列拼成一张表（左连接，同名列加 _2 后缀）
  $('mergeHist')?.addEventListener('click', () => {
    const rows0 = list.filter((r) => Array.isArray(r.data) && r.data.length && typeof r.data[0] === 'object');
    if (rows0.length < 2) { el.count.textContent = '至少要有两次「表格结果」才能合并（先各跑一次）'; return; }
    const colsOf = (rs) => { const cs = []; for (const row of rs[0].data) for (const k of Object.keys(row ?? {})) if (!cs.includes(k)) cs.push(k); return cs; };
    const c1 = colsOf([rows0[0]]), c2 = colsOf([rows0[1]]);
    const common = c1.filter((c) => c2.includes(c));
    const key = common[0] ?? c1[0];
    const merged = mergeTables(rows0[0].data, rows0[1].data, key, common[0] ? key : c2[0]);
    if (!merged) { el.count.textContent = '合并失败：数据形状不对'; return; }
    // 合并结果作为一张普通表格渲染进结果卡，可继续排序/筛选/导出
    renderResult({ ok: true, ms: 0, data: merged, render: undefined,
      note: `合并视图：第 1、2 条记录按「${key}」列拼接（左连接）` });
    el.count.textContent = `已合并 ${merged.length} 行（按「${key}」列；同名列加了 _2 后缀）`;
  });
}

const HOTKEYS = ['F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12'];

function hotkeyMap() { return readJson(PREF.hotkeys, {}); }

function hotkeyFor(key) {
  const m = hotkeyMap();
  for (const [hk, k] of Object.entries(m)) if (k === key) return hk;
  return null;
}

/** 给当前动作挑一个功能键；被占用的键会显示成「被 XX 占用」，点了就换绑 */
function bindHotkey(actionKeyStr, title) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const m = hotkeyMap();
  overlay.innerHTML = `
    <div class="modal">
      <h3>绑定到 ${esc(title)}</h3>
      <div class="hk-grid">${HOTKEYS.map((hk) => {
        const owner = m[hk];
        return `<button class="ghost hk${owner === actionKeyStr ? ' on' : ''}" data-hk="${hk}">
          ${hk}${owner && owner !== actionKeyStr ? '<span class="hk-owner">已占用</span>' : ''}</button>`;
      }).join('')}</div>
      <div class="actions"><button class="ghost" id="hkClear">解除绑定</button>
        <button class="ghost" id="hkClose">关闭</button></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-hk]');
    if (btn) {
      const hk = btn.dataset.hk;
      const map = hotkeyMap();
      // 一个键只绑一个动作；换绑时清掉旧的
      for (const [k, v] of Object.entries(map)) if (v === actionKeyStr) delete map[k];
      map[hk] = actionKeyStr;
      writeJson(PREF.hotkeys, map);
      overlay.remove();
      const hint = $('hkHint');
      if (hint) hint.textContent = `当前绑定：${hk}`;
    } else if (e.target.id === 'hkClear') {
      const map = hotkeyMap();
      for (const [k, v] of Object.entries(map)) if (v === actionKeyStr) delete map[k];
      writeJson(PREF.hotkeys, map);
      overlay.remove();
      const hint = $('hkHint');
      if (hint) hint.textContent = '未绑定（F1–F12）';
    } else if (e.target === overlay || e.target.id === 'hkClose') overlay.remove();
  });
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

let currentResult = null;
let lastExport = null;  // 第十七轮④⑥：最近一次导出（文件名/大小/内容），供「外部接力」用
function refreshResult() {
  if (currentResult) renderResult(currentResult);
}

/** 结果卡右键菜单：复制行/表格/Markdown/CSV/JSON/文本——工具条太长，右键是补充入口 */
function bindResultMenu(box, res) {
  box.addEventListener('contextmenu', (ev) => {
    if (!ev.target.closest('.card')) return;
    ev.preventDefault();
    const old = document.getElementById('resMenu');
    if (old) old.remove();
    const menu = document.createElement('div');
    menu.className = 'res-menu';
    menu.id = 'resMenu';
    const isTable = Array.isArray(res.data) && res.data.length && typeof res.data[0] === 'object';
    const acts = RESULT_ACTIONS.filter((a) => a.needs === 'any' || (a.needs === 'table' && isTable));
    menu.innerHTML = acts.map((a) => `<div class="res-menu-item" data-mid="${a.id}">${a.label}</div>`).join('');
    menu.style.left = `${Math.min(ev.clientX, window.innerWidth - 220)}px`;
    menu.style.top = `${Math.min(ev.clientY, window.innerHeight - 40 * acts.length)}px`;
    document.body.appendChild(menu);
    const close = () => menu.remove();
    setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
    menu.querySelectorAll('[data-mid]').forEach((it) => it.addEventListener('click', () => {
      const id = it.dataset.mid;
      const tr = it.closest('.res-menu') ? null : null;
      const row = ev.target.closest('tr');
      const tbl = ev.target.closest('table.grid');
      if (id === 'copyRow' && row) {
        const cells = [...row.querySelectorAll('td')].map((td) => td.textContent).join('\t');
        navigator.clipboard?.writeText(cells);
      } else if (id === 'copyTable' && tbl) {
        const lines = [...tbl.querySelectorAll('tr')].map((tr2) => [...tr2.querySelectorAll('th,td')].map((c) => c.textContent).join('\t'));
        navigator.clipboard?.writeText(lines.join('\n'));
      } else if (id === 'copyMarkdown' && Array.isArray(res.data)) {
        navigator.clipboard?.writeText(markdownTable(res.data));
      } else if (id === 'csv') {
        downloadCsv(res.data);
      } else if (id === 'copyJson') {
        navigator.clipboard?.writeText(res.data !== undefined ? JSON.stringify(res.data, null, 2) : (res.stdout ?? ''));
      } else if (id === 'copyText') {
        navigator.clipboard?.writeText(res.data !== undefined ? JSON.stringify(res.data, null, 2) : (res.stdout ?? ''));
      }
      close();
    }));
  });
}

function downloadCsv(data) {
  const { toCsv } = window.__zerokit;
  const blob = new Blob(['\ufeff' + toCsv(data)], { type: 'text/csv;charset=utf-8' });  // BOM：Excel 双击打开不乱码
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zerokit-${detail ? `${detail.plugin.id}-${detail.action.id}` : 'result'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function renderResult(res) {
  currentResult = res;
  if (res && (res.data !== undefined || res.stdout !== undefined || res.error)) lastResult = res;   // 第十九轮④：脱敏切换重画用
  lastExport = null;  // 第十七轮④⑥：每次新结果清掉旧导出记录
  const box = $('result');
  if (!box) return;
  const head = res.ok
    ? `<span class="ok">✓ 成功</span><span class="sr-only" role="status">动作完成，${res.ms !== undefined ? `耗时 ${formatMs(res.ms)}` : '无耗时数据'}</span>`
    : `<span class="bad">✗ 失败</span><span class="sr-only" role="status">动作失败${res.error ? '：' + esc(String(res.error).slice(0, 80)) : ''}</span>`;
  // 统一毫秒展示 + 「慢于平常」：超该动作历史 P95 才亮（历史 ≥3 次才参与判断）
  const ms = res.ms !== undefined ? formatMs(res.ms) : '';
  const slowBadge = (() => {
    if (res.ms === undefined || !detail) return '';
    const hist = (runStore[actionKey(detail.plugin.id, detail.action.id)] ?? [])
      .slice(0, -1); // 不含本次
    if (hist.length < 3) return '';
    const p95 = p95Ms(hist);
    return (p95 !== null && res.ms > p95)
      ? `<span class="badge slow" title="慢于该动作历史 P95（${formatMs(p95)}）">🐢 慢于平常</span>`
      : '';
  })();

  let body = '';
  // 第十九轮④：文本输出默认脱敏（token/Bearer/长 hex 打码；开关在 actions 区 🕶）
  const masked = (t) => (maskState() ? maskSecrets(t) : String(t ?? ''));
  if (res.error) {
    body += `<pre class="out" style="color:var(--bad)">${esc(masked(res.error))}</pre>`;
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
    body += renderData(res.data, res.render, `r${++resultSeq}`);
  } else if (res.stdout) {
    // 长输出折叠：超 60 行时收起后 40+ 行，一个按钮展开——翻 2000 行日志不废手
    const lines = String(res.stdout).split('\n');
    if (lines.length > 60) {
      const shown = lines.slice(0, 60).join('\n');
      const rest = lines.slice(60).join('\n');
      const id = `fold${++resultSeq}`;
      body += `<pre class="out">${esc(masked(shown))}`
        + `<span class="fold-hint">… 还有 ${lines.length - 60} 行</span>`
        + `<button class="fold-btn" data-fold="${id}">展开全部</button>`
        + `<span class="fold-rest hidden" id="${id}">${esc(masked(rest))}</span></pre>`;
    } else {
      body += `<pre class="out">${esc(masked(res.stdout))}</pre>`;
    }
  }
  if (res.truncated && res.artifactPath) {
    body += `<div class="cmd-line">输出过长已截断，完整内容：${esc(res.artifactPath)}</div>`;
  }
  if (res.stderr && !res.ok) {
    body += `<pre class="out" style="color:var(--fg-dim)">${esc(res.stderr)}</pre>`;
  }
  if (!body) body = `<div class="help">（没有输出）</div>`;
  // 第十六轮⑤：合并视图等场景的来源说明（顶在结果卡里，让人知道这张表从哪来）
  const srcNote = res.note ? `<div class="detail-note">📌 ${esc(res.note)}</div>` : '';

  // 第十八轮③④：监控模式下的变更 diff 高亮 + 数值 sparkline。
  // 与前次采样对比：表格逐格（data-key 定位）、键值逐项（data-k 定位）。
  let watchNote = '';
  const wkey = detail ? actionKey(detail.plugin.id, detail.action.id) : '';
  const watch = wkey ? watchRegistry()[wkey] : null;
  if (watch && watch.samples.length >= 1 && res.ok === true) {
    // 注意：此刻新结果尚未 push 进 samples（push 在调度回调里做），上一采样就是最后一个（.at(-1)）
    const prevSample = watch.samples.at(-1)?.data;
    const diffs = [];
    if (Array.isArray(res.data) && res.data.length && typeof res.data[0] === 'object') {
      // 表格：按主键列（第一列）对齐逐格比
      const prevMap = new Map((Array.isArray(prevSample) ? prevSample : []).map((r) => [String(Object.values(r)[0]), r]));
      for (const row of res.data) {
        const pk = String(Object.values(row)[0]);
        const pr = prevMap.get(pk);
        if (!pr) continue;
        for (const [k, v] of Object.entries(row)) {
          const d = cellDiff(pr[k], v);
          if (d) diffs.push({ sel: `[data-dcell="${esc(pk)}|${esc(k)}"]`, txt: d, col: k, val: v });
        }
      }
    } else if (res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
      for (const [k, v] of Object.entries(res.data)) {
        const d = cellDiff(prevSample?.[k], v);
        if (d) diffs.push({ sel: `[data-dkv="${esc(k)}"]`, txt: d, col: k, val: v });
      }
    }
    if (diffs.length) {
      watchNote = `<div class="watch-diff-note">⇄ ${diffs.length} 处变化（黄色高亮）</div>`;
      setTimeout(() => {
        for (const d of diffs) {
          const td = box.querySelector(d.sel);
          if (!td) continue;
          td.classList.add('cell-changed');
          td.title = d.txt;
          const tag = document.createElement('span');
          tag.className = 'diff-tag';
          tag.textContent = d.txt.slice(0, 40);
          td.appendChild(tag);
        }
      }, 0);
    }
    // ④ 数值列 sparkline：每个数值字段一条（取最近 20 次采样）
    setTimeout(() => {
      const numericKeys = new Set();
      for (const s of watch.samples.slice(-20)) {
        if (s.data && typeof s.data === 'object' && !Array.isArray(s.data)) {
          for (const [k, v] of Object.entries(s.data)) {
            if (Number.isFinite(Number(v)) && String(v).trim() !== '') numericKeys.add(k);
          }
        }
      }
      for (const k of numericKeys) {
        const host = box.querySelector(`[data-dkv="${esc(k)}"]`)?.parentElement;
        if (!host || host.querySelector('.watch-spark')) continue;
        const series = sparkSeries(watch.samples.slice(-20).map((s) => Number(s.data?.[k])));
        if (!series) continue;
        const spark = document.createElement('span');
        spark.className = 'watch-spark';
        spark.title = `最近 ${series.length} 次趋势`;
        spark.innerHTML = miniSparkSvg(series);
        host.appendChild(spark);
      }
      // 表格动作的数值列 spark：监控采样是表数组时，按主键行对齐逐列画（挂在表头 th 里）
      if (Array.isArray(res.data) && res.data.length && typeof res.data[0] === 'object') {
        const cols = Object.keys(res.data[0]);
        const byKey = new Map(watch.samples.slice(-20).map((s) => {
          const rows = Array.isArray(s.data) ? s.data : [];
          return [s.ts, new Map(rows.map((r) => [String(Object.values(r)[0]), r]))];
        }));
        const headRow = box.querySelector('.result-table thead tr, table thead tr');
        if (headRow) {
          for (const col of cols) {
            const sampleVals = watch.samples.slice(-20).map((s) => {
              const rows = Array.isArray(s.data) ? s.data : [];
              const first = rows[0];
              return Number(first?.[col]);
            });
            if (!sampleVals.some((v) => Number.isFinite(v))) continue;
            const series = sparkSeries(sampleVals);
            if (!series) continue;
            const th = headRow.querySelector(`th:nth-child(${cols.indexOf(col) + 1})`);
            if (!th || th.querySelector('.watch-spark')) continue;
            const spark = document.createElement('span');
            spark.className = 'watch-spark';
            spark.title = `首行「${col}」最近 ${series.length} 次趋势`;
            spark.innerHTML = miniSparkSvg(series);
            th.appendChild(spark);
          }
        }
      }
    }, 0);
  }

  const copyText = res.data !== undefined ? JSON.stringify(res.data, null, 2) : (res.stdout ?? '');
  box.innerHTML = `
    <div class="card">
      <div class="card-head" id="cardHead" title="点这里折叠 / 展开结果">${head}${slowBadge}
        <span style="margin-left:auto" class="aid">${esc(res.command || '')}</span>
        <button class="ghost" id="cardFold" title="折叠 / 展开结果">收起</button>
      </div>
      <div class="result-tools">
        <button class="ghost" id="copyRes" title="把结果复制到剪贴板">复制</button>
        <button class="ghost" id="saveRes" title="把结果存成文本文件">下载</button>
        <button class="ghost" id="mdRes" title="导出成 Markdown（表格/代码块），方便贴进文档或 Issue">导出 Markdown</button>
        ${res.data !== undefined ? `<button class="ghost" id="csvRes" title="导出成 CSV，Excel / Numbers 直接打开">导出 CSV</button>
        <button class="ghost" id="jsonRes" title="导出成 JSON，给脚本接着处理">导出 JSON</button>
        ${toJsonl(res.data) ? `<button class="ghost" id="jsonlRes" title="导出 JSONL（每行一个 JSON，jq / ndjson 友好）">导出 JSONL</button>` : ''}` : ''}
        ${Array.isArray(res.data) && res.data.length && typeof res.data[0] === 'object' ? `<button class="ghost" id="mdTableRes" title="复制为 Markdown 表格（数字列右对齐）">复制 MD 表</button>
        <button class="ghost" id="tsvRes" title="复制为 TSV（Excel/Numbers 直接粘贴）">复制 TSV</button>
        <button class="ghost" id="htmlRes" title="复制为 HTML 表格（贴进邮件/文档带格式）">复制 HTML 表</button>` : ''}
        <button class="ghost" id="termRes" title="终端模式查看：等宽字体、自动滚到底（进入后 w=换行开关 t=顶 b=底）">终端</button>
        <button class="ghost" id="editRes" title="把结果文本丢给外部编辑器（ZEROKIT_EDITOR 环境变量，没配用系统默认）">编辑器打开</button>
        <button class="ghost" id="againRes" title="用同样的参数再跑一次">再跑一次</button>
        <button class="ghost" id="pinRes" title="把这条结果钉进收藏夹（#/saved），重启后还在">收藏</button>
        <button class="ghost" id="noteRes" title="给这次执行写一句备注（本机保存）">备注</button>
        <span class="ms">${esc(ms)}</span>
      </div>
      <div class="card-body">${srcNote}${watchNote}${body}</div>
      <div class="export-path sub hidden" role="status" style="padding:2px 10px"> </div>
      <div class="export-actions hidden" style="padding:0 10px 6px"><button class="ghost mini" id="openDirRes" title="在系统文件管理器里打开导出目录">打开目录</button></div>
      <div class="card-find">
        <input id="findInResult" type="text" placeholder="在结果里找…（实时高亮，Enter 下一个）" autocomplete="off" spellcheck="false">
        <span class="sub" id="findCount"></span>
      </div>
      <div id="noteBox" class="note-box hidden">
        <input id="noteInput" type="text" placeholder="备注：这次执行有什么值得记的？（存本机）" autocomplete="off">
        <button class="primary" id="noteSave">保存</button>
      </div>
    </div>`;

  $('copyRes')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    // 第十七轮①②：清单 copy_template 优先；Shift+点=美化 JSON（默认紧凑）
    let text = copyText;
    if (detail?.action?.copy_template) {
      const rendered = renderCopyTemplate(detail.action.copy_template, res);
      if (rendered !== null) text = rendered;
    } else if (ev.shiftKey && res.data !== undefined) {
      text = JSON.stringify(res.data, null, 2);
    }
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = ev.shiftKey ? '已复制(缩进)' : '已复制';
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
  // ⑤ 卡内查找：用 Highlight API 的兜底方案——把命中文本包成 <mark>
  $('findInResult')?.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    const card = box.querySelector('.card-body');
    if (!card) return;
    const marks = [...card.querySelectorAll('mark.find-hit')];
    if (!marks.length) return;
    const idx = Number(card.dataset.findIdx || '0');
    const next = (idx + (ev.shiftKey ? marks.length - 1 : 1)) % marks.length;
    card.dataset.findIdx = String(next);
    marks[next].scrollIntoView({ block: 'center' });
    marks.forEach((m2, i) => m2.classList.toggle('cur', i === next));
    $('findCount').textContent = `${next + 1}/${marks.length}`;
  });
  $('findInResult')?.addEventListener('input', () => {
    const card = box.querySelector('.card-body');
    const needle = $('findInResult').value.trim();
    // 先还原上次的高亮（缓存原始 HTML 代价高；用 mark/data 反解不可靠，直接重渲染）
    if (!card) return;
    if (!card.dataset.orig) card.dataset.orig = card.innerHTML;
    if (!needle) { card.innerHTML = card.dataset.orig; $('findCount').textContent = ''; return; }
    try {
      const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      // 只处理文本节点，避免把标签剪坏
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
      const texts = [];
      while (walker.nextNode()) texts.push(walker.currentNode);
      let hits = 0;
      for (const node of texts) {
        if (!node.textContent.toLowerCase().includes(needle.toLowerCase())) continue;
        const frag = document.createDocumentFragment();
        let rest = node.textContent;
        let m2;
        re.lastIndex = 0;
        let last = 0;
        while ((m2 = re.exec(rest))) {
          frag.append(rest.slice(last, m2.index));
          const mark = document.createElement('mark');
          mark.className = 'find-hit';
          mark.textContent = m2[0];
          frag.append(mark);
          hits++;
          last = m2.index + m2[0].length;
          if (m2[0].length === 0) re.lastIndex++;
        }
        frag.append(rest.slice(last));
        node.replaceWith(frag);
      }
      $('findCount').textContent = hits ? `${hits} 处` : '没有命中';
      card.dataset.findHits = String(hits);
      card.dataset.findIdx = '0';
      card.querySelector('mark.find-hit')?.scrollIntoView({ block: 'nearest' });
    } catch { /* 非法正则已在上面转义，到这里就算了 */ }
  });

  // ⑨ 折叠结果：大结果看完一眼就可以收起来，参数还在上面可以改了重跑
  $('cardFold')?.addEventListener('click', () => {
    const bodyEl = box.querySelector('.card-body');
    const find = box.querySelector('.card-find');
    const btn = $('cardFold');
    const folded = bodyEl.classList.toggle('hidden');
    find?.classList.toggle('hidden', folded);
    if (btn) btn.textContent = folded ? '展开' : '收起';
  });

  $('termRes')?.addEventListener('click', () => {
    const body = box.querySelector('.card-body');
    if (!body) return;
    body.classList.toggle('term-mode');
    if (body.classList.contains('term-mode')) {
      body.scrollTop = body.scrollHeight;
      // 第十七轮⑦：终端模式键盘——w 换行开关 / t 跳顶 / b 跳底（不抢输入框）
      if (!body.dataset.termBound) {
        body.dataset.termBound = '1';
        body.tabIndex = 0;
        body.addEventListener('keydown', (ke) => {
          if (ke.key !== 'w' && ke.key !== 't' && ke.key !== 'b') return;
          if (ke.target.tagName === 'INPUT' || ke.target.tagName === 'TEXTAREA') return;
          ke.preventDefault();
          if (ke.key === 'w') body.classList.toggle('term-wrap');
          else if (ke.key === 't') body.scrollTop = 0;
          else body.scrollTop = body.scrollHeight;
        });
      }
      body.focus();
    }
  });
  // 第十七轮⑤⑥：外部接力——编辑器打开 + 打开导出目录（走服务端 API，路径白名单在那边）
  $('editRes')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.textContent = '打开中…';
    try {
      const r = await api('/api/edit', { method: 'POST', body: { text: copyText, name: lastExport?.name ?? (detail ? `${detail.plugin.id}-${detail.action.id}.txt` : 'result.txt') } });
      el.count.textContent = `已在编辑器打开：${r.file ?? ''}`;
      btn.textContent = '已打开';
    } catch (e) {
      el.count.textContent = `编辑器打不开：${String(e.message || e).slice(0, 120)}`;
      btn.textContent = '失败';
    }
    setTimeout(() => { const b = $('editRes'); if (b) b.textContent = '编辑器打开'; }, 1600);
  });
  $('openDirRes')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    try {
      const r = await api('/api/open', { method: 'POST', body: (lastExport?.dir || window.__zkExportsDir) ? { target: lastExport?.dir ?? window.__zkExportsDir } : { dir: 'exports' } });
      el.count.textContent = `已在文件管理器打开：${r.opened ?? ''}`;
      btn.textContent = '已打开';
    } catch (e) {
      el.count.textContent = `目录打不开：${String(e.message || e).slice(0, 120)}`;
      btn.textContent = '失败';
    }
    setTimeout(() => { const b = $('openDirRes'); if (b) b.textContent = '打开目录'; }, 1600);
  });
  $('mdTableRes')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    try { await navigator.clipboard.writeText(markdownTable(res.data)); btn.textContent = '已复制'; }
    catch { btn.textContent = '失败'; }
    setTimeout(() => { btn.textContent = '复制 MD 表'; }, 1500);
  });
  $('tsvRes')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    try { await navigator.clipboard.writeText(tsvTable(res.data)); btn.textContent = '已复制'; }
    catch { btn.textContent = '失败'; }
    setTimeout(() => { btn.textContent = '复制 TSV'; }, 1500);
  });
  $('mdTableRes')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    try { await navigator.clipboard.writeText(markdownTable(res.data)); btn.textContent = '已复制'; }
    catch { btn.textContent = '失败'; }
    setTimeout(() => { btn.textContent = '复制 MD 表'; }, 1500);
  });
  $('tsvRes')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    try { await navigator.clipboard.writeText(tsvTable(res.data)); btn.textContent = '已复制'; }
    catch { btn.textContent = '失败'; }
    setTimeout(() => { btn.textContent = '复制 TSV'; }, 1500);
  });
  $('againRes')?.addEventListener('click', () => submit(false));
  $('pinRes')?.addEventListener('click', () => {
    if (!detail) return;
    savedList.unshift({
      key: actionKey(detail.plugin.id, detail.action.id),
      plugin: detail.plugin.name,
      action: detail.action.title,
      command: res.command || '',
      ok: Boolean(res.ok),
      ms: res.ms ?? null,
      ts: Date.now(),
      data: res.data,
      stdout: res.stdout,
    });
    savedList = savedList.slice(0, 50);
    writeJson(PREF.saved, savedList);
    const btn = $('pinRes');
    if (btn) { btn.textContent = '已收藏'; btn.disabled = true; }
  });
  $('noteRes')?.addEventListener('click', () => {
    const box = $('noteBox');
    if (!box) return;
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) {
      const k = detail ? actionKey(detail.plugin.id, detail.action.id) : '';
      $('noteInput').value = notesStore[k]?.text ?? '';
      $('noteInput').focus();
    }
  });
  $('noteSave')?.addEventListener('click', () => {
    if (!detail) return;
    const k = actionKey(detail.plugin.id, detail.action.id);
    const text = $('noteInput').value.trim();
    if (text) notesStore[k] = { text, ts: Date.now() };
    else delete notesStore[k];
    writeJson(PREF.notes, notesStore);
    const box = $('noteBox');
    if (box) box.classList.add('hidden');
    // 详情页头部显示备注（下次打开还能看见）
    const head = document.querySelector('.detail-note');
    if (head) {
      head.textContent = text ? `📌 ${text}` : '';
      head.classList.toggle('hidden', !text);
    }
  });

  const exportAs = (btnId, text, mime, ext) => {
    $(btnId)?.addEventListener('click', async () => {
      const blob = new Blob([text], { type: `${mime};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // 第十七轮④：可预测文件名 插件-动作-时间戳.扩展名（取代随机/固定名，批量导出不混淆）
      a.download = exportFilename(detail?.plugin?.id, detail?.action?.id, ext);
      lastExport = { name: a.download, mime: `${mime};charset=utf-8`, size: blob.size, text };
      const pathRow = box.querySelector('.export-path');
      if (pathRow) {
        pathRow.textContent = `已导出：${a.download}（${Math.max(1, Math.round(blob.size / 1024))} KB）`;
        pathRow.classList.remove('hidden');
      }
      const actRow = box.querySelector('.export-actions');
      if (actRow) actRow.classList.remove('hidden');
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const btn = $(btnId);
      if (btn) { const t = btn.textContent; btn.textContent = '已导出'; setTimeout(() => { btn.textContent = t; }, 1500); }
    });
  };
  if (res.data !== undefined) {
    exportAs('csvRes', '\ufeff' + toCsv(res.data), 'text/csv;charset=utf-8', 'csv');  // BOM：Excel 中文不乱码
    exportAs('jsonRes', JSON.stringify(res.data, null, 2), 'application/json', 'json');
    // 第十七轮③：JSONL 导出（每行一个对象，jq / ndjson 友好）
    const jsonl = toJsonl(res.data);
    if (jsonl) exportAs('jsonlRes', jsonl, 'application/x-ndjson', 'jsonl');
  }
  // 第十六轮⑧：复制 HTML 表格——贴进邮件/文档带格式（writeText 写纯 HTML 源，富文本粘贴由目标应用解析）
  $('htmlRes')?.addEventListener('click', async (ev) => {
    if (!Array.isArray(res.data)) return;
    const html = toHtmlTable(res.data, detail ? `${detail.plugin.name} · ${detail.action.title}` : 'zerokit 结果');
    try {
      await navigator.clipboard.writeText(html);
      ev.currentTarget.textContent = '已复制';
    } catch { ev.currentTarget.textContent = '复制失败'; }
    setTimeout(() => { const b = $('htmlRes'); if (b) b.textContent = '复制 HTML 表'; }, 1500);
  });

  // web 面的 iframe 加载完就发执行上下文（页面里的 hello 握手是双保险）
  const frame = box.querySelector('.web-frame:not(.html)');
  if (frame) frame.addEventListener('load', () => sendContext(frame));
  box.querySelectorAll('.fold-btn').forEach((b) => b.addEventListener('click', () => {
    const rest = document.getElementById(b.dataset.fold);
    if (rest) rest.classList.remove('hidden');
    b.remove();
  }));
  bindTableSorts(box);
  bindResultMenu(box, res);
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
    const blob = new Blob([md], { type: 'text/markdown' });
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

let resultSeq = 0;
function barsData(data) {
  // [{label,value}] 直接用；{label:[], value:[]} 平行数组转一下；其余返回 null
  if (Array.isArray(data)) {
    return data.every((r) => r && typeof r === 'object' && 'value' in r) ? data : null;
  }
  if (data && Array.isArray(data.label) && Array.isArray(data.value)
      && data.label.length === data.value.length) {
    return data.label.map((l, i) => ({ label: l, value: data.value[i] }));
  }
  return null;
}

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

function renderData(data, render, tableId = '') {
  if (render === 'bars') {
    const rows = barsData(data);
    if (rows) return renderBars(rows);
    // 数据形状不对时降级成默认渲染，不把用户晾在空卡片前
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return `<div class="help">（空结果）</div>`;
    if (typeof data[0] === 'object' && data[0] !== null) return renderTable(data, tableId);
    return `<pre class="out">${esc(data.join('\n'))}</pre>`;
  }
  if (data && typeof data === 'object') {
    if (render === 'json') {
      // 折叠树：键多/嵌套深时树比一整坨 JSON 可读；浅对象仍走 KV
      const lines = jsonTreeLines(data);
      const deep = lines.some((l) => l.depth >= 1);
      if (deep) {
        const id = `jt${++resultSeq}`;
        return `<div class="json-tree" id="${id}">${lines.map((l, i) => `
          <div class="jt-row${l.isLeaf ? ' leaf' : ' branch'}" data-jt="${i}" style="padding-left:${l.depth * 14}px">
            ${l.isLeaf ? '' : '<i class="jt-dot">▾</i>'}${l.key !== '' ? `<b>${esc(l.key)}</b>: ` : ''}<span>${esc(maskState() ? maskSecrets(l.preview) : l.preview)}</span>
          </div>`).join('')}</div>`;
      }
      return `<pre class="out">${esc(maskState() ? maskSecrets(JSON.stringify(data, null, 2)) : JSON.stringify(data, null, 2))}</pre>`;
    }
    return renderKV(data);
  }
  return `<pre class="out">${esc(String(data))}</pre>`;
}

function renderKV(obj) {
  const rows = Object.entries(obj).map(([k, v]) => {
    // 第十九轮④：字符串值默认脱敏（长 hex / token 形态打码；结构化对象先 JSON 化）
    const raw = (v && typeof v === 'object') ? JSON.stringify(v) : String(v);
    const val = (maskState() && typeof v === 'string') ? maskSecrets(raw) : raw;
    const num = typeof v === 'number' || /^[\d.,\s%]+$/.test(val) ? ' class="num"' : '';
    // 第十八轮③④：键级锚点（监控 diff 高亮 / sparkline 挂载用）
    return `<tr><td>${esc(k)}</td><td${num} data-dkv="${esc(k)}">${esc(val)}</td></tr>`;
  }).join('');
  return `<table class="kv">${rows}</table>`;
}

/** 第十八轮④：0–100 归一化序列 → 60×18 的迷你 SVG 折线（结果卡内联，不占行高） */
function miniSparkSvg(series) {
  const W = 60; const H = 18; const PAD = 2;
  const n = series.length;
  const pts = series.map((v, i) => {
    const x = PAD + (i / (n - 1)) * (W - PAD * 2);
    const y = H - PAD - (v / 100) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}

/** 结果表格：点列头排序（再点反向）、数字列右对齐 + 千分位。rowKey 让 diff 取「第 N 次」
 * 第十六轮叠加：列筛选行、列显示/隐藏（⚙）、数字列统计行（tfoot）、单位列一键换算。 */
function renderTable(rows0, tableId = '') {
  // 第十六轮⑦：单位列换算先作用于数据副本（不改原结果）
  const uc = tableUnitConv[tableId];
  const rows = (uc && convertUnitColumn(rows0, uc.col, uc.to)) ?? rows0;
  const cols = [];
  for (const row of rows) {
    for (const k of Object.keys(row)) if (!cols.includes(k)) cols.push(k);
  }
  // 列显示/隐藏（按 tableId 记忆）：默认全显
  const colVis = readJson(`zerokit.colvis.${tableId || 't'}`, null) ?? Object.fromEntries(cols.map((c) => [c, true]));
  const visCols = cols.filter((c) => colVis[c] !== false);
  const numeric = Object.fromEntries(cols.map((c) => [c, isNumericColumn(rows.map((r) => r[c]))]));
  // 第十六轮③：表格筛选行——空格分词，每词都要在某列命中
  const fterms = tableFilterTerms[tableId] ?? [];
  const frows = filterRows(rows, fterms);
  const state = tableState[tableId] ?? { col: null, dir: 1 };
  const view = state.col ? sortRows(frows, state.col, state.dir) : frows;
  const arrow = (c) => state.col === c ? (state.dir === 1 ? ' ▲' : ' ▼') : '';
  const head = visCols.map((c) =>
    `<th class="sortable${numeric[c] ? ' num' : ''}" data-col="${esc(c)}">${esc(c)}${arrow(c)}</th>`).join('');
  const body = view.map((row) => `<tr>${visCols.map((c) => {
    const v = row[c];
    const val = (v && typeof v === 'object') ? JSON.stringify(v) : String(v ?? '');
    const shown = numeric[c] && val !== '' && Number.isFinite(Number(val)) ? formatNumber(val) : val;
    // 长单元格省略 + 点击展开：长路径/长 JSON 不再撑破表格
    const clip = !numeric[c] && shown.length > 48;
    // 第十八轮③：主键+列名的格级锚点（监控 diff 高亮定位用）
    const pk = String(Object.values(row)[0] ?? '');
    const dmark = ` data-dcell="${esc(pk)}|${esc(c)}"`;
    return `<td${numeric[c] ? ' class="num"' : ''}${clip ? ` class="cell-clip" title="点击展开" data-full="${esc(val)}"` : ''}${dmark}>${esc(clip ? `${shown.slice(0, 45)}…` : shown)}</td>`;
  }).join('')}</tr>`).join('');
  // 第十六轮⑥：统计行——数字列给 Σ/均值/最小~最大，文本列给非空计数
  const foot = visCols.map((c) => {
    const st = colStats(view, c);
    if (st.kind === 'num') {
      const f = (n) => formatNumber(String(Math.round(n * 100) / 100));
      return `<td class="num tstat" title="合计 ${f(st.sum)} · 均值 ${f(st.avg)}">${f(st.sum)}<span class="sub"> Σ·x̄${f(st.avg)}<br>${f(st.min)}~${f(st.max)}</span></td>`;
    }
    return `<td class="tstat" title="非空 ${st.count} 条"><span class="sub">${st.count} 条</span></td>`;
  }).join('');
  // 第十六轮⑦：单位列换算按钮（KB↔MB↔GB…），非单位列不显示
  const unitBtns = visCols.filter((c) => isUnitColumn(view, c)).map((c) => {
    const sample = unitOf(view.find((r) => unitOf(r?.[c]))?.[c]);
    const unit = sample?.unit ?? '';
    const targets = { ms: ['s'], s: ['ms'], B: ['KB', 'MB'], KB: ['MB', 'GB'], MB: ['GB', 'KB'], GB: ['MB', 'TB'], TB: ['GB'] }[unit] ?? [];
    return `<span class="unit-conv" data-ucol="${esc(c)}">${esc(c)}: ${targets.map((t) => `<button class="link mini" data-uconv="${esc(c)}:${esc(t)}" title="把 ${esc(c)} 列换算成 ${esc(t)}">→${esc(t)}</button>`).join(' ')}</span>`;
  }).join(' ');
  // 第十六轮③：筛选输入行（thead 第二行）
  const fRow = `<tr class="tfilter">${visCols.map((c) => `<th><input data-tf="${esc(c)}" placeholder="筛…" value="${esc((fterms[0] && tableFilterTerms[tableId]?.join(' ')) || '')}" autocomplete="off" spellcheck="false"></th>`).join('')}</tr>`;
  const gear = `<span class="colvis-btn" data-colvis="${esc(tableId || 't')}" title="显示/隐藏列" role="button" tabindex="0">⚙</span>`;
  return `${unitBtns ? `<div class="unit-bar">${unitBtns}</div>` : ''}${gear}<table class="grid" data-table="${esc(tableId)}"><thead><tr>${head}</tr>${fRow}</tr></thead><tbody>${body}</tbody><tfoot><tr>${foot}</tr></tfoot></table>
  <div class="tcount sub">${view.length === rows.length ? `共 ${rows.length} 行` : `${view.length} / ${rows.length} 行（筛选中）`}</div>`;
}

// 表格排序状态（按 tableId 记，重渲染后保留）
const tableState = {};
// 第十六轮③：每张表的筛选词（tableId → 词组），输入即时过滤
const tableFilterTerms = {};
// 第十六轮⑦：单位换算请求（tableId → {col, to}），换算后的数据走 refreshResult 重画
const tableUnitConv = {};
function bindTableSorts(scope) {
  scope.querySelectorAll('table.grid[data-table]').forEach((tbl) => {
    const id = tbl.dataset.table || 't';
    // 列宽记忆恢复
    const saved = readJson(`zerokit.colw.${id}`, null);
    if (saved) {
      const ths = [...tbl.querySelectorAll('th')];
      for (const [i, w] of saved.entries()) if (w && ths[i]) ths[i].style.width = `${w}px`;
    }
    tbl.querySelectorAll('th.sortable').forEach((th) => th.addEventListener('click', () => {
      const col = th.dataset.col;
      const st = tableState[id] ?? { col: null, dir: 1 };
      tableState[id] = st.col === col ? { col, dir: -st.dir } : { col, dir: 1 };
      refreshResult();  // 用同样的数据重画整张结果卡
    }));
    // 列宽拖拽（第十一轮①）：th 右缘 5px 热区，松手写 localStorage 记忆
    tbl.querySelectorAll('th').forEach((th, i) => {
      th.classList.add('colresize');
      th.addEventListener('mousedown', (ev) => {
        const rect = th.getBoundingClientRect();
        if (ev.clientX < rect.right - 6) return;  // 只在右缘热区触发，别抢排序点击
        ev.preventDefault();
        const startX = ev.clientX;
        const startW = rect.width;
        const move = (e2) => { th.style.width = `${Math.max(40, startW + e2.clientX - startX)}px`; };
        const up = () => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          const widths = [...tbl.querySelectorAll('th')].map((x) => Math.round(x.getBoundingClientRect().width));
          try { localStorage.setItem(`zerokit.colw.${id}`, JSON.stringify(widths)); } catch { /* 私密模式忽略 */ }
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
    });
    // 长单元格点击展开：省略的完整内容弹层显示（点外面关）
    tbl.querySelectorAll('td.cell-clip').forEach((td) => td.addEventListener('click', () => {
      document.getElementById('cellFullPop')?.remove();
      const pop = document.createElement('pre');
      pop.id = 'cellFullPop';
      pop.className = 'cell-full';
      pop.textContent = td.dataset.full ?? td.textContent;
      pop.addEventListener('click', () => pop.remove());
      document.body.appendChild(pop);
    }));
    // ---- 第十六轮：筛选行 / 单位换算 / 列复制 ----
    tbl.querySelectorAll('input[data-tf]').forEach((inp) => {
      inp.addEventListener('input', () => {
        tableFilterTerms[id] = inp.value.split(/\s+/).filter(Boolean);
        refreshResult();
        // 重画后焦点回筛选框（光标在末尾）
        const again = document.querySelector(`table.grid[data-table="${CSS.escape(id)}"] input[data-tf]`);
        if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      });
    });
    tbl.querySelectorAll('button[data-uconv]').forEach((b) => b.addEventListener('click', () => {
      const [col, to] = b.dataset.uconv.split(':');
      const cur = tableUnitConv[id];
      tableUnitConv[id] = (cur && cur.col === col && cur.to === to) ? null : { col, to };
      refreshResult();
    }));
    // 列名右键：复制这一列（去重可选）——右键不抢交互，提示走 count 栏
    tbl.querySelectorAll('th.sortable').forEach((th) => th.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      const col = th.dataset.col;
      const rows0 = currentResult?.data;
      if (!Array.isArray(rows0)) return;
      const vals = columnValues(rows0, col, { dedupe: ev.altKey });
      navigator.clipboard?.writeText(vals.join('\n')).then(() => {
        el.count.textContent = `已复制列「${col}」${ev.altKey ? '（去重后' : '（'}${vals.length} 行）`;
      }).catch(() => {});
    }));
  });
  // 列显示/隐藏面板（⚙）：点击表格外右上角齿轮
  scope.querySelectorAll('[data-colvis]').forEach((gear) => {
    gear.addEventListener('click', () => {
      const tid = gear.dataset.colvis;
      document.getElementById('colvisPop')?.remove();
      const rows0 = Array.isArray(currentResult?.data) ? currentResult.data : [];
      const cols = [];
      for (const row of rows0) for (const k of Object.keys(row ?? {})) if (!cols.includes(k)) cols.push(k);
      const vis = readJson(`zerokit.colvis.${tid}`, null) ?? Object.fromEntries(cols.map((c) => [c, true]));
      const pop = document.createElement('div');
      pop.id = 'colvisPop';
      pop.className = 'colvis-pop';
      pop.innerHTML = `<div class="pop-title">显示哪些列？</div>${cols.map((c) =>
        `<label class="pop-row"><input type="checkbox" data-cv="${esc(c)}" ${vis[c] !== false ? 'checked' : ''}>${esc(c)}</label>`).join('')}
        <div class="actions"><button class="ghost mini" id="cvAll">全选</button><button class="ghost mini" id="cvClose">关闭</button></div>`;
      document.body.appendChild(pop);
      const r = gear.getBoundingClientRect();
      pop.style.left = `${Math.max(8, r.right - pop.offsetWidth)}px`;
      pop.style.top = `${r.bottom + 4}px`;
      pop.addEventListener('change', (ev2) => {
        if (!ev2.target.dataset?.cv) return;
        vis[ev2.target.dataset.cv] = ev2.target.checked;
        writeJson(`zerokit.colvis.${tid}`, vis);
        refreshResult();
      });
      pop.querySelector('#cvAll')?.addEventListener('click', () => {
        Object.keys(vis).forEach((k) => { vis[k] = true; });
        writeJson(`zerokit.colvis.${tid}`, vis);
        refreshResult();
        pop.remove();
      });
      pop.querySelector('#cvClose')?.addEventListener('click', () => pop.remove());
      setTimeout(() => {
        const off = (e2) => { if (!pop.contains(e2.target) && e2.target !== gear) { pop.remove(); document.removeEventListener('mousedown', off); } };
        document.addEventListener('mousedown', off);
      });
    });
  });
  // JSON 折叠树：点分支行折叠/展开其直接子树
  scope.querySelectorAll('.json-tree').forEach((tree) => {
    const rows = [...tree.querySelectorAll('.jt-row')];
    rows.forEach((row) => {
      if (!row.classList.contains('branch')) return;
      row.addEventListener('click', () => {
        const idx = Number(row.dataset.jt);
        const depth = jsonTreeLines(currentResult?.data ?? {}).length ? undefined : undefined;
        // 折叠：本行 depth 之后、直到下一个 <= depth 的行
        const all = rows;
        const myDepth = Number(row.style.paddingLeft.replace(/px$/, '')) / 14;
        let hide = false;
        for (let j = idx + 1; j < all.length; j++) {
          const d = Number(all[j].style.paddingLeft.replace(/px$/, '')) / 14;
          if (d <= myDepth) break;
          all[j].classList.toggle('hidden', !row.classList.contains('collapsed'));
          hide = true;
        }
        if (hide) row.classList.toggle('collapsed');
      });
    });
  });
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
let logsPage = 1;
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
  // 第十九轮④：命令与错误信息默认脱敏（密钥可能随命令行/报错回显）
  const mtext = (t) => (maskState() ? maskSecrets(t) : String(t ?? ''));
  return `<div class="log-detail hidden" id="logDetail${i}">
    <pre>${esc(mtext(e['command'] ?? '（无命令）'))}</pre>
    ${e['error'] ? `<p class="log-error">${esc(mtext(e['error']))}</p>` : ''}
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
  // 第十九轮⑤：自动清理提示——启动时算过一遍超期条目数（trimAuditLog），页头亮出来
  const trimInfo = window.__zkAuditTrim
    ? `<div class="trim-note">🧹 已自动清理 ${window.__zkAuditTrim} 条超期日志（>90 天；config.toml 可关）</div>` : '';
  el.logsView.innerHTML = `
    <div class="ps-head">
      <h2>审计日志 <span class="aid">${logsFile === 'audit' ? 'audit.log' : 'denied.log'}</span></h2>
      <span class="sub">每次执行、被拒、失败都在这里；只在本机 ~/.zerokit/logs/</span>
    </div>
    ${trimInfo}
    <div class="log-tools">
      <div class="chips">${chips}</div>
      <input id="logQuery" class="log-query" placeholder="过滤：插件 / 动作 / 错误" value="${esc(logsQuery)}">
      <button class="ghost" id="logReload">刷新</button>
      <button class="ghost" id="logFile">${logsFile === 'audit' ? '看被拒记录' : '看全部记录'}</button>
    </div>
    <div id="logList" class="log-list"><div class="ps-empty" role="status">读取中…</div></div>`;

  el.logsView.querySelectorAll('[data-log-decision]').forEach((b) => {
    b.addEventListener('click', () => { logsDecision = b.dataset.logDecision; logsPage = 1; renderLogs(); });
  });
  $('logQuery').addEventListener('change', () => { logsQuery = $('logQuery').value.trim(); logsPage = 1; renderLogs(); });
  $('logReload').addEventListener('click', renderLogs);
  $('logFile').addEventListener('click', () => {
    logsFile = logsFile === 'audit' ? 'denied' : 'audit';
    logsPage = 1;
    renderLogs();
  });

  let data;
  try {
    const params = new URLSearchParams({ file: logsFile, limit: '200' });
    if (logsDecision) params.set('decision', logsDecision);
    if (logsQuery) params.set('q', logsQuery);
    data = await api(`/api/logs?${params}`);
  } catch (e) {
    $('logList').innerHTML = `<div class="ps-empty" role="status">读日志失败：${esc(e.message)}</div>`;
    return;
  }
  const rows = data.entries ?? [];
  // 分页：日志会一直涨，一页 50 条翻着看
  let logCur = logsPage;
  if (!Number.isInteger(logCur) || logCur < 1) logCur = 1;
  if (logCur > Math.max(1, Math.ceil(rows.length / 50))) { logCur = 1; logsPage = 1; }
  const pg = pageSlice(rows, logCur, 50);
  logsPage = pg.page;
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
    b.addEventListener('click', () => { logsPage = Number(b.dataset.pg); renderLogs(); });
  });
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
    <div id="docBody"><div class="ps-empty" role="status">检查中…</div></div>`;
  $('docReload').addEventListener('click', renderDoctor);

  let r;
  try { r = await api('/api/doctor'); } catch (e) {
    $('docBody').innerHTML = `<div class="ps-empty" role="status">自检失败：${esc(e.message)}</div>`;
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
    <h3 class="plug-home-h">插件</h3>${pluginRows || '<div class="ps-empty" role="status">还没装插件</div>'}`;
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
        : `<span class="bad">✗ 失败</span>`;
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
    el.marketView.innerHTML = `<div class="ps-empty" role="status">读不到集市列表：${esc(e.message)}</div>
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
      ? '<div class="ps-empty" role="status">还没有添加任何集市。先用上面的输入框加一个，或者在终端 <code>zkit market add &lt;地址&gt;</code>。</div>'
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
    el.plugView.innerHTML = `<div class="ps-empty" role="status">找不到插件 ${esc(id)}</div>
      <div class="actions"><button class="primary" id="homeBackList">返回插件列表</button></div>`;
    $('homeBackList').addEventListener('click', showPlugins);
    return;
  }

  // 能力清单导出：把插件主页的「动作/风险/依赖/设置」拼成 Markdown 报告下载。
  // 给的是「人能审阅」的形状——同事装之前先看这份就知道它会动什么。
  if (p.source?.type === 'market') checkPluginUpdate(p);
  // 锚点滚动：详情页顶部就是动作区，但插件列表很长时，锚点让「回到这个插件」一步到位
  $('homeExport')?.addEventListener('click', () => {
    const md = [
      `# ${p.name}（\`${p.id}\`）能力清单`,
      '',
      `- 版本：v${p.version}　来源：${p.sourceText}`,
      `- 摘要：${p.summary || '（无）'}`,
      p.description ? `- 说明：${p.description}` : '',
      '',
      '## 动作',
      ...p.actions.map((a) => '- **' + a.title + '**（`' + a.id + '`）：风险 `' + a.risk + '`'
        + (a.steps?.length ? '，组合 ' + a.steps.length + ' 步' : '') + ' —— ' + (a.description || a.title)),
      '',
      p.pluginDeps?.length ? '## 插件依赖\n' + p.pluginDeps.map((d) => '- `' + d.id + '`' + (d.installed ? '（已装）' : '（未装）')).join('\n') : '',
      p.settings?.length ? '## 设置项\n' + p.settings.map((x) => '- `' + x.name + '`' + (x.required ? '（必填）' : '') + (x.secret ? '（密钥）' : '')).join('\n') : '',
      '',
      `> 由 zerokit 于 ${new Date().toLocaleString()} 生成`,
    ].filter(Boolean).join('\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${p.id}-capabilities.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const settings = p.settings ?? [];
  const deps = p.pluginDeps ?? [];
  el.plugView.innerHTML = `
    <div class="ps-head">
      <h2>${esc(p.name)} <span class="aid">${esc(p.id)} · v${esc(p.version)}</span></h2>
      <span class="sub">${esc(p.sourceText)}</span>
    </div>
    <div class="plug-home-desc">${esc(p.description || p.summary || '')}</div>
    <div class="plug-home-history">📥 装于 ${esc(p.installedAt ? new Date(p.installedAt).toLocaleString() : '未知时间')} · ${esc(p.sourceText)}${p.installedVersion && p.installedVersion !== p.version ? `（记录自 v${esc(p.installedVersion)}）` : ''}</div>
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
      <button class="ghost" id="homeExport" title="导出这个插件的能力清单（Markdown）">导出能力清单</button>
      ${p.source?.type === 'market' ? '<button class="ghost" id="plugUpdateBtn">检查更新</button>' : ''}
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
    el.plugView.innerHTML = `<div class="ps-empty" role="status">读不到插件列表：${esc(e.message)}</div>
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
      <span class="head-sort">
        <label>排序：</label>
        <select id="plugSort">
          <option value="name"${readJson('zerokit.plugin-sort', 'name') === 'name' ? ' selected' : ''}>名称</option>
          <option value="actions"${readJson('zerokit.plugin-sort', 'name') === 'actions' ? ' selected' : ''}>动作数</option>
          <option value="installed"${readJson('zerokit.plugin-sort', 'name') === 'installed' ? ' selected' : ''}>最近安装</option>
        </select>
      </span>
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
      <button class="ghost" id="newPluginBtn" title="生成一个能直接跑的最小插件骨架，改文件即生效">新建插件</button>
    </div>
    <div id="newPluginBox" class="cmd-box hidden"></div>
    <div id="installBox"></div>
    <div class="plug-batch">
      <label class="market-check"><input type="checkbox" id="plugSelAll"> 全选</label>
      <button class="ghost" id="plugBatchCheck" disabled>批量检查更新</button>
      <span class="sub" id="plugBatchNote"></span>
    </div>
    ${(() => {
      // ⑥ 面板排序：名称 / 动作数 / 最近安装（选择只存本机）
      const sortMode = readJson('zerokit.plugin-sort', 'name');
      const sorted = [...plugins].sort((a, b) => {
        if (sortMode === 'actions') return b.actions.length - a.actions.length;
        if (sortMode === 'installed') return String(b.installedAt ?? '').localeCompare(String(a.installedAt ?? ''));
        return a.name.localeCompare(b.name, 'zh');
      });
      return sorted.map((p) => {
      const tags = pluginTags[p.id] ?? [];
      return `
      <div class="plug-card" data-id="${esc(p.id)}">
        <div class="plug-card-head">
          <input type="checkbox" class="plug-sel" data-id="${esc(p.id)}" title="选中做批量操作">
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
        <div class="plug-tags-row">
          ${(tags).map((t) => `<span class="tag">${esc(t)}<button class="tag-x" data-untag="${esc(t)}" title="移除标签">×</button></span>`).join('')}
          <input class="tag-input" placeholder="+ 标签，回车添加" data-taginput="${esc(p.id)}">
        </div>
        <div class="plug-config" hidden></div>
        <div class="plug-card-foot" hidden></div>
      </div>`;
    }).join('');
    })()}
    <div class="actions"><button class="primary" id="plugBack">返回</button></div>`;

  $('installSrc').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); doInstall(); }
  });
  $('installBtn').addEventListener('click', doInstall);
  $('plugBack').addEventListener('click', exitPlugins);
  $('plugSort')?.addEventListener('change', (e) => {
    writeJson('zerokit.plugin-sort', e.target.value);
    renderPlugins();
  });

  // 新建插件：三个问题（id / 名字 / 语言）→ 生成骨架 → 开发模式装好
  $('newPluginBtn')?.addEventListener('click', () => {
    const box = $('newPluginBox');
    if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
    box.innerHTML = `
      <div class="cmd-box-head">新建插件 —— 生成能直接跑的最小骨架，进入开发模式（改文件即生效）</div>
      <div class="new-plugin-form">
        <label>插件 id（小写字母/数字/连字符）<input id="npId" placeholder="my-tool" autocomplete="off" spellcheck="false"></label>
        <label>显示名称（可留空，默认用 id）<input id="npName" placeholder="我的工具" autocomplete="off" spellcheck="false"></label>
        <label>语言
          <select id="npRuntime">
            <option value="node">Node.js（零依赖，推荐）</option>
            <option value="python">Python（要装 python）</option>
          </select></label>
        <button class="primary" id="npCreate">生成骨架</button>
        <span class="sub" id="npMsg"></span>
      </div>`;
    box.classList.remove('hidden');
    $('npCreate').addEventListener('click', async () => {
      const id = $('npId').value.trim();
      if (!id) { $('npMsg').textContent = '先填插件 id'; return; }
      $('npMsg').textContent = '生成中…';
      try {
        const r = await api('/api/plugin/new', {
          method: 'POST',
          body: { id, name: $('npName').value.trim(), runtime: $('npRuntime').value },
        });
        $('npMsg').innerHTML = `✓ ${esc(r.message)}。生成了 ${r.files.length} 个文件，去命令行改 <code>${esc(String(r.dir))}</code> 下的文件即生效；也可以 <a class="link" href="#/plugins">刷新插件列表</a> 看到它。`;
        plugins = (await api('/api/plugins')).plugins ?? [];
        entries = buildEntries(plugins);
        renderPlugins();
        box.classList.remove('hidden');   // renderPlugins 会重建 DOM，把表单补回来
      } catch (e) {
        $('npMsg').textContent = `失败：${e.message}`;
      }
    });
  });

  // 批量选择：至少选中一个才点亮「批量检查更新」
  const selAll = $('plugSelAll');
  const batchBtn = $('plugBatchCheck');
  const batchNote = $('plugBatchNote');
  const syncBatch = () => {
    const n = el.plugView.querySelectorAll('.plug-sel:checked').length;
    batchBtn.disabled = n === 0;
    batchNote.textContent = n ? `已选 ${n} 个` : '';
  };
  selAll.addEventListener('change', () => {
    el.plugView.querySelectorAll('.plug-sel').forEach((c) => { c.checked = selAll.checked; });
    syncBatch();
  });
  el.plugView.querySelectorAll('.plug-sel').forEach((c) => c.addEventListener('change', syncBatch));
  batchBtn.addEventListener('click', async () => {
    const ids = [...el.plugView.querySelectorAll('.plug-sel:checked')].map((c) => c.dataset.id);
    if (!ids.length) return;
    batchBtn.disabled = true;
    batchNote.textContent = `正在检查 ${ids.length} 个插件…`;
    let updated = 0;
    let upToDate = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        const r = await api('/api/plugin/check', { method: 'POST', body: { id } });
        if (r.available && r.confirm) {
          const up = await api('/api/plugin/update', {
            method: 'POST', body: { id, confirm: r.confirm },
          });
          if (up.ok) { updated++; continue; }
        }
        if (r.available === false) upToDate++;
        else failed++;
      } catch { failed++; }
    }
    batchNote.textContent = `完成：${updated} 个已更新，${upToDate} 个已是最新${failed ? `，${failed} 个失败` : ''}`;
    if (updated) await renderPlugins();
  });

  // 标签：回车添加、×移除；只存本机
  el.plugView.querySelectorAll('[data-taginput]').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      e.preventDefault();
      const id = input.dataset.taginput;
      const set = new Set(pluginTags[id] ?? []);
      set.add(input.value.trim());
      pluginTags[id] = [...set];
      savePrefs();
      renderPlugins();
    });
  });
  el.plugView.querySelectorAll('[data-untag]').forEach((x) => x.addEventListener('click', () => {
    const card = x.closest('.plug-card');
    const id = card?.dataset.id;
    if (!id) return;
    pluginTags[id] = (pluginTags[id] ?? []).filter((t) => t !== x.dataset.untag);
    savePrefs();
    renderPlugins();
  }));

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
    // 徽标计数：有东西在跑时，标签页标题一眼可见（切去别的页也不会忘）；
    // 第十八轮⑦：监控数也并入标题（⏱N），fetchPs 与监控启停都走 tabTitle 保持一致
    document.title = tabTitle(Object.keys(watchRegistry()).length, running);
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
    el.psView.innerHTML = '<div class="ps-empty" role="status">读不到运行状态</div>';
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
    ${total === 0 ? '<div class="ps-empty" role="status">现在没有任何在运行的东西。</div>' : ''}
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
  restored: false,
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

/** 恢复上次的工作台对话：服务端内存里有这个 sessionId 的转录就重画出来 */
async function restoreWb() {
  if (!wb.sessionId || wb.restored || !wb.log) return;
  wb.restored = true;
  try {
    const r = await api(`/api/chat/state?sessionId=${encodeURIComponent(wb.sessionId)}`);
    if (!r.exists || !r.messages?.length) return;
    wb.log.innerHTML = r.messages.map((m) => {
      if (m.role === 'user') return `<div class="wb-msg user">${esc(m.text)}</div>`;
      if (m.role === 'tool') return `<div class="wb-msg tool">${esc(m.text)}</div>`;
      return `<div class="wb-msg assistant">${esc(m.text)}</div>`;
    }).join('');
    wb.log.scrollTop = wb.log.scrollHeight;
    const note = document.createElement('div');
    note.className = 'wb-restored';
    note.textContent = '（已恢复上次会话——重新加载页面后对话还在）';
    wb.log.prepend(note);
  } catch { /* 服务端重启后档案没了，就当新会话 */ }
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
    $('wbReset').addEventListener('click', () => {
      wb.sessionId = '';
      wb.restored = false;
      wb.log.innerHTML = '';
    });
    loadAiInfo();
    renderPrompts();
    restoreWb();
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



// ---------------------------------------------------------------- 全局统计页

/** 全局统计：总执行数 / 成功率 / 最活跃插件 / 近 7 天趋势。数据全部来自本机 runStore。 */
function showStats() {
  mode = 'stats';
  el.modeLabel.textContent = '统计';
  el.searchRow.classList.add('hidden');
  hidePanels();
  el.allowView.classList.remove('hidden');
  const view = el.allowView;
  if (location.hash !== '#/stats') history.replaceState(null, '', '#/stats');

  // 扁平化全部执行记录
  const runs = [];
  for (const [key, list] of Object.entries(runStore)) {
    for (const r of list ?? []) runs.push({ key, ts: r.ts, ok: r.ok, ms: r.ms });
  }
  runs.sort((a, b) => b.ts - a.ts);
  const total = runs.length;
  const okCount = runs.filter((r) => r.ok).length;
  const rate = total ? Math.round((okCount / total) * 100) : 0;
  const byPlugin = new Map();
  for (const r of runs) {
    const pid = r.key.split('.')[0];
    byPlugin.set(pid, (byPlugin.get(pid) ?? 0) + 1);
  }
  const top = [...byPlugin.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxTop = top[0]?.[1] ?? 1;
  const trend = dailyTrend(runs, 7);
  const maxDay = Math.max(1, ...trend.map((d) => d.total));
  const avgMs = total ? Math.round(runs.reduce((s, r) => s + (r.ms ?? 0), 0) / total) : 0;

  view.innerHTML = `
    <div class="ps-head"><h2>使用统计</h2>
      <span class="sub">全部来自本机执行记录，不上传任何数据</span></div>
    <div class="doc-grid">
      <div class="doc-line stat-big"><b>${total}</b><span>总执行次数</span></div>
      <div class="doc-line stat-big"><b>${rate}%</b><span>成功率（${okCount} 成功）</span></div>
      <div class="doc-line stat-big"><b>${avgMs} ms</b><span>平均耗时</span></div>
    </div>
    ${top.length ? `
    <h3 class="plug-home-h">最活跃的插件</h3>
    <div class="usage-block">
      ${top.map(([pid, n]) => `
        <div class="usage-row stat-top-plugin" data-plugin="${esc(pid)}" title="点开插件主页">
          <span class="usage-name">${esc(pid)}</span>
          <span class="usage-bar"><i style="width:${Math.round((n / maxTop) * 100)}%"></i></span>
          <span class="usage-n">${n} 次</span></div>`).join('')}
    </div>` : ''}
    <h3 class="plug-home-h">近 7 天</h3>
    <div class="usage-block trend">
      ${trend.map((d) => `
        <div class="trend-col" title="${esc(d.day)}：${d.total} 次（失败 ${d.fail}）">
          <div class="trend-bars">
            <i class="trend-ok" style="height:${Math.round(((d.total - d.fail) / maxDay) * 60)}px"></i>
            ${d.fail ? `<i class="trend-fail" style="height:${Math.max(3, Math.round((d.fail / maxDay) * 60))}px"></i>` : ''}
          </div>
          <span class="trend-day">${esc(d.day.slice(5))}</span>
        </div>`).join('')}
    </div>
    ${total ? `
    <h3 class="plug-home-h">一天中的什么时候在用</h3>
    <div class="usage-block heat-row">
      ${(() => {
        const heat = hourlyHeat(runs);
        const maxH = Math.max(1, ...heat.map((x) => x.total));
        return heat.map((b) => `
          <div class="heat-cell" title="${b.hour}:00 — ${b.total} 次">
            <i style="height:${Math.max(2, Math.round((b.total / maxH) * 32))}px"></i>
            <span>${b.hour}</span>
          </div>`).join('');
      })()}
    </div>` : ''}
    ${total ? `
    <h3 class="plug-home-h">一次跑多久（毫秒分布）</h3>
    <div class="usage-block">
      ${(() => {
        const hist = msHistogram(runs.map((r) => r.ms ?? 0));
        const maxC = Math.max(1, ...hist.map((x) => x.count));
        const totalR = runs.length || 1;
        return hist.map((b) => `
          <div class="heat-cell" title="${b.label}ms：${b.count} 次（占 ${Math.round((b.count / totalR) * 100)}%）">
            <i style="height:${Math.max(2, Math.round((b.count / maxC) * 32))}px"></i>
            <span>${b.label}</span>
            <em class="heat-count">${b.count || ''}</em>
          </div>`).join('');
      })()}
    </div>` : ''}
    ${total === 0 ? '<div class="ps-empty" role="status">还没有执行记录——随便跑一个只读动作，这里就会开始长出来。</div>' : ''}
    <h3 class="plug-home-h">偏好备份</h3>
    <div class="cmd-box prefs-box">
      <div class="help">收藏、备注、别名、标签、快捷键、主题——全部只存在这台机器的浏览器里。
        换电脑或清浏览器数据前，先导出一份 JSON；导入时只认 zerokit. 开头的键。</div>
      <div class="actions">
        <button class="ghost" id="prefsExport">导出偏好</button>
        <button class="ghost" id="prefsImport">导入偏好</button>
        <input type="file" id="prefsFile" accept="application/json" class="hidden">
        <span class="sub" id="prefsMsg"></span>
      </div>
    </div>
    <h3 class="plug-home-h">偏好快照（两组切换）</h3>
    <div class="cmd-box prefs-box">
      <div class="help">工作、生活各存一套（主题/强调色/字体/收藏/别名/昵称/标签/快捷键），
        一键切换整套偏好。快照存在本机，不进任何云端。</div>
      <div class="actions">
        <button class="ghost" id="snapSaveA">存入 A 组</button>
        <button class="ghost" id="snapSaveB">存入 B 组</button>
        <button class="primary" id="snapUse">切换到另一组</button>
        <span class="sub" id="snapState"></span>
      </div>
    </div>
    <div class="actions">
      <button class="ghost" id="statsBack">返回</button>
      ${total ? '<button class="primary" id="dailyReportBtn">生成今天的日报</button>' : ''}
    </div>`;
  $('statsBack').addEventListener('click', exitStats);
  view.querySelectorAll('.stat-top-plugin').forEach((row) => row.addEventListener('click', () => {
    showPluginHome(row.dataset.plugin);
  }));
  $('dailyReportBtn')?.addEventListener('click', () => {
    const names = new Map(plugins.map((p) => [p.id, p.name]));
    const rep = dailyReport(runs, { pluginNames: names });
    const box = document.createElement('div');
    box.className = 'overlay';
    box.innerHTML = `
      <div class="modal diff-modal">
        <h3>${esc(rep.title)}</h3>
        <pre class="report-body">${esc(rep.body)}</pre>
        <div class="actions">
          <button class="ghost" id="reportCopy">复制</button>
          <button class="primary" id="reportClose">关闭</button>
        </div>
      </div>`;
    document.body.appendChild(box);
    box.querySelector('#reportClose').addEventListener('click', () => box.remove());
    box.addEventListener('click', (e) => { if (e.target === box) box.remove(); });
    box.querySelector('#reportCopy').addEventListener('click', async (e) => {
      try {
        await navigator.clipboard.writeText(`${rep.title}\n\n${rep.body}`);
        e.currentTarget.textContent = '✓ 已复制';
      } catch { e.currentTarget.textContent = '复制失败'; }
    });
  });

  // 偏好快照：两组一键切换（工作/生活各一套：主题、强调色、收藏、别名、昵称、标签）
  const renderSnap = () => {
    const snapA = readJson('zerokit.snapA');
    const snapB = readJson('zerokit.snapB');
    const cur = readJson('zerokit.snapCur') ?? 'A';
    $('snapState') && ($('snapState').textContent = `当前：${cur}`
      + `${snapA ? ' · A 已存' : ''}${snapB ? ' · B 已存' : ''}`);
  };
  $('snapSaveA')?.addEventListener('click', () => {
    writeJson('zerokit.snapA', collectPrefsSnapshot());
    writeJson('zerokit.snapCur', 'A'); renderSnap();
  });
  $('snapSaveB')?.addEventListener('click', () => {
    writeJson('zerokit.snapB', collectPrefsSnapshot());
    writeJson('zerokit.snapCur', 'B'); renderSnap();
  });
  $('snapUse')?.addEventListener('click', () => {
    const cur = readJson('zerokit.snapCur') ?? 'A';
    const next = cur === 'A' ? 'B' : 'A';
    const snap = readJson(next === 'A' ? 'zerokit.snapA' : 'zerokit.snapB');
    if (!snap) { $('snapState').textContent = `${next} 组还没存过快照`; return; }
    applyPrefsSnapshot(snap);
    writeJson('zerokit.snapCur', next);
    renderSnap();
  });
  renderSnap();

  $('prefsExport').addEventListener('click', async () => {
    const msg = $('prefsMsg');
    const prefs = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('zerokit.')) prefs[k] = localStorage.getItem(k);
    }
    try {
      const r = await api('/api/prefs/export', { method: 'POST', body: { prefs } });
      const blob = new Blob([JSON.stringify(r.payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `zerokit-prefs-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      URL.revokeObjectURL(url);
      msg.textContent = '✓ 已导出';
    } catch (e) { msg.textContent = `导出失败：${e.message}`; }
  });
  $('prefsImport').addEventListener('click', () => $('prefsFile').click());
  $('prefsFile').addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const msg = $('prefsMsg');
    try {
      const parsed = JSON.parse(await file.text());
      const r = await api('/api/prefs/import', { method: 'POST', body: { payload: parsed } });
      let n = 0;
      for (const [k, v] of Object.entries(r.prefs)) {
        localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
        n++;
      }
      msg.textContent = `✓ 已导入 ${n} 项，刷新后生效`;
      // 第十轮⑨：空闲推荐（只提示一次；点开即执行该动作详情）
setTimeout(() => {
  const sug = idleSuggest(runStore, Date.now());
  if (!sug) return;
  const e = entries.find((x) => actionKey(x.plugin.id, x.action.id) === sug.key);
  if (!e) return;
  const tip = document.createElement('div');
  tip.className = 'idle-tip';
  tip.innerHTML = `<span>有一阵子没用了——要不要跑一次「${esc(e.action.title)}」？</span>
    <button class="ghost mini" id="idleGo">打开</button>
    <button class="ghost mini" id="idleNo">不用</button>`;
  document.body.appendChild(tip);
  tip.querySelector('#idleGo').addEventListener('click', () => { tip.remove(); openDetail(e.plugin, e.action); });
  tip.querySelector('#idleNo').addEventListener('click', () => tip.remove());
  setTimeout(() => tip.remove(), 60_000);
}, 35 * 60 * 1000);

// 第十轮：footer 入口
$('timersBtn')?.addEventListener('click', showTimers);
$('briefBtn')?.addEventListener('click', showBrief);

loadPrefs();
applyFontScale(); applyTheme(); applyAccent();
    } catch (e) { msg.textContent = `导入失败：${e.message}`; }
  });
}

function exitStats() {
  mode = 'command';
  el.allowView.classList.add('hidden');
  el.searchRow.classList.remove('hidden');
  el.listView.classList.remove('hidden');
  el.modeLabel.textContent = '命令';
  history.replaceState(null, '', location.pathname);
  renderList();
  el.q.focus();
}


// ---------------------------------------------------------------- 结果收藏夹

/** 收藏的结果：钉住某次执行的关键输出，重启后还在（本机 localStorage）。 */
async function showSaved() {
  mode = 'saved';
  el.modeLabel.textContent = '收藏';
  el.searchRow.classList.add('hidden');
  hidePanels();
  const view = el.allowView;
  view.classList.remove('hidden');
  if (location.hash !== '#/saved') history.replaceState(null, '', '#/saved');

  if (!savedList.length) {
    view.innerHTML = `
      <div class="ps-head"><h2>收藏的结果</h2>
        <span class="sub">执行结果点「收藏」就会钉在这里；只存本机，重启后还在。</span></div>
      <div class="ps-empty" role="status">还没有收藏——跑一次动作，在结果工具条里点「收藏」。</div>
      <div class="actions"><button class="primary" id="savedBack">返回</button></div>`;
  } else {
    view.innerHTML = `
      <div class="ps-head"><h2>收藏的结果 <span class="sub">${savedList.length} 条 · 只存本机</span></h2></div>
      ${savedList.map((x, i) => `
        <div class="plug-card saved-card">
          <div class="plug-card-head">
            <b>${esc(x.action)}</b>
            <span class="aid">${esc(x.plugin)}</span>
            <span class="badge ${x.ok ? 'read' : 'destructive'}">${x.ok ? '成功' : '失败'}</span>
            ${x.ms != null ? `<span class="badge">${x.ms} ms</span>` : ''}
            <span class="plug-ops">
              <button class="ghost" data-open="${i}">打开动作</button>
              <button class="ghost" data-del="${i}">移除</button>
            </span>
          </div>
          <div class="saved-cmd">${esc(x.command)}</div>
          <div class="saved-data"><pre>${esc(x.data !== undefined ? JSON.stringify(x.data, null, 1) : (x.stdout ?? '')).slice(0, 400)}</pre></div>
        </div>`).join('')}
      <div class="actions"><button class="primary" id="savedBack">返回</button>
        <button class="ghost" id="savedClear">清空收藏</button></div>`;
    view.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
      const x = savedList[Number(b.dataset.open)];
      const dot = x.key.indexOf('.');
      const e = __zerokit.entries.find((en) => en.plugin.id === x.key.slice(0, dot)
        && en.action.id === x.key.slice(dot + 1));
      if (e) { exitSaved(); __zerokit.openDetail(e.plugin, e.action); }
    }));
    view.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      savedList.splice(Number(b.dataset.del), 1);
      writeJson(PREF.saved, savedList);
      showSaved();
    }));
    $('savedClear')?.addEventListener('click', () => {
      savedList = [];
      writeJson(PREF.saved, savedList);
      showSaved();
    });
  }
  $('savedBack')?.addEventListener('click', exitSaved);
}

function exitSaved() {
  mode = 'command';
  el.allowView.classList.add('hidden');
  el.searchRow.classList.remove('hidden');
  el.listView.classList.remove('hidden');
  el.modeLabel.textContent = '命令';
  history.replaceState(null, '', location.pathname);
  renderList();
  el.q.focus();
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
      view.innerHTML = `<div class="ps-empty" role="status">读不到授权状态：${esc(err)}</div>`;
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
    { icon: '📈', label: '使用统计', hint: '总执行数 / 成功率 / 趋势', act: () => showStats() },
    { icon: '⏱', label: '定时任务', hint: '管理界面内定时器', act: () => { location.hash = '#/timers'; } },
    { icon: '👁', label: '监控面板', hint: '自动重跑的监控聚合', act: () => { location.hash = '#/watch'; } },
    { icon: '📰', label: '今日简报', hint: '跑了多少 / 成败 / 最常用', act: () => { location.hash = '#/brief'; } },
    { icon: '📌', label: '收藏结果', hint: '钉住的重要输出', act: () => { location.hash = '#/saved'; } },
    { icon: '◐', label: '深色 / 浅色', hint: '一键切换主题（Ctrl+Shift+D）', act: () => toggleLightDark() },
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
    const pluginItems = plugins.map((p) => ({
      icon: '🧩', label: p.name, hint: `插件 · ${p.id}`,
      act: () => { exitPalette(); location.hash = `#/plugins/${encodeURIComponent(p.id)}`; },
    }));
    const all = [...pages.map((x) => ({ ...x, act: (() => { const f = x.act; return () => { exitPalette(); f(); }; })() })),
      ...actionItems, ...pluginItems];
    // 打分排序：精确 > 前缀 > 子串 > hint 子串 > 子序列（拼首字母）；空查询取前 20
    items = paletteScore(all, needle);
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
  // Esc 栈：优先关「最上层」的临时浮层（长单元格弹层 > 带 overlay 的面板 > 页面层）。
  // 键盘用户按 Esc 预期关掉眼前那个弹层，而不是让底下的页面先退出。
  if (e.key === 'Escape' && document.getElementById('cellFullPop')) {
    e.preventDefault();
    document.getElementById('cellFullPop').remove();
    return;
  }
  if (e.key === 'Escape') {
    // 只处理「焦点正落在里面」的最上层 overlay（焦点不在里面说明是纯点击流，交给页面层）
    const inOverlay = document.activeElement
      && [...document.querySelectorAll('body > .overlay')].some((o) => o.contains(document.activeElement));
    if (inOverlay) return; // overlay 内部各自的 keydown（如命令面板）会处理并 stopPropagation 之前的顺序问题——这里不重复处理
  }
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
  if (mode === 'saved') {
    if (e.key === 'Escape') { e.preventDefault(); exitSaved(); }
    return;
  }
  if (mode === 'stats') {
    if (e.key === 'Escape') { e.preventDefault(); exitStats(); }
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
  // F1–F12：绑定的动作一键直达（在任何模式下都生效）
  if (/^F([1-9]|1[0-2])$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const target = hotkeyMap()[e.key];
    if (target) {
      e.preventDefault();
      const dot = target.indexOf('.');
      const entry = entries.find((en) => en.plugin.id === target.slice(0, dot)
        && en.action.id === target.slice(dot + 1));
      if (entry) {
        if (detail) __zerokit.backToList();
        openDetail(entry.plugin, entry.action);
      }
    }
    return; // 没绑定的功能键不拦，让浏览器自己处理
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
  } else if (e.key === 'PageDown' || e.key === 'PageUp') {
    e.preventDefault();
    if (filtered.length) { active = pageJump(active, e.key, filtered.length); paintActive(); }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) { openActive(); setTimeout(() => submit(true), 0); }
    else openActive();
  } else if (e.key === 'Escape') {
    el.q.value = '';
    renderList();
  } else if (/^Digit[1-9]$/.test(e.code) && e.altKey && filtered.length) {
    // Alt+数字 = 直开第 N 条：搜索结果稳定时比方向键快
    e.preventDefault();
    const nth = Number(e.code.slice(5)) - 1;
    if (filtered[nth]) { active = nth; openActive(); }
  } else if (/^[1-9]$/.test(e.key) && filtered.length > 0 && document.activeElement === el.q) {
    // 纯数字键 1-9 = 选中第 N 条（不直接打开——选中后回车才开，防误触）。
    // 与 Alt+数字 的差别：那是「直开」，这是「快选」，配合 roving tabindex。
    const pick = digitPick(e.key, filtered.length);
    if (pick >= 0) {
      e.preventDefault();
      active = pick;
      paintActive();
      el.count.textContent = `第 ${pick + 1} 项：${filtered[pick].action.title}（回车打开）`;
    }
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
    // 剪贴板里的东西往往就是「输入」：有智能匹配时把推荐条目置顶并提示
    if (filteredSmart.size > 0) {
      const firstOrder = filteredSmart.keys().next().value;
      const label = filteredSmart.get(firstOrder);
      const idx = filtered.findIndex((x) => x.order === firstOrder);
      if (idx >= 0) {
        active = idx;
        paintActive();
        el.count.textContent = `剪贴板识别为「${label}」——回车直接用`;
      }
    }
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
      ${(() => {
        const map = hotkeyMap();
        const rows = Object.entries(map).map(([k, keyStr]) => {
          const dot = keyStr.lastIndexOf('.');
          const entry = entries.find((e) => e.plugin.id === keyStr.slice(0, dot)
            && e.action.id === keyStr.slice(dot + 1));
          return { k, name: entry ? `${entry.plugin.name} · ${entry.action.title}` : keyStr };
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

/** 扁平化动作索引：搜索、命令面板、别名都吃这一份 */
function buildEntries(list) {
  const out = [];
  for (const p of list) {
    for (const a of p.actions) {
      out.push({
        plugin: p, action: a,
        order: out.length,         // 清单顺序，用于并列时的兜底排序
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
  return out;
}

async function load(notify) {
  try {
    const data = await api('/api/plugins');
    plugins = data.plugins || [];
    entries = buildEntries(plugins);
    if (notify) { active = 0; }
    renderList();
    refreshPsCount();   // 顺手把「运行中」徽标更新一下
    el.plugCount.textContent = String(plugins.length);
    api('/api/markets')
      .then((m) => { el.marketCount.textContent = String((m.markets || []).length); })
      .catch(() => { /* 集市读不到不影响命令面 */ });
    applyHash();
    // 列表态深链还原：#/?q=词&filter=… —— 刷新不丢搜索词/筛选
    if (!detail && /^#\/\?(.+)/.test(location.hash || '')) {
      const st = parseListState(location.hash);
      if (st.q) el.q.value = st.q;
      if (st.filter && FILTERS.some((f) => f.id === st.filter)) listFilter = st.filter;
      renderList();
    }
    // 主页 ?q=词：URL 带查询词直达搜索结果（外部系统/文档里给入口链接用）
    const qParam = new URLSearchParams(location.search).get('q');
    if (qParam) { el.q.value = qParam; active = 0; renderList(); el.q.focus(); }
  } catch (e) {
    el.count.textContent = `加载失败：${e.message}`;
  }
}

/** 支持 #/插件/动作 深链直达 */
function applyHash() {
  // #/timers 定时任务面板
  if ((location.hash || '') === '#/timers') { showTimers(); return; }
  // #/watch 监控聚合面板（第十八轮⑥）
  if ((location.hash || '') === '#/watch') { showWatchPanel(); return; }
  // #/brief 每日简报
  if ((location.hash || '') === '#/brief') { showBrief(); return; }

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

  // #/saved  直接打开「收藏的结果」
  if ((location.hash || '') === '#/saved') {
    showSaved();
    return;
  }

  // #/stats  全局统计
  if ((location.hash || '') === '#/stats') {
    showStats();
    return;
  }

  // #/q=...  带一个初始搜索词（命令行、通知、别的程序都能给这么个链接）
  const qHash = /^#\/q=(.*)$/.exec(location.hash || '');
  if (qHash) {
    el.q.value = decodeURIComponent(qHash[1]);
    active = 0;
    renderList();
    // 分享链接进来的人可能想常驻这个搜索：给一条可点的提示
    const term = decodeURIComponent(qHash[1]);
    if (term.trim()) {
      el.count.textContent = `来自分享链接的搜索「${term}」`;
      searchHistory = pushSearch(searchHistory, term);   // 记进最近搜索，下次一点即回
      writeJson(PREF.searches, searchHistory);
    }
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
  const m = /^#\/([\w.-]+)(?:\/([\w.-]+))?(?:\?(.*))?/.exec(location.hash || '');
  if (!m) return;
  // 深链带参数：#/插件/动作?字段=值&… → 打开详情并预填表单
  // （只做预填，不自动执行——「打开就跑」会让分享链接变成钓鱼面）
  let prefill = null;
  if (m[3]) {
    prefill = {};
    for (const [k, v] of new URLSearchParams(m[3]).entries()) prefill[k] = v;
  }
  const entry = entries.find((e) => e.plugin.id === m[1] && (!m[2] || e.action.id === m[2]));
  if (entry) openDetail(entry.plugin, entry.action, prefill);
}

window.addEventListener('hashchange', () => {
  // 第十八轮⑥：#/watch 是面板路由——监控继续跑（面板就是聚合它们的），只切视图
  if ((location.hash || '') === '#/watch') {
    showWatchPanel();
    return;
  }
  // 从详情后退回列表：hash 已变回空/列表态，详情界面要自己收掉
  if (detail && !/#\/[\w.-]+\/[\w.-]+/.test(location.hash || '')) {
    detail = null;
    el.detailView.classList.add('hidden');
    el.detailView.innerHTML = '';
    el.listView.classList.remove('hidden');
    const st = parseListState(location.hash);
    if (st.q) { el.q.value = st.q; }
    renderList();
    return;
  }
  // 第十八轮⑥补：从面板（#/watch 等）回到当前详情的深链——
  // detail 变量还在（面板没清它），但视图被面板藏了，这里恢复出来
  if (detail && /#\/[\w.-]+\/[\w.-]+/.test(location.hash || '') && el.detailView.classList.contains('hidden')) {
    hidePanels();
    mode = 'detail';
    el.modeLabel.textContent = '详情';
    el.listView.classList.add('hidden');
    el.detailView.classList.remove('hidden');
    return;
  }
  if (!detail) applyHash();
});


// 第十轮⑧：Ctrl/Cmd+K 全局聚焦搜索（与浏览器快捷键不冲突：我们 preventDefault）
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    el.q.focus();
    el.q.select();
  }
});

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
  openDetail, submit, backToList, renderResult,
  showPalette, runBatch, showMarket, showPlugins,
  get batch() { return batch; },
  get logsPage() { return logsPage; },
};

/** ⑧ 深浅一键切换：记住切换前是深还是浅，往返即可 */
function toggleLightDark() {
  const now = document.documentElement.dataset.theme;
  const prev = readJson('zerokit.theme-before-fast', null);
  const next = now === 'light' ? (prev && prev !== 'light' ? prev : 'dark') : 'light';
  if (now !== 'light') writeJson('zerokit.theme-before-fast', now);
  try { localStorage.setItem(PREF.theme, next); } catch { /* 隐私模式 */ }
  applyTheme();
  const b = $('themeFast');
  if (b) b.textContent = next === 'light' ? '🌙' : '☀';
}
$('langBtn')?.addEventListener('click', () => {
  lang = pickLang(lang === 'zh' ? 'en' : 'zh');
  localStorage.setItem('zerokit.lang', lang);
  t = makeT(lang);
  applyLang();
});
function applyLang() {
  el.q.placeholder = t('searchPlaceholder');
  const run = $('runBtn');
  if (run) run.textContent = t('run');
}
$('themeFast')?.addEventListener('click', toggleLightDark);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
    e.preventDefault();
    toggleLightDark();
  }
});

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
$('savedBtn')?.addEventListener('click', () => { if (mode === 'saved') exitSaved(); else showSaved(); });
$('doctorBtn')?.addEventListener('click', showDoctor);
$('helpBtn')?.addEventListener('click', showShortcuts);

// 第十九轮⑤：启动时算一遍审计日志超期条目（只统计并亮提示；物理清理由内核侧做）
(async () => {
  try {
    const data = await api('/api/logs?file=audit&limit=500');
    const entries = (data.entries ?? []).map((e) => ({ ts: e.ts ? new Date(String(e.ts)).getTime() : NaN }))
      .filter((e) => Number.isFinite(e.ts));
    const { dropped } = trimAuditLog(entries, 90);
    if (dropped.length) window.__zkAuditTrim = dropped.length;
  } catch { /* 日志不可用就静默 */ }
})();

// 第十九轮⑦：有监控在跑时，Ctrl+W / 关标签页前给一次挽留（beforeunload 需要 returnValue）
window.addEventListener('beforeunload', (e) => {
  const watching = Object.keys(watchRegistry()).length;
  const running = submitInFlight;
  if (watching > 0 || running > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

load();
setupVirtualScroll();
el.q.focus();