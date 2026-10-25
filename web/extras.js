// 启动器里的纯逻辑：主题、收藏、高亮、参数记忆、执行历史、插件健康。
//
// 抽出来是为了能脱离浏览器单测（test/extras-smoke.mjs）——
// 这些判断（「哪些算收藏」「历史留几条」「怎样的插件算不健康」）
// 出错时不会有报错，只会悄悄让人用得不顺手，所以值得钉住。
// 本文件不碰 DOM、localStorage、fetch。

export const THEMES = ['system', 'dark', 'light'];

/** 把存储里的任意值收敛成合法主题；坏值等于没设置 */
export function normalizeTheme(value) {
  return THEMES.includes(value) ? value : 'system';
}

/** system 跟随系统，其它原样返回 */
export function resolveTheme(choice, prefersDark) {
  const theme = normalizeTheme(choice);
  if (theme !== 'system') return theme;
  return prefersDark ? 'dark' : 'light';
}

export const SHORTCUTS = [
  { keys: ['↑', '↓'], what: '在结果里上下选择' },
  { keys: ['Enter'], what: '打开动作 / 执行' },
  { keys: ['Ctrl', 'Enter'], what: '直接确认执行（会改动）并记住' },
  { keys: ['Esc'], what: '返回上一层 / 清空搜索' },
  { keys: ['?'], what: '切到 AI 工作台（在搜索框开头输入）' },
  { keys: ['Ctrl', '/'], what: '打开这份快捷键速查' },
  { keys: ['Ctrl', 'K'], what: '聚焦搜索框' },
];

/** 关键词高亮：只认「原样子串」（不把拼音/子序列硬套进来），否则会高亮得莫名其妙 */
export function highlightSegments(text, query, maxParts = 24) {
  const src = String(text ?? '');
  const q = String(query ?? '').trim();
  if (!q || !src) return [{ text: src, hit: false }];
  const lowerSrc = src.toLowerCase();
  const lowerQ = q.toLowerCase();
  const parts = [];
  let from = 0;
  let guard = 0;
  while (from < src.length && guard < maxParts) {
    const at = lowerSrc.indexOf(lowerQ, from);
    if (at < 0) break;
    if (at > from) parts.push({ text: src.slice(from, at), hit: false });
    parts.push({ text: src.slice(at, at + q.length), hit: true });
    from = at + q.length;
    guard += 1;
  }
  if (from < src.length) parts.push({ text: src.slice(from), hit: false });
  return parts.length ? parts : [{ text: src, hit: false }];
}

/** 高亮成可直接插入 innerHTML 的片段；esc 由调用方传入（app.js 的 esc） */
export function highlightHtml(text, query, esc) {
  return highlightSegments(text, query)
    .map((p) => (p.hit ? `<mark>${esc(p.text)}</mark>` : esc(p.text)))
    .join('');
}

/** 收藏键：插件 id + 动作 id。插件里 id 不允许点号冲突，所以扁平拼起来是安全的 */
export function actionKey(pluginId, actionId) {
  return `${pluginId}.${actionId}`;
}

/** 切换收藏（纯函数：返回新数组，不改入参）；新收藏放最前面 */
export function toggleFavorite(list, key) {
  const current = Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
  return current.includes(key) ? current.filter((x) => x !== key) : [key, ...current];
}

export function isFavorite(list, key) {
  return Array.isArray(list) && list.includes(key);
}

/** 收藏优先的稳定排序：收藏项保持原相对顺序，其余也保持原相对顺序 */
export function favoritesFirst(items, favSet) {
  const on = [];
  const off = [];
  for (const item of items) {
    (favSet.has(actionKey(item.plugin.id, item.action.id)) ? on : off).push(item);
  }
  return [...on, ...off];
}

/** 参数记忆：只记非密钥字段。密钥记忆下来等于把明文密码写进 localStorage */
export function rememberParams(store, key, values, secretNames = []) {
  const safe = {};
  for (const [name, value] of Object.entries(values ?? {})) {
    if (secretNames.includes(name)) continue;
    if (value === undefined || value === '') continue;
    safe[name] = value;
  }
  return Object.keys(safe).length ? { ...store, [key]: safe } : store;
}

/** 执行历史：每个动作只留最近 cap 条，新的在前 */
export function pushRunHistory(store, key, run, cap = 3) {
  const list = Array.isArray(store?.[key]) ? store[key] : [];
  return { ...store, [key]: [run, ...list].slice(0, cap) };
}

/** 插件健康概览：插件面板顶部的四张数字卡就靠它 */
export function pluginHealth(plugins) {
  const list = Array.isArray(plugins) ? plugins : [];
  const missingDeps = [];
  const missingPluginDeps = [];
  const missingSettings = [];
  let chains = 0;
  for (const p of list) {
    if (p.requiresOk === false) missingDeps.push(p.id);
    if (p.pluginDepsOk === false) missingPluginDeps.push(p.id);
    if ((p.settings || []).some((s) => s.missing)) missingSettings.push(p.id);
    chains += (p.actions || []).filter((a) => (a.steps || []).length > 0).length;
  }
  return {
    total: list.length,
    actions: list.reduce((n, p) => n + (p.actions || []).length, 0),
    missingDeps,
    missingPluginDeps,
    missingSettings,
    chains,
    healthy: missingDeps.length === 0 && missingPluginDeps.length === 0 && missingSettings.length === 0,
  };
}

/** 工作台空会话的提问建议：挑几个能立刻跑出结果的，别推荐需要密钥的动作 */
export const PROMPTS = [
  { label: '看看我的电脑配置', prompt: '总结一下这台机器的配置和当前占用情况' },
  { label: '查公网 IP', prompt: '查一下我的公网 IP，并解释它能透露什么信息' },
  { label: '最近剪贴板有什么', prompt: '看看剪贴板历史里最近几条，帮我归类' },
  { label: '搜索文件', prompt: '帮我找一下名字里带 report 的文件' },
];
