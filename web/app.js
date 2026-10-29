let qClearBound = false;
let batchFocus = -1;   // 第五十二轮⑥：键盘操作批量篮时的焦点项
// zerokit 启动器前端。
// 纯静态、无构建步骤，所以浏览器和 Tauri 壳用的是同一份代码。
// 所有来自插件的文本都经过 esc() 转义再插入 DOM——插件内容属于不可信输入。
//
// ===== 文件地图（第四十二轮⑥：按「----- 域」分节，改哪里先看这里）=====
//   本地偏好 ~55        配置档存取 ~364     最近使用 ~478      搜索 ~509
//   列表渲染 ~656       详情/表单 ~1254     执行与确认 ~1941   危险度卡 ~2769
//   数据备份 ~2819      结果渲染 ~2905      插件桥 ~3960       插件管理 ~4378
//   集市面板 ~4384      审计日志 ~4413      环境自检 ~4530     工作台 ~5701
//   全局统计 ~5989      结果收藏夹 ~6231    MCP 授权 ~6301     命令面板 ~6369
//   键盘 ~6551          快捷键速查 ~6783    启动 ~6855
// 行号会随改动漂移，定位以「------ 域」锚点 grep 为准。

import { romanize, scorePinyin } from './pinyin.js';
import { detectContent, matchFires } from './match.js';
import { qrSvg } from './qrcode.js';
import { pickLang, validLangPref, makeT , OVERFLOW_ROWS, PAGE_ROWS } from './extras.js';
import { pageJump, explainScore, planBatch, msHistogram, validateFields, dirtyFields, deepLinkParams, recentParamSets, whyLabel, expandSynonyms, stripStopwords, parseHistoryHash, recencyBoost } from './extras.js';
import { RESULT_ACTIONS, markdownTable, tsvTable, jsonTreeLines } from './extras.js';
import { dailyBrief, trimRuns, idleSuggest } from './extras.js';
import { cellDisplay, tableDensity, kvCollapsed } from './extras.js';
import { timelineDays, groupByHour, weekCompare, topActionsFlat } from './extras.js';
import { barsScale, sparkPoints, formatMs, paletteScore, p95Ms, runTrend, failureRate, durationStats } from './extras.js';
import { filterRows, colStats, unitOf, isUnitColumn, convertUnitColumn, mergeTables, columnValues, toHtmlTable } from './extras.js';
import { renderCopyTemplate, toJsonl, exportFilename, toMarkdownProps } from './extras.js';
import { WATCH_INTERVALS, intervalLabel, cellDiff, sparkSeries, watchStopCondition, tabTitle, watchCsv } from './extras.js';
import { dangerousPattern, maskSecrets, rateLimitHits, trimAuditLog, actionRiskCard } from './extras.js';
import { BACKUP_GROUPS, classifyKey, collectBackup, parseBackup, mergeBackup, backupFilename } from './extras.js';
import { HELP_TOPICS, firstRunSeen, markFirstRunDone, emptySearchSuggestions } from './extras.js';
import { profileList, validProfileName, upsertProfile, deleteProfile, renameProfile } from './extras.js';
import { resultTabTitle, tabEvict, resultQuery, resultCompare, withNoteHeader } from './extras.js';
import { TIMER_PRESETS, inWindow, validWindow, nextRunLabel, shouldCatchUp, exportTimers, parseTimersPack, trimHistory, looksLikeTimestamp, humanTs, emptyReason, tocFromMd } from './extras.js';
import { COMMAND_LIST, quickRunKey, gotoTarget, cycleTabIndex, pushHistory } from './extras.js';
import { chainFill, batchDedup, chunkWindows, parseBatchList } from './extras.js';
import { classifyClip, pushClipHistory, clipSuggestions } from './extras.js';
import { toShareMarkdown, toShareHtml } from './extras.js';
import { toAiMarkdown, packContext, toMcpConfig, toCurl, toLlmJsonl, watchTrendMarkdown } from './extras.js';
import { navGroups, emptyState, skeletonRows, resultHeightTier, viewportMode, classifyError, batchSummary } from './extras.js';
import { pluginCompare as plugCompare, versionDiff, depTreeLines, filterPluginActions, pluginTags as pluginTagChips, pluginStatCards, installedList, installCommand } from './extras.js';
import { normalizeTheme, resolveTheme, SHORTCUTS, highlightHtml, actionKey, toggleFavorite, isFavorite, favoritesFirst, rememberParams, pushRunHistory, pluginHealth, PROMPTS, ACCENTS, normalizeAccent, FILTERS, filterActions, pushSearch, topActions, recentRuns, invocationText, resultMarkdown, formatNumber, isNumericColumn, sortRows, toCsv, diffResults, dailyTrend, hourlyHeat, dailyReport, virtualWindow, pageSlice, breadcrumb, listStateQuery, parseListState, digitPick, suggestNext, comboLabel, keyHelpList } from './extras.js';

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
  statusPill: $('statusPill'), pillText: $('pillText'),
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
let langPref = 'system'; // 'system' | 'zh' | 'en'（第二十八轮：三档，实际 lang 由 pickLang 解析）
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
  langPref = validLangPref(localStorage.getItem('zerokit.lang')) ? localStorage.getItem('zerokit.lang') : 'system';
  lang = pickLang(langPref, navigator.language);
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
  // 第四十七轮：主题按钮收进抽屉（openThemePop 渲染时带当前档位），顶栏不再有 themeBtn
}

/** 面板里展示的档名：落盘档 + 隐式默认档（「默认」没落盘过也要能看见、能切） */
function panelProfileNames() {
  const list = profileList(loadProfiles());
  if (!list.includes('默认') && (curProfileName() === '默认' || list.length === 0)) return ['默认', ...list];
  return list;
}

/** 第三十七轮⑧：AI 辅助开关（隐私偏好）。关掉后 data-ai 按钮全部隐藏。 */
function aiAssistOn() {
  return localStorage.getItem('zerokit.ai-assist') !== 'off';
}
function applyAiAssist() {
  document.body.classList.toggle('no-ai', !aiAssistOn());
}

/** 外观面板：主题三档 + 六个强调色。以前只能循环切换，想回上一档要再点两轮。 */
// 第六十六轮⑥：标签页标题播报去重——单一出口，值没变不重复触发读屏。
let lastTitleAnnounced = '';
function announceTitle(n, running) {
  const v = tabTitle(n, running);
  if (v === document.title && v === lastTitleAnnounced) return;
  document.title = v;
  lastTitleAnnounced = v;
}

// 第六十六轮②：浮层焦点圈禁（focus trap）——Tab 循环留在浮层内，Esc 关后焦点回触发按钮。
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
function trapFocus(container, { onClose } = {}) {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      release(); onClose?.(); return;
    }
    if (e.key !== 'Tab') return;
    const items = [...container.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
    if (!items.length) return;
    const first = items[0]; const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    else if (!container.contains(document.activeElement)) { first.focus(); e.preventDefault(); }
  };
  container.addEventListener('keydown', onKey);
  function release(focusBack = true) {
    container.removeEventListener('keydown', onKey);
    if (focusBack && opener && document.contains(opener)) opener.focus();
  }
  // 进浮层先把焦点放进去（屏幕阅读器跟着走）
  const firstIn = container.querySelector(FOCUSABLE);
  firstIn?.focus();
  return { release };
}

function openThemePop() {
  const pop = $('themePop');
  if (!pop) return;
  // 第四十七轮：themePop 常驻抽屉（drawer 内非 hidden），改为纯渲染不再做开合切换
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
    </div>
    <div class="tp-head">语言 Language</div>
    <div class="tp-row">
      ${[['system', t('langSystem')], ['zh', t('langZh')], ['en', t('langEn')]].map(([id, label]) => `
        <button data-lang-choice="${id}" class="${langPref === id ? 'on' : ''}">${label}</button>`).join('')}
    </div>
    <div class="tp-head">AI 辅助</div>
    <div class="tp-row">
      <button data-ai-toggle="${aiAssistOn() ? 'on' : 'off'}" class="${aiAssistOn() ? 'on' : ''}" title="关闭后隐藏所有 AI 相关按钮（给 AI / AI 上下文 / curl / MCP 配置）——本机不留 AI 使用痕迹于界面">${aiAssistOn() ? '已开启' : '已关闭'}</button>
    </div>
    <div class="tp-head">数据</div>
    <div class="tp-row tp-backup">
      <button data-backup="export" title="把所有个性化数据（收藏、历史、参数记忆、外观设置）打包成 JSON 下载">⬇ 导出数据</button>
      <button data-backup="import" title="从备份 JSON 恢复：可预览、可选择类别、合并不覆盖">⬆ 导入数据</button>
      <button data-backup="purge" title="清除本地结果与运行历史（含参数记忆），审计日志不动">🧹 清除痕迹</button>
    </div>
    <div class="tp-head">配置档 <small class="tp-profile-cur">${esc(curProfileName())}</small></div>
    <div class="tp-row tp-profiles">
      ${panelProfileNames().map((n) => `
        <button data-profile="${esc(n)}" class="${n === curProfileName() ? 'on' : ''}" title="切换到此配置档">${esc(n)}</button>`).join('')}
      <button data-profile-new="1" title="以当前状态为基础新建配置档">＋ 新建</button>
    </div>
    <div class="tp-row tp-profiles-actions">
      <button data-profile-rename="1" title="重命名当前配置档">✏ 重命名</button>
      <button data-profile-del="1" title="删除当前配置档（至少保留一个）">🗑 删除</button>
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
  // 语言三档：点选即存偏好并全界面生效。openThemePop 重开刷新面板自身文案——
  // 此时已不在被点按钮的事件链内（click 已返回），重建安全。
  pop.querySelectorAll('[data-ai-toggle]').forEach((b) => b.addEventListener('click', () => {
    localStorage.setItem('zerokit.ai-assist', aiAssistOn() ? 'off' : 'on');
    applyAiAssist();
    openThemePop();
  }));
  pop.querySelectorAll('[data-lang-choice]').forEach((b) => {
    b.addEventListener('click', () => {
      langPref = validLangPref(b.dataset.langChoice) ? b.dataset.langChoice : 'system';
      try { localStorage.setItem('zerokit.lang', langPref); } catch { /* 隐私模式 */ }
      lang = pickLang(langPref, navigator.language);
      t = makeT(lang);
      applyLang(true);
      openThemePop();
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
  // ---- 第二十轮：数据分组（导出 / 导入 / 清除痕迹收进外观面板底部） ----
  // 以前「清除痕迹」只在详情页，导入导出不存在——换机器/清缓存会把收藏、
  // 历史、参数记忆全带走。外观面板就是既有的设置面板，数据操作收进底部一组。
  pop.querySelectorAll('[data-backup]').forEach((b) => {
    b.addEventListener('click', () => {
      const act = b.dataset.backup;
      pop.classList.add('hidden');
      if (act === 'export') exportBackup();
      else if (act === 'import') openImportDialog();
      else if (act === 'purge') purgeSensitive();
    });
  });
  // ---- 第二十一轮：配置档分组（新建 / 切换 / 重命名 / 删除） ----
  pop.querySelectorAll('[data-profile]').forEach((b) => {
    b.addEventListener('click', () => {
      switchProfile(b.dataset.profile);
      openThemePop(); // 重建面板刷新高亮
      openThemePop();
    });
  });
  pop.querySelector('[data-profile-new]')?.addEventListener('click', () => {
    const raw = prompt('新配置档名字（以当前状态为基础）：');
    if (raw == null) return;
    const v = validProfileName(raw);
    if (!v.ok) { el.count.textContent = v.error; return; }
    createProfileFromCurrent(v.name);
    pop.classList.add('hidden');
    openThemePop();
  });
  pop.querySelector('[data-profile-rename]')?.addEventListener('click', () => {
    const raw = prompt('重命名当前配置档为：', curProfileName());
    if (raw == null) return;
    const v = validProfileName(raw);
    if (!v.ok) { el.count.textContent = v.error; return; }
    const r = renameProfile(loadProfiles(), curProfileName(), v.name);
    if (r.error) { el.count.textContent = r.error; return; }
    saveProfiles(r.profiles);
    localStorage.setItem('zerokit.profile.cur', r.current);
    pop.classList.add('hidden');
    openThemePop();
  });
  pop.querySelector('[data-profile-del]')?.addEventListener('click', () => {
    const r = deleteProfile(loadProfiles(), curProfileName(), curProfileName());
    if (r.error) { el.count.textContent = r.error; return; }
    if (!confirm(`删除配置档「${curProfileName()}」？该档的外观/收藏/参数记忆将一并删除。`)) return;
    saveProfiles(r.profiles);
    localStorage.setItem('zerokit.profile.cur', r.current);
    switchProfile(r.current);
    pop.classList.add('hidden');
    openThemePop();
  });
}

// ---------------------------------------------------------------- 第二十一轮：配置档存取
//
// 档 = 一个 collectBackup 形状的 keys 信封（+createdAt 排序）。
// 当前档名 zerokit.profile.cur；各档数据 zerokit.profile.<name>。
// 切换 = 当前状态存回旧档 → 新档 keys 整批写回 localStorage → 刷新模块级变量。

function loadProfiles() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k.startsWith('zerokit.profile.')) continue;
    const name = k.slice('zerokit.profile.'.length);
    if (name === 'cur') continue;
    try { out[name] = JSON.parse(localStorage.getItem(k) || '{}'); } catch { /* 坏档跳过 */ }
  }
  return out;
}
function saveProfiles(profiles) {
  // 先清旧档键再写新表（重命名/删除会留孤儿键）
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith('zerokit.profile.') && k !== 'zerokit.profile.cur') localStorage.removeItem(k);
  }
  for (const [name, env] of Object.entries(profiles ?? {})) {
    try { localStorage.setItem(`zerokit.profile.${name}`, JSON.stringify(env)); } catch { /* 私密模式 */ }
  }
}
function curProfileName() {
  return localStorage.getItem('zerokit.profile.cur') || '默认';
}
/** 当前个性化状态 → keys 表（外观+收藏+参数记忆+表格设置，与第二十轮同口径） */
function currentProfileKeys() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k.startsWith('zerokit.')) continue;
    if (k.startsWith('zerokit.profile.')) continue; // 档管理键不属于档内容
    if (k === 'zerokit.runs' || k === 'zerokit.saved-results' || k === 'zerokit.run-notes' || k === 'zerokit.recent') continue; // 执行历史是全局事实
    out[k] = localStorage.getItem(k);
  }
  return out;
}
function createProfileFromCurrent(name) {
  const next = upsertProfile(loadProfiles(), name, currentProfileKeys());
  saveProfiles(next);
  el.count.textContent = `已新建配置档「${name}」（以当前状态为基础）`;
}
/** 切换：旧档存回 → 新档整批写回 → 模块级变量重载（不整页刷新，列表与主题就地生效） */
function switchProfile(name) {
  const profiles = loadProfiles();
  const list = profileList(profiles);
  const target = list.includes(name) ? name : list[0];
  // 1. 当前状态存回当前档（隐式默认档也落盘，下次切换才有完整现场）
  const curName = curProfileName();
  if (curName !== target) {
    saveProfiles(upsertProfile(profiles, curName, currentProfileKeys()));
  }
  // 2. 新档 keys 写回（先清个性化键，保留档管理键与执行历史）
  const env = (loadProfiles()[target] ?? {});
  const keep = new Set(['zerokit.profile.cur', 'zerokit.runs', 'zerokit.saved-results', 'zerokit.run-notes', 'zerokit.recent']);
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith('zerokit.') && !keep.has(k) && !k.startsWith('zerokit.profile.')) localStorage.removeItem(k);
  }
  for (const [k, v] of Object.entries(env.keys ?? {})) {
    if (k.startsWith('zerokit.profile.')) continue;
    try { localStorage.setItem(k, v); } catch { /* 私密模式 */ }
  }
  localStorage.setItem('zerokit.profile.cur', target);
  // 3. 模块级变量重载 + 就地重绘
  loadPrefs();
  applyTheme();
  applyAccent();
  applyFontScale();
  renderList();
  el.count.textContent = `已切换到配置档「${target}」`;
}

function cycleTheme() {
  const order = ['system', 'dark', 'light'];
  const now = normalizeTheme(localStorage.getItem(PREF.theme));
  const next = order[(order.indexOf(now) + 1) % order.length];
  try { localStorage.setItem(PREF.theme, next); } catch { /* 隐私模式 */ }
  applyTheme();
}

const RISK_TEXT = { read: 'riskRead', mutate: 'riskWrite', destructive: 'riskHigh' };
function riskText(risk) {
  // RISK_TEXT 值已改为 i18n 键（第二十八轮）；老值直接透出
  const k = RISK_TEXT[risk];
  return k ? t(k) : risk;
}

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
  // 第二十七轮⑥：剥掉「看看/帮我」这类虚词——它们对任何动作都不命中，
  // 带着搜等于全灭；剩下的实词才进 AND 匹配
  const tokens = stripStopwords(content.toLowerCase().split(/\s+/).filter(Boolean));

  // 空输入：把最近用过的排前面。启动器高频用的就是那几个，让它们待在顺手的位置。
  if (tokens.length === 0) {
    const out = entries.map((entry) => {
      const rank = recentRank(entry);
      return { entry, score: rank < 0 ? 0 : 1000 - rank };
    });
    out.sort((x, y) => y.score - x.score || x.entry.order - y.entry.order);
    return out;
  }

  // 第二十七轮⑥：同义词弱路由——「看看内存」这种描述型 query，把词展开成
  // 同义词组参与匹配（原词仍要命中——同义词只补召回，不降低精度）
  const synTokens = expandSynonyms(tokens);
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
    // 同义词补充召回：每个同义词命中给小额加分（远低于原词，只用于排序微调）
    if (synTokens.length) {
      for (const syn of synTokens) {
        if (tokens.includes(syn)) continue;
        const s2 = scoreEntry(entry, syn);
        if (s2 > 0) total += s2 * 0.3;
      }
    }
    entry.lastWhy = why;   // 详情页「为什么命中」用（ WeakMap 更干净但没必要）
    const rank = recentRank(entry);
    if (rank >= 0) total += recencyBoost(rank);   // 第二十七轮②：统一走纯函数
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
  return `<li class="item${i === active ? ' active' : ''}${smart ? ' smart' : ''}${fav ? ' fav' : ''}${i < 10 ? ' zk-stagger' : ''}" data-i="${i}" data-key="${esc(key)}" role="option"
    style="${i < 10 ? `animation-delay:${i * 18}ms` : ''}"
    aria-selected="${i === active ? 'true' : 'false'}" tabindex="${i === active ? 0 : -1}">
    <span class="risk-dot" data-risk="${esc(a.risk)}" title="${esc(riskText(a.risk))}"></span>
    ${who}
    <span class="title">
      <span class="item-line1"><span class="item-name name">${highlightHtml(a.title, query, esc)}${nicknames[key] ? `<i class="nick">（${esc(nicknames[key])}）</i>` : ''}</span>
      ${(actionTags[key] ?? []).map((tg) => `<span class="badge tag">#${esc(tg)}</span>`).join(' ')}
      ${a.steps?.length ? `<span class="badge">组合 ${a.steps.length} 步</span>` : ''}
      ${smart ? `<span class="badge smart-badge">智能匹配</span>` : ''}
      ${!smart && entry.lastWhy?.length ? `<span class="badge why-badge" title="${esc(whyLabel(entry.lastWhy))}">${esc(whyLabel(entry.lastWhy))}</span>` : ''}
      ${dep}</span>
      <span class="item-desc1 desc">${smart ? `内容看起来是${esc(smart)}，可以直接用` : highlightHtml(a.description || p.summary || '', query, esc)}</span>
    </span>
    <button class="star${fav ? ' on' : ''}" data-fav="${esc(key)}" title="${fav ? '取消收藏' : '收藏这个动作'}" aria-label="${fav ? '取消收藏' : '收藏这个动作'}">${fav ? '★' : '☆'}</button>
    <span class="aid">${esc(a.id)}</span>
    <span class="badge ${esc(a.risk)}">${esc(riskText(a.risk))}</span>
  </li>`;
}

function hidePanels() {
  for (const v of [el.listView, el.detailView, el.workbench, el.psView,
    el.plugView, el.marketView, el.logsView, el.doctorView, el.allowView]) {
    v.classList.add('hidden');
    // 第五十九轮②：每次面板重新显示时重放视图动效（先移除类，显示方再加回）
    v.classList.remove('view-anim');
  }
}
/** 第五十九轮②：显示一个面板并播放入场动效（200ms 淡入上移）。 */
function showPanelAnimated(v) {
  v.classList.remove('hidden');
  // 强制 reflow 重启动画
  void v.offsetWidth;
  v.classList.add('view-anim');
}

function rememberSearch(query) {
  // 第五十一轮②：词+筛选 chip 的组合也记忆（「磁盘 [safe]」比裸「磁盘」更有上下文）
  const label = comboLabel(query, listFilter);
  if (!label) return;
  searchHistory = pushSearch(searchHistory, label);
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
  // 第二十七轮⑧：搜索历史不再只在空 q 时显示——输入态也给（回填替换当前词），
  // 上限 8 条由 pushSearch 维护
  const hist = searchHistory.length
    ? `<div class="hist-chips${q.trim() ? ' while-typing' : ''}"><span class="hist-label">最近搜索</span>${searchHistory
      .map((x) => `<span class="chip-wrap"><button class="chip quiet" data-hist="${esc(x)}">${esc(x)}</button><button class="chip-x" data-hist-x="${esc(x)}" title="删掉这条记录" aria-label="删掉这条搜索记录">✕</button></span>`).join('')}
      <button class="chip quiet" id="clearHist">清空</button></div>`
    : '';
  el.listTools.innerHTML = `<div class="chips">${chips}</div>${hist}`;
  el.listTools.querySelectorAll('[data-filter]').forEach((b) => {
    b.addEventListener('click', () => { listFilter = b.dataset.filter; renderList(); });
  });
  el.listTools.querySelectorAll('[data-hist]').forEach((b) => {
    b.addEventListener('click', () => {
      const raw = b.dataset.hist;
      const m = raw.match(/^(.*) \[(\w+)\]$/);   // 组合记忆还原：词 + chip
      if (m && FILTERS.some((f) => f.id === m[2])) { el.q.value = m[1]; listFilter = m[2]; }
      else { el.q.value = raw; listFilter = 'all'; }
      renderList();
      // 第五十五轮⑦：renderList 重画 chips 后焦点不在任何输入上——把焦点还给搜索框，
      // 下一次输入/快捷键不用先点鼠标
      el.q.focus();
    });
  });
  // 第五十一轮⑨：单条删历史
  el.listTools.querySelectorAll('[data-hist-x]').forEach((b) => {
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      searchHistory = searchHistory.filter((x) => x !== b.dataset.histX);
      writeJson(PREF.searches, searchHistory);
      renderList();
    });
  });
  $('clearHist')?.addEventListener('click', () => {
    searchHistory = [];
    writeJson(PREF.searches, searchHistory);
    renderList();
  });
}

/** 批量顺序执行：逐个跑篮子里的动作（destructive 排最后），完成后弹汇总卡片。
 * 每项用已记忆的参数（参数记忆参数不存在时用默认值），失败不阻断后面的项。 */
async function runBatch(retryItems) {
  const source = retryItems ?? batch;
  if (!source.length) return;
  // destructive 排最后：失败不至于挡住只读项
  const ordered = [...source].sort((a, b) =>
    (a.action.risk === 'destructive' ? 1 : 0) - (b.action.risk === 'destructive' ? 1 : 0));
  const results = [];
  const btn = document.getElementById('batchRun');
  if (btn) { btn.disabled = true; btn.textContent = '执行中…'; }
  const runOne = async (entry) => {
    const key = actionKey(entry.plugin.id, entry.action.id);
    const values = paramStore[key] ?? {};
    const payload = { plugin: entry.plugin.id, action: entry.action.id, values };
    try {
      const r = await fetch('/api/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-zk-token': TOKEN },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({ ok: false, error: '响应不是 JSON' }));
      return { entry, ok: j.ok !== false && r.ok, ms: j.ms ?? 0, error: j.error };
    } catch (err) {
      return { entry, ok: false, ms: 0, error: String(err) };
    }
  };
  // 第二十五轮⑧：并发窗口——窗口内并行、窗口间串行（1=纯串行，默认 3）
  const conc = Math.max(1, Math.min(8, Number(readJson('zerokit.batchconc', 3)) || 3));
  for (const win of chunkWindows(ordered.length, conc)) {
    const rs = await Promise.all(win.map((i) => runOne(ordered[i])));
    results.push(...rs);
  }
  if (btn) { btn.disabled = false; btn.textContent = '顺序执行'; }
  if (!retryItems) { batch = []; renderList(); }
  else renderList();
  // 汇总卡片：成功 N / 失败 M / 总耗时，失败项可点开
  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  const totalMs = results.reduce((s, r) => s + (r.ms || 0), 0);
  // 第四十八轮⑤：汇总行改走共享 batchSummary（成功/失败/未跑三段式）
  const sum = document.createElement('div');
  sum.id = 'batchSummary';
  sum.className = 'batch-summary';
  sum.innerHTML = `
    <b>${retryItems ? '失败项重跑完成' : '批量执行完成'}（并发 ${conc}）</b>
    <span>${esc(batchSummary(results.map((r) => ({ ok: r.ok })), ordered.length))}</span>
    <span class="sub">总耗时 ${formatMs(totalMs)}</span>
    ${failed ? `<ul class="batch-fails">${results.filter((r) => !r.ok).map((r, i) => `
      <li data-fail="${i}" title="${esc(classifyError(r.error || '失败').title + '：' + String(r.error || '失败').slice(0, 120))}">✗ ${esc(r.entry.action.title)}（${esc(r.entry.plugin.name)}）</li>`).join('')}</ul>
      <button class="ghost mini" id="batchRetry">只重跑失败的（${failed} 项）</button>` : ''}
    <button class="ghost mini" id="batchSumClose">关闭</button>`;
  el.listView.insertBefore(sum, el.list);
  sum.querySelector('#batchSumClose').addEventListener('click', () => sum.remove());
  // 第二十五轮⑥：一键重跑失败项（参数保持原样）
  sum.querySelector('#batchRetry')?.addEventListener('click', () => {
    const failEntries = results.filter((r) => !r.ok).map((r) => r.entry);
    sum.remove();
    runBatch(failEntries);
  });
  const failItems = [...sum.querySelectorAll('[data-fail]')];
  const fails = results.filter((r) => !r.ok);
  failItems.forEach((li) => li.addEventListener('click', () => {
    const r = fails[Number(li.dataset.fail)];
    if (r) openDetail(r.entry.plugin, r.entry.action);
  }));
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

function renderListInner() {
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
    // 第二十五轮⑤：重复项标记（同插件+动作+参数）
    const { dups } = batchDedup(batch.map((b) => ({ pluginId: b.plugin.id, actionId: b.action.id, values: paramStore[actionKey(b.plugin.id, b.action.id)] ?? {} })));
    const bar = document.createElement('div');
    bar.className = 'batch-bar';
    bar.id = 'batchBar';
    bar.innerHTML = `已选 ${batch.length} 项${dups.length ? `（<span class="warn">重复 ${dups.length}</span>）` : ''}
      <button class="ghost mini" id="batchRun" aria-label="顺序执行篮子里的 ${batch.length} 个动作">顺序执行</button>
      <button class="ghost mini" id="batchDedup" aria-label="去掉同动作同参数的重复项">去重</button>
      <button class="ghost mini" id="batchExport" aria-label="导出批量清单 JSON">导出清单</button>
      <button class="ghost mini" id="batchImport" aria-label="导入批量清单 JSON">导入</button>
      <label class="mini">并发 <input type="number" id="batchConc" min="1" max="8" value="${readJson('zerokit.batchconc', 3)}" style="width:3em"></label>
      <button class="ghost mini" id="batchClear" aria-label="清空批量篮">清空</button>
      <span class="help">destructive 排最后</span>
      <ol class="batch-items">${batch.map((b, i) => `
        <li data-bi="${i}" class="${dups.includes(i) ? 'dup' : ''}">${esc(b.action.title)}
          <button class="ghost mini" data-bup="${i}" title="上移">↑</button>
          <button class="ghost mini" data-bdown="${i}" title="下移">↓</button>
          <button class="ghost mini" data-bdel="${i}" title="移出篮子" aria-label="移出篮子">✕</button>
        </li>`).join('')}</ol>`;
    el.listView.insertBefore(bar, el.list);
    bar.querySelector('#batchRun').addEventListener('click', runBatch);
    bar.querySelector('#batchClear').addEventListener('click', () => { batch = []; renderList(); });
    // ④排序：↑↓ 按钮交换相邻项（destructive 排序仍由 runBatch 兜底）
    bar.querySelectorAll('[data-bup]').forEach((btn2) => btn2.addEventListener('click', () => {
      const i = Number(btn2.dataset.bup);
      if (i > 0) { [batch[i - 1], batch[i]] = [batch[i], batch[i - 1]]; renderList(); }
    }));
    bar.querySelectorAll('[data-bdown]').forEach((btn2) => btn2.addEventListener('click', () => {
      const i = Number(btn2.dataset.bdown);
      if (i < batch.length - 1) { [batch[i + 1], batch[i]] = [batch[i], batch[i + 1]]; renderList(); }
    }));
    bar.querySelectorAll('.batch-items li').forEach((li, i) => li.addEventListener('click', () => { batchFocus = i; }));
    bar.querySelectorAll('[data-bdel]').forEach((btn2) => btn2.addEventListener('click', () => {
      batch.splice(Number(btn2.dataset.bdel), 1); renderList();
    }));
    // ⑤一键去重
    bar.querySelector('#batchDedup')?.addEventListener('click', () => {
      const { uniq } = batchDedup(batch.map((b) => ({ pluginId: b.plugin.id, actionId: b.action.id, values: paramStore[actionKey(b.plugin.id, b.action.id)] ?? {}, ref: b })));
      batch = uniq.map((u) => u.ref);
      renderList();
      el.count.textContent = '已去掉重复项';
    });
    // ⑦导出清单
    bar.querySelector('#batchExport')?.addEventListener('click', () => {
      const list = batch.map((b) => ({ plugin: b.plugin.id, action: b.action.id, values: paramStore[actionKey(b.plugin.id, b.action.id)] ?? {} }));
      const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = exportFilename('batch', 'json');
      a.click();
      URL.revokeObjectURL(a.href);
    });
    // ⑦导入清单
    bar.querySelector('#batchImport')?.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.json,application/json';
      inp.addEventListener('change', async () => {
        const text = await inp.files?.[0]?.text();
        if (!text) return;
        const parsed = parseBatchList(text);
        if (!parsed.ok) { el.count.textContent = `导入失败：${parsed.error}`; return; }
        let added = 0;
        for (const it of parsed.items) {
          const entry = entries.find((en) => en.plugin.id === it.plugin && en.action.id === it.action);
          if (entry) {
            batch.push({ plugin: entry.plugin, action: entry.action });
            paramStore[actionKey(it.plugin, it.action)] = it.values ?? {};
            added += 1;
          }
        }
        renderList();
        el.count.textContent = `导入了 ${added} 项（${parsed.items.length - added} 个动作不存在）`;
      });
      inp.click();
    });
    // ⑧并发上限记忆
    bar.querySelector('#batchConc')?.addEventListener('change', (ev) => {
      const v = Math.max(1, Math.min(8, Number(ev.target.value) || 3));
      ev.target.value = v;
      try { localStorage.setItem('zerokit.batchconc', String(v)); } catch { /* 忽略 */ }
    });
  }
  const oldSum = document.getElementById('batchSummary');
  if (oldSum) oldSum.remove();



  const q = el.q.value;
  mode = 'command';
  el.modeLabel.textContent = t('modeCommand');
  el.modeDot.classList.remove('workbench');
  el.workbench.classList.add('hidden');
  el.plugView.classList.add('hidden');
  el.psView.classList.add('hidden');
  el.marketView.classList.add('hidden');
  el.logsView.classList.add('hidden');
  el.doctorView.classList.add('hidden');
  showPanelAnimated(el.listView);
  if (detail) showPanelAnimated(el.detailView);

  const tS = performance.now();
  const results = search(q);
  perfStats.searchMs = Math.round((performance.now() - tS) * 10) / 10;
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
    // 第五十一轮⑤：结果计数徽标——X 项 · 来自 Y 个插件（搜索态才显示，浏览态是全部）
    if (q.trim()) {
      const fromPlugins = new Set(filtered.map((e) => e.plugin.id)).size;
      el.count.textContent = `${filtered.length} 项 · 来自 ${fromPlugins} 个插件`;
    }
  } else {
    // 空状态不是死胡同：给出「下一步做什么」的可点建议
    const suggestions = [];
    if (q.trim()) {
      suggestions.push(`<button class="link" data-sug="clear">清空搜索，浏览全部动作</button>`);
      suggestions.push(`<button class="link" data-sug="market">去集市找一个能做这件事的插件</button>`);
      suggestions.push(`<button class="link" data-sug="wb">问 AI 工作台：「${esc(q.trim())}」</button>`);
      // 第五十一轮①：丢词建议——「A B」全灭时，去掉哪个词能救回多少项
      const rawTokens = stripStopwords(q.trim().toLowerCase().split(/\s+/).filter(Boolean));
      const hayEntries = entries.map((e) => ({ hay: `${e.plugin.name} ${e.action.title} ${e.action.description ?? ''} ${(e.action.keywords ?? []).join(' ')}`.toLowerCase() }));
      const sugg = suggestNext(rawTokens, hayEntries);
      if (sugg.length) {
        suggestions.push('<div class="empty-sug-title">丢一个词试试：</div>');
        for (const sg of sugg) {
          suggestions.push(`<button class="link" data-sug="dropword" data-word="${esc(sg.drop)}">去掉「${esc(sg.drop)}」——能救回 ${sg.hit} 项</button>`);
        }
      }
      // 第二十二轮③：无结果时给「试试这些」——只读动作直达，新用户有路可走
      const picks = emptySearchSuggestions(entries, 5);
      if (picks.length) {
        suggestions.push('<div class="empty-sug-title">试试这些（都是只读、安全）：</div>');
        for (const p of picks) {
          suggestions.push(`<button class="link" data-sug="go" data-go="${esc(p.key)}">${esc(p.plugin)} · ${esc(p.title)}</button>`);
        }
      }
    } else if (!plugins.length) {
      suggestions.push(`<button class="link" data-sug="market">还没有插件——去集市装一个</button>`);
      suggestions.push(`<button class="link" data-sug="doctor">检查环境哪里没配好</button>`);
    }
    // 第四十七轮⑥：空态文案分级——首访/无插件/无匹配三种情境不同指引
    const firstRun = !localStorage.getItem('zerokit.firstrun');
    const es = q.trim() ? emptyState('no-match', q.trim())
      : (!plugins.length ? (firstRun ? emptyState('first-run') : emptyState('no-plugins')) : null);
    el.empty.innerHTML = suggestions.length
      ? `<div class="empty-art" aria-hidden="true">${q.trim() ? '🔍' : '🌱'}</div>
         <div class="empty-title">${es ? esc(es.title) : '这里还空着'}</div>
         <div class="empty-why">${q.trim()
           ? '可能是词太具体，也可能这个能力还没装进来。'
           : '装上第一个插件，启动器就会开始认识你的电脑。'}</div>
         <div class="empty-sugs">${suggestions.join('')}</div>`
      : `<div class="empty-art" aria-hidden="true"></div>
         <div class="e-title">${esc(es ? es.title : t('noResult'))}</div>
         <div class="e-hint">${esc(es ? es.hint : '试试短一点的关键词。')}</div>`;
    el.empty.classList.remove('hidden');
    el.empty.querySelectorAll('[data-sug]').forEach((b) => b.addEventListener('click', () => {
      const act2 = b.dataset.sug;
      if (act2 === 'clear') { el.q.value = ''; renderList(); el.q.focus(); }
      else if (act2 === 'market') showMarket();
      else if (act2 === 'doctor') showDoctor();
      else if (act2 === 'wb') showWorkbench(el.q.value.trim());
      else if (act2 === 'dropword') {
        // 第五十一轮①：丢词重搜
        const w = b.dataset.word || '';
        const parts = el.q.value.trim().split(/\s+/).filter((x) => x !== w);
        el.q.value = parts.join(' ');
        renderList(); el.q.focus();
      }
      else if (act2 === 'go') {
        const key = b.dataset.go || '';
        const dot = key.lastIndexOf('.');
        const entry = entries.find((e) => e.plugin.id === key.slice(0, dot) && e.action.id === key.slice(dot + 1));
        if (entry) openDetail(entry.plugin, entry.action);
      }
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
      // 第二十二轮④：悬停可见风险构成——一行 title 说清这个插件只读/会改/高危各几个
      const riskTally = { read: 0, mutate: 0, destructive: 0 };
      for (const [entry2] of items) riskTally[entry2.action.risk] = (riskTally[entry2.action.risk] || 0) + 1;
      const riskTip = `动作数 ${items.length}：只读 ${riskTally.read || 0}、会改动 ${riskTally.mutate || 0}、高风险 ${riskTally.destructive || 0}（点击整行折叠/展开）`;
      return `<li class="group-head${isCollapsed ? ' collapsed' : ''}" data-group="${esc(id)}" title="${esc(riskTip)}">
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
    // 第二十七轮⑦：搜索结果 ≥2 个插件时分组显示（组头带计数）——
    // 平铺 20 条时看不出「这些动作是哪几个插件的」，分组一眼看出结构
    const pluginsHit = new Set(filtered.map((e) => e.plugin.id));
    if (pluginsHit.size >= 2 && filtered.length <= 60) {
      const groups = new Map();
      filtered.forEach((entry, i) => {
        const id = entry.plugin.id;
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push([entry, i]);
      });
      el.list.innerHTML = [...groups.entries()].map(([id, items]) => {
        const p2 = items[0][0].plugin;
        const collapsedNow = loadCollapsed().has(id);
        return `<li class="group-head search-group${collapsedNow ? ' collapsed' : ''}" data-group="${esc(id)}" data-gtoggle="1">
            <span class="g-arrow">▾</span>
            <span class="g-name">${esc(p2.name)}</span>
            <span class="g-meta">${items.length} 个命中</span>
          </li>`
          + (collapsedNow ? '' : items.map(([entry, i]) => itemHtml(entry, i, false, q)).join(''));
      }).join('');
      // 第五十一轮③：搜索态分组头点击也能折叠/展开（与浏览态同一份状态）
      el.list.querySelectorAll('[data-gtoggle]').forEach((head) => {
        head.addEventListener('click', () => {
          const id = head.dataset.group;
          const set = loadCollapsed();
          set.has(id) ? set.delete(id) : set.add(id);
          saveCollapsed(set);
          renderList();
        });
      });
    } else if (filtered.length > 60) {
      // 虚拟滚动：条目多时只渲染视口附近（+缓冲），上下用 spacer 撑出总高度。
      // 上百个动作时 DOM 节点从 N 降到 ~20，滚动不再卡。
      renderVirtualList(q);
    } else {
      el.list.innerHTML = filtered.map((entry, i) => itemHtml(entry, i, true, q)).join('');
    }
  }

  perfStats.listItems = filtered.length;
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
// 第四十二轮⑧：事件委托——#list 单监听器收口全部条目交互。
// 此前每项 li/星标都各自 addEventListener，重渲一次列表挂一批监听器，
// 千项列表就是几千个闭包；委托后只有一个，重渲不再重新绑定。
let listEventsBound = false;
function bindListItems(q) {
  if (listEventsBound) return;
  listEventsBound = true;
  el.list.addEventListener('click', (ev) => {
    // 星标不打开动作：它只是「把这一条钉在前面」，所以单独拦一层
    const favBtn = ev.target.closest('[data-fav]');
    if (favBtn) {
      ev.stopPropagation();
      favorites = toggleFavorite(favorites, favBtn.dataset.fav);
      savePrefs();
      // 第四十二轮①：收藏切换只改这一项的类与按钮，不再整表重建
      patchItemFav(favBtn.dataset.fav);
      return;
    }
    const recent = ev.target.closest('[data-recent]');
    if (recent) {
      const key = recent.dataset.recent;
      const dot = key.lastIndexOf('.');
      const entry = entries.find((e) => e.plugin.id === key.slice(0, dot)
        && e.action.id === key.slice(dot + 1));
      if (entry) openDetail(entry.plugin, entry.action);
      return;
    }
    const node = ev.target.closest('.item');
    if (!node) return;
    // Alt+点击：不打开，而是加入批量篮（巡检/报表场景）
    if (ev.altKey) {
      ev.preventDefault();
      const entry = filtered[Number(node.dataset.i)];
      if (entry) {
        const k = actionKey(entry.plugin.id, entry.action.id);
        const existed = batch.some((x) => actionKey(x.plugin.id, x.action.id) === k);
        if (!existed) batch.push(entry);
        // 第二十五轮：篮子内容变了就要重渲染浮条
        renderList();
        el.count.textContent = existed ? `已在篮子里：${entry.action.title}` : `已加入批量篮：${entry.action.title}（共 ${batch.length} 项）`;
      }
      return;
    }
    active = Number(node.dataset.i);
    openActive();
  });
  el.list.addEventListener('mousemove', (ev) => {
    const node = ev.target.closest('.item');
    if (!node) return;
    const i = Number(node.dataset.i);
    if (i !== active) { active = i; paintActive(); }
  });
}

/** 第四十二轮①④：收藏切换的就地补丁——DOM 身份不变（li 节点引用稳定），
 * 只改 star 按钮与 li 的 fav 类。 */
function patchItemFav(key) {
  const on = isFavorite(favorites, key);
  el.list.querySelectorAll(`.item[data-key="${CSS.escape(key)}"]`).forEach((li) => {
    li.classList.toggle('fav', on);
    const btn = li.querySelector('[data-fav]');
    if (btn) {
      btn.classList.toggle('on', on);
      btn.textContent = on ? '★' : '☆';
      btn.title = on ? '取消收藏' : '收藏这个动作';
      btn.setAttribute('aria-label', btn.title);
    }
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

/** 第二十九轮⑨：把同步大活切成小片，每片之间让出主线程一帧。
 * 用于大结果复制/导出前的 JSON.stringify——一次序列化几 MB 会冻住 UI 几百毫秒，
 * 用户以为死了。切片后最长冻帧 = 单片耗时（这里每片 64KB 字符）。 */
async function chunkedStringify(value, onProgress) {
  // 用 JSON.stringify(indent) 的行流做切片——格式与同步版完全一致，
  // 只是拼接过程中每 512 行让出主线程一帧，界面不冻。
  const full = JSON.stringify(value, null, 2);
  const lines = full.split('\n');
  let out = '';
  for (let i = 0; i < lines.length; i += 512) {
    out += lines.slice(i, i + 512).join('\n') + (i + 512 < lines.length ? '\n' : '');
    if (onProgress) onProgress(Math.min(1, (i + 512) / lines.length));
    await new Promise((r) => setTimeout(r, 0));   // 让出一帧
  }
  return out;
}
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
  // 第四十二轮②：只改前一项和当前项的属性（此前全表 forEach）——
  // 千项列表上键盘上下移动也从 O(N) 降为 O(1)，且不触发其它项的重排。
  const prev = el.list.querySelector('.item.active');
  const cur = el.list.querySelector(`.item[data-i="${active}"]`);
  if (prev && prev !== cur) {
    prev.classList.remove('active');
    prev.setAttribute('aria-selected', 'false');
    prev.setAttribute('tabindex', '-1');
  }
  if (cur) {
    cur.classList.add('active');
    cur.setAttribute('aria-selected', 'true');
    cur.setAttribute('tabindex', '0');
    cur.scrollIntoView({ block: 'nearest' });
  }
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
  showPanelAnimated(el.detailView);

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
  // 第四十九轮①②④⑤：历史分析卡——数值趋势 / 耗时分布 / 失败率警示 / 与上次对比
  const numericFields = (() => {
    const fields = new Set();
    for (const r of runHist) {
      if (r?.data && typeof r.data === 'object' && !Array.isArray(r.data)) {
        for (const [k, v] of Object.entries(r.data)) {
          if (typeof v === 'number'
            || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.trim().match(/^-?\d+(?:\.\d+)?/)?.[0] ?? NaN)))) {
            fields.add(k);
          }
        }
      }
    }
    return [...fields];
  })();
  const trendHtml = numericFields.length
    ? `<div class="hist-trend">${numericFields.map((f) => {
        const t = runTrend(runHist, f);
        if (!t) return '';
        return `<span class="trend-chip" data-trend-field="${esc(f)}" title="最近 ${t.points.length} 次 ${esc(f)}：均值 ${t.avg.toFixed(1)} · 最好 ${t.best} · 最差 ${t.worst}">${esc(f)} <b>${t.points.at(-1).v}</b> <i>(${t.points.length}次 均值${t.avg.toFixed(1)})</i></span>`;
      }).join('')}</div>`
    : '';
  const dur = durationStats(runHist.filter((r) => typeof r.ms === 'number').map((r) => r.ms));
  const durHtml = dur
    ? `<span class="dur-chip" title="耗时分布：最快 ${formatMs(dur.min)} · P50 ${formatMs(dur.p50)} · P95 ${formatMs(dur.p95)} · 最慢 ${formatMs(dur.max)}">⏱ P50 ${formatMs(dur.p50)} · P95 ${formatMs(dur.p95)}</span>`
    : '';
  const fr = failureRate(runHist, 10);
  const frHtml = fr.total >= 3 && fr.rate > 0.3
    ? `<div class="warn-chip" role="status">⚠ 最近 ${fr.total} 次里失败 ${fr.fails} 次（${Math.round(fr.rate * 100)}%）——这个动作最近不太稳，看看错误分类卡里的建议</div>`
    : '';
  const cmpBtn = runHist.length >= 2 ? '<button class="ghost mini" id="cmpLast" title="当前结果与上一次对比（第二十三轮 resultCompare）">⇄ 与上次对比</button>' : '';
  const historyPanel = (trendHtml || durHtml || frHtml || cmpBtn)
    ? `<div class="hist-panel">${frHtml}${trendHtml}<div class="hist-meta">${durHtml}${cmpBtn}</div></div>`
    : '';
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
        <span class="badge ${esc(action.risk)}">${esc(riskText(action.risk))}</span>
        ${steps.length ? `<span class="badge">组合 ${steps.length} 步</span>` : ''}
        <span class="badge">${esc(action.tool)}</span>
        ${sparkline}
      </div>
      <div class="desc">${esc(action.description || '（这个动作没写说明）')}</div>
      ${historyPanel}
      ${action.risk !== 'read' ? `<div class="risk-explain callout">⚠ 风险等级「${esc(riskText(action.risk))}」是什么意思：只读=只是看、不改任何东西；会改动=会修改文件/配置/服务，执行前想清楚；高风险=可能删除数据或不可逆，确认明白了再执行。</div>` : ''}
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
    <div class="actions action-tier">
      <button class="primary run-main" id="runBtn">▶ 执行</button>
      <button class="ghost" id="previewBtn" title="先看真正会执行的命令行（密钥打码），再决定跑不跑">预览命令</button>
      <button class="ghost" id="backBtn">返回</button>
      <div class="more-wrap" id="moreWrap">
        <button class="ghost" id="moreBtn" title="更多操作：调用方式 / 配置 / 分享 / 定时 / 监控 / 结果处理" aria-haspopup="menu" aria-expanded="false">⋯ 更多</button>
        <div class="more-pop hidden" id="morePop" role="menu">
          <button class="ghost more-item" id="invokeBtn" role="menuitem" title="这个动作在 CLI / MCP / 深链里怎么调">⌨ 调用方式</button>
          ${plugin.settings?.length ? '<button class="ghost more-item" id="cfgBtn" role="menuitem" title="这个插件的长期配置（端点、密钥等），保存后立即生效">⚙ 配置插件</button>' : ''}
          <button class="ghost more-item" id="qrBtn" role="menuitem" title="生成深链二维码，手机扫码直达这个动作">▦ 二维码</button>
          <button class="ghost more-item" id="shareBtn" role="menuitem" title="复制带当前参数的完整深链">🔗 分享深链</button>
          <button class="ghost more-item" id="timerBtn" role="menuitem" title="只读动作按间隔自动执行（界面开着才跑）">⏲ 定时</button>
          <button class="ghost more-item" id="watchBtn" role="menuitem" title="监控模式：自动重跑+变更追踪+倒计时环（#/watch 聚合面板）">◎ 监控</button>
          <button class="ghost more-item" id="maskBtn" role="menuitem" title="结果里的 token/密钥/长十六进制串默认打码——切换显示明文">🕶 脱敏切换</button>
          <button class="ghost more-item" id="purgeBtn" role="menuitem" title="清除当前结果与本地运行历史（含参数记忆），审计日志不动">🧹 清除痕迹</button>
          <button class="ghost more-item" id="shareCardBtn" role="menuitem" title="把这次结果生成一张摘要卡（复制到剪贴板）">🪪 分享卡</button>
          <button class="ghost more-item" id="copyJsonBtn" role="menuitem" title="复制动作定义 JSON（写文档 / 分享给他人用）">📋 复制 JSON</button>
          <button class="ghost more-item" id="resetBtn" role="menuitem" title="把所有参数清回清单默认值">↺ 恢复默认</button>
        </div>
      </div>
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
  // 第五十九轮①：⋯ 更多菜单——次要操作收纳（点开/关闭/点外关/Esc 关；菜单项点击后收起）
  {
    const moreBtn = $('moreBtn'); const morePop = $('morePop');
    if (moreBtn && morePop) {
      const closeMore = () => { morePop.classList.add('hidden'); moreBtn.setAttribute('aria-expanded', 'false'); };
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = morePop.classList.toggle('hidden');
        moreBtn.setAttribute('aria-expanded', String(!open));
      });
      morePop.addEventListener('click', (e) => {
        // 菜单项点击后收起；容器空白点击不关（避免误触）
        if (e.target.closest('button')) closeMore();
      });
      document.addEventListener('click', (e) => {
        if (!morePop.classList.contains('hidden') && !e.target.closest('#moreWrap')) closeMore();
      }, { capture: true });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMore(); }, { capture: true });
    }
  }
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
    // 第三十八轮①②③④：定时任务升级——档位选择 + 执行窗口 + 暂停 + 历史。
    // 旧 prompt 只能填秒数，窗口/暂停这些维度表达不了，改模态表单。
    openTimerDialog(plugin, action);
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
    // 第三十七轮③：调用方式弹窗追加 MCP 配置段——AI 客户端接入一步到位
    const mcpCfg = toMcpConfig('node', '/path/to/zerokit/src/mcp.ts');
    $('invokeBox').innerHTML = `<div class="cmd-box">
      <div class="cmd-box-head">三种调用方式</div>
      <pre>${esc(text)}</pre>
      <button class="ghost" id="copyInvoke">复制</button>
    </div>
    <div class="cmd-box" data-ai="1">
      <div class="cmd-box-head">MCP 配置（贴进 Claude Desktop / Cursor 等客户端）</div>
      <pre>${esc(mcpCfg)}</pre>
      <button class="ghost" id="copyMcpCfg">复制 mcpServers</button>
    </div>`;
    $('copyMcpCfg').addEventListener('click', async (ev) => {
      try {
        await navigator.clipboard.writeText(mcpCfg);
        ev.currentTarget.textContent = '已复制';
      } catch { ev.currentTarget.textContent = '复制失败'; }
      setTimeout(() => { ev.currentTarget.textContent = '复制 mcpServers'; }, 1500);
    });
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
    showPanelAnimated(el.listView);
    renderList();
    el.q.focus();
    return;
  }
  history.replaceState(null, '', location.pathname);
  el.detailView.classList.add('hidden');
  el.detailView.innerHTML = '';
  showPanelAnimated(el.listView);
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
    btn.classList.add('warn');
    btn.onclick = () => { location.hash = '#/market'; };
    // 第二十六轮②：主页头部同步一枚「有更新」徽标（versionDiff 口径统一）
    const badge = document.getElementById('plugUpdateBadge');
    const diff = versionDiff(String(p.version), String(remote));
    if (badge && diff) { badge.textContent = `⬆ 可更新：v${diff.installed} → v${diff.latest}`; badge.classList.remove('hidden'); badge.style.display = ''; }
  } catch {
    btn.textContent = '检查失败（稍后再试）';
  }
}

/** 第十轮⑤：每日简报——今天跑了多少、成败、最常用 top3、平均耗时。 */
/** 第五十四轮：#/timeline 时间线与执行复盘页。 */
function showTimeline() {
  hidePanels();
  mode = 'timeline';
  el.modeLabel.textContent = '时间线';
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  if (location.hash !== '#/timeline') history.pushState(null, '', '#/timeline');
  // runStore 是 {actionKey: [runs]}——摊平成带 plugin/action 的列表
  const flat = [];
  for (const [key, list] of Object.entries(runStore)) {
    for (const r of list ?? []) flat.push({ ...r, key });
  }
  flat.sort((a, b) => b.ts - a.ts);
  const days = timelineDays(flat);
  const wc = weekCompare(flat);
  const hours = groupByHour(flat);
  const tops = topActionsFlat(flat, 5);
  const maxH = Math.max(1, ...hours);
  const collapsed = readJson('zerokit.timeline-collapsed', []) ?? [];
  const dayHtml = days.length ? days.map((g) => {
    const isCollapsed = collapsed.includes(g.day);
    const okN = g.total - g.fails;
    const dots = `<span class="tl-bar"><span style="width:${Math.round((okN / g.total) * 100)}%" class="tl-ok"></span><span style="width:${Math.round((g.fails / g.total) * 100)}%" class="tl-fail"></span></span>`;
    const rows = g.items.map((r) => `<div class="tl-row"><span class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'}</span><span class="tl-when">${new Date(r.ts).toLocaleTimeString()}</span><span class="tl-name">${esc(`${r.plugin ?? ''} · ${r.action ?? ''}`)}</span><span class="tl-ms">${typeof r.ms === 'number' ? formatMs(r.ms) : ''}</span></div>`).join('');
    return `<div class="tl-day" data-day="${g.day}">
      <div class="tl-head" data-tlday="${g.day}" role="button" tabindex="0"><span class="tl-caret">${isCollapsed ? '▸' : '▾'}</span><b>${g.day}</b> ${dots} <span class="sub">${g.total} 次 · ${g.fails} 失败 · 均 ${g.total ? formatMs(g.msSum / g.total) : '—'}</span></div>
      ${isCollapsed ? '' : `<div class="tl-rows">${rows}</div>`}
    </div>`;
  }).join('') : `<div class="help">还没有执行记录——回到列表随便跑一个动作，时间线就会在这里长出来（只保存在本机）。</div>`;
  const fmtDelta = (d, unit = '') => d === null ? '—' : `${d >= 0 ? '+' : ''}${Math.round(d * 100)}%${unit}`;
  el.allowView.innerHTML = `
    <h2 class="ps-title">时间线</h2>
    <div class="tl-week-card card">
      <div class="tl-wc-cell">本周<b>${wc.cur.total}</b> 次 <span class="sub">${fmtDelta(wc.totalDelta)} vs 上周 ${wc.prev.total}</span></div>
      <div class="tl-wc-cell">失败率<b>${Math.round(wc.cur.failRate * 100)}%</b> <span class="sub">${fmtDelta(wc.failDelta)} vs 上周 ${Math.round(wc.prev.failRate * 100)}%</span></div>
      <div class="tl-wc-cell">平均耗时<b>${wc.cur.avgMs ? formatMs(wc.cur.avgMs) : '—'}</b> <span class="sub">${fmtDelta(wc.avgDelta)} vs 上周 ${wc.prev.avgMs ? formatMs(wc.prev.avgMs) : '—'}</span></div>
    </div>
    <div class="tl-hours card">
      <h3>时段分布</h3>
      <div class="tl-hbars">${hours.map((n, h) => `<div class="tl-hbar" title="${h} 时 · ${n} 次"><span class="sub">${h}</span><div class="tl-htrack"><div class="tl-hfill" style="height:${Math.round((n / maxH) * 100)}%"></div></div><span class="sub">${n || ''}</span></div>`).join('')}</div>
    </div>
    ${tops.length ? `<div class="tl-tops card"><h3>最常跑</h3>${tops.map((x, i) => `<div class="tl-top"><span class="sub">#${i + 1}</span> ${esc(x.label)} <b>${x.count}</b> 次</div>`).join('')}</div>` : ''}
    <div class="tl-days">${dayHtml}</div>`;
  showPanelAnimated(el.allowView);
  el.allowView.querySelectorAll('[data-tlday]').forEach((h) => {
    h.addEventListener('click', () => {
      const day = h.dataset.tlday;
      const cur = readJson('zerokit.timeline-collapsed', []) ?? [];
      localStorage.setItem('zerokit.timeline-collapsed', JSON.stringify(cur.includes(day) ? cur.filter((x) => x !== day) : [...cur, day]));
      showTimeline();
    });
  });
}

function showBrief() {
  hidePanels();
  mode = 'brief';
  el.modeLabel.textContent = t('modeBrief');
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
  showPanelAnimated(el.allowView);
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
  announceTitle(n, running);
}

/** ①⑤ 监控设置弹窗：间隔档位 + 停止条件（连续失败 N 次 / 结果包含某串） */
function openWatchDialog(plugin, action, key) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const intervalOpts = WATCH_INTERVALS.map((o) =>
    `<option value="${o.sec}" ${o.sec === 30 ? 'selected' : ''}>${o.label}</option>`).join('');
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
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
    w.samples.push({ ts: Date.now(), ok: now?.ok === true, data: now?.data, err: now?.ok === true ? undefined : String(now?.error ?? '') });
    if (w.samples.length > 30) w.samples.shift();
    // ⑤ 停止条件
    const stop = watchStopCondition(
      w.samples.map((s) => ({ ok: s.ok, data: s.data })),
      { failStreak: w.failStreak, matchStr: w.matchStr },
    );
    if (stop) {
      stopWatch(key);
      renderWatchBar();
      // 第四十八轮⑧：自动停带失败原因摘要——最近一次失败给分类，不只「已停」
      const lastBad = [...w.samples].reverse().find((sm) => !sm.ok);
      const why = stop === 'stop-fail'
        ? (lastBad ? `（最近失败：${classifyError(lastBad.err ?? '').title}）` : '')
        : `（命中停止串「${w.matchStr}」）`;
      w.stopReason = `监控已自动停：${stop === 'stop-fail' ? `连续 ${w.failStreak} 次失败` : '结果命中了停止串'}${why}`;
      watchStopLog.push(w.stopReason);
      if (watchStopLog.length > 5) watchStopLog.shift();
      el.count.textContent = w.stopReason;
      if (mode === 'watch') showWatchPanel();   // 正看着面板就刷新摘要
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

/** 第二十九轮⑧：性能面板 #/perf——体感问题的量化入口。
 * 列表项数 / 列表渲染耗时 / 搜索耗时三张卡，外加最近一次渲染时间。
 * 数字来自 perfStats（renderList/search 实测写入），不猜。 */
function showPerfPanel() {
  hidePanels();
  mode = 'perf';
  el.modeLabel.textContent = '性能';
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  if (location.hash !== '#/perf') history.replaceState(null, '', '#/perf');
  const views = el.listView.parentElement;
  let pane = document.getElementById('perfPane');
  if (!pane) {
    pane = document.createElement('div');
    pane.id = 'perfPane';
    pane.className = 'pane';
    views.appendChild(pane);
  }
  pane.classList.remove('hidden');
  pane.innerHTML = `
    <div class="pane-head"><h2>性能</h2>
      <button class="ghost mini" data-perf-refresh>重新测量</button></div>
    <div class="stat-cards">
      <div class="stat-card"><div class="stat-num">${perfStats.listItems}</div><div class="stat-label">列表项数</div></div>
      <div class="stat-card"><div class="stat-num">${perfStats.listMs} ms</div><div class="stat-label">列表渲染耗时</div></div>
      <div class="stat-card"><div class="stat-num">${perfStats.renderCount}</div><div class="stat-label">累计渲染次数</div></div>
      <div class="stat-card"><div class="stat-num">${perfStats.searchMs} ms</div><div class="stat-label">搜索打分耗时</div></div>
    </div>
    <p class="ps-empty" role="status">最近一次渲染：${perfStats.lastRenderAt ? new Date(perfStats.lastRenderAt).toLocaleString() : '尚未渲染'}。
    搜索输入有 150ms 防抖 + 请求动画帧合并；超过 60 项的搜索结果走虚拟滚动。</p>`;
  pane.querySelector('[data-perf-refresh]').addEventListener('click', () => {
    renderList();
    showPerfPanel();
  });
}

/** ⑥⑨ 监控聚合面板 #/watch：所有在跑的监控 + 采样 CSV 导出 */
function showWatchPanel() {
  hidePanels();
  mode = 'watch';
  el.modeLabel.textContent = t('modeWatch');
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
      ${w.stopReason ? `<span class="bad">${esc(w.stopReason)}</span>` : ''}
      <button class="ghost mini" data-wstop="${esc(k)}">停止</button>
      <button class="ghost mini" data-wcsv="${esc(k)}">导出 CSV</button>
      <button class="ghost mini" data-wmd="${esc(k)}" data-ai="1" title="把采样导出成 Markdown 趋势表（时间/值/变化），贴给 AI 或进文档">趋势 MD</button>
    </div>`;
  }).join('');
  const stopLog = watchStopLog.slice(-5).reverse();
  el.allowView.innerHTML = `
    <h2 class="ps-title">监控面板</h2>
    <div class="help">界面开着才会跑；翻到别的动作自动停。在只读动作详情页点「监控」添加。</div>
    ${rows || '<div class="ps-empty" role="status">没有在跑的监控。</div>'}
    ${stopLog.length ? `<div class="watch-stoplog"><div class="sub">最近自动停止：</div>${stopLog.map((l) => `<div class="watch-stoprow bad">${esc(l)}</div>`).join('')}</div>` : ''}`;
  showPanelAnimated(el.allowView);
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
  // 第三十七轮⑥：采样 → Markdown 趋势表（数值列环比用 cellDiff 文本）
  el.allowView.querySelectorAll('[data-wmd]').forEach((b) => b.addEventListener('click', () => {
    const w = watchRegistry()[b.dataset.wmd];
    if (!w || !w.samples.length) { el.count.textContent = '还没有采样，导出啥呀'; return; }
    const firstNum = w.samples.map((smp) => smp?.data).find((d) => d && typeof d === 'object' && !Array.isArray(d));
    const key = firstNum ? Object.keys(firstNum).find((k2) => typeof firstNum[k2] === 'number') : undefined;
    const md = watchTrendMarkdown(w.samples, (smp) => (key !== undefined ? smp?.data?.[key] : JSON.stringify(smp?.data)?.slice(0, 40)));
    navigator.clipboard.writeText(md).then(() => { el.count.textContent = `已复制 ${w.samples.length} 次采样趋势表（列 ${key ?? '摘要'}）`; }, () => { el.count.textContent = '复制失败（剪贴板被拒）'; });
  }));
}

/** 第二十二轮⑤⑥⑦：帮助页 #/help——HELP_TOPICS 逐段渲染，每段「去试用」深链 */
function showHelpPanel() {
  hidePanels();
  mode = 'help';
  el.modeLabel.textContent = t('modeHelp');
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  if (location.hash !== '#/help') history.replaceState(null, '', '#/help');
  const sections = HELP_TOPICS.map((t) => `
    <div class="help-topic" id="help-${esc(t.id)}">
      <h3>${esc(t.title)}</h3>
      <p>${esc(t.body)}</p>
      <button class="ghost mini" data-try="${esc(t.tryHash)}" title="跳到这个功能试一下">去试用 →</button>
    </div>`).join('');
  el.allowView.innerHTML = `
    <h2 class="ps-title">使用指南</h2>
    <div class="help">启动器能做什么、怎么上手，都在这一页。每段都有「去试用」直达。</div>
    ${sections}`;
  showPanelAnimated(el.allowView);
  el.allowView.querySelectorAll('[data-try]').forEach((b) => {
    b.addEventListener('click', () => {
      const h = b.dataset.try || '#/';
      location.hash = h;
      // 首页深链：applyHash 不跑（hash 可能没变），手动回列表
      if (h === '#/' && location.hash === '#/') {
        hidePanels();
        renderList();
      }
    });
  });
}

/** 第二十二轮②：快捷键速查表增强——帮助页入口（原 helpBtn 已指向这里升级为双入口） */

/* ===================== 第三十八轮：定时与调度 ===================== */

/** 定时任务引擎：interval 驱动 + 窗口判定 + 补跑 + 历史裁剪。
 * 与监控（watchRegistry）的分工：定时只管「到点跑」，监控管采样/diff/趋势。 */
function startTimerTick(key) {
  const reg = timerRegistry();
  const t = reg[key];
  if (!t || t.id) return;
  t.id = setInterval(() => fireTimer(key, 'auto'), t.interval * 1000);
  t.nextAt = Date.now() + t.interval * 1000;
}

async function fireTimer(key, why) {
  const reg = timerRegistry();
  const t = reg[key];
  if (!t || t.paused) return;
  // ②执行窗口：窗口外跳过并记 skipped（不重置节奏）
  const now = new Date();
  if (!inWindow(now, t.win)) {
    t.history = trimHistory([...(t.history ?? []), { ts: Date.now(), ok: null, why: 'skipped:窗口外' }]);
    t.nextAt = Date.now() + t.interval * 1000;
    return;
  }
  t.lastRanAt = Date.now();
  t.nextAt = Date.now() + t.interval * 1000;
  try {
    // 找到动作并静默执行（不抢焦点）
    const e = entries.find((x) => actionKey(x.plugin.id, x.action.id) === key);
    if (!e) throw new Error('动作不在了（插件被卸载？）');
    const res = await runActionQuiet(e.plugin, e.action, t.values ?? {});
    t.history = trimHistory([...(t.history ?? []), { ts: Date.now(), ok: res.ok === true, why: res.ok === true ? '' : String(res.error ?? '').slice(0, 80) }]);
    // ⑧失败通知带错误摘要（granted 时）
    if (res.ok !== true) {
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('zerokit 定时任务失败', { body: `${t.title}：${String(res.error ?? '').slice(0, 120)}`, tag: 'zerokit-timer' });
        }
      } catch { /* 通知是增强 */ }
    }
  } catch (err) {
    t.history = trimHistory([...(t.history ?? []), { ts: Date.now(), ok: false, why: String(err.message ?? err).slice(0, 80) }]);
  }
}

/** 静默执行：走 fetch /api/run，不碰界面焦点（submit 会写结果区抢走视图）。 */
async function runActionQuiet(plugin, action, values) {
  try {
    const r = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-zerokit-token': TOKEN },
      body: JSON.stringify({ plugin: plugin.id, action: action.id, values }),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, error: String(e.message ?? e) };
  }
}

/** ①②模态：档位快捷 + 自定义秒 + 执行窗口。 */
function openTimerDialog(plugin, action) {
  const key = actionKey(plugin.id, action.id);
  const reg = timerRegistry();
  const ex = reg[key];
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'timerDlg';
  const presets = TIMER_PRESETS.map((p) =>
    `<button type="button" class="ghost mini t-preset" data-sec="${p.sec}">${p.label}</button>`).join(' ');
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h3>定时执行：${esc(action.title)}</h3>
      <div class="help">界面开着才会跑。只读动作才允许定时（有副作用的自动跑风险太大）。</div>
      <div class="field"><label>间隔（秒）</label><input id="tSec" type="number" min="10" step="1" value="${ex?.interval ?? 60}"></div>
      <div class="field"><label>快捷档位</label><div class="chip-row">${presets}</div></div>
      <div class="field"><label>执行窗口（可空，如 09:00-18:00，窗口外跳过）</label>
        <input id="tWin" type="text" placeholder="09:00-18:00" value="${esc(ex?.win ?? '')}"></div>
      <div class="field"><label>用当前表单值作为定时参数</label>
        <input id="tVals" type="checkbox" ${ex?.values ? '' : 'checked'}></div>
      <div class="modal-actions">
        <button class="ghost" id="tCancel">取消</button>
        <button class="primary" id="tSave">${ex ? '更新' : '开始'}定时</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('.t-preset').forEach((b) => b.addEventListener('click', () => {
    overlay.querySelector('#tSec').value = b.dataset.sec;
  }));
  overlay.querySelector('#tCancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#tSave').addEventListener('click', () => {
    const sec = Number(overlay.querySelector('#tSec').value);
    const win = overlay.querySelector('#tWin').value.trim();
    const useVals = overlay.querySelector('#tVals').checked;
    if (!Number.isFinite(sec) || sec < 10) { el.count.textContent = '间隔至少 10 秒'; return; }
    if (!validWindow(win)) { el.count.textContent = '窗口格式应为 HH:MM-HH:MM'; return; }
    if (reg[key]) { clearInterval(reg[key].id); delete reg[key]; }
    reg[key] = {
      id: null, interval: sec, win,
      title: `${plugin.name} · ${action.title}`,
      values: useVals ? collectValues(action) : {},
      createdAt: Date.now(), lastRanAt: Date.now(),
      history: [], paused: false, nextAt: 0,
    };
    startTimerTick(key);
    overlay.remove();
    el.count.textContent = `已开启定时执行：每 ${sec} 秒一次${win ? `（窗口 ${win}）` : ''}（#/timers 可管理）`;
    // 第六十三轮①：落盘（CLI 与下次加载都能看到）
    api('/api/timers', { method: 'POST', body: { op: 'upsert', timer: {
      key, title: reg[key].title, interval: sec, win, createdAt: reg[key].createdAt,
      values: reg[key].values ?? {},
    } } }).catch(() => {});
  });
}


// ============================================================
// 第六十四轮：剪贴板工作流——历史留痕、识别建议、Ctrl+Shift+V 贴入即搜
// ============================================================
let clipHist = [];
function loadClipHist() {
  try { clipHist = JSON.parse(localStorage.getItem('zerokit.clip-hist') || '[]'); } catch { clipHist = []; }
}
function saveClipHist() {
  try { localStorage.setItem('zerokit.clip-hist', JSON.stringify(clipHist)); } catch { /* 满/禁用就算了 */ }
}
loadClipHist();

/** 识别结果建议卡：识别说明 + 推荐动作按钮（点击直达详情）。 */
function showClipSuggest(text) {
  const { kind, why } = classifyClip(text);
  const recs = clipSuggestions(kind)
    .map((k) => {
      // entries 元素是 {plugin, action}（都是对象），key 形如 插件id.动作id
      const e = entries.find((x) => `${x.plugin.id}.${x.action.id}` === k);
      return e ? { key: k, name: e.action.title, pluginId: e.plugin.id, actionId: e.action.id } : null;
    })
    .filter(Boolean);
  const overlay = document.createElement('div');
  overlay.className = 'clip-suggest zk-pop-in';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.setAttribute('role', 'dialog');
  const shown = text.length > 120 ? text.slice(0, 120) + '…' : esc(text);
  overlay.innerHTML = `
    <div class="cs-head">📋 剪贴板识别：${kind.toUpperCase()}<span class="cs-why">${esc(why)}</span></div>
    <div class="cs-text">${shown}${text.length > 500 ? `（共 ${text.length} 字符，已截断保存）` : ''}</div>
    <div class="cs-actions">
      ${recs.length
        ? recs.map((r) => `<button class="cs-go primary" data-go="${esc(r.pluginId)}/${esc(r.actionId)}">▶ ${esc(r.name)}</button>`).join('')
        : '<span class="cs-none">没有专门动作——去列表搜</span>'}
      <button class="ghost" data-search>当作搜索词</button>
      <button class="ghost" data-close>关闭</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (ev) => {
    const go = ev.target.closest('[data-go]');
    if (go) {
      overlay.remove();
      openDetail(go.dataset.go.split('/')[0], go.dataset.go.split('/')[1], { text });
      return;
    }
    if (ev.target.closest('[data-search]')) {
      overlay.remove();
      el.q.value = text.trim().slice(0, 200);
      active = 0;
      renderList();
      el.q.focus();
      return;
    }
    if (ev.target.closest('[data-close]') || ev.target === overlay) overlay.remove();
  });
}

/** Ctrl+Shift+V：读剪贴板并弹建议卡（不写搜索框——和 clipBtn 的搜索行为互补）。 */
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
    e.preventDefault();
    el.clipBtn.click();
  }
});

/** #/clip 剪贴板历史面板：可回写、单条删、清空。 */
function showClipPanel() {
  loadClipHist();   // 打开即重读——别拿模块加载时的旧快照
  hidePanels();
  mode = 'clip';
  el.modeLabel.textContent = '📋 剪贴板';
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  if (location.hash !== '#/clip') history.replaceState(null, '', '#/clip');
  const panel = el.allowView;   // 复用面板容器（与定时任务同款）
  showPanelAnimated(panel);
  const rows = clipHist.length
    ? clipHist.map((c, i) => `
      <div class="clip-row" data-i="${i}">
        <span class="clip-kind">${classifyClip(c.text).kind}</span>
        <span class="clip-text" title="${esc(c.text.slice(0, 200))}">${esc(c.text.slice(0, 80))}${c.full > 500 ? ` …（${c.full} 字符）` : ''}</span>
        <span class="clip-at">${new Date(c.at).toLocaleTimeString()}</span>
        <button class="ghost" data-write="${i}" title="写回剪贴板">↩</button>
        <button class="ghost" data-del="${i}" title="删除这条" aria-label="删除这条">✕</button>
      </div>`).join('')
    : '<div class="empty" role="status">还没有剪贴板历史——复制点东西再点 📋 按钮</div>';
  panel.innerHTML = `
    <div class="panel-head">
      <h2>📋 剪贴板历史</h2>
      <div class="panel-tools">
        <span class="dim">本地保留最近 ${clipHist.length}/20 条 · 不上报</span>
        <button class="ghost" id="clipClear">清空历史</button>
        <button class="ghost" id="clipBack">返回</button>
      </div>
    </div>
    <div class="clip-rows">${rows}</div>`;
  panel.querySelector('#clipBack').addEventListener('click', () => { location.hash = '#/'; });
  panel.querySelector('#clipClear').addEventListener('click', () => {
    clipHist = [];
    saveClipHist();
    showClipPanel();
  });
  panel.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    clipHist.splice(Number(b.dataset.del), 1);
    saveClipHist();
    showClipPanel();
  }));
  panel.querySelectorAll('[data-write]').forEach((b) => b.addEventListener('click', async () => {
    const c = clipHist[Number(b.dataset.write)];
    try { await navigator.clipboard.writeText(c.text); el.count.textContent = '已写回剪贴板'; }
    catch { el.count.textContent = '写剪贴板被浏览器拒绝'; }
  }));
}

function showTimers() {
  hidePanels();
  mode = 'timers';
  el.modeLabel.textContent = t('modeTimers');
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  if (location.hash !== '#/timers') history.replaceState(null, '', '#/timers');
  const reg = timerRegistry();
  // ③补跑：打开面板时对错过的任务各补一次（shouldCatchUp 保证只一次）
  for (const k of Object.keys(reg)) {
    if (shouldCatchUp(reg[k])) fireTimer(k, 'catchup').then(() => renderTimersRows()).catch(() => {});
  }
  el.allowView.innerHTML = `
    <h2 class="ps-title">定时任务</h2>
    <div class="help">界面开着才会跑（关掉页面即停）。在只读动作详情页点「定时」添加。</div>
    <div class="timers-actions">
      <button class="ghost mini" id="timersExport" data-ai="1">导出 JSON</button>
      <button class="ghost mini" id="timersImport">导入 JSON</button>
      <input type="file" id="timersFile" accept=".json" class="hidden">
    </div>
    <div id="timersRows"></div>`;
  showPanelAnimated(el.allowView);
  renderTimersRows();
  // ⑨导出/导入
  el.allowView.querySelector('#timersExport')?.addEventListener('click', async (ev) => {
    const pack = exportTimers(timerRegistry());
    const name = exportFilename('timers', 'json');
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    ev.currentTarget.textContent = '已导出';
    setTimeout(() => { ev.currentTarget.textContent = '导出 JSON'; }, 1200);
  });
  const fileBtn = el.allowView.querySelector('#timersFile');
  el.allowView.querySelector('#timersImport')?.addEventListener('click', () => fileBtn?.click());
  fileBtn?.addEventListener('change', async () => {
    const f = fileBtn.files?.[0];
    if (!f) return;
    const r = parseTimersPack(await f.text());
    if (!r.ok) { el.count.textContent = `导入失败：${r.error}`; return; }
    const reg2 = timerRegistry();
    let added = 0;
    for (const [k, cfg] of Object.entries(r.pack.timers)) {
      if (reg2[k]) continue;   // 已有的不覆盖（本机配置优先）
      reg2[k] = { id: null, interval: cfg.interval, win: cfg.win ?? '', title: cfg.title ?? k,
        values: {}, createdAt: Date.now(), lastRanAt: Date.now(), history: [], paused: !!cfg.paused, nextAt: 0 };
      if (!cfg.paused) startTimerTick(k);
      added++;
    }
    el.count.textContent = `导入完成：新增 ${added} 个定时任务`;
    renderTimersRows();
  });
}

/** 面板行渲染：独立函数以便执行后局部刷新（不整页重画）。 */
function renderTimersRows() {
  const host = document.getElementById('timersRows');
  if (!host) return;
  const reg = timerRegistry();
  const rows = Object.entries(reg).map(([k, tm]) => {
    const hist = tm.history ?? [];
    const last = hist[hist.length - 1];
    const lastTxt = !last ? '还没跑过'
      : last.ok === null ? `跳过（${esc(last.why ?? '')}）`
      : last.ok ? `✓ ${new Date(last.ts).toLocaleTimeString()}`
      : `✗ ${new Date(last.ts).toLocaleTimeString()} ${esc(last.why ?? '')}`;
    return `
    <div class="run-row timer-row" data-tk="${esc(k)}">
      <span class="badge">⏱</span>
      <span class="run-when">${esc(tm.title)}（每 ${esc(String(tm.interval))} 秒${tm.win ? ` · 窗口 ${esc(tm.win)}` : ''}${tm.paused ? ' · 已暂停' : ''}）</span>
      <span class="timer-next" title="下次触发">${tm.paused ? '—' : nextRunLabel(tm.nextAt ?? Date.now())}</span>
      <span class="timer-last" title="最近一次">${lastTxt}</span>
      <button class="ghost mini" data-trun="${esc(k)}" title="立即跑一次，不影响节奏">现在跑</button>
      <button class="ghost mini" data-tpause="${esc(k)}">${tm.paused ? '恢复' : '暂停'}</button>
      <button class="ghost mini" data-thist="${esc(k)}" title="最近 10 次">历史</button>
      <button class="ghost mini" data-stop="${esc(k)}">停止</button>
    </div>`;
  }).join('');
  host.innerHTML = rows || '<div class="ps-empty" role="status">没有定时任务。在只读动作详情页点「定时」添加。</div>';
  host.querySelectorAll('[data-trun]').forEach((b) => b.addEventListener('click', () => {
    fireTimer(b.dataset.trun, 'manual').then(() => renderTimersRows());
  }));
  host.querySelectorAll('[data-tpause]').forEach((b) => b.addEventListener('click', () => {
    const tm = timerRegistry()[b.dataset.tpause];
    if (!tm) return;
    tm.paused = !tm.paused;
    if (tm.paused && tm.id) { clearInterval(tm.id); tm.id = null; }
    else if (!tm.paused) startTimerTick(b.dataset.tpause);
    renderTimersRows();
  }));
  host.querySelectorAll('[data-thist]').forEach((b) => b.addEventListener('click', () => {
    const tm = timerRegistry()[b.dataset.thist];
    if (!tm) return;
    const lines = (tm.history ?? []).slice().reverse().map((h) =>
      `<div class="timer-hist-line">${h.ok === null ? '⏭' : h.ok ? '✓' : '✗'} ${new Date(h.ts).toLocaleString()} ${esc(h.why ?? '')}</div>`).join('');
    const row = b.closest('.timer-row');
    const old = row?.querySelector('.timer-hist');
    if (old) { old.remove(); return; }
    const div = document.createElement('div');
    div.className = 'timer-hist';
    div.innerHTML = lines || '<div class="timer-hist-line">还没有记录</div>';
    row?.appendChild(div);
  }));
  host.querySelectorAll('[data-stop]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.stop;
    const tm = timerRegistry()[k];
    if (tm) { if (tm.id) clearInterval(tm.id); delete timerRegistry()[k]; }
    renderTimersRows();
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
  if (btn) { btn.disabled = true; btn.textContent = '执行中…'; btn.classList.add('running'); }
  try {
    $('previewBox').innerHTML = '';
    $('invokeBox').innerHTML = '';
    // 第二十五轮②：链模式下参数里的 {result.data.字段} 占位符先填再校验（危险检测看到真实值）
    const values = chainFillValues(collectValues(action));
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
    if (res.ok === true) pushResultTab(res);   // 第二十三轮①：成功结果进页签工作台
    if (res.ok === true && action.risk === 'destructive') renderUndoHint(plugin, action);
    if (res.ok === true) renderChainNext(plugin, action, res);   // 第二十五轮①②③：链下一步
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
      values,           // 第二十五轮⑨：留参数给「用这些参数重跑」
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
    if (b) { b.disabled = false; b.textContent = '▶ 执行'; b.classList.remove('running'); }
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
      <div class="modal" role="dialog" aria-modal="true">
        <h3>确认执行</h3>
        <div class="risk-note">
          ${esc(plugin.name)} · ${esc(action.title)} ·
          <span class="badge ${esc(action.risk)}">${esc(riskText(action.risk))}</span>
        </div>
        <div class="confirm-explain">${riskExplain}</div>
        <div class="cmd-line">${esc(res.command || '(无动作)')}</div>
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
      <span class="badge ${esc(action.risk)}">${esc(riskText(action.risk))}</span>
      <span class="sub">${esc(why)}</span>
    </div>
    ${card.runs ? `<div class="risk-stats">历史 ${card.runs} 次 · 失败率 ${pct}%${pct >= 40 ? ' ⚠' : ''} · 平均 ${esc(formatMs(card.avgMs))}</div>` : '<div class="risk-stats sub">还没有执行记录——首次执行没有历史可参考。</div>'}`;
}

/** ④ 脱敏开关：默认打码。状态挂在 body data 上，renderResult / 日志渲染都读它。 */
function maskState() { return document.body.dataset.zkMask !== 'off'; }
function toggleMask() {
  document.body.dataset.zkMask = maskState() ? 'off' : 'on';
  const btn = $('maskBtn');
  if (btn) btn.textContent = maskState() ? '🕶 脱敏切换（当前：打码中）' : '👁 脱敏切换（当前：明文）';
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

// ---------------------------------------------------------------- 第二十轮：数据备份与迁移
//
// 个性化数据全在 localStorage（zerokit.* 键），换机器/清缓存就全丢。
// 导出 = 全量键值打包成信封 JSON；导入 = 校验 → 预览分组 → 勾选 → 合并（新优先）。

function exportBackup() {
  const entries = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    entries.push([k, localStorage.getItem(k)]);
  }
  const backup = collectBackup(entries);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFilename();
  a.click();
  URL.revokeObjectURL(url);
  el.count.textContent = `已导出 ${backup.meta.keyCount} 个键（${backup.meta.bytes} 字符）→ ${backupFilename()}`;
}

/** 导入三步：选文件 → parseBackup 校验 → 分组预览+勾选 → mergeBackup 合并写回并重载 */
function openImportDialog() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseBackup(text);
    if (!parsed.ok) {
      el.count.textContent = `导入失败：${parsed.error}`;
      return;
    }
    const backup = parsed.backup;
    // 分组统计：每组多少键，预览时全选上（用户去掉不想导入的组）
    const groups = new Map();
    for (const k of Object.keys(backup.keys)) {
      const g = classifyKey(k) ?? '(跳过)';
      groups.set(g, (groups.get(g) ?? 0) + 1);
    }
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>导入备份</h3>
        <div class="risk-note">来自 ${esc(backup.exportedAt || '未知时间')} · v${esc(backup.version || '?')} · 共 ${Object.keys(backup.keys).length} 个键</div>
        <div class="import-groups">
          ${[...groups.entries()].map(([g, n]) => `
            <label class="import-group">
              <input type="checkbox" data-group="${esc(g)}" ${g !== '(跳过)' ? 'checked' : ''} ${g === '(跳过)' ? 'disabled' : ''}>
              <span>${esc(g)} <small>(${n} 键)</small></span>
            </label>`).join('')}
        </div>
        <div class="confirm-explain">合并策略：同名数据以备份为准（新优先），本地独有条目保留。</div>
        <div class="actions">
          <button class="ghost" id="impCancel">取消</button>
          <button class="primary" id="impOk">导入</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#impCancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#impOk').addEventListener('click', () => {
      const selected = new Set(
        [...overlay.querySelectorAll('input[data-group]:checked')].map((c) => c.dataset.group)
      );
      // 当前 localStorage 快照成键值表
      const current = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        current[k] = localStorage.getItem(k);
      }
      const { out, applied, skipped } = mergeBackup(current, backup.keys, selected);
      for (const [k, v] of Object.entries(out)) {
        try { localStorage.setItem(k, v); } catch { /* 私密模式尽力而为 */ }
      }
      overlay.remove();
      el.count.textContent = `导入完成：应用 ${applied} 项、跳过 ${skipped} 项，即将刷新…`;
      setTimeout(() => location.reload(), 900);
    });
  };
  input.click();
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
      <button class="ghost" data-rerun>重跑</button>
      ${r.values ? `<button class="ghost" data-rerunp="${i}" title="用这次的历史参数回填表单再跑">用这些参数重跑</button>` : ''}${list.length >= 2 ? `
      <button class="ghost" data-diff="${i}" ${i === 0 ? 'disabled title="这就是最新一次，选更早的一条来对比"' : 'title="和最新一次的结果逐格对比"'}>与最新对比</button>` : ''}
      <button class="ghost mini" data-pick="${i}" title="选进 A/B 对比槽">选比</button>
      <button class="ghost mini" data-curl="${i}" data-ai="1" title="复制这条执行的 curl 等价命令（token 用占位符，真令牌不进剪贴板）">curl</button>
    </div>`).join('')}
    <div class="help" id="diffPickHint" style="margin-top:4px"></div>`;
  box.querySelectorAll('[data-rerun]').forEach((b) => b.addEventListener('click', () => submit(false)));
  // 第三十七轮⑦：单条执行 → curl 等价命令（API 形状；令牌只给占位符）
  box.querySelectorAll('[data-curl]').forEach((b) => b.addEventListener('click', () => {
    const r = list[Number(b.dataset.curl)];
    const cmd = toCurl({ plugin: plugin.id, action: action.id, values: r?.values ?? {}, port: Number(location.port) || 28970 });
    navigator.clipboard.writeText(cmd).then(() => { b.textContent = '已复制'; setTimeout(() => { b.textContent = 'curl'; }, 1500); }, () => { el.count.textContent = '复制失败（剪贴板被拒）'; });
  }));
  // 第二十五轮⑨：一键回填历史参数再跑
  box.querySelectorAll('[data-rerunp]').forEach((b) => b.addEventListener('click', () => {
    const r = list[Number(b.dataset.rerunp)];
    if (r?.values) {
      paramStore[actionKey(plugin.id, action.id)] = { ...r.values };
      openDetail(plugin, action);
      el.count.textContent = '已回填该次参数';
      submit(false);
    }
  }));
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
    <div class="modal" role="dialog" aria-modal="true">
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

// 第二十五轮①②③：手动链。chainSteps 记录当前链（[{pluginId, actionId, title, res}]），
// 成功后弹「接着跑」选择器；下一步参数里 {result.data.字段} 用上一步结果填。
let chainSteps = [];
function chainActive() { return chainSteps.length > 0; }

/** ①链下一步选择器：只读动作用收藏/最近优先列出；destructive 不进链（链是自动化，风险要显式） */
function renderChainNext(plugin, action, res) {
  chainSteps.push({ pluginId: plugin.id, actionId: action.id, title: action.title, res });
  const box = $('result');
  if (!box) return;
  renderChainSteps(box);
  // 候选：只读动作，收藏优先
  const cands = entries.filter((e) => e.action.risk === 'read')
    .sort((a, b) => (favorites.includes(actionKey(b.plugin.id, b.action.id)) ? 1 : 0)
      - (favorites.includes(actionKey(a.plugin.id, a.action.id)) ? 1 : 0))
    .slice(0, 8);
  const next = document.createElement('div');
  next.className = 'cmd-box chain-next';
  next.id = 'chainNext';
  next.innerHTML = `
    <div class="cmd-box-head">完成后接着跑（第 ${chainSteps.length + 1} 步）</div>
    <div class="chain-cands">${cands.map((e, i) => `
      <button class="ghost mini" data-chain="${i}" title="${esc(e.plugin.name)} · ${esc(e.action.id)}">${esc(e.action.title)}</button>`).join('')}</div>
    <div class="help">下一步的参数里可用 <code>{result.data.字段}</code> / <code>{result.stdout}</code> 引用本步结果（同 CLI chain 语义）。</div>
    <div class="chain-row">
      <button class="ghost mini" id="chainEnd">结束链</button>
      <button class="ghost mini" id="chainRunNext" disabled>先选一个动作</button>
    </div>`;
  box.appendChild(next);
  let picked = null;
  next.querySelectorAll('[data-chain]').forEach((b) => b.addEventListener('click', () => {
    picked = cands[Number(b.dataset.chain)];
    next.querySelectorAll('[data-chain]').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    const runBtn2 = next.querySelector('#chainRunNext');
    if (runBtn2) { runBtn2.disabled = false; runBtn2.textContent = `去填参数：${picked.action.title}`; }
  }));
  next.querySelector('#chainEnd')?.addEventListener('click', () => {
    chainSteps = [];
    next.remove();
    const bar2 = document.getElementById('chainStepsBar');
    bar2?.remove();
    el.count.textContent = '链已结束';
  });
  next.querySelector('#chainRunNext')?.addEventListener('click', () => {
    if (!picked) return;
    next.remove();
    openDetail(picked.plugin, picked.action);
    el.count.textContent = `链第 ${chainSteps.length + 1} 步：参数里可用 {result.data.字段} 引用上一步`;
  });
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

/** ②链占位符注入：提交前把 {result.data.x}/{result.stdout} 换成链上一步的值 */
function chainFillValues(values) {
  if (!chainActive() || !values || typeof values !== 'object') return values;
  const prev = chainSteps.at(-1)?.res;
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = typeof v === 'string' ? chainFill(v, prev) : v;
  }
  return out;
}

// 第二十三轮：结果页签工作台。tabs=[{id,res,name,ts,pinned,note}]；activeTab=当前页签 id。
const resultTabs = [];
let activeTab = null;
function tabById(id) { return resultTabs.find((t) => t.id === id) ?? null; }

/** 结果进页签：新成功结果 upsert 到当前页签（同动作重跑=刷新），否则开新页签并逐出旧的 */
function pushResultTab(res) {
  if (!detail) return;
  const name = detail.action.title || detail.action.id;
  const sameActionTab = tabById(activeTab);
  const entry = {
    id: `t${Date.now()}${Math.floor(Math.random() * 1000)}`,
    res, name, ts: Date.now(), pinned: false, note: '',
    pluginId: detail.plugin.id, actionId: detail.action.id,
  };
  // 同一动作重跑：沿用当前页签（保 pinned/note），只换结果与时间
  if (sameActionTab && sameActionTab.pluginId === detail.plugin.id && sameActionTab.actionId === detail.action.id) {
    sameActionTab.res = res; sameActionTab.ts = entry.ts;
    renderTabBar();
    return;
  }
  let next = resultTabs.slice();
  if (next.length >= 8) next = tabEvict(next, 7);   // 给新页签腾位
  if (next.length >= 8 && next.every((t) => t.pinned)) { el.count.textContent = '页签满了：先关或取消固定一个'; return; }
  next.push(entry);
  resultTabs.length = 0; resultTabs.push(...next);
  activeTab = entry.id;
  renderTabBar();
}

/** ①②③④⑧页签栏渲染：挂在 #result 上方（detail 视图内动态插） */
function renderTabBar() {
  const box = $('result');
  if (!box) return;
  box.setAttribute('role', 'tabpanel');
  box.setAttribute('aria-label', '结果内容');
  let bar = $('rtabs');
  if (!resultTabs.length) { bar?.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'rtabs'; bar.className = 'rtabs';
    box.parentNode?.insertBefore(bar, box);
  }
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', '结果页签');
  bar.innerHTML = resultTabs.map((t) => `
    <button class="rtab${t.id === activeTab ? ' active' : ''}" data-rtab="${esc(t.id)}"
      role="tab" aria-selected="${t.id === activeTab}"
      tabindex="${t.id === activeTab ? '0' : '-1'}"
      title="${esc(t.note ? `备注：${t.note}` : '点击切换 · 双击写备注 · 右键固定/取消固定')}${t.pinned ? '（已固定）' : ''}">
      ${t.pinned ? '📌 ' : ''}${esc(resultTabTitle(t.name, t.ts, Date.now(), lang))}
      <span class="rtab-note" data-rn="${esc(t.id)}" title="写备注" aria-label="写备注">✎</span>
      <span class="rtab-x" data-rx="${esc(t.id)}" title="关闭" aria-label="关闭">✕</span>
    </button>`).join('')
    + (resultTabs.length >= 2 ? '<button class="rtab rtab-cmp ghost" data-rcmp title="选两个页签并排对比">⇄ 对比</button>' : '');
  if (!bar.dataset.roving) {
    bar.dataset.roving = '1';
    bar.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const tabs = [...bar.querySelectorAll('[data-rtab]')];
      const cur = tabs.findIndex((t) => t.classList.contains('active'));
      const next = tabs[(cur + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      if (!next) return;
      e.preventDefault();
      next.click();                       // 先切：click 会重画页签栏（innerHTML 重建）
      const after = bar.querySelector(`[data-rtab="${CSS.escape(next.dataset.rtab ?? '')}"]`);
      after?.focus();                     // 重画后再聚焦，焦点不掉回 body
    });
  }
  bar.querySelectorAll('[data-rtab]').forEach((b) => {
    const tid = b.dataset.rtab;
    b.addEventListener('click', (e) => {
      if (e.target.closest('[data-rx]')) return;
      if (e.target.closest('[data-rn]')) {   // 第三十轮④：✎ 按钮=双击的显式入口（触屏无双击）
        e.stopPropagation();
        b.dispatchEvent(new MouseEvent('dblclick', { bubbles: false }));
        return;
      }
      const t = tabById(tid);
      if (!t) return;
      activeTab = t.id;
      renderResult(t.res);
      renderTabBar();
    });
    // ⑧备注：双击页签写一句，title 显示
    b.addEventListener('dblclick', () => {
      const t = tabById(tid);
      if (!t) return;
      const v = prompt('给这个结果写句备注（页签悬停可见，复制可附带）：', t.note || '');
      if (v === null) return;
      t.note = String(v).slice(0, 60);
      renderTabBar();
      el.count.textContent = t.note ? '备注已保存' : '备注已清空';
    });
    // ④固定：右键切换 pinned——固定页签不会被新结果挤出
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const t = tabById(tid);
      if (!t) return;
      t.pinned = !t.pinned;
      renderTabBar();
      el.count.textContent = t.pinned ? '已固定（不会被挤出）' : '已取消固定';
    });
  });
  bar.querySelectorAll('[data-rx]').forEach((x) => x.addEventListener('click', (e) => {
    e.stopPropagation();
    const idx = resultTabs.findIndex((t) => t.id === x.dataset.rx);
    if (idx < 0) return;
    resultTabs.splice(idx, 1);
    if (activeTab === x.dataset.rx) {
      const last = resultTabs.at(-1);
      activeTab = last ? last.id : null;
      if (last) renderResult(last.res); else refreshResult();
    }
    renderTabBar();
  }));
  // ⑦对比：前两个未固定顺序取最早两个？不——取「当前激活 + 最近一个其它页签」
  bar.querySelector('[data-rcmp]')?.addEventListener('click', () => {
    const cur = tabById(activeTab);
    const other = resultTabs.filter((t) => t.id !== activeTab).at(-1);
    if (!cur || !other) { el.count.textContent = '对比需要两个页签'; return; }
    showCompareView(cur, other);
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

function refreshResult() {
  if (currentResult) renderResult(currentResult);
}


// 第三十轮③：触屏长按（500ms 不动）合成 contextmenu——移动端浏览器不派发右键事件，
// 列复制/固定页签/结果菜单这些右键入口在触屏上够不着。全局一次监听，合成事件
// 带原生手势（preventDefault 可用），已存在的 contextmenu 监听器无需改动。
(function bindLongPressContextmenu() {
  let timer = 0; let sx = 0; let sy = 0; let target = null;
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    target = e.target; sx = t.clientX; sy = t.clientY;
    timer = setTimeout(() => {
      timer = 0;
      target?.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: sx, clientY: sy,
      }));
    }, 500);
  }, { passive: true });
  const cancel = () => { if (timer) { clearTimeout(timer); timer = 0; } };
  document.addEventListener('touchmove', (e) => {
    if (!timer) return;
    const t = e.touches[0];
    if (Math.abs(t.clientX - sx) > 8 || Math.abs(t.clientY - sy) > 8) cancel();
  }, { passive: true });
  document.addEventListener('touchend', cancel, { passive: true });
  document.addEventListener('touchcancel', cancel, { passive: true });
})();

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


// 第四十八轮③：失败卡重试/折叠——委托绑在 #result 容器（innerHTML 重建后仍有效）
document.addEventListener('click', (e) => {
  // 第四十九轮①：与上次对比——取当前结果 + runStore 里倒数第二次
  const cmpBtn = e.target.closest?.('#cmpLast');
  if (cmpBtn) {
    e.preventDefault();
    const runs = runStore[actionKey(detail?.plugin?.id ?? '', detail?.action?.id ?? '')] ?? [];
    const cur = runs.at(-1), prev = runs.at(-2);
    if (!cur || !prev) { el.count.textContent = '没有两次可对比的结果'; return; }
    showCompareView({ res: cur }, { res: prev });
    return;
  }
  const retryBtn = e.target.closest?.('[data-fail-retry]');
  if (retryBtn) { e.preventDefault(); const rb = document.querySelector('#runBtn'); rb?.click(); return; }
  const foldBtn = e.target.closest?.('[data-fail-fold]');
  if (foldBtn) {
    const t = document.getElementById(foldBtn.dataset.failFold ?? '');
    if (t) t.classList.toggle('hidden');
    foldBtn.textContent = t?.classList.contains('hidden')
      ? foldBtn.textContent.replace('收起', '展开') : foldBtn.textContent.replace('展开', '收起');
  }
});
function renderResult(res) {
  // 第四十七轮⑦：结果区高度自适应——行数决定紧凑/常规/滚动
  const rc = Array.isArray(res?.data) ? res.data.length
    : (res?.data && typeof res.data === 'object' ? Object.keys(res.data).length : 1);
  const tier = resultHeightTier(rc);
  const isRepaint = res === currentResult;   // 先判再赋值（第二十九轮⑤：重画沿用 tableId）
  currentResult = res;
  if (res && (res.data !== undefined || res.stdout !== undefined || res.error)) lastResult = res;   // 第十九轮④：脱敏切换重画用
  lastExport = null;  // 第十七轮④⑥：每次新结果清掉旧导出记录
  const box = $('result');
  if (!box) return;
  // 第四十七轮⑦：挂高度档位类（compact/normal/scroll）
  box.classList.remove('height-compact', 'height-normal', 'height-scroll');
  box.classList.add(`height-${tier}`);
  // 第五十九轮⑦：新结果滑入动画（重画/脱敏切换不重放）
  if (!isRepaint) {
    box.classList.remove('result-anim');
    void box.offsetWidth;
    box.classList.add('result-anim');
  }
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
    // 第四十八轮②③：失败卡片——分类标题 + 建议步骤 + 同参数重试 + 原文折叠
    const cls = classifyError(`${res.error}\n${res.stderr ?? ''}`);
    const errId = `errfold${++resultSeq}`;
    const rawLen = String(res.error).length;
    body += `<div class="fail-card" data-fail-kind="${esc(cls.kind)}">
      <div class="fail-title">✗ ${esc(cls.title)}</div>
      <div class="fail-steps">${cls.steps.map((st) => `<div class="fail-step">→ ${esc(st)}</div>`).join('')}</div>
      <div class="fail-actions">
        <button class="ghost" data-fail-retry="1">↻ 同参数重试</button>
        ${rawLen > 200
          ? `<button class="ghost" data-fail-fold="${errId}">展开原始错误（${rawLen} 字符）</button>`
          : ''}
      </div>
      <pre class="out fail-raw ${rawLen > 200 ? 'hidden' : ''}" id="${errId}" style="color:var(--bad)">${esc(masked(res.error))}</pre>
    </div>`;
  }
  if (res.render === 'web' && detail) {
    // 插件自己的页面渲染结果：沙箱 iframe，无 allow-same-origin——
    // 页面拿不到令牌、fetch 不了宿主 API，执行只能走桥（见下方 zkit 桥）
    // 第六十一轮④：清单声明的 ui_height 作为首帧高度（缺省 360），桥的 resize 仍可覆盖——
    // 声明式配置解决「首帧闪烁回正」：不再先 360 再被桥消息顶到真实高度。
    const h = Math.max(120, Math.min(4096, Number(detail.action.ui_height) || 360));
    body += `<iframe class="web-frame" sandbox="allow-scripts" style="height:${h}px"
      src="/p/${esc(detail.plugin.id)}/index.html" title="${esc(detail.action.title)}"></iframe>`;
  } else if (res.render === 'html' && res.stdout) {
    // output = "html"：stdout 本身就是 HTML 片段，沙箱里直接渲染
    body += `<iframe class="web-frame html" sandbox="allow-scripts" srcdoc="${esc(res.stdout)}"></iframe>`;
  } else if (res.data !== undefined) {
    // 第二十九轮⑤：refreshResult（同一结果重画）沿用旧 tableId，
    // 否则 tableFullLoad / resultQueryTerms / colvis 等按 tableId 记的状态每次重画全丢
    if (!isRepaint) resultSeq++;
    body += renderData(res.data, res.render, `r${resultSeq}`);
  } else if (res.stdout) {
    // 长输出折叠：超 60 行时收起后 40+ 行，一个按钮展开——翻 2000 行日志不废手
    const lines = String(res.stdout).split('\n');
    if (lines.length > 60) {
      const shown = lines.slice(0, 60).join('\n');
      const rest = lines.slice(60).join('\n');
      const id = `fold${++resultSeq}`;
      body += `${renderPreNumbered(masked(shown))}`
        + `<span class="fold-hint">… 还有 ${lines.length - 60} 行</span>`
        + `<button class="fold-btn" data-fold="${id}">展开全部</button>`
        + `<span class="fold-rest hidden" id="${id}">${esc(masked(rest))}</span></pre>`;
    } else {
      body += renderPreNumbered(masked(res.stdout));
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
  // 第三十九轮⑧：备注是长 Markdown（>3 个标题）时配目录，点击跳到对应标题
  let srcNote = '';
  if (res.note) {
    const toc = tocFromMd(res.note);
    const tocHtml = toc.length ? `<nav class="md-toc" aria-label="目录">${toc.map((h) =>
      `<a href="javascript:void 0" class="md-toc-l${h.level}" data-toc="${esc(h.text)}">${esc(h.text)}</a>`).join('')}</nav>` : '';
    srcNote = `<div class="detail-note">📌 ${esc(res.note)}${tocHtml}</div>`;
  }

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
        <button class="ghost" id="copyRes" title="复制结果；Shift=美化 JSON；Alt=带备注与时间">复制</button>
        <button class="ghost" id="saveRes" title="把结果存成文本文件">下载</button>
        <button class="ghost" id="mdRes" title="导出成 Markdown（表格/代码块），方便贴进文档或 Issue">导出 Markdown</button>
        <button class="ghost" id="shareMdRes" title="导出分享 Markdown 单文件（含执行信息折叠头，贴 Issue/文档即用）">⧉ 分享 MD</button>
        <button class="ghost" id="shareHtmlRes" title="导出分享 HTML 单文件（内联样式，双击浏览器直接看，无外链）">⧉ 分享 HTML</button>
        <button class="ghost" id="shareCopyRes" title="复制分享文本（Markdown，含元数据头；超过 50KB 自动截断）">⧉ 复制分享</button>
        ${res.data !== undefined ? `<button class="ghost" id="csvRes" title="导出成 CSV，Excel / Numbers 直接打开">导出 CSV</button>
        <button class="ghost" id="jsonRes" title="导出成 JSON，给脚本接着处理">导出 JSON</button>
        ${toJsonl(res.data) ? `<button class="ghost" id="jsonlRes" title="导出 JSONL（每行一个 JSON，jq / ndjson 友好）">导出 JSONL</button>
        <button class="ghost" id="llmRes" data-ai="1" title="导出 LLM 批处理 JSONL（每行 {input,expected}，补上期望值就是评测集）">LLM JSONL</button>` : ''}` : ''}
        ${Array.isArray(res.data) && res.data.length && typeof res.data[0] === 'object' ? `<button class="ghost" id="mdTableRes" title="复制为 Markdown 表格（数字列右对齐）">复制 MD 表</button>
        <button class="ghost" id="tsvRes" title="复制为 TSV（Excel/Numbers 直接粘贴）">复制 TSV</button>
        <button class="ghost" id="htmlRes" title="复制为 HTML 表格（贴进邮件/文档带格式）">复制 HTML 表</button>` : ''}
        <button class="ghost" id="aiRes" data-ai="1" title="复制为 LLM 友好的 Markdown（表格/属性行+动作名+时间）——直接粘进 AI 对话">给 AI</button>
        <button class="ghost" id="ctxRes" data-ai="1" title="打包当前结果+最近执行+插件清单成一段上下文，粘给 AI 免得重新描述">AI 上下文</button>
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
      <div class="rmeta sub" role="contentinfo">${res.ms !== undefined ? `耗时 ${formatMs(res.ms)}` : ''}${res.code !== undefined && res.code !== 0 ? ` · 退出码 ${res.code}` : ''}${res.at ? ` · ${new Date(res.at).toLocaleTimeString()}` : ''}</div>
    </div>`;

  $('copyRes')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    // 第十七轮①②：清单 copy_template 优先；Shift+点=美化 JSON（默认紧凑）
    let text = copyText;
    if (detail?.action?.copy_template) {
      const rendered = renderCopyTemplate(detail.action.copy_template, res);
      if (rendered !== null) text = rendered;
    } else if (ev.shiftKey && res.data !== undefined) {
      // 第二十九轮⑨：大结果美化序列化走切片，不阻塞 UI
      const big = JSON.stringify(res.data).length > 262144;
      if (big) {
        btn.textContent = '序列化中…';
        text = await chunkedStringify(res.data, null, 2);
      } else text = JSON.stringify(res.data, null, 2);
    }
    // 第二十三轮⑨：Alt+点=带备注复制（有备注的页签附上备注头与时间）
    if (ev.altKey) {
      const t = tabById(activeTab);
      text = withNoteHeader(text, t?.note || '', t?.ts);
      btn.textContent = '已复制(带备注)';
      try { await navigator.clipboard.writeText(text); } catch { btn.textContent = '复制失败'; }
      setTimeout(() => { btn.textContent = '复制'; }, 1500);
      return;
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
  // 第六十五轮：分享三路——MD 单文件 / HTML 单文件 / 复制分享文本
  if (res.data !== undefined && detail) {
    const shareMeta = {
      plugin: detail.plugin.id, action: detail.action.id,
      at: Date.now(), ms: res.ms, ok: res.ok !== false,
      params: collectValues(detail.action),
    };
    exportAs('shareMdRes', toShareMarkdown(res.data, shareMeta), 'text/markdown;charset=utf-8', 'md');
    exportAs('shareHtmlRes', toShareHtml(res.data, shareMeta), 'text/html;charset=utf-8', 'html');
    const btn = document.getElementById('shareCopyRes');
    if (btn) btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(toShareMarkdown(res.data, shareMeta, { full: false }));
        el.count.textContent = '分享文本已复制（Markdown，含执行信息头）';
      } catch { el.count.textContent = '复制被浏览器拒绝'; }
    });
  }
  if (res.data !== undefined) {
    exportAs('csvRes', '\ufeff' + toCsv(res.data), 'text/csv;charset=utf-8', 'csv');  // BOM：Excel 中文不乱码
    exportAs('jsonRes', JSON.stringify(res.data, null, 2), 'application/json', 'json');
    // 第十七轮③：JSONL 导出（每行一个对象，jq / ndjson 友好）
    const jsonl = toJsonl(res.data);
    if (jsonl) exportAs('jsonlRes', jsonl, 'application/x-ndjson', 'jsonl');
    // 第三十七轮④：LLM 批处理形状 {input, expected:null}——用户补 expected 就是评测集
    if (Array.isArray(res.data)) exportAs('llmRes', toLlmJsonl(res.data) + '\n', 'application/x-ndjson', 'jsonl');
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

  // 第三十七轮①：给 AI——LLM 友好 Markdown 一键复制（隐私开关 aiAssist 关时按钮不渲染，双保险）
  $('aiRes')?.addEventListener('click', async (ev) => {
    const md = toAiMarkdown(res, { name: detail ? `${detail.plugin.name} · ${detail.action.title}` : '结果', ts: Date.now() });
    try {
      await navigator.clipboard.writeText(md);
      ev.currentTarget.textContent = '已复制';
    } catch { ev.currentTarget.textContent = '复制失败'; }
    setTimeout(() => { const b = $('aiRes'); if (b) b.textContent = '给 AI'; }, 1500);
  });
  // ②：AI 上下文——当前结果 + 最近 3 次执行 + 已装插件摘要，粘进对话免得重新描述
  $('ctxRes')?.addEventListener('click', async (ev) => {
    const runs = Object.values(runStore).flat().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 3);
    const plugins = (window.__zkPlugins || plugins).map((pl) => ({
      id: pl.id, name: pl.name,
      actions: (pl.actions || []).map((a) => ({ id: a.id, title: a.title })),
    }));
    const ctx = packContext({
      current: { res, name: detail ? `${detail.plugin.id}.${detail.action.id}` : '结果', ts: Date.now() },
      runs, plugins,
    });
    try {
      await navigator.clipboard.writeText(ctx);
      ev.currentTarget.textContent = '已复制';
    } catch { ev.currentTarget.textContent = '复制失败'; }
    setTimeout(() => { const b = $('ctxRes'); if (b) b.textContent = 'AI 上下文'; }, 1500);
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
  // 第三十九轮③②：行点击展开 JSON 详情 + 横滚阴影
  box.querySelectorAll('table.grid tbody tr[data-rowjson]').forEach((tr) => {
    tr.addEventListener('click', (ev) => {
      if (ev.target.closest('button, input, a')) return;   // 别拦按钮/输入
      const exist = tr.nextElementSibling?.classList?.contains('det-row');
      if (exist) { tr.nextElementSibling.remove(); return; }
      const det = document.createElement('tr');
      det.className = 'det-row';
      det.innerHTML = `<td colspan="${tr.children.length}"><pre>${esc(tr.dataset.rowjson)}</pre></td>`;
      tr.after(det);
    });
  });
  box.querySelectorAll('.tbl-wrap').forEach((wrap) => {
    const upd = () => {
      wrap.classList.toggle('can-r', wrap.scrollWidth - wrap.clientWidth - wrap.scrollLeft > 8);
      wrap.classList.toggle('can-l', wrap.scrollLeft > 8);
    };
    wrap.addEventListener('scroll', upd, { passive: true });
    upd();
  });
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
  // 第四十四轮⑤：外观上下文一并下发——插件页面跟随宿主主题/暗色/字号/语言，
  // 不用页面自己猜。都是非敏感的展示信息。
  const cs = getComputedStyle(document.documentElement);
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
      appearance: {
        dark: document.documentElement.dataset.theme === 'dark',
        accent: cs.getPropertyValue('--accent').trim() || '#2271f0',
        fontScale: localStorage.getItem('zerokit.font-scale') || 'm',
        lang: localStorage.getItem('zerokit.lang') || 'system',
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
  } else if (msg.type === 'nav') {
    bridgeNav(frame, msg);
  } else if (msg.type === 'error') {
    // 页面自己报错：打进来给用户看见，而不是静默白屏
    console.warn('[zk-bridge] 页面报错：', msg.error);
    el.count.textContent = `插件页面报错：${String(msg.error ?? '').slice(0, 80)}`;
  }
  // 未知 type 一律忽略（协议收紧：多出来的消息不解释不转发）
});

/** 第四十四轮③：受控跳转——页面请求开外部链接，宿主弹确认后替它开 */
function bridgeNav(frame, msg) {
  const url = String(msg.url ?? '');
  const reply = () => frame.contentWindow.postMessage({
    __zkit: true, type: 'nav:allowed', url,
  }, '*');
  if (!/^https?:\/\//i.test(url)) { reply(); return; }
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h3>打开外部链接</h3>
      <div class="risk-note">插件页面请求在系统浏览器打开：</div>
      <div class="cmd-line">${esc(url)}</div>
      <div class="actions">
        <button class="ghost" id="navCancel">取消</button>
        <button class="primary" id="navOk">打开</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#navCancel').addEventListener('click', () => { close(); reply(); });
  overlay.querySelector('#navOk').addEventListener('click', () => {
    close();
    window.open(url, '_blank', 'noopener');
    reply();
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { close(); reply(); } });
  overlay.querySelector('#navOk').focus();
}

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
    // 第三十九轮⑥：空结果要归因——「查了没有」和「没返回」是两回事
    if (data.length === 0) return `<div class="ps-empty" role="status">${esc(emptyReason(data) ?? '空结果')}</div>`;
    if (typeof data[0] === 'object' && data[0] !== null) return renderTable(data, tableId);
    return renderPreNumbered(data.join('\n'));
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
  // 第三十九轮⑥：null/undefined 也不是一句"完成"就完了
  if (data === null || data === undefined) {
    return `<div class="ps-empty" role="status">${esc(emptyReason(data))}</div>`;
  }
  return `<pre class="out">${esc(String(data))}</pre>`;
}

/** 第三十九轮④：代码块行号——每行一个 span，CSS counter 计数（复制不带行号）。 */
function renderPreNumbered(text) {
  const lines = String(text).split('\n');
  return `<pre class="out numbered"><code>${lines.map((l) => `<span class="ln">${esc(l)}</span>`).join('')}</code></pre>`;
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
  // 第三十九轮⑤：时间戳列优先于数字判定——10/13 位纯数字列其实是时间，不该千分位
  const tsCols = new Set(cols.filter((c) => {
    const vals = rows.map((r) => r[c]).filter((v) => v !== null && v !== undefined && v !== '');
    return vals.length > 0 && vals.filter((v) => looksLikeTimestamp(v)).length >= Math.max(1, Math.floor(vals.length * 0.8));
  }));
  const numeric = Object.fromEntries(cols.map((c) => [c, !tsCols.has(c) && isNumericColumn(rows.map((r) => r[c]))]));
  // 第十六轮③：表格筛选行——空格分词，每词都要在某列命中
  const fterms = tableFilterTerms[tableId] ?? [];
  const frows = filterRows(rows, fterms);
  // 第二十三轮⑤⑥：结果查询——支持子串词与数字比较（size>100）；与筛选行叠加
  const rq = resultQueryTerms[tableId] ?? '';
  const qrows = rq ? resultQuery(frows, rq) : frows;
  const state = tableState[tableId] ?? { col: null, dir: 1 };
  const view = state.col ? sortRows(qrows, state.col, state.dir) : qrows;
  const arrow = (c) => state.col === c ? (state.dir === 1 ? ' ▲' : ' ▼') : '';
  // 第三十九轮⑤：时间戳列头标 ⏱（提示已人性化显示）
  const head = visCols.map((c) =>
    `<th class="sortable${numeric[c] ? ' num' : ''}" data-col="${esc(c)}">${esc(c)}${tsCols.has(c) ? ' <span class="ts-mark" title="时间戳已转本地时间">⏱</span>' : ''}${arrow(c)}</th>`).join('');
  // 第二十九轮⑦：大表只画首屏 200 行 + 「加载全部」按钮——
  // >500 行全画 DOM 会冻 UI 数秒；200 行覆盖绝大多数真实结果，其余按需展开
  const bigTable = view.length > OVERFLOW_ROWS && !tableFullLoad.has(tableId || 't');
  const viewRows = bigTable ? view.slice(0, PAGE_ROWS) : view;
  // 第三十九轮③：行点击就地展开该行 JSON（tr.det-row 跟在后面，再点收起）
  const body = viewRows.map((row) => `<tr data-rowjson="${esc(JSON.stringify(row))}">${visCols.map((c) => {
    const v = row[c];
    const val = (v && typeof v === 'object') ? JSON.stringify(v) : String(v ?? '');
    // 第三十九轮⑤：时间戳列自动人性化（10/13 位数字 → 本地时间），列头加⏱标注
    const isTs = !numeric[c] && looksLikeTimestamp(v);
    const shown = isTs ? humanTs(v)
      : numeric[c] && val !== '' && Number.isFinite(Number(val)) ? formatNumber(val) : val;
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
  const fRow = `<tr class="tfilter" aria-label="按列筛选">${visCols.map((c) => `<td><input data-tf="${esc(c)}" placeholder="筛…" value="${esc((fterms[0] && tableFilterTerms[tableId]?.join(' ')) || '')}" autocomplete="off" spellcheck="false"></th>`).join('')}</tr>`;
  const gear = `<span class="colvis-btn" data-colvis="${esc(tableId || 't')}" title="显示/隐藏列" role="button" tabindex="0">⚙</span>`;
  // 第五十三轮③：表格密度三档（记忆进 zerokit.tdensity）
  const dpref = localStorage.getItem('zerokit.tdensity') || 'normal';
  const dens = tableDensity(dpref);
  const densBtns = ['compact', 'normal', 'relaxed'].map((d) =>
    `<button class="ghost mini dens-btn${d === dpref ? ' on' : ''}" data-dens="${d}" title="${{ compact: '紧凑', normal: '标准', relaxed: '宽松' }[d]}行高">${{ compact: '⇕紧', normal: '⇕标', relaxed: '⇕宽' }[d]}</button>`).join('');
  // 第五十三轮⑥：字段/行数上限提示
  const overFields = cols.length > 30 ? `<span class="sub warn-note">列已超 30（${cols.length}），可在 ⚙ 隐藏不看的</span>` : '';
  // 第二十三轮⑤⑥：查询框（与第十六轮筛选行不同：这是整表查询，支持 > < = 数字比较）
  const qbar = `<div class="rquery"><input data-rq="${esc(tableId || 't')}" placeholder="查询：词 或 size>100 …" value="${esc(resultQueryTerms[tableId] ?? '')}" autocomplete="off" spellcheck="false"><span class="sub" data-rqc="${esc(tableId || 't')}">${rq ? `${qrows.length} / ${frows.length} 行` : ''}</span></div>`;
  return `${unitBtns ? `<div class="unit-bar">${unitBtns}</div>` : ''}${gear}${densBtns}${overFields}${qbar}<div class="tbl-wrap density-${dpref}"><table class="grid" data-table="${esc(tableId)}" style="--tbl-row-h:${dens.row};--tbl-pad:${dens.pad};--tbl-fs:${dens.fs}"><thead><tr>${head}</tr>${fRow}</tr></thead><tbody>${body}</tbody><tfoot><tr>${foot}</tr></tfoot></table></div>
  ${bigTable ? `<div class="tcount"><span class="sub">${viewRows.length} / ${view.length} 行（大表只画前 ${PAGE_ROWS} 行保流畅）</span> <button class="ghost mini" data-loadall="${esc(tableId || 't')}">加载全部 ${view.length} 行</button></div>` : `<div class="tcount sub">${view.length === rows.length ? `共 ${rows.length} 行` : `${view.length} / ${rows.length} 行（筛选中）`}</div>`}`;
}

// 表格排序状态（按 tableId 记，重渲染后保留）
const tableState = {};
// 第十六轮③：每张表的筛选词（tableId → 词组），输入即时过滤
const tableFilterTerms = {};
// 第十六轮⑦：单位换算请求（tableId → {col, to}），换算后的数据走 refreshResult 重画
const tableUnitConv = {};
// 第二十三轮⑤⑥：结果查询词（tableId → 串）——支持子串与数字比较（size>100）
const resultQueryTerms = {};
// 第二十九轮⑦：点了「加载全部」的表（tableId 集合），会话内不再截断
const tableFullLoad = new Set();
function bindTableSorts(scope) {
  // 第二十九轮⑦：大表「加载全部」——把该表的溢出阈值记成 Infinity 后重画
  scope.querySelectorAll('[data-loadall]').forEach((btn) => {
    btn.addEventListener('click', () => {
      tableFullLoad.add(btn.dataset.loadall);
      refreshResult();
    });
  });
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
      const colwSave = () => {
        const widths = [...tbl.querySelectorAll('th')].map((x) => Math.round(x.getBoundingClientRect().width));
        try { localStorage.setItem(`zerokit.colw.${id}`, JSON.stringify(widths)); } catch { /* 私密模式忽略 */ }
      };
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
          colwSave();
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
      // 第三十轮⑤：触屏拖列宽——touchstart 在同一热区（右缘 12px，手指比鼠标大放宽些）
      th.addEventListener('touchstart', (ev) => {
        const rect = th.getBoundingClientRect();
        const x = ev.touches[0].clientX;
        if (x < rect.right - 12) return;
        ev.preventDefault();
        const startX = x;
        const startW = rect.width;
        const move = (e2) => { th.style.width = `${Math.max(40, startW + e2.touches[0].clientX - startX)}px`; };
        const up = () => {
          document.removeEventListener('touchmove', move);
          document.removeEventListener('touchend', up);
          colwSave();
        };
        document.addEventListener('touchmove', move, { passive: false });
        document.addEventListener('touchend', up);
      }, { passive: false });
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
    // 第二十三轮⑤⑥：结果查询框（整表查询，支持数字比较）
    tbl.parentNode?.querySelectorAll('input[data-rq]').forEach((inp) => {
      inp.addEventListener('input', () => {
        resultQueryTerms[inp.dataset.rq] = inp.value;
        refreshResult();
        const again = document.querySelector(`input[data-rq="${CSS.escape(inp.dataset.rq)}"]`);
        if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      });
    });
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
  // 第五十三轮③：密度三档——点按钮即切（记忆 localStorage），refreshResult 重画
  scope.querySelectorAll('[data-dens]').forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.setItem('zerokit.tdensity', btn.dataset.dens);
      refreshResult();
    });
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
  el.modeLabel.textContent = t('modeMarket');
  el.searchRow.classList.add('hidden');
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  el.plugView.classList.add('hidden');
  el.psView.classList.add('hidden');
  el.workbench.classList.add('hidden');
  showPanelAnimated(el.marketView);
  if (location.hash !== '#/market') history.replaceState(null, '', '#/market');
  await renderMarket();
}

function exitMarket() {
  mode = 'command';
  marketPreview = null;
  el.marketView.classList.add('hidden');
  el.searchRow.classList.remove('hidden');
  showPanelAnimated(el.listView);
  el.modeLabel.textContent = t('modeCommand');
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
  el.modeLabel.textContent = t('modeLogs');
  el.searchRow.classList.add('hidden');
  hidePanels();
  showPanelAnimated(el.logsView);
  if (location.hash !== '#/logs') history.replaceState(null, '', '#/logs');
  await renderLogs();
}

function exitLogs() {
  mode = 'command';
  el.logsView.classList.add('hidden');
  el.searchRow.classList.remove('hidden');
  showPanelAnimated(el.listView);
  el.modeLabel.textContent = t('modeCommand');
  history.replaceState(null, '', location.pathname);
  renderList();
  el.q.focus();
}

function logDetailHtml(e, i) {
  // 第十九轮④：命令与错误信息默认脱敏（密钥可能随命令行/报错回显）
  const mtext = (t) => (maskState() ? maskSecrets(t) : String(t ?? ''));
  return `<div class="log-detail hidden" id="logDetail${i}">
    <pre>${esc(mtext(e['command'] ?? '（无动作）'))}</pre>
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
      <input id="logQuery" class="log-query" placeholder="过滤：插件 / 动作 / 错误（支持 ms>100 这类数字比较）" value="${esc(logsQuery)}">
      <button class="ghost" id="logCsv" title="把当前过滤结果导出 CSV（时间/插件/动作/决策/耗时/退出码）">⬇ CSV</button>
      <button class="ghost" id="logReload">刷新</button>
      <button class="ghost" id="logFile">${logsFile === 'audit' ? '看被拒记录' : '看全部记录'}</button>
    </div>
    <div id="logList" class="log-list"><div class="ps-empty" role="status">读取中…</div></div>`;

  el.logsView.querySelectorAll('[data-log-decision]').forEach((b) => {
    b.addEventListener('click', () => { logsDecision = b.dataset.logDecision; logsPage = 1; renderLogs(); });
  });
  $('logQuery').addEventListener('change', () => { logsQuery = $('logQuery').value.trim(); logsPage = 1; renderLogs(); });
  $('logReload').addEventListener('click', renderLogs);
  // 第四十九轮⑥：导出当前过滤视图为 CSV（只含元数据，不含输出正文——审计里可能有敏感串）
  $('logCsv').addEventListener('click', async () => {
    try {
      const params = new URLSearchParams({ file: logsFile, limit: '200' });
      if (logsDecision) params.set('decision', logsDecision);
      if (logsQuery) params.set('q', logsQuery);
      const d2 = await api(`/api/logs?${params}`);
      const es = d2.entries ?? [];
      if (!es.length) { el.count.textContent = '没有可导出的行'; return; }
      const head = 'time,plugin,action,decision,ms,exitCode';
      const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [head, ...es.map((e) => [
        cell(e.ts), cell(e.plugin), cell(e.action), cell(e.decision), cell(e.ms), cell(e.exitCode),
      ].join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `zerokit-logs-${logsFile}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click(); URL.revokeObjectURL(a.href);
      el.count.textContent = `已导出 ${es.length} 条日志`;
    } catch (err) { el.count.textContent = `导出失败：${err.message}`; }
  });
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
  el.modeLabel.textContent = t('modeDoctor');
  el.searchRow.classList.add('hidden');
  hidePanels();
  showPanelAnimated(el.doctorView);
  if (location.hash !== '#/doctor') history.replaceState(null, '', '#/doctor');
  await renderDoctor();
}

function exitDoctor() {
  mode = 'command';
  el.doctorView.classList.add('hidden');
  el.searchRow.classList.remove('hidden');
  showPanelAnimated(el.listView);
  el.modeLabel.textContent = t('modeCommand');
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
  showPanelAnimated(el.listView);
  el.modeLabel.textContent = t('modeCommand');
  history.replaceState(null, '', location.pathname);
  renderList();
  el.q.focus();
}

async function showPlugins() {
  hidePanels();
  mode = 'plugins';
  el.modeLabel.textContent = t('modePlugins');
  el.searchRow.classList.add('hidden');
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  el.workbench.classList.add('hidden');
  el.psView.classList.add('hidden');
  showPanelAnimated(el.plugView);
  if (location.hash !== '#/plugins') history.replaceState(null, '', '#/plugins');
  await renderPlugins();
}

/** 插件主页：一个插件在四个面里到底是什么——动作、设置、依赖、来源，一页看完 */
async function showPluginHome(id) {
  hidePanels();
  mode = 'plugins';
  el.modeLabel.textContent = t('modePlugins');
  el.searchRow.classList.add('hidden');
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  el.workbench.classList.add('hidden');
  el.psView.classList.add('hidden');
  el.marketView.classList.add('hidden');
  showPanelAnimated(el.plugView);
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
    <span id="plugUpdateBadge" class="badge upd-badge hidden" style="display:none"></span>
    <div class="plug-home-history">📥 装于 ${esc(p.installedAt ? new Date(p.installedAt).toLocaleString() : '未知时间')} · ${esc(p.sourceText)}${p.installedVersion && p.installedVersion !== p.version ? `（记录自 v${esc(p.installedVersion)}）` : ''}</div>
    <div class="plug-home-meta">
      <span class="badge">${p.actions.length} 个动作</span>
      ${deps.length ? `<span class="badge">插件依赖 ${deps.map((d) => `${esc(d.id)}${d.installed ? '' : '（未装）'}`).join('、')}</span>` : ''}
      ${settings.length ? `<span class="badge warn">${settings.filter((x) => x.missing).length} 项未填</span>` : ''}
      ${p.requiresOk ? '' : '<span class="badge destructive">缺命令依赖</span>'}
    </div>
    ${(() => {
      // 第二十六轮⑧：统计卡三格（动作/最近使用/健康）
      const st = pluginStatCards(p, runStore);
      if (!st) return '';
      return `<div class="stat-row plug-stats">
        <div class="stat-card"><b>${st.actions}</b><span>动作（组合 ${st.chains}）</span></div>
        <div class="stat-card"><b>${st.runs}</b><span>累计执行${st.lastUsed !== null ? ` · 最近 ${st.lastUsed} 分钟前` : ''}</span></div>
        <div class="stat-card${st.health === 'warn' ? ' warn' : ''}"><b>${st.health === 'ok' ? '健康' : '注意'}</b><span>${st.health === 'ok' ? '依赖齐全' : '缺命令依赖'}</span></div>
      </div>`;
    })()}
    ${(() => {
      // 第二十六轮⑦：标签 chips
      const tags = pluginTagChips(p);
      return tags.length ? `<div class="plug-tags">${tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : '';
    })()}
    <h3 class="plug-home-h">动作 <input id="plugActFilter" class="plug-act-filter" placeholder="在 ${p.actions.length} 个动作里搜索…" /></h3>
    <div class="plug-home-actions" id="plugActList">
      ${p.actions.map((a) => `
        <button class="plug-action" data-action="${esc(a.id)}">
          <span class="pa-title">${esc(a.title)}</span>
          <span class="badge ${esc(a.risk)}">${esc(riskText(a.risk))}</span>
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
    ${deps.length ? `<h3 class="plug-home-h">依赖树</h3><pre class="dep-tree">${esc(depTreeLines(p.id, deps).join('\n'))}</pre>` : ''}
    <div class="actions">
      <button class="ghost" id="homeExport" title="导出这个插件的能力清单（Markdown）">导出能力清单</button>
      <button class="ghost" id="homeCopyInstall" title="复制安装命令（命令行里一键装）">复制安装命令</button>
      <button class="ghost" id="homeCompare" title="与另一个插件对比动作与风险">对比…</button>
      ${p.source?.type === 'market' ? '<button class="ghost" id="plugUpdateBtn">检查更新</button>' : ''}
      <button class="ghost" id="homeBackList">返回插件列表</button>
      <button class="primary" id="homeBack">返回</button>
    </div>`;

  el.plugView.querySelectorAll('[data-action]').forEach((btn) => {
    const a = p.actions.find((x) => x.id === btn.dataset.action);
    btn.addEventListener('click', () => openDetail(p, a));
  });
  // 第二十六轮⑤：主页内动作搜索（与全局搜索独立，只过滤本插件动作卡）
  const filt = $('plugActFilter');
  filt?.addEventListener('input', () => {
    const shown = filterPluginActions(p.actions, filt.value);
    el.plugView.querySelectorAll('[data-action]').forEach((btn) => {
      btn.style.display = shown.some((a) => a.id === btn.dataset.action) ? '' : 'none';
    });
  });
  // 第二十六轮⑥：复制安装命令
  $('homeCopyInstall')?.addEventListener('click', async () => {
    const cmd = installCommand(p);
    try { await navigator.clipboard.writeText(cmd); el.count.textContent = `已复制：${cmd}`; }
    catch { el.count.textContent = cmd; }
  });
  // 第二十六轮①：与另一个插件对比（模态选择 + 对比表）
  $('homeCompare')?.addEventListener('click', () => {
    const others = plugins.filter((x) => x.id !== p.id);
    if (!others.length) { el.count.textContent = '没有其它插件可对比'; return; }
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h3>与哪个插件对比？</h3>
      <div class="chain-cands">${others.map((o, i) => `<button data-cmp="${i}">${esc(o.name)} <span class="sub">${esc(o.id)} · ${o.actions.length} 动作</span></button>`).join('')}</div>
      <div class="actions"><button class="ghost" data-cmp-close>取消</button></div>
    </div>`;
    document.body.appendChild(ov);
    ov.querySelector('[data-cmp-close]').addEventListener('click', () => ov.remove());
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
    ov.querySelectorAll('[data-cmp]').forEach((b) => b.addEventListener('click', () => {
      const o = others[Number(b.dataset.cmp)];
      const cmp = plugCompare(p, o);
      if (!cmp) { el.count.textContent = '对比失败：插件数据不完整'; ov.remove(); return; }
      ov.querySelector('.modal').innerHTML = `
        <h3>对比：${esc(cmp.a.name)} vs ${esc(cmp.b.name)}</h3>
        <table class="cmp-table"><caption class="sr-only">插件对比</caption><thead><tr><th>维度</th><th>${esc(cmp.a.name)}</th><th>${esc(cmp.b.name)}</th></tr></thead>
        <tbody>
          <tr><td>动作数</td><td>${cmp.a.actions}</td><td>${cmp.b.actions}</td></tr>
          ${cmp.risks.map((r) => `<tr class="${r.a !== r.b ? 'cmp-diff' : ''}"><td>风险 ${esc(r.risk)}</td><td>${r.a}</td><td>${r.b}</td></tr>`).join('')}
          <tr><td>插件依赖</td><td>${cmp.deps.a.length ? esc(cmp.deps.a.join('、')) : '无'}</td><td>${cmp.deps.b.length ? esc(cmp.deps.b.join('、')) : '无'}</td></tr>
        </tbody></table>
        <div class="actions"><button class="primary" data-cmp-close>关闭</button></div>`;
      ov.querySelector('[data-cmp-close]').addEventListener('click', () => ov.remove());
    }));
  });
  $('homeBackList').addEventListener('click', showPlugins);
  $('homeBack').addEventListener('click', exitPlugins);
}

/** 第二十六轮⑨：已装插件清单导出（可分享 JSON：id/版本/来源/动作数）。 */
function exportInstalledList() {
  api('/api/plugins').then(({ plugins: ps }) => {
    const data = installedList(ps);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `zerokit-plugins-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    el.count.textContent = `已导出 ${data.plugins.length} 个插件的清单`;
  }).catch((e) => { el.count.textContent = `导出失败：${e.message}`; });
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
    ${plugins.filter((x) => x.requiresOk === false).map((x) =>
      `<div class="health-note bad-plugin" role="status">⚠ 插件「${esc(x.name)}」缺命令依赖（${esc((x.missingBinaries || []).join('、') || '未知命令')}）——对应动作会执行失败。装好命令或 <code>zkit plugin remove ${esc(x.id)}</code> 卸载。</div>`).join('')}
    <div class="actions plug-list-actions">
      <button class="ghost" id="plugExportList" title="把已装插件清单导出为可分享的 JSON">导出已装清单</button>
    </div>
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
  $('plugExportList')?.addEventListener('click', exportInstalledList);

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
              <td><span class="badge ${esc(a.risk)}">${esc(riskText(a.risk))}</span></td>
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
      <div class="modal" role="dialog" aria-modal="true">
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
    announceTitle(Object.keys(watchRegistry()).length, running);
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
  el.modeLabel.textContent = t('modePs');
  el.searchRow.classList.add('hidden');
  el.listView.classList.add('hidden');
  el.detailView.classList.add('hidden');
  el.workbench.classList.add('hidden');
  el.plugView.classList.add('hidden');
  showPanelAnimated(el.psView);
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
  showPanelAnimated(el.listView);
  el.modeLabel.textContent = t('modeCommand');
  history.replaceState(null, '', location.pathname);
  renderList();
  el.q.focus();
}

/** 第五十九轮⑤：顶栏状态胶囊——时间问候 + 在跑计数；有东西在跑时呼吸灯。
 *  数据源复用 fetchPs（2s 一跳），时间显示分钟级精度即可（秒级跳动反而闹心）。 */
function updateStatusPill(running) {
  if (!el.statusPill || !el.pillText) return;
  const h = new Date().getHours();
  const greet = h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '午安' : h < 19 ? '下午好' : '晚上好';
  const watches = Object.keys(watchRegistry()).length;
  const bits = [greet];
  if (running > 0) bits.push(`${running} 个在跑`);
  if (watches > 0) bits.push(`⏱${watches} 监控`);
  el.pillText.textContent = bits.join(' · ');
  el.statusPill.classList.toggle('pill-live', running > 0);
  el.statusPill.classList.toggle('pill-warn', running === 0 && watches > 0);
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
  updateStatusPill(total);

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
  el.modeLabel.textContent = t('modeCommand');
  el.modeDot.classList.remove('workbench');
  el.searchRow.classList.remove('hidden');
  showPanelAnimated(el.listView);
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
  el.modeLabel.textContent = t('modeWorkbench');
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
    <div class="cmd-line">${esc(call.command || '(无动作)')}</div>
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
  el.modeLabel.textContent = t('modeStats');
  el.searchRow.classList.add('hidden');
  hidePanels();
  showPanelAnimated(el.allowView);
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
applyLang();
applyFontScale(); applyTheme(); applyAccent();
    } catch (e) { msg.textContent = `导入失败：${e.message}`; }
  });
}

function exitStats() {
  mode = 'command';
  el.allowView.classList.add('hidden');
  el.searchRow.classList.remove('hidden');
  showPanelAnimated(el.listView);
  el.modeLabel.textContent = t('modeCommand');
  history.replaceState(null, '', location.pathname);
  renderList();
  el.q.focus();
}


// ---------------------------------------------------------------- 结果收藏夹

/** 收藏的结果：钉住某次执行的关键输出，重启后还在（本机 localStorage）。 */
async function showSaved() {
  mode = 'saved';
  el.modeLabel.textContent = t('modeSaved');
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
              <button class="ghost mini" data-sel="${i}" title="选进对比槽（选两条同动作收藏后可对比）">选比</button>
              <button class="ghost" data-open="${i}">打开动作</button>
              <button class="ghost" data-del="${i}">移除</button>
            </span>
          </div>
          <div class="saved-cmd">${esc(x.command)}</div>
          <div class="saved-data"><pre>${esc(x.data !== undefined ? JSON.stringify(x.data, null, 1) : (x.stdout ?? '')).slice(0, 400)}</pre></div>
        </div>`).join('')}
      <div class="actions"><button class="primary" id="savedBack">返回</button>
        <button class="ghost" id="savedClear">清空收藏</button></div>`;
    // 第四十九轮⑧：收藏结果对比——选两条同动作的，逐键 diff（复用 resultCompare）
    const selA = { v: null };
    view.querySelectorAll('[data-sel]').forEach((b) => b.addEventListener('click', () => {
      const x = savedList[Number(b.dataset.sel)];
      if (selA.v === null) {
        selA.v = Number(b.dataset.sel);
        b.textContent = 'A✓'; b.classList.add('on');
      } else if (selA.v === Number(b.dataset.sel)) {
        selA.v = null; b.textContent = '选比'; b.classList.remove('on');
      } else {
        const a = savedList[selA.v], c = savedList[Number(b.dataset.sel)];
        if (a.key !== c.key) { el.count.textContent = '只能对比同一个动作的两条结果'; return; }
        const rows = resultCompare(a.data, c.data);
        const html = rows.map((r2) => `<tr class="${r2.diff ? 'cmp-diff' : ''}"><td>${esc(r2.key)}</td><td>${esc(r2.a)}</td><td>${esc(r2.b)}</td></tr>`).join('');
        const box = document.createElement('div');
        box.className = 'cmp-view';
        box.innerHTML = `<div class="ps-head"><h3>收藏对比：${esc(a.command)} ⇄ ${esc(c.command)}</h3>
          <button class="ghost mini" id="cmpClose">关闭</button></div>
          <table class="cmp-table"><caption class="sr-only">历史对比</caption><thead><tr><th>键</th><th>较早</th><th>较晚</th></tr></thead><tbody>${html}</tbody></table>`;
        view.prepend(box);
        box.querySelector('#cmpClose').addEventListener('click', () => box.remove());
        el.count.textContent = rows.length ? `对比出 ${rows.filter((r2) => r2.diff).length} 处差异` : '两条没有可比的键';
      }
    }));
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
  showPanelAnimated(el.listView);
  el.modeLabel.textContent = t('modeCommand');
  history.replaceState(null, '', location.pathname);
  renderList();
  el.q.focus();
}

// ---------------------------------------------------------------- MCP 授权面板

/** MCP 授权：哪些「有副作用」的动作允许 AI 直接调。只读动作默认放行，不在这里。 */
async function showMcpAllow() {
  mode = 'mcp';
  el.modeLabel.textContent = t('modeMcp');
  el.searchRow.classList.add('hidden');
  hidePanels();
  showPanelAnimated(el.allowView);
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
  showPanelAnimated(el.listView);
  el.modeLabel.textContent = t('modeCommand');
  history.replaceState(null, '', location.pathname);
  renderList();
  el.q.focus();
}

// ---------------------------------------------------------------- 全局命令面板（Ctrl+P）

let paletteMode = false;
const watchStopLog = [];   // 第四十八轮⑧：最近 5 条自动停止原因
let gotoArmedAt = 0;   // 第二十四轮⑤：g 键按下时间（600ms 内按 l/h/s/m 生效）

/** 第二十四轮⑧：键盘速查浮层——分组列出全部快捷键，Esc/点遮罩关闭 */
function showHotkeyCheat() {
  document.getElementById('hotkeyCheat')?.remove();
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.id = 'hotkeyCheat';
  ov.innerHTML = `
    <div class="modal cheat-sheet">
      <h3>键盘速查</h3>
      <div class="cheat-grid">
        <div><h4>全局</h4><ul>
          <li><kbd>Ctrl/⌘+P</kbd> 命令面板</li>
          <li><kbd>?</kbd> 本速查</li>
          <li><kbd>F1–F12</kbd> 绑定的动作直达</li>
          <li><kbd>Esc</kbd> 关最上层浮层/回列表</li>
        </ul></div>
        <div><h4>跳转（g 后接键）</h4><ul>
          <li><kbd>g l</kbd> 动作列表</li>
          <li><kbd>g h</kbd> 帮助</li>
          <li><kbd>g s</kbd> 统计</li>
          <li><kbd>g m</kbd> 监控面板</li>
        </ul></div>
        <div><h4>命令面板</h4><ul>
          <li><kbd>&gt;</kbd> 前缀进入命令模式</li>
          <li><kbd>;</kbd>插件.动作 快速执行</li>
          <li><kbd>↑↓</kbd> 翻最近命令/查询</li>
        </ul></div>
        <div><h4>列表 / 结果</h4><ul>
          <li><kbd>↑↓</kbd> 移动 · <kbd>1–9</kbd> 快选 · <kbd>Alt+1–9</kbd> 直开</li>
          <li><kbd>PgUp/PgDn</kbd> 翻页 · <kbd>Home/End</kbd> 首尾</li>
          <li><kbd>j / k</kbd> 表格行选中</li>
          <li><kbd>[ / ]</kbd> 切换结果页签</li>
          <li><kbd>Ctrl/⌘+Enter</kbd> 执行当前动作</li>
        </ul></div>
        <div><h4>键盘流（新）</h4><ul>
          <li><kbd>F</kbd> 收藏/取消当前项</li>
          <li><kbd>T</kbd> 给当前项打标签（数字选）</li>
          <li><kbd>Y / E</kbd> 结果区复制/导出</li>
          <li><kbd>Alt+↑↓</kbd> 批量篮内移位</li>
        </ul></div>
      </div>
      <div class="palette-foot">Esc 关闭</div>
    </div>`;
  ov.addEventListener('click', (ev) => { if (ev.target === ov) ov.remove(); });
  document.body.appendChild(ov);
}

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
    { icon: '📋', label: '剪贴板历史', hint: '最近复制的内容与识别', act: () => { location.hash = '#/clip'; } },
    { icon: '👁', label: '监控面板', hint: '自动重跑的监控聚合', act: () => { location.hash = '#/watch'; } },
    { icon: '📰', label: '今日简报', hint: '跑了多少 / 成败 / 最常用', act: () => { location.hash = '#/brief'; } },
    { icon: '🗓', label: '时间线', hint: '按天复盘执行 + 周对比 + 时段分布', act: () => { location.hash = '#/timeline'; } },
    { icon: '📌', label: '收藏结果', hint: '钉住的重要输出', act: () => { location.hash = '#/saved'; } },
    { icon: '◐', label: '深色 / 浅色', hint: '一键切换主题（Ctrl+Shift+D）', act: () => toggleLightDark() },
    { icon: '☰', label: '设置抽屉', hint: '主题/语言/配置档/备份统一入口', act: () => openDrawer() },
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
    const raw = q.value;
    const needle = raw.trim().toLowerCase();
    // 第二十四轮③：`;插件.动作` 快速执行语法——直接跳详情页，不走打分
    const quick = quickRunKey(raw);
    if (quick) {
      const entry = entries.find((en) => en.plugin.id === quick.plugin && en.action.id === quick.action);
      items = [{
        icon: '⚡', label: `执行 ${quick.plugin}.${quick.action}`,
        hint: entry ? entry.action.title : '（未找到该动作）',
        act: () => { if (entry) { exitPalette(); openDetail(entry.plugin, entry.action); } else { el.count.textContent = '没有这个动作'; } },
      }];
      sel = 0; paint(); return;
    }
    // 第二十四轮①②④：`>` 前缀 = 命令模式（内置命令 + 最近命令置顶）
    if (raw.trim().startsWith('>')) {
      const cneedle = raw.trim().slice(1).trim().toLowerCase();
      const recentCmds = (readJson('zerokit.cmdhist') ?? []).map((c) => ({
        icon: '🕘', label: c, hint: '最近用过', act: () => { runCommand(c); },
      }));
      const cmds = COMMAND_LIST.map((c) => ({
        icon: c.icon, label: `> ${c.name}`, hint: c.hint,
        act: () => { runCommand(c.name); },
      }));
      const pool = [...recentCmds, ...cmds];
      items = cneedle ? pool.filter((x) => x.label.toLowerCase().includes(cneedle)
        || x.hint.toLowerCase().includes(cneedle)) : pool.slice(0, 24);
      sel = 0; paint(); return;
    }
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
  /** ①②命令执行：解释 go 标记（hash 直跳 / UI 动作），并记入最近命令 */
  const runCommand = (name) => {
    const c = COMMAND_LIST.find((x) => x.name === name);
    if (!c) return;
    try { localStorage.setItem('zerokit.cmdhist', JSON.stringify(pushHistory(readJson('zerokit.cmdhist') ?? [], name))); } catch { /* 存不进就算了 */ }
    exitPalette();
    if (c.go.startsWith('#')) location.hash = c.go;
    else if (c.go === 'batch') { if (detail) backToList(); el.count.textContent = batch.length ? `批量篮里已有 ${batch.length} 项，Alt+点击列表项继续加` : '批量模式：按住 Alt 点击列表项加入批量篮'; }
    else if (c.go === 'theme') openDrawer();
    else if (c.go === 'drawer') openDrawer();
    else if (c.go === 'workbench') showWorkbench('');
    // 第三十七轮⑤：两个 AI 命令直接进剪贴板（不弹面板——复制类动作要一步到位）
    else if (c.go === 'copy-mcp') {
      const cfg = toMcpConfig('node', '/path/to/zerokit/src/mcp.ts');
      navigator.clipboard.writeText(cfg).then(() => { el.count.textContent = '已复制 MCP 配置（mcpServers JSON）'; }, () => { el.count.textContent = '复制失败（剪贴板被拒）'; });
    } else if (c.go === 'copy-ctx') {
      const runs = Object.values(runStore).flat().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 3);
      const ctx = packContext({ runs, plugins: plugins.map((pl) => ({ id: pl.id, name: pl.name, actions: (pl.actions || []).map((a) => ({ id: a.id, title: a.title })) })) });
      navigator.clipboard.writeText(ctx).then(() => { el.count.textContent = '已复制 AI 上下文（最近执行+插件清单）'; }, () => { el.count.textContent = '复制失败（剪贴板被拒）'; });
    }
  };
  const exitPalette = () => { paletteMode = false; overlay.remove(); };

  q.addEventListener('input', refill);
  // 第二十四轮⑨：面板输入历史（命令+查询一起记），↑↓ 在空选择位翻历史
  let histIdx = -1;
  const histList = () => [...new Set([...(readJson('zerokit.cmdhist') ?? []), ...(readJson('zerokit.searches') ?? []).map((s) => String(s))])];
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); exitPalette(); }
    else if (e.key === 'ArrowDown') {
      const h = histList();
      if (sel < items.length - 1) { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); paint(); }
      else if (histIdx > -1) { e.preventDefault(); histIdx -= 1; q.value = histIdx === -1 ? '' : (h[histIdx] ?? ''); refill(); }
    }
    else if (e.key === 'ArrowUp') {
      const h = histList();
      if (sel > 0) { e.preventDefault(); sel -= 1; paint(); }
      else if (histIdx + 1 < h.length) { e.preventDefault(); histIdx += 1; q.value = h[histIdx] ?? ''; refill(); }
      else if (histIdx + 1 === h.length) { e.preventDefault(); histIdx = h.length; q.value = ''; refill(); }
    }
    else if (e.key === 'Enter') { e.preventDefault(); items[sel]?.act(); }
    else { histIdx = -1; }
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
  // 第二十四轮⑤：两段式 goto——g 后 600ms 内按 l/h/s/m 跳列表/帮助/统计/监控。
  // g 是纯字母键，只在「焦点不在输入框」时生效，避免打字误触；详情页里也允许（g l 回列表）。
  const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.key === 'g') { gotoArmedAt = Date.now(); return; }
    if (gotoArmedAt) {
      const t = gotoTarget(e.key, Date.now(), gotoArmedAt);
      gotoArmedAt = 0;
      if (t) {
        e.preventDefault();
        // goto 目标是 hash 路由：先清掉详情态（同步置空 detail，别走 backToList 的
        // history.back 弹栈——那是异步的，会跟下一行 location.hash 赋值竞速，导致
        // 最终落在上一个详情深链而不是目标面板）。
        if (detail) { detail = null; el.detailView.classList.add('hidden'); showPanelAnimated(el.listView); }
        location.hash = t;
        return;
      }
    }
  }
  // 第二十四轮⑥：结果表格 j/k 上下移选中行（配合排序/筛选看数据）
  if (detail && !typing && (e.key === 'j' || e.key === 'k')) {
    const tbl = document.querySelector('#result table tbody');
    if (tbl) {
      e.preventDefault();
      const trs = [...tbl.querySelectorAll('tr')];
      if (!trs.length) return;
      let cur = trs.findIndex((tr) => tr.classList.contains('row-sel'));
      cur = cur < 0 ? -1 : cur;
      const next = Math.max(0, Math.min(trs.length - 1, cur + (e.key === 'j' ? 1 : -1)));
      trs.forEach((tr) => tr.classList.remove('row-sel'));
      trs[next].classList.add('row-sel');
      trs[next].scrollIntoView({ block: 'nearest' });
      return;
    }
  }
  // 第二十四轮⑦：[ ] 切换结果页签（环形）
  if (detail && !typing && (e.key === '[' || e.key === ']') && resultTabs.length) {
    e.preventDefault();
    const cur = resultTabs.findIndex((t) => t.id === activeTab);
    const nxt = resultTabs[cycleTabIndex(cur < 0 ? 0 : cur, resultTabs.length, e.key === ']' ? 1 : -1)];
    if (nxt) { activeTab = nxt.id; renderResult(nxt.res); renderTabBar(); }
    return;
  }
  // 第二十四轮⑧：? 键盘速查浮层
  if (!typing && e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    showHotkeyCheat();
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
  if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && batch.length) {
    // 第五十二轮⑥：Alt+↑↓ 移动批量篮内当前项（与鼠标 ↑↓ 等价；操作对象 = 最近点过的篮内项）
    e.preventDefault();
    const i = batchFocus >= 0 && batchFocus < batch.length ? batchFocus : batch.length - 1;
    const j = e.key === 'ArrowDown' ? Math.min(i + 1, batch.length - 1) : Math.max(i - 1, 0);
    if (i !== j) { [batch[i], batch[j]] = [batch[j], batch[i]]; batchFocus = j; renderList(); }
  } else if (e.key === 'ArrowDown') {
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
  } else if ((e.key === 'f' || e.key === 'F') && filtered.length && document.activeElement === el.q && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // 第五十二轮④：F 键切换当前激活项收藏（与点星标等价）
    e.preventDefault();
    const key = actionKey(filtered[active].plugin.id, filtered[active].action.id);
    favorites = toggleFavorite(favorites, key);
    writeJson(PREF.favorites, favorites);
    patchItemFav(key);
    el.count.textContent = favorites.includes(key) ? `已收藏：${filtered[active].action.title}` : `已取消收藏：${filtered[active].action.title}`;
  } else if ((e.key === 't' || e.key === 'T') && filtered.length && document.activeElement === el.q && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // 第五十二轮⑤：T 键给当前项打标签（弹小面板，数字选）
    e.preventDefault();
    showTagPanel(active);
  } else if ((e.key === 'y' || e.key === 'Y') && document.activeElement === document.body && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // 第五十二轮③：结果可见时 Y=复制（与点复制按钮等价）
    const btn = document.querySelector('#result [data-copy], #result .copy-btn');
    if (btn) { e.preventDefault(); btn.click(); }
  } else if ((e.key === 'e' || e.key === 'E') && document.activeElement === document.body && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // 第五十二轮③：E=导出（结果区第一个导出按钮）
    const btn = document.querySelector('#result [data-exp], #result #csvBtn, #result [data-exp-csv]');
    if (btn) { e.preventDefault(); btn.click(); }
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
    // 第六十四轮①②：留痕 + 识别建议
    clipHist = pushClipHistory(clipHist, text);
    saveClipHist();
    showClipSuggest(text);
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

// 第二十九轮①：搜索防抖（150ms）+ rAF 合帧。
// 每键全量重算 search()+renderList() 在大列表下会掉帧；防抖让连续击键只算最后一次，
// rAF 保证同帧内多次触发只画一次。搜索计时进 perfStats 供 #/perf 展示。
let searchDebounceTimer = 0;
let searchRaf = 0;
const perfStats = { listItems: 0, listMs: 0, searchMs: 0, lastRenderAt: 0, renderCount: 0 };

// 第四十二轮⑨：热点入口打 perf 标签——Performance 面板/面板页都能对上时间线
function perfMark(name) {
  perfStats.renderCount += 1;
  try { performance.mark(name); } catch { /* 老嵌入环境无 performance.mark */ }
}

el.q.addEventListener('input', () => {
  const q = el.q.value;
  // 第五十一轮⑥：清空按钮显隐
  $('qClear')?.classList.toggle('hidden', q.length === 0);
  if (!qClearBound) { qClearBound = true; $('qClear')?.addEventListener('click', () => { el.q.value = ''; renderList(); el.q.focus(); $('qClear')?.classList.add('hidden'); }); }
  // 输入 ? 即切到工作台，后面的内容当作第一个问题带过去
  if (q.startsWith('?') && mode !== 'workbench') {
    el.q.value = '';
    showWorkbench(q.slice(1).trim());
    return;
  }
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    if (searchRaf) return;
    searchRaf = requestAnimationFrame(() => {
      searchRaf = 0;
      active = 0;
      renderList();
    });
  }, 150);
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
  // 第四十七轮⑤：首屏骨架屏——列表还空着时先画占位行，拉到数据后 renderList 覆盖
  if (!el.list.childElementCount && el.listView && !el.listView.classList.contains('hidden')) {
    el.list.innerHTML = skeletonRows(6).map(() => '<li class="skel-row" aria-hidden="true"></li>').join('');
  }
  // 第六十三轮⑥：从持久化文件恢复定时任务（刷新/重启不丢）。
  // 恢复配置与节奏锚点；执行历史是会话内状态，不跨会话搬。
  try {
    const saved = await api('/api/timers');
    const reg = timerRegistry();
    for (const t of saved.timers || []) {
      if (!reg[t.key]) {
        reg[t.key] = {
          id: null, interval: t.interval, win: t.win || '',
          title: t.title, values: t.values || {},
          createdAt: t.createdAt ?? Date.now(), lastRanAt: t.lastRanAt ?? t.createdAt ?? Date.now(),
          history: [], paused: !!t.paused, nextAt: 0,
        };
      }
      if (!reg[t.key].paused) startTimerTick(t.key);
    }
  } catch { /* 定时任务恢复失败不拦主界面 */ }
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
    // 第二十二轮①：首访引导——三步卡片（搜索→执行→看结果），可跳过、不再打扰
    if (!firstRunSeen((k) => localStorage.getItem(k))) showFirstRunGuide();
  } catch (e) {
    el.count.textContent = `加载失败：${e.message}`;
  }
}

/** 第二十二轮①：首访三步引导。点完/跳过都标记 done，之后永不再弹。 */
function showFirstRunGuide() {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const steps = [
    { icon: '🔍', t: '搜一下', d: '顶部搜索框支持中文、拼音、首字母。打「xtxx」试试「系统信息」。' },
    { icon: '▶', t: '执行', d: '选一个动作回车进入详情。只读的直接跑；会改动的要确认。' },
    { icon: '📊', t: '看结果', d: '结果可复制/下载/重跑，表格能排序筛选，还能开监控自动盯变化。' },
  ];
  overlay.innerHTML = `
    <div class="modal firstrun-modal">
      <h3>欢迎使用 zerokit 启动器</h3>
      <div class="firstrun-steps">
        ${steps.map((s2, i) => `<div class="firstrun-step">
          <div class="firstrun-icon">${s2.icon}</div>
          <div><b>${i + 1}. ${esc(s2.t)}</b><br>${esc(s2.d)}</div>
        </div>`).join('')}
      </div>
      <div class="modal-actions">
        <button class="primary" id="frDone">开始使用</button>
        <button class="ghost" id="frHelp">先看使用指南</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const finish = (toHelp) => {
    markFirstRunDone((k, v) => localStorage.setItem(k, v));
    overlay.remove();
    if (toHelp) location.hash = '#/help';
  };
  overlay.querySelector('#frDone').addEventListener('click', () => finish(false));
  overlay.querySelector('#frHelp').addEventListener('click', () => finish(true));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
  document.addEventListener('keydown', function frEsc(e) {
    if (e.key === 'Escape') { finish(false); document.removeEventListener('keydown', frEsc); }
  });
  overlay.querySelector('#frDone').focus();
}

/** 支持 #/插件/动作 深链直达 */
function applyHash() {
  // #/timers 定时任务面板
  if ((location.hash || '') === '#/timers') { showTimers(); return; }
  // 第六十四轮：#/clip 剪贴板历史面板
  if ((location.hash || '') === '#/clip') { showClipPanel(); return; }
  // #/watch 监控聚合面板（第十八轮⑥）
  if ((location.hash || '') === '#/watch') { showWatchPanel(); return; }
  // #/brief 每日简报
  if ((location.hash || '') === '#/brief') { showBrief(); return; }
  // 第五十四轮：#/timeline 时间线与复盘
  if ((location.hash || '') === '#/timeline') { showTimeline(); return; }

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

  // 第二十七轮⑤：#/history/<plugin>.<action> 历史深链——「上次那个」直达
  const hh = parseHistoryHash(location.hash || '');
  if (hh) {
    const dot = hh.lastIndexOf('.');
    const entry = entries.find((e) => e.plugin.id === hh.slice(0, dot) && e.action.id === hh.slice(dot + 1));
    if (entry) {
      openDetail(entry.plugin, entry.action);
      return;
    }
    // 动作不存在（被卸载？）：退回列表并说明
    el.q.value = '';
    renderList();
    el.count.textContent = `历史里的 ${hh} 已不存在（插件可能被卸载）`;
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
  // 第三十八轮：#/timers 面板路由（applyHash 有同样分支，hashchange 也要）
  if ((location.hash || '') === '#/timers') { showTimers(); return; }
  // 第六十四轮：#/clip 剪贴板历史面板
  if ((location.hash || '') === '#/clip') { showClipPanel(); return; }
  // 第十八轮⑥：#/watch 是面板路由——监控继续跑（面板就是聚合它们的），只切视图
  if ((location.hash || '') === '#/watch') {
    showWatchPanel();
    return;
  }
  // 第二十二轮⑤：#/help 帮助页——界面内说明，不跳出应用
  if ((location.hash || '') === '#/help') {
    showHelpPanel();
    return;
  }
  // #/logs 等面板路由：hashchange 直达（applyHash 有同款分支，hash 導航也要）
  if ((location.hash || '') === '#/logs') { showLogs(); return; }
  if ((location.hash || '') === '#/stats') { showStats(); return; }
  if ((location.hash || '') === '#/doctor') { showDoctor(); return; }
  // 第二十九轮⑧：#/perf 性能页——列表/搜索耗时三指标卡，改代码前后各看一眼
  if ((location.hash || '') === '#/perf') {
    showPerfPanel();
    return;
  }
  // 从详情后退回列表：hash 已变回空/列表态，详情界面要自己收掉
  if (detail && !/#\/[\w.-]+\/[\w.-]+/.test(location.hash || '')) {
    detail = null;
    el.detailView.classList.add('hidden');
    el.detailView.innerHTML = '';
    showPanelAnimated(el.listView);
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
    el.modeLabel.textContent = t('modeDetail');
    el.listView.classList.add('hidden');
    showPanelAnimated(el.detailView);
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
  // 第六十四轮：剪贴板工作流（截图脚本与自动化验证用）
  __zerokitShowClipSuggest: showClipSuggest,
  __zerokitShowClipPanel: showClipPanel,
  // 第三十九轮：结果区直渲（截图脚本与自动化验证用）
  __zerokitRenderResult: (res) => renderResult(res),
  // 第二十一轮：配置档（截图脚本与深度自动化用）
  get __zerokitProfileNames() { return profileList(loadProfiles()); },
  __zerokitCreateProfile: createProfileFromCurrent,
  __zerokitSwitchProfile: switchProfile,
  __zerokitShowHelp: showHelpPanel,
  __zerokitResultTabs: resultTabs,
  __zerokitPushResultTab: pushResultTab,
  __zerokitRenderTabBar: renderTabBar,
  __zerokitResultQueryTerms: resultQueryTerms,
  __zerokitShowFirstRun: showFirstRunGuide,
  // 第二十四轮：命令与快捷键
  __zerokitShowPalette: showPalette,
  __zerokitShowHotkeyCheat: showHotkeyCheat,
  __zerokitCommandList: COMMAND_LIST,
  __zerokitGotoArmedAt: () => gotoArmedAt,
  __zerokitRenameProfile(from, to) {
    const r = renameProfile(loadProfiles(), from, to);
    if (r.error) return r;
    saveProfiles(r.profiles);
    localStorage.setItem('zerokit.profile.cur', r.current);
    return r;
  },
  __zerokitDeleteProfile(name) {
    const r = deleteProfile(loadProfiles(), curProfileName(), name);
    if (r.error) return r;
    saveProfiles(r.profiles);
    localStorage.setItem('zerokit.profile.cur', r.current);
    if (curProfileName() !== r.current) switchProfile(r.current);
    return r;
  },
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
  collectBackup, parseBackup, mergeBackup, classifyKey, backupFilename, exportBackup, openImportDialog,
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
  // 三档循环：跟随系统 → 中文 → 英文 → 跟随系统
  langPref = langPref === 'system' ? 'zh' : (langPref === 'zh' ? 'en' : 'system');
  try { localStorage.setItem('zerokit.lang', langPref); } catch { /* 隐私模式 */ }
  lang = pickLang(langPref, navigator.language);
  t = makeT(lang);
  applyLang(true);
});
/**
 * 应用语言：静态 DOM（data-i18n）+ 当前面板重渲。首次启动 mode 尚未建立时
 * 只处理静态点；切换时按 mode 重渲对应面板。标题徽标（tabTitle）不属语言文案。
 */
function applyLang(rerender = false) {
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  el.q.placeholder = t('searchPlaceholder');
  const lb = $('langBtn');
  if (lb) { lb.textContent = t('langLabel'); lb.title = t('langTitle'); }
  // 静态节点统一走 data-i18n（index.html 标注）
  document.querySelectorAll('[data-i18n]').forEach((n) => {
    const k = n.getAttribute('data-i18n');
    const v = I18N_TEXT(k);
    if (v != null) {
      if (n.tagName === 'INPUT' && n.type !== 'button') n.placeholder = v; else n.textContent = v;
    }
  });
  const run = $('runBtn');
  if (run) run.textContent = t('run');
  refreshModeLabel();
  if (!rerender) return;
  // 按当前 mode 重渲（第二十八轮清单；面板函数都是幂等重渲）
  switch (mode) {
    case 'command': renderList(); renderTabBar(); break;
    case 'detail': if (detail) openDetail(detail.plugin, detail.action); renderTabBar(); break;
    case 'market': showMarket(); break;
    case 'logs': showLogs(); break;
    case 'doctor': showDoctor(); break;
    case 'plugins': showPlugins(); break;
    case 'stats': showStats(); break;
    case 'saved': showSaved(); break;
    case 'ps': showPs(); break;
    case 'workbench': showWorkbench(); break;
    case 'watch': showWatchPanel(); break;
    case 'help': showHelpPanel(); break;
    case 'brief': showBrief(); break;
    case 'timers': showTimers(); break;
    default: renderList();
  }
  // 结果区与页脚等常驻元素
  if (currentResult) renderResult(currentResult);
}
/** data-i18n 键 → 文案（静态点专用小表，避免 index.html 与 extras 大表耦合） */
function I18N_TEXT(k) {
  const map = {
    reload: t('reload'),
    footerSaved: t('modeSaved'), footerTimers: t('modeTimers'), footerBrief: t('modeBrief'),
    footerLogs: t('modeLogs'), footerDoctor: t('modeDoctor'), footerShortcuts: t('shortcuts'),
    footerGuide: t('modeHelp'),
  };
  return map[k] ?? null;
}
/** 顶栏模式标签随语言刷新（mode → t('mode'+Mode)） */
function refreshModeLabel() {
  const key = 'mode' + mode.charAt(0).toUpperCase() + mode.slice(1);
  const v = t(key);
  if (v !== key) el.modeLabel.textContent = v;
}
$('themeFast')?.addEventListener('click', toggleLightDark);
  // 第四十七轮①：设置抽屉——管理类入口统一收纳
let drawerTrap = null;
function openDrawer() {
  $('drawer')?.classList.remove('hidden');
  $('drawerMask')?.classList.remove('hidden');
  openThemePop();   // 主题区常驻抽屉
  drawerTrap?.release(false);
  drawerTrap = trapFocus($('drawer'), { onClose: closeDrawer });   // 第六十六轮②
}
function closeDrawer() {
  $('drawer')?.classList.add('hidden');
  $('drawerMask')?.classList.add('hidden');
}
$('drawerBtn')?.addEventListener('click', () => {
  const d = $('drawer');
  if (d?.classList.contains('hidden')) openDrawer(); else closeDrawer();
});
$('drawerClose')?.addEventListener('click', closeDrawer);
$('drawerMask')?.addEventListener('click', closeDrawer);

// 第四十七轮：抽屉链接转发到既有入口（语言三档循环内联——langBtn 已移出顶栏）
$('dlLang')?.addEventListener('click', () => {
  langPref = langPref === 'system' ? 'zh' : (langPref === 'zh' ? 'en' : 'system');
  try { localStorage.setItem('zerokit.lang', langPref); } catch { /* 隐私模式 */ }
  lang = pickLang(langPref, navigator.language);
  t = makeT(lang);
  applyLang(true);
});
$('dlLogs')?.addEventListener('click', () => { closeDrawer(); $('logsBtn')?.click(); });
$('dlDoctor')?.addEventListener('click', () => { closeDrawer(); $('doctorBtn')?.click(); });
$('dlSaved')?.addEventListener('click', () => { closeDrawer(); $('savedBtn')?.click(); });
$('dlTimers')?.addEventListener('click', () => { closeDrawer(); $('timersBtn')?.click(); });
$('dlBrief')?.addEventListener('click', () => { closeDrawer(); $('briefBtn')?.click(); });
$('dlHelp')?.addEventListener('click', () => { closeDrawer(); $('guideBtn')?.click(); });
$('dlWatch')?.addEventListener('click', () => { closeDrawer(); location.hash = '#/watch'; });
// 第四十七轮：抽屉内的主题区入口（themePop 现在常驻抽屉，由 drawerBtn 打开时渲染）
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
    e.preventDefault();
    toggleLightDark();
  }
});

loadPrefs();
applyAiAssist();
applyLang();
applyTheme();
applyAccent();
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
// 第四十七轮：themeBtn 已收进抽屉（drawerBtn 打开即渲染主题区），此处不再绑定顶栏按钮
document.addEventListener('click', (e) => {
  const pop = $('themePop');
  if (!pop || pop.classList.contains('hidden')) return;
  if (pop.contains(e.target) || e.target.closest('#drawerBtn') || e.target.closest('#drawer')) return;
  pop.classList.add('hidden');
});
$('logsBtn')?.addEventListener('click', showLogs);
$('savedBtn')?.addEventListener('click', () => { if (mode === 'saved') exitSaved(); else showSaved(); });
$('doctorBtn')?.addEventListener('click', showDoctor);
// 第二十二轮②⑤：页脚「快捷键」保留原速查表；旁边加「使用指南」进 #/help
$('helpBtn')?.addEventListener('click', showShortcuts);
$('guideBtn')?.addEventListener('click', () => { location.hash = '#/help'; });

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
/** 第五十二轮⑤：T 键标签小面板——当前项打/选标签，数字快捷选已有标签。 */
function showTagPanel(i) {
  const entry = filtered[i];
  if (!entry) return;
  const key = actionKey(entry.plugin.id, entry.action.id);
  const existing = Object.values(actionTags).flat().filter((x, idx, a) => a.indexOf(x) === idx).slice(0, 9);
  const cur = actionTags[key] ?? [];
  const panel = document.createElement('div');
  panel.className = 'tag-panel overlay-panel';
  panel.id = 'tagPanel';
  panel.innerHTML = `<div class="ps-head"><h3>标签：${esc(entry.action.title)}</h3>
      <button class="ghost mini" id="tagClose">✕</button></div>
    <input id="tagInput" placeholder="新标签，回车添加（逗号分隔可多个）" style="width:100%">
    ${existing.length ? `<div class="empty-sug-title">已有标签（点选/数字键）：</div>
      ${existing.map((t, j) => `<button class="chip${cur.includes(t) ? ' on' : ''}" data-tg="${esc(t)}">${j + 1} ${esc(t)}${cur.includes(t) ? ' ✓' : ''}</button>`).join(' ')}` : ''}
    <div class="sub">当前：${cur.length ? cur.map((t) => `#${esc(t)}`).join(' ') : '无'}</div>`;
  document.body.appendChild(panel);
  const close = () => panel.remove();
  panel.querySelector('#tagClose').addEventListener('click', close);
  panel.querySelectorAll('[data-tg]').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.tg;
    const list = actionTags[key] ?? [];
    const at = list.indexOf(t);
    at >= 0 ? list.splice(at, 1) : list.push(t);
    if (list.length) actionTags[key] = list; else delete actionTags[key];
    writeJson(PREF.tags, actionTags);
    renderList(); showTagPanel(i);   // 重开刷新勾选
  }));
  panel.querySelector('#tagInput').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      const raw = ev.target.value.trim();
      if (!raw) return;
      for (const t of raw.split(/[,，]/).map((x) => x.trim()).filter(Boolean)) {
        (actionTags[key] ??= []).push(t);
      }
      writeJson(PREF.tags, actionTags);
      renderList(); close();
      el.count.textContent = `已打标签：${(actionTags[key] ?? []).map((t) => '#' + t).join(' ')}`;
    } else if (ev.key === 'Escape') close();
    else if (/^[1-9]$/.test(ev.key)) {
      const b = panel.querySelectorAll('[data-tg]')[Number(ev.key) - 1];
      if (b) b.click();
    }
  });
  panel.querySelector('#tagInput').focus();
}

/** 第五十二轮⑧：? 键位帮助浮层。 */
function showKeyHelp() {
  showHotkeyCheat();
  return;
  const rows = keyHelpList(); /* eslint-disable-line no-unreachable */
  const panel = document.createElement('div');
  panel.className = 'tag-panel overlay-panel';
  panel.id = 'keyHelp';
  panel.innerHTML = `<div class="ps-head"><h3>键盘流</h3><button class="ghost mini" id="khClose">✕</button></div>
    <table class="kh-table"><tbody>${rows.map((r) => `<tr><td><kbd>${esc(r.key)}</kbd></td><td>${esc(r.what)}</td></tr>`).join('')}</tbody></table>`;
  document.body.appendChild(panel);
  const close = () => panel.remove();
  panel.querySelector('#khClose').addEventListener('click', close);
  panel.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' || ev.key === '?' ) close(); });
  panel.tabIndex = -1; panel.focus();
}
