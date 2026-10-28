// 启动器里的纯逻辑：主题、收藏、高亮、参数记忆、执行历史、插件健康。
//
// 抽出来是为了能脱离浏览器单测（test/extras-smoke.mjs）——
// 这些判断（「哪些算收藏」「历史留几条」「怎样的插件算不健康」）
// 出错时不会有报错，只会悄悄让人用得不顺手，所以值得钉住。
// 本文件不碰 DOM、localStorage、fetch。


// ==================================================================
// ===== 外观与主题 =====
// ==================================================================
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


// ==================================================================
// ===== 文本高亮与快捷键 =====
// ==================================================================
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

// ==================================================================
// ===== 收藏与动作键 =====
// ==================================================================
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

// ---------------------------------------------------------------- 第二轮十项
//
// 同样只放纯函数：解析/排序/拼文本这类容易写错、又完全不需要 DOM 的逻辑，
// 放这里让 Node 直接单测。

/** 强调色：只改一个 CSS 变量，深浅主题都跟着走 */
export const ACCENTS = [
  { id: 'ocean', label: '海水蓝', color: '#5aa9ff' },
  { id: 'violet', label: '暮光紫', color: '#a78bfa' },
  { id: 'emerald', label: '翡翠绿', color: '#34d399' },
  { id: 'amber', label: '琥珀金', color: '#f0b43c' },
  { id: 'rose', label: '玫瑰红', color: '#f472b6' },
  { id: 'slate', label: '石板灰', color: '#94a3b8' },
];

export function normalizeAccent(id) {
  return ACCENTS.some((a) => a.id === id) ? id : 'ocean';
}

export function accentColor(id) {
  return ACCENTS.find((a) => a.id === normalizeAccent(id)).color;
}

/** 列表筛选：风险维度 + 收藏，顺序与数量都由它决定 */
export const FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'fav', label: '收藏' },
  { id: 'read', label: '只读' },
  { id: 'mutate', label: '会改动' },
  { id: 'destructive', label: '高风险' },
];

export function filterActions(items, filter, favorites) {
  const list = Array.isArray(items) ? items : [];
  if (filter === 'fav') {
    const favSet = new Set(favorites || []);
    return list.filter((e) => favSet.has(`${e.plugin.id}.${e.action.id}`));
  }
  if (filter === 'read' || filter === 'mutate' || filter === 'destructive') {
    return list.filter((e) => e.action.risk === filter);
  }
  return list;
}

/** 搜索历史：最近的在前、去重、最多 8 条；空查询不写 */
export function pushSearch(history, query, max = 8) {
  const q = String(query ?? '').trim();
  const list = Array.isArray(history) ? history : [];
  if (!q) return list;
  return [q, ...list.filter((x) => x !== q)].slice(0, max);
}

/** 使用统计：按执行次数取前 N，次数相同看最近一次 */
export function topActions(runStore, n = 5) {
  return Object.entries(runStore || {})
    .map(([key, runs]) => {
      const list = Array.isArray(runs) ? runs : [];
      return { key, runs: list.length, last: list[0]?.ts ?? 0 };
    })
    .filter((x) => x.runs > 0)
    .sort((a, b) => b.runs - a.runs || b.last - a.last)
    .slice(0, n);
}

/** 跨动作的最近执行：首页「最近执行」用，时间倒序 */
export function recentRuns(runStore, n = 5) {
  const rows = [];
  for (const [key, list] of Object.entries(runStore || {})) {
    if (!Array.isArray(list)) continue;
    for (const run of list) rows.push({ key, ...run });
  }
  return rows.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0)).slice(0, n);
}

/**
 * 复制「怎么调用这个动作」：CLI、MCP 工具名、启动器深链三行。
 * 给同事分享、或让 AI 直接照着调时不用查文档。
 */
export function invocationText(plugin, action, deepLink = '') {
  const lines = [];
  if (action.type === 'http') {
    lines.push(`# CLI（http 动作）`, `zkit run ${plugin.id} ${action.id} --yes # ${action.method} ${action.url}`);
  } else if (action.type === 'chain') {
    lines.push(`# CLI（组合 ${action.steps.length} 步）`, `zkit run ${plugin.id} ${action.id}`);
  } else {
    lines.push('# CLI', `zkit run ${plugin.id} ${action.id}`);
  }
  lines.push('', '# MCP 工具（AI 客户端里叫这个名字）', `${plugin.id}__${action.id}`);
  if (deepLink) lines.push('', '# 启动器深链', deepLink);
  return lines.join('\n');
}

/**
 * 把结果导出成 Markdown：对象走表格、数组走表格或 JSON、纯文本走代码块。
 * 导出的东西要能直接贴进 Issue / 文档，所以不用截图，也不带终端控制字符。
 */
export function resultMarkdown(title, res) {
  const out = [`### ${title}`, ''];
  if (!res) return out.join('\n');
  if (!res.ok && res.error) {
    out.push(`> 失败：${String(res.error).replace(/\s+/g, ' ')}`, '');
  }
  const cell = (v) => String(v === undefined || v === null ? '' : v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const data = res.data;
  if (Array.isArray(data)) {
    const first = data[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      const keys = [...new Set(data.flatMap((row) => Object.keys(row)))];
      out.push(`| ${keys.join(' | ')} |`, `| ${keys.map(() => '---').join(' | ')} |`);
      for (const row of data) out.push(`| ${keys.map((k) => cell(row[k])).join(' | ')} |`);
    } else {
      out.push('```json', JSON.stringify(data, null, 2), '```');
    }
  } else if (data && typeof data === 'object') {
    // 第十七轮⑧：对象结果导出成属性行列表（**键**: 值）——比两列表格更像「报告」，
    // 嵌套对象缩进一层；数组值逗号连排
    const props = toMarkdownProps(data);
    if (props) out.push(props);
    else out.push('| 字段 | 值 |', '| --- | --- |');
  } else if (data !== undefined && data !== null) {
    out.push(String(data));
  } else if (res.stdout) {
    out.push('```', String(res.stdout).trim(), '```');
  }
  out.push('', `> ${res.ok ? '成功' : '失败'}${res.ms !== undefined ? ` · ${res.ms} ms` : ''}${res.command ? ` · \`${res.command}\`` : ''}`);
  return out.join('\n');
}

// ---------------------------------------------------------------- 第四轮：结果加工与统计

/** 千分位：1234567 -> "1,234,567"；小数保留原样（只加整数部分分隔） */
export function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const [int, dec] = String(n).split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (dec ? '.' + dec : '');
}

/** 判断一列是不是数字列：至少一半的值是有限数字 */
export function isNumericColumn(values) {
  const vals = values.filter((v) => v !== null && v !== undefined && v !== '');
  if (!vals.length) return false;
  const nums = vals.filter((v) => Number.isFinite(Number(v)));
  return nums.length >= vals.length / 2;
}

/** 表格排序：num 列按数值、其余按字符串；dir=1 升序 -1 降序；返回新数组不动原表 */
export function sortRows(rows, col, dir = 1) {
  return [...rows].sort((a, b) => {
    const x = a[col], y = b[col];
    const nx = Number(x), ny = Number(y);
    const bothNum = Number.isFinite(nx) && Number.isFinite(ny)
      && String(x).trim() !== '' && String(y).trim() !== '';
    const cmp = bothNum ? nx - ny : String(x ?? '').localeCompare(String(y ?? ''), 'zh');
    return cmp * dir;
  });
}

/** 结果转 CSV：数组对象取并集列；对象转 key,value 两列。值里带逗号/引号/换行会加引号转义 */
export function toCsv(data) {
  const cell = (v) => {
    const s = (v && typeof v === 'object') ? JSON.stringify(v) : String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [];
  if (Array.isArray(data) && data.length && typeof data[0] === 'object' && data[0] !== null) {
    const keys = [...new Set(data.flatMap((row) => Object.keys(row)))];
    lines.push(keys.map(cell).join(','));
    for (const row of data) lines.push(keys.map((k) => cell(row[k])).join(','));
  } else if (data && typeof data === 'object') {
    lines.push('key,value');
    for (const [k, v] of Object.entries(data)) lines.push(`${cell(k)},${cell(v)}`);
  } else if (data !== undefined && data !== null) {
    lines.push(cell(data));
  }
  return lines.join('\n');
}

/** 两次执行结果的逐格 diff：a -> b，只对对象/对象数组。返回 [{path, from, to}] */
export function diffResults(a, b) {
  const out = [];
  const walk = (x, y, path) => {
    if (x === y) return;
    if (x !== null && y !== null && typeof x === 'object' && typeof y === 'object'
        && !Array.isArray(x) && !Array.isArray(y)) {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], path ? `${path}.${k}` : k);
      return;
    }
    const fa = (x === undefined) ? '（无）' : (typeof x === 'object' ? JSON.stringify(x) : String(x));
    const fb = (y === undefined) ? '（无）' : (typeof y === 'object' ? JSON.stringify(y) : String(y));
    if (fa !== fb) out.push({ path: path || '（顶层）', from: fa, to: fb });
  };
  walk(a, b, '');
  return out;
}

/** 近 N 天执行趋势：runs 是全部 runStore 扁平化后的 [{ts, ok}]，返回 [{day, total, fail}] */
export function dailyTrend(runs, days = 7) {
  const buckets = new Map();
  const dayKey = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  for (let i = days - 1; i >= 0; i--) {
    const t = Date.now() - i * 86400000;
    buckets.set(dayKey(t), { day: dayKey(t), total: 0, fail: 0 });
  }
  for (const r of runs) {
    const b = buckets.get(dayKey(r.ts));
    if (!b) continue;
    b.total++;
    if (!r.ok) b.fail++;
  }
  return [...buckets.values()];
}

/** 按小时分布（0–23），返回 [{hour, total}]，供热力条 */
export function hourlyHeat(runs) {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0 }));
  for (const r of runs) {
    const h = new Date(r.ts).getHours();
    buckets[h].total++;
  }
  return buckets;
}

/** 执行日报：本地拼装的中文小结（不调模型）。runs 为扁平化记录。 */
export function dailyReport(runs, { pluginNames = new Map() } = {}) {
  if (!runs.length) return { title: '今天的 zerokit', body: '今天还没有执行记录。跑一个只读动作试试，比如「系统概况」。' };
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const today = runs.filter((r) => r.ts >= dayStart.getTime());
  const okCount = today.filter((r) => r.ok).length;
  const failCount = today.length - okCount;
  const byAction = new Map();
  for (const r of today) byAction.set(r.key, (byAction.get(r.key) ?? 0) + 1);
  const top = [...byAction.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const avgMs = Math.round(today.reduce((s, r) => s + (r.ms ?? 0), 0) / today.length);
  const lines = [];
  lines.push(`今天跑了 ${today.length} 次动作（成功 ${okCount}${failCount ? `，失败 ${failCount}` : ''}），平均 ${avgMs} ms。`);
  if (top.length) {
    lines.push('用得最多的是：' + top.map(([k, n]) => {
      const [pid, aid] = k.split('.');
      const name = pluginNames.get(pid) ?? pid;
      return `「${name} · ${aid}」${n} 次`;
    }).join('、') + '。');
  }
  if (failCount) lines.push(`有 ${failCount} 次失败——可以在审计日志里看具体原因。`);
  else lines.push('全部成功，稳。');
  return { title: `今天的 zerokit（${new Date().toLocaleDateString()}）`, body: lines.join('\n') };
}


// ---------------------------------------------------------------- 第八轮：i18n

/**
 * 界面双语（中/英）。范围：框架级文案（模式标签、通用按钮、提示、空态）。
 * 动作/插件的名称与描述来自清单（作者的语言），不翻译——机器翻译插件描述
 * 只会制造困惑。框架文案 ~40 条先到位，其余后续轮次增量迁移。
 */
export const I18N = {
  zh: {
    modeCommand: '命令', modePlugins: '插件', modeMarket: '集市', modeStats: '统计',
    modeBrief: '简报', modeWatch: '监控', modeHelp: '帮助', modeTimers: '定时',
    modeLogs: '日志', modeDoctor: '自检', modePs: '运行中', modeWorkbench: '工作台',
    modeSaved: '收藏', modeMcp: 'MCP', modeDetail: '详情',
    searchPlaceholder: '搜索动作、插件、内容…（Ctrl+K 专注）',
    run: '执行', back: '返回', close: '关闭', copy: '复制', cancel: '取消',
    confirm: '确认执行', all: '全部', favorite: '收藏', settings: '设置',
    shortcuts: '快捷键', theme: '主题', empty: '什么都没有', noResult: '没有匹配的动作',
    langLabel: '中/EN', langTitle: '切换语言 / Switch language',
    // 第二十八轮扩充：高频共享键（盘点出现次数：执行141/复制72/返回78/失败94…）
    delete: '删除', save: '保存', edit: '编辑', export: '导出', importLabel: '导入',
    success: '成功', failed: '失败', loading: '加载中…', retry: '重试', open: '打开',
    more: '加载更多', copied: '已复制到剪贴板', required: '必填', total: '共',
    riskRead: '只读', riskWrite: '会改动', riskHigh: '高风险',
    emptyRuns: '还没有执行记录——跑一次就会记在这里',
    emptyMarket: '集市是空的——先添加一个集市源', emptyLogs: '还没有日志',
    emptySaved: '还没有收藏——点列表项的 ☆ 收藏常用动作',
    confirmDelete: '确认删除？', notFound: '没有找到', actions: '个动作',
    reload: '重新加载', plugins: '插件', action: '动作', actionUnit: '个动作',
    langSystem: '跟随系统', langZh: '中文', langEn: 'English',
  },
  en: {
    modeCommand: 'Commands', modePlugins: 'Plugins', modeMarket: 'Market', modeStats: 'Stats',
    modeBrief: 'Brief', modeWatch: 'Watch', modeHelp: 'Help', modeTimers: 'Timers',
    modeLogs: 'Logs', modeDoctor: 'Doctor', modePs: 'Running', modeWorkbench: 'Workbench',
    modeSaved: 'Saved', modeMcp: 'MCP', modeDetail: 'Detail',
    searchPlaceholder: 'Search actions, plugins, content… (Ctrl+K)',
    run: 'Run', back: 'Back', close: 'Close', copy: 'Copy', cancel: 'Cancel',
    confirm: 'Confirm', all: 'All', favorite: 'Favorite', settings: 'Settings',
    shortcuts: 'Shortcuts', theme: 'Theme', empty: 'Nothing here', noResult: 'No matching actions',
    langLabel: '中/EN', langTitle: 'Switch language / 切换语言',
    delete: 'Delete', save: 'Save', edit: 'Edit', export: 'Export', importLabel: 'Import',
    success: 'Success', failed: 'Failed', loading: 'Loading…', retry: 'Retry', open: 'Open',
    more: 'Load more', copied: 'Copied to clipboard', required: 'Required', total: 'Total',
    riskRead: 'Read-only', riskWrite: 'Writes', riskHigh: 'High risk',
    emptyRuns: 'No runs yet — run something and it will show up here',
    emptyMarket: 'Market is empty — add a market source first', emptyLogs: 'No logs yet',
    emptySaved: 'Nothing saved — tap ☆ on a list item to favorite actions',
    confirmDelete: 'Delete?', notFound: 'Not found', actions: 'actions',
    reload: 'Reload', plugins: 'plugins', action: 'Action', actionUnit: 'actions',
    langSystem: 'System', langZh: '中文', langEn: 'English',
  },
};

/**
 * 语言档解析：'en'|'zh' 原样；'system' 由 navLang 判定（默认 zh——本项目中文用户为主，
 * 非中文系统给 en）。任何非法值兜底 'zh'。返回值域恒为 'zh'|'en'，makeT/备份分类
 * 不受影响（第二十八轮：三档「跟随系统/中文/英文」的解析层）。
 */

// ==================================================================
// ===== 语言与格式化 =====
// ==================================================================
export function pickLang(v, navLang = '') {
  if (v === 'en') return 'en';
  if (v === 'system' || v == null || v === '') {
    // 无 navLang 信息（Node 测试环境/隐私模式）时兜底 zh——本项目中文用户为主
    if (!navLang) return 'zh';
    return navLang.startsWith('zh') ? 'zh' : 'en';
  }
  return 'zh';
}

/** 语言档原始值（'system'|'zh'|'en'）是否合法——外观面板下拉用。 */
export function validLangPref(v) {
  return v === 'system' || v === 'zh' || v === 'en';
}

/** t('run') → 当前语言的文案；缺 key 回退中文再回退 key 本身。 */
export function makeT(lang) {
  const L = I18N[pickLang(lang)];
  return (key) => L[key] ?? I18N.zh[key] ?? key;
}


// ---------------------------------------------------------------- 第九轮：可发现性与效率

/**
 * 键盘跳页计算：Home/End/PageUp/PageDown 在长度 n 的扁平序里怎么移。
 * 纯函数便于单测；pageLines 与可视区行高解耦（固定 8 行/页，与 CSS 行高一致）。
 */
export function pageJump(index, key, n, pageLines = 8) {
  if (!Number.isInteger(index) || index < 0) index = 0;
  const max = Math.max(0, n - 1);
  switch (key) {
    case 'Home': return 0;
    case 'End': return max;
    case 'PageUp': return Math.max(0, index - pageLines);
    case 'PageDown': return Math.min(max, index + pageLines);
    default: return index;
  }
}

/**
 * 搜索权重解释：把一次命中的各信号分数摊开，给「为什么排在前面」一个人话版。
 * 返回 [{label, score, weight, got}]（got = score * weight）。
 */
export function explainScore(pairs) {
  return (pairs ?? [])
    .filter(([, w]) => w > 0)
    .map(([label, score, weight]) => ({ label, score: Math.round(score * 100) / 100, weight, got: Math.round(score * weight * 100) / 100 }))
    .sort((a, b) => b.got - a.got);
}

/**
 * 批量执行计划：按选中顺序编排，destructive 排最后（降低「顺手全选」的破坏面）。
 * 返回 {ordered, moved}，moved 是被挪到尾部的 destructive 数量。
 */
export function planBatch(entries) {
  const list = [...(entries ?? [])];
  const dangerous = list.filter((e) => e.action.risk === 'destructive');
  const safe = list.filter((e) => e.action.risk !== 'destructive');
  return { ordered: [...safe, ...dangerous], moved: dangerous.length };
}

/**
 * 耗时直方图：把毫秒数装进对数桶（<50/100/250/500/1k/2.5k/5k/∞）。
 */
export function msHistogram(runsMs) {
  const edges = [50, 100, 250, 500, 1000, 2500, 5000, Infinity];
  const labels = ['<50', '50–100', '100–250', '250–500', '0.5–1s', '1–2.5s', '2.5–5s', '>5s'];
  const buckets = labels.map(() => 0);
  for (const ms of runsMs ?? []) {
    const i = edges.findIndex((e) => ms < e);
    buckets[i < 0 ? labels.length - 1 : i] += 1;
  }
  return labels.map((label, i) => ({ label, count: buckets[i] }));
}


// ---------------------------------------------------------------- 第十轮：自动化与粘性

/**
 * 每日简报：今天跑了多少、成败、最常用 top3、平均耗时。
 * 纯函数：runs 是 {key: [{ok, ms, ts}...]} 的本地记录。
 */
export function dailyBrief(runs, now = Date.now()) {
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const from = dayStart.getTime();
  const rows = [];
  for (const [key, list] of Object.entries(runs ?? {})) {
    for (const r of list ?? []) if ((r.ts ?? 0) >= from) rows.push({ key, ...r });
  }
  const ok = rows.filter((r) => r.ok).length;
  const byKey = {};
  for (const r of rows) byKey[r.key] = (byKey[r.key] ?? 0) + 1;
  const top = Object.entries(byKey).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const avg = rows.length ? Math.round(rows.reduce((s2, r) => s2 + (r.ms ?? 0), 0) / rows.length) : 0;
  return { total: rows.length, ok, failed: rows.length - ok, top, avgMs: avg };
}

/**
 * 结果保留策略：每个动作只留最近 N 份（默认 20），超出丢弃最老的。
 */
export function trimRuns(list, keep = 20) {
  const arr = [...(list ?? [])].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  return arr.slice(0, keep);
}

/**
 * 空闲推荐：距上次执行超过 idleMs 时，从历史里挑最常用动作 key。
 */
export function idleSuggest(runs, now = Date.now(), idleMs = 30 * 60 * 1000) {
  let latest = 0; const counts = {};
  for (const [key, list] of Object.entries(runs ?? {})) {
    counts[key] = (list ?? []).length;
    for (const r of list ?? []) if ((r.ts ?? 0) > latest) latest = r.ts ?? 0;
  }
  if (!latest || now - latest < idleMs) return null;
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 3 ? { key: best[0], sinceMs: now - latest } : null;
}


// ---------------------------------------------------------------- 第十一轮：专业工具感

/**
 * 结果工具条的动作集：右键菜单/工具条共用一份定义，避免两处漂移。
 * 每项 {id, label, needs} —— needs 标注它需要什么数据形态（table/json/text）。
 */
export const RESULT_ACTIONS = [
  { id: 'copyRow', label: '复制本行', needs: 'table' },
  { id: 'copyTable', label: '复制表格（TSV）', needs: 'table' },
  { id: 'copyMarkdown', label: '复制为 Markdown 表', needs: 'table' },
  { id: 'csv', label: '导出 CSV', needs: 'table' },
  { id: 'copyJson', label: '复制 JSON', needs: 'any' },
  { id: 'copyText', label: '复制纯文本', needs: 'any' },
];

/** Markdown 表：首行表头，第二行对齐线；数字列右对齐语法 `---:`。 */
export function markdownTable(rows) {
  if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== 'object') return '';
  const cols = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  const esc2 = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const numeric = Object.fromEntries(cols.map((c) => [c, rows.every((r) => r[c] === undefined || r[c] === '' || Number.isFinite(Number(r[c])))]));
  const head = `| ${cols.map(esc2).join(' | ')} |`;
  const sep = `| ${cols.map((c) => (numeric[c] ? '---:' : '---')).join(' | ')} |`;
  const body = rows.map((r) => `| ${cols.map((c) => esc2(r[c])).join(' | ')} |`).join('\n');
  return [head, sep, body].join('\n');
}

/** TSV：Excel/Numbers 直接粘贴进单元格的格式。 */
export function tsvTable(rows) {
  if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== 'object') return '';
  const cols = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  const cell = (v) => String(v ?? '').replace(/\t/g, ' ').replace(/\n/g, ' ');
  return [cols.map(cell).join('\t'), ...rows.map((r) => cols.map((c) => cell(r[c])).join('\t'))].join('\n');
}

/** JSON 折叠树的行模型：每行 {depth, key, preview, isLeaf, isArrayItem}。 */
export function jsonTreeLines(value, depth = 0, out = []) {
  if (value === null || typeof value !== 'object') {
    out.push({ depth, key: '', preview: JSON.stringify(value), isLeaf: true, isArrayItem: false });
    return out;
  }
  const isArray = Array.isArray(value);
  for (const [k, v] of Object.entries(value)) {
    if (v !== null && typeof v === 'object') {
      out.push({ depth, key: isArray ? `[${k}]` : k, preview: isArray ? `${(v).length} 项` : `${Object.keys(v).length} 键`, isLeaf: false, isArrayItem: isArray });
      jsonTreeLines(v, depth + 1, out);
    } else {
      out.push({ depth, key: isArray ? `[${k}]` : k, preview: JSON.stringify(v) ?? 'null', isLeaf: true, isArrayItem: isArray });
    }
  }
  return out;
}
/**
 * 第十二轮纯函数：数据可视化与命令面板
 */

/** 柱状图定标：给定 [{label,value}]，返回画条用的归一化高度（0–100）与展示值。
 * 负值整列翻转（min<0 时基线取 0 上移）；空数组/全零返回空。 */
export function barsScale(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const vals = rows.map((r) => Number(r.value ?? 0));
  const max = Math.max(...vals);
  const min = Math.min(...vals, 0);
  const span = max - min || 1;
  return rows.map((r, i) => {
    const v = Number(r.value ?? 0);
    return {
      label: String(r.label ?? `#${i + 1}`),
      height: Math.round(Math.abs(v) / span * 100),
      below: v < 0,
      display: String(r.value ?? 0),
    };
  });
}

/** sparkline 降采样：把任意长度序列压到 ≤width 个点（等距取样，保留首尾）。
 * 每点带 ok 标志（失败点在图上画成红点）。 */
export function sparkPoints(values, width = 24) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const n = values.length;
  if (n <= width) return values.map((v) => ({ ms: Number(v?.ms ?? 0), ok: v?.ok !== false }));
  const step = (n - 1) / (width - 1);
  const out = [];
  for (let i = 0; i < width; i++) {
    const idx = Math.min(n - 1, Math.round(i * step));
    const v = values[idx];
    out.push({ ms: Number(v?.ms ?? 0), ok: v?.ok !== false });
  }
  return out;
}

/** 统一毫秒展示：<1000ms 原样；<60s 秒一位小数；其余 分秒。 */
export function formatMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return String(ms ?? '');
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60000) return `${(n / 1000).toFixed(1)} s`;
  const m = Math.floor(n / 60000);
  const s = Math.round((n % 60000) / 1000);
  return `${m}m${String(s).padStart(2, '0')}s`;
}

/** 命令面板打分：label 精确 > 前缀 > 子串；hint 减半；返回降序排序的 items。 */
export function paletteScore(items, needle) {
  const q = String(needle ?? '').trim().toLowerCase();
  if (!q) return items.slice(0, 20);
  const scored = [];
  for (const it of items) {
    const label = String(it.label ?? '').toLowerCase();
    const hint = String(it.hint ?? '').toLowerCase();
    let score = 0;
    if (label === q) score = 100;
    else if (label.startsWith(q)) score = 80;
    else if (label.includes(q)) score = 60;
    else if (hint.includes(q)) score = 30;
    else {
      // 逐字符子序列匹配（拼首字母的体验）：label 里按顺序出现 q 的所有字符
      let li = 0;
      let seq = true;
      for (const ch of q) {
        li = label.indexOf(ch, li);
        if (li < 0) { seq = false; break; }
        li++;
      }
      if (seq) score = 20;
    }
    if (score > 0) scored.push({ it, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 20).map((x) => x.it);
}

/** 历史毫秒列表的 P95：给「慢于平常」徽标用。空列表返回 null。 */
export function p95Ms(values) {
  const arr = (Array.isArray(values) ? values : [])
    .map((v) => Number(v?.ms ?? 0)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const idx = Math.min(arr.length - 1, Math.ceil(arr.length * 0.95) - 1);
  return arr[idx];
}

// ---------------------------------------------------------------- 第十四轮：表单与输入体验

/** 表单校验：必填空值收集成 {name, reason} 数列；数字字段顺带验 min/max。空数组 = 通过。 */

// ==================================================================
// ===== 表单与参数 =====
// ==================================================================
export function validateFields(fields, values) {
  const errs = [];
  for (const f of fields ?? []) {
    const v = values?.[f.name];
    const empty = v === undefined || v === null || String(v).trim() === '';
    if (f.required && empty) { errs.push({ name: f.name, reason: '必填' }); continue; }
    if (empty) continue;
    if (f.type === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) { errs.push({ name: f.name, reason: '不是数字' }); continue; }
      if (f.min !== undefined && n < f.min) errs.push({ name: f.name, reason: `小于最小值 ${f.min}` });
      if (f.max !== undefined && n > f.max) errs.push({ name: f.name, reason: `大于最大值 ${f.max}` });
    }
  }
  return errs;
}

/** 参数脏检查：当前值与默认值（或预填值）不同的字段名列表。 */
export function dirtyFields(fields, values, initial = {}) {
  const dirty = [];
  for (const f of fields ?? []) {
    const base = initial[f.name] !== undefined ? String(initial[f.name]) : String(f.default ?? '');
    const now = values?.[f.name] === undefined || values?.[f.name] === null ? '' : String(values[f.name]);
    if (f.type === 'checkbox') {
      if (Boolean(values?.[f.name]) !== Boolean(f.default)) dirty.push(f.name);
      continue;
    }
    if (now !== base && !(now === '' && base === '')) dirty.push(f.name);
  }
  return dirty;
}

/** 从 URL 深链 query 提取预填参数：#/插件/动作?字段=值。返回对象（无 query 返回 {}）。 */
export function deepLinkParams(hash) {
  const h = String(hash ?? '');
  const qi = h.indexOf('?');
  if (qi < 0) return {};
  const out = {};
  for (const pair of h.slice(qi + 1).split('&')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const k = pair.slice(0, eq);
    if (!/^[\w.-]+$/.test(k)) continue;
    try { out[k] = decodeURIComponent(pair.slice(eq + 1)); } catch { out[k] = pair.slice(eq + 1); }
  }
  return out;
}

/** 最近成功执行的参数组合（去重、留新）：给「历史参数重选」下拉用。 */
export function recentParamSets(history, limit = 3) {
  const seen = new Set();
  const out = [];
  for (const run of (Array.isArray(history) ? history : [])) {
    if (!run?.ok || !run?.params) continue;
    const key = JSON.stringify(run.params);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ts: run.ts, params: run.params });
    if (out.length >= limit) break;
  }
  return out;
}

// ------------------------------------------------------- 第十五轮：大数据量与导航

/**
 * 虚拟滚动窗口计算：给定总数 / 滚动位置 / 视口能容纳的行数，
 * 返回渲染区间 [start, end)（end 不含）与上下撑高的 spacer 高度。
 * overscan 是缓冲行数，快速滚动时不闪白。
 */

// ==================================================================
// ===== 列表与虚拟滚动 =====
// ==================================================================
export function virtualWindow(total, scrollTop, rowH, viewH, overscan = 6) {
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(rowH) || rowH <= 0) {
    return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  }
  const visible = Math.ceil((Number.isFinite(viewH) && viewH > 0 ? viewH : 600) / rowH);
  let start = Math.floor(scrollTop / rowH) - overscan;
  if (start < 0) start = 0;
  let end = start + visible + overscan * 2;
  if (end > total) end = total;
  if (start > end) start = end;
  return { start, end, padTop: start * rowH, padBottom: (total - end) * rowH };
}

/** 分页切片：页码从 1 起，越界钳回有效范围。返回 {page, pages, slice}。 */
export function pageSlice(list, page, per = 50) {
  const n = Array.isArray(list) ? list.length : 0;
  const pages = Math.max(1, Math.ceil(n / per));
  const p = Number.isInteger(page) && page >= 1 ? Math.min(page, pages) : 1;
  return { page: p, pages, slice: (list ?? []).slice((p - 1) * per, p * per) };
}

/** 面包屑路径：全部 › 插件 › 动作，插件段带 id 用于跳转。 */
export function breadcrumb(plugin, action) {
  if (!plugin) return [];
  const crumbs = [{ kind: 'list', label: '全部', hash: '' }];
  crumbs.push({ kind: 'plugin', label: plugin.name || plugin.id, id: plugin.id, hash: `#/plugins/${plugin.id}` });
  if (action) crumbs.push({ kind: 'action', label: action.title || action.id, id: action.id });
  return crumbs;
}

/** 列表状态编码进 hash query：搜索词/筛选（白名单键）。 */
export function listStateQuery(state = {}) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.filter && state.filter !== 'all') params.set('filter', state.filter);
  return params.toString();
}

/** 从 hash query 还原列表状态（与 listStateQuery 对偶）。 */
export function parseListState(hash) {
  const h = String(hash ?? '');
  const qm = h.indexOf('?');
  const out = { q: '', filter: 'all' };
  if (qm < 0) return out;
  for (const [k, v] of new URLSearchParams(h.slice(qm + 1))) {
    if (k === 'q') out.q = v.slice(0, 100);
    if (k === 'filter') out.filter = v;
  }
  return out;
}

/** 数字键 1-9 快选：按下的数字是否落在列表长度内，返回目标下标或 -1。 */
export function digitPick(key, n) {
  const d = /^[1-9]$/.exec(String(key ?? ''));
  if (!d) return -1;
  const i = Number(d[0]) - 1;   // 无捕获组：整段匹配就是数字本身
  return i < n ? i : -1;
}

/** ---------- 第十六轮：数据与结果的二次加工 ---------- */

/** 表格筛选：按各列子串过滤行（每个词都要在某列命中；空词组返回原表）。 */

// ==================================================================
// ===== 表格加工 =====
// ==================================================================
export function filterRows(rows, terms) {
  const qs = (Array.isArray(terms) ? terms : []).map((t) => String(t ?? '').trim().toLowerCase()).filter(Boolean);
  if (!qs.length) return rows;
  return rows.filter((row) => {
    const hay = Object.values(row).map((v) => String(v ?? '')).join('\n').toLowerCase();
    return qs.every((q) => hay.includes(q));
  });
}

/** 列统计：数字列给 合计/均值/最小/最大；非数字列给 非空计数。 */
export function colStats(rows, col) {
  const nums = rows.map((r) => r?.[col])
    .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) {
    const filled = rows.filter((r) => r?.[col] !== undefined && r?.[col] !== null && String(r[col]) !== '').length;
    return { kind: 'text', count: filled };
  }
  const sum = nums.reduce((a, b) => a + b, 0);
  return { kind: 'num', count: nums.length, sum, avg: sum / nums.length, min: Math.min(...nums), max: Math.max(...nums) };
}

/** 单位识别：值看起来像「数字+单位后缀」的列才可换算。 */
export function unitOf(v) {
  const m = /^\s*(-?[\d.,]+)\s*(ms|s|KB|MB|GB|TB|B)\b/i.exec(String(v ?? ''));
  return m ? { num: Number(m[1].replace(/,/g, '')), unit: m[2] } : null;
}

/** 单位列检测：>60% 的值带单位才算单位列。 */
export function isUnitColumn(rows, col) {
  const vals = rows.map((r) => r?.[col]).filter((v) => v !== undefined && v !== null && String(v) !== '');
  if (!vals.length) return false;
  return vals.filter((v) => unitOf(v)).length / vals.length > 0.6;
}

const UNIT_FACTORS = {
  ms: { s: 0.001 }, s: { ms: 1000 },
  B: { KB: 1 / 1024, MB: 1 / (1024 ** 2), GB: 1 / (1024 ** 3), TB: 1 / (1024 ** 4) },
  KB: { B: 1024, MB: 1 / 1024, GB: 1 / (1024 ** 2), TB: 1 / (1024 ** 3) },
  MB: { B: 1024 ** 2, KB: 1024, GB: 1 / 1024, TB: 1 / (1024 ** 2) },
  GB: { B: 1024 ** 3, KB: 1024 ** 2, MB: 1024, TB: 1 / 1024 },
  TB: { B: 1024 ** 4, KB: 1024 ** 3, MB: 1024 ** 2, GB: 1024 },
};

/** 单位换算：把单位列整列换到目标单位（保持合适精度；不可换返回 null）。 */
export function convertUnitColumn(rows, col, to) {
  if (!isUnitColumn(rows, col)) return null;
  const out = rows.map((row) => {
    const u = unitOf(row?.[col]);
    if (!u) return row;
    const f = UNIT_FACTORS[u.unit.toUpperCase()]?.[String(to)] ?? UNIT_FACTORS[u.unit]?.[String(to)];
    if (f === undefined) return row;
    const n = u.num * f;
    const raw = Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 1 ? n.toFixed(2) : n.toPrecision(3);
    const shown = String(Number(raw));  // 去尾零：2.00 → 2、0.500 → 0.5
    return { ...row, [col]: `${shown} ${to}` };
  });
  return out;
}

/** 跨动作合并：两份数组结果按 key 列拼接（左连接语义；b 的同名列加后缀）。 */
export function mergeTables(a, b, keyA, keyB, suffix = '_2') {
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  const idx = new Map();
  b.forEach((row, i) => {
    const k = String(row?.[keyB] ?? '');
    if (!idx.has(k)) idx.set(k, i);
  });
  return a.map((row) => {
    const k = String(row?.[keyA] ?? '');
    const hit = idx.has(k) ? b[idx.get(k)] : null;
    const extra = hit ? Object.fromEntries(Object.entries(hit)
      .filter(([c]) => c !== keyB)
      .map(([c, v]) => [a.some((r) => c in r) ? `${c}${suffix}` : c, v])) : {};
    return { ...row, ...extra };
  });
}

/** 列值提取：取一列的所有值（可选去重、保持出现顺序）。 */
export function columnValues(rows, col, { dedupe = false } = {}) {
  let vals = rows.map((r) => String(r?.[col] ?? ''));
  if (dedupe) {
    const seen = new Set();
    vals = vals.filter((v) => (seen.has(v) ? false : (seen.add(v), true)));
  }
  return vals;
}

/** HTML 表格导出：贴进邮件/文档带格式的完整 HTML（含 style 内联）。 */
export function toHtmlTable(data, title = 'zerokit 结果') {
  if (!Array.isArray(data) || !data.length) return '';
  const cols = [];
  for (const row of data) for (const k of Object.keys(row ?? {})) if (!cols.includes(k)) cols.push(k);
  const th = cols.map((c) => `<th style="border:1px solid #ccc;padding:4px 8px;background:#f5f5f5;text-align:left">${c}</th>`).join('');
  const trs = data.map((row) => `<tr>${cols.map((c) => {
    const v = row?.[c];
    const val = (v && typeof v === 'object') ? JSON.stringify(v) : String(v ?? '');
    const esc = String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return `<td style="border:1px solid #ccc;padding:4px 8px">${esc}</td>`;
  }).join('')}</tr>`).join('');
  return `<table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:13px"><caption style="text-align:left;font-weight:600;padding:4px 0">${title}</caption><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

// ---------- 第十七轮：导出与外部对接 ----------

/** ① 复制模板：把 {a.b.c} 占位符按路径取值填进模板；取不到就原样返回 null（调用方回退纯文本）。 */
export function renderCopyTemplate(tpl, result) {
  if (typeof tpl !== 'string' || !tpl.includes('{')) return null;
  let hit = false;
  const out = tpl.replace(/\{([^{}]+)\}/g, (_, rawPath) => {
    // 模板根名约定是 result：{result.data.ip} 的第一段映射到结果对象自身
    const segs = String(rawPath).trim().split('.');
    if (segs[0] === 'result') segs.shift();
    let cur = result;
    for (const seg of segs) {
      if (cur == null || typeof cur !== 'object') { cur = undefined; break; }
      cur = cur[seg];
    }
    if (cur === undefined || cur === null) return '';
    hit = true;
    return typeof cur === 'object' ? JSON.stringify(cur) : String(cur);
  });
  return hit ? out : null;
}

/** ③ JSONL：对象数组每行一个 JSON（jq / ndjson 友好）；非对象数组返回 null。 */
export function toJsonl(data) {
  if (!Array.isArray(data) || !data.length || typeof data[0] !== 'object' || Array.isArray(data[0])) return null;
  return data.map((row) => JSON.stringify(row)).join('\n') + '\n';
}

/** ④ 可预测导出文件名：插件-动作-时间戳.扩展名（非法字符归一成 -，防路径穿越）。 */
export function exportFilename(pluginId, actionId, ext, now = new Date()) {
  const clean = (s) => String(s || 'result').replace(/[^\w.-]+/g, '-').replace(/^-+|\.+/g, '').replace(/-+$/g, '').slice(0, 40) || 'result';
  const pad = (n) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${clean(pluginId)}-${clean(actionId)}-${ts}.${clean(ext === '' ? 'txt' : ext)}`;
}

/** ⑧ 对象结果的 Markdown：属性行列表（**键**: 值），嵌套对象缩进；非对象返回 null。 */
export function toMarkdownProps(data, indent = '') {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const lines = [];
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      lines.push(`${indent}- **${k}**:`);
      const sub = toMarkdownProps(v, `${indent}  `);
      if (sub) lines.push(sub);
    } else if (Array.isArray(v)) {
      lines.push(`${indent}- **${k}**: ${v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ')}`);
    } else {
      lines.push(`${indent}- **${k}**: ${v === null || v === undefined ? '' : String(v)}`);
    }
  }
  return lines.join('\n');
}

/* ===================== 第十八轮：监控与自动化 ===================== */

/**
 * ① 间隔选项标签：秒数 ↔ 人话标签。输入秒数返回标签；输 null 返回默认档位表。
 *   档位是写死的（关/5/10/30/60/300）——自由输入秒数看似灵活，实际没人填 47 秒。
 */

// ==================================================================
// ===== 监控与定时 =====
// ==================================================================
export const WATCH_INTERVALS = [
  { sec: 0, label: '关' },
  { sec: 5, label: '5 秒' },
  { sec: 10, label: '10 秒' },
  { sec: 30, label: '30 秒' },
  { sec: 60, label: '1 分钟' },
  { sec: 300, label: '5 分钟' },
];

export function intervalLabel(sec) {
  const hit = WATCH_INTERVALS.find((i) => i.sec === sec);
  if (hit) return hit.label;
  if (!Number.isFinite(sec) || sec <= 0) return '关';
  if (sec % 60 === 0 && sec < 3600) return `${sec / 60} 分钟`;
  return `${sec} 秒`;
}

/**
 * ③ 单元格 diff：新旧两个值，返回变更描述（相等返回 null）。
 *   数字变化附带方向（↑/↓）与百分比——监控磁盘占用时一眼看出涨了还是降了。
 */
export function cellDiff(prev, next) {
  if (prev === next) return null;
  const ps = prev === null || prev === undefined ? '' : String(prev);
  const ns = next === null || next === undefined ? '' : String(next);
  if (ps === ns) return null;
  const pn = Number(ps); const nn = Number(ns);
  if (ps !== '' && ns !== '' && Number.isFinite(pn) && Number.isFinite(nn)) {
    const dir = nn > pn ? '↑' : '↓';
    const pct = pn === 0 ? '' : `（${((nn - pn) / Math.abs(pn) * 100).toFixed(1)}%）`;
    return `${dir} ${ns}${pct}（原 ${ps}）`;
  }
  return `${ns}（原 ${ps}）`;
}

/**
 * ④ 数值采样序列 → sparkline 点位（0–100 归一化，保序）。
 *   全相同值返回中位线（画出来是平线，而不是 NaN 崩掉）；空/单点返回 null。
 */
export function sparkSeries(values, width = 60) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const nums = values.map(Number).filter((n) => Number.isFinite(n));
  if (nums.length < 2) return null;
  const min = Math.min(...nums); const max = Math.max(...nums);
  const span = max - min;
  return nums.map((n) => {
    const t = span === 0 ? 50 : ((n - min) / span) * 100;
    return Math.round(t * width) / width;
  });
}

/**
 * ⑤ 停止条件判定：给定最近 N 次结果，返回 'stop-fail' | 'stop-match' | null（继续）。
 *   failStreak 是连续失败次数阈值；matchStr 是结果包含即停的串（空 = 不启用）。
 */
export function watchStopCondition(runs, { failStreak = 0, matchStr = '' } = {}) {
  if (!Array.isArray(runs) || !runs.length) return null;
  if (failStreak > 0) {
    let streak = 0;
    for (let i = runs.length - 1; i >= 0; i--) {
      if (runs[i].ok === false) streak++;
      else break;
    }
    if (streak >= failStreak) return 'stop-fail';
  }
  if (matchStr) {
    const last = runs.at(-1);
    const blob = JSON.stringify(last?.data ?? '') + String(last?.stdout ?? '');
    if (blob.includes(matchStr)) return 'stop-match';
  }
  return null;
}

/**
 * ⑦ 标签页标题：运行中的监控数（与原有运行中进程数合并显示）。
 */
export function tabTitle(watchCount, runningCount = 0) {
  const parts = [];
  if (watchCount > 0) parts.push(`⏱${watchCount}`);
  if (runningCount > 0) parts.push(String(runningCount));
  return parts.length ? `(${parts.join(' ')}) zerokit` : 'zerokit';
}

/**
 * ⑨ 监控采样导出 CSV：runs → 时间戳,ok,值 列表。valuesFrom 从一次 run 里取要跟踪的值
 *   （调用方决定取哪个字段；默认整个 data JSON 化）。
 */
export function watchCsv(runs, valuesFrom = (r) => JSON.stringify(r.data ?? '')) {
  if (!Array.isArray(runs) || !runs.length) return '';
  const head = 'time,ok,value';
  const rows = runs.map((r) => {
    const t = new Date(r.ts ?? 0).toISOString();
    const v = String(valuesFrom(r) ?? '').replace(/"/g, '""');
    return `${t},${r.ok === false ? 'fail' : 'ok'},"${v}"`;
  });
  return [head, ...rows].join('\n') + '\n';
}

// ================================================================ 第十九轮：安全与危险操作防护

/**
 * ① 危险参数值检测：值里包含已知「危险模式」时给黄条警示（可继续，不硬拦）。
 *   覆盖：递归删除、系统目录、格式化、Windows 强删、fork 炸弹、dd 直写磁盘。
 */
const DANGEROUS_PATTERNS = [
  { re: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+/i, why: '递归/强制删除（rm -rf）' },
  { re: /(?:^|[\s"'=])(?:\/etc|\/boot|\/usr\/lib|\/windows\/system32|c:\\windows)/i, why: '指向系统目录' },
  { re: /\b(?:mkfs|format\s+[a-z]:|diskutil\s+erase)/i, why: '格式化磁盘' },
  { re: /\bdel\s+\/[fs]/i, why: 'Windows 强制删除' },
  { re: /:\(\)\s*\{\s*:\|\:\s*&\s*\}\s*;:/, why: 'fork 炸弹' },
  { re: /\bdd\s+[^|]*of=\/dev\/(?:disk|sd|nvme|mmc)/i, why: 'dd 直写物理磁盘' },
];
export function dangerousPattern(value) {
  const s = String(value ?? '');
  for (const p of DANGEROUS_PATTERNS) if (p.re.test(s)) return p.why;
  return null;
}

/**
 * ④ 敏感信息脱敏：token / Bearer / 长 hex / 长 base64 形态的串打码，保留首尾各 4 字符。
 *   返回打码后的文本（无可打码内容时原样返回）。
 */
export function maskSecrets(text, { reveal = false } = {}) {
  const s = String(text ?? '');
  if (reveal || !s) return s;
  const mask = (m) => (m.length <= 8 ? '*'.repeat(m.length) : `${m.slice(0, 4)}${'*'.repeat(Math.min(10, m.length - 8))}${m.slice(-4)}`);
  return s
    .replace(/(?:sk|pk|api)?[-_]?[A-Za-z0-9]{32,}/g, (m) => (/^sk-|^Bearer |^[A-Fa-f0-9]{32,}$/.test(m) || m.length >= 40 ? mask(m) : m))
    .replace(/Bearer\s+[A-Za-z0-9._\-]{12,}/g, (m) => `Bearer ${'*'.repeat(8)}`)
    .replace(/\b[A-Fa-f0-9]{24,}\b/g, mask);
}

/**
 * ③ 限速判定：同一动作 windowMs 内第 max+1 次起算「过于频繁」。
 *   times 是历史执行时间戳数组（升序），now 是本次时间。返回 true 表示需要拦下确认。
 */
export function rateLimitHits(times, now, windowMs = 3000, max = 2) {
  if (!Array.isArray(times)) return false;
  const inWindow = times.filter((t) => typeof t === 'number' && now - t < windowMs && t <= now);
  return inWindow.length >= max;
}

/**
 * ⑤ 审计日志自动清理：超过 keepDays 的条目剔除。返回 { kept, dropped }。
 *   entries 每条带 ts（毫秒）。边界：keepDays<=0 不清；空数组不清。
 */
export function trimAuditLog(entries, keepDays = 90, now = Date.now()) {
  const list = Array.isArray(entries) ? entries.filter((e) => e && typeof e.ts === 'number') : [];
  if (keepDays <= 0 || !list.length) return { kept: list, dropped: [] };
  const cutoff = now - keepDays * 864e5;
  const kept = list.filter((e) => e.ts >= cutoff);
  const dropped = list.filter((e) => e.ts < cutoff);
  return { kept, dropped };
}

/**
 * ⑥ 动作危险度提示卡：历史失败率 + 风险等级。返回 { level, failRate, avgMs, runs }。
 *   runs 是该动作的历史执行记录（ok/ts/ms）。
 */
export function actionRiskCard(runs, risk) {
  const list = Array.isArray(runs) ? runs.filter((r) => r && typeof r.ok === 'boolean') : [];
  const failed = list.filter((r) => r.ok === false).length;
  const durations = list.map((r) => Number(r.ms)).filter((v) => Number.isFinite(v) && v >= 0);
  const avgMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const failRate = list.length ? failed / list.length : 0;
  return {
    runs: list.length,
    failRate,
    avgMs,
    level: risk === 'destructive' ? 'destruct' : risk === 'mutate' ? (failRate >= 0.5 && list.length >= 2 ? 'risky' : 'mutate') : 'read',
  };
}

// ============ 第二十轮：数据备份与迁移 ============
// 个性化数据全在 localStorage（zerokit.* 键），清缓存/换机器就全丢。
// 这里只做纯函数：收集、校验、归类、合并、文件名；DOM 与下载在 app.js。

/** 备份里的固定键前缀 → 展示分组。动态前缀（colvis./colw.）单列。
 * 顺序就是导入预览里的展示顺序。 */

// ==================================================================
// ===== 备份与配置档 =====
// ==================================================================
export const BACKUP_GROUPS = [
  { match: ['zerokit.favorites', 'zerokit.plugin-tags', 'zerokit.action-tags', 'zerokit.nicknames', 'zerokit.aliases', 'zerokit.action-hotkeys'], label: '收藏与标记' },
  { match: ['zerokit.runs', 'zerokit.params', 'zerokit.searches', 'zerokit.recent', 'zerokit.saved-results', 'zerokit.run-notes'], label: '历史与参数' },
  { match: ['zerokit.theme', 'zerokit.accent', 'zerokit.font-scale', 'zerokit.lang', 'zerokit.plugin-sort'], label: '外观与设置' },
  { match: ['zerokit.snapA', 'zerokit.snapB', 'zerokit.snapCur'], label: '配置快照' },
];
const PREFIX_GROUPS = [
  { prefix: 'zerokit.colvis.', label: '表格列显隐' },
  { prefix: 'zerokit.colw.', label: '表格列宽' },
  { prefix: 'zerokit.profile.', label: '配置档' },
];
const OTHER_LABEL = '其它';

/** 单个键属于哪个分组（预览与选择性导入共用一个归类口径） */
export function classifyKey(key) {
  if (!key.startsWith('zerokit.')) return null;
  for (const g of BACKUP_GROUPS) if (g.match.includes(key)) return g.label;
  for (const g of PREFIX_GROUPS) if (key.startsWith(g.prefix)) return g.label;
  return OTHER_LABEL;
}

/** 收集备份：entries 是 [key, value] 数组（localStorage 直接给）。
 *  只收 zerokit.* 键；theme-before-fast 这类瞬时态也收（无害，导入时被覆盖）。
 *  返回信封：{app, version, exportedAt, keys, meta}。 */
export function collectBackup(entries, now = Date.now(), version = '0.25.0') {
  const keys = {};
  let bytes = 0;
  for (const [k, v] of entries) {
    if (!k.startsWith('zerokit.')) continue;
    keys[k] = v;
    bytes += k.length + String(v ?? '').length;
  }
  return {
    app: 'zerokit',
    version,
    exportedAt: new Date(now).toISOString(),
    keys,
    meta: { keyCount: Object.keys(keys).length, bytes },
  };
}

/** 解析并校验备份文本。格式不对返回 {ok:false, error}——错误要说人话。 */
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, error: '不是有效的 JSON 文件' }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: '文件结构不对：需要备份对象' };
  if (data.app !== 'zerokit') return { ok: false, error: `不是 zerokit 的备份（app 字段为 ${JSON.stringify(data.app ?? null)}）` };
  if (!data.keys || typeof data.keys !== 'object' || Array.isArray(data.keys)) return { ok: false, error: '备份里没有 keys 数据' };
  return { ok: true, backup: data };
}

/** 合并导入：current/incoming 都是 {key: value} 的键值表。
 *  selected 是选中的分组标签集合（null = 全部）。
 *  策略：新优先——对象值按键合并（incoming 覆盖同键），标量直接覆盖。
 *  只跳过「未选中的分组」，选中分组里的键一律应用，不存在静默丢弃。 */
export function mergeBackup(current, incoming, selected = null) {
  const cur = current ?? {};
  const inc = incoming ?? {};
  const out = { ...cur };
  let applied = 0;
  let skipped = 0;
  for (const [k, v] of Object.entries(inc)) {
    const group = classifyKey(k);
    if (group === null) { skipped++; continue; }
    if (selected && !selected.has(group)) { skipped++; continue; }
    // localStorage 里存的是 JSON 字符串：对象值要先解开再按对象合并（新优先），
    // 保留本地独有的子键——直接覆盖字符串会把本地没有备份里的键整段丢掉。
    // 数组（favorites 这类）整段替换：数组没有可靠的按 id 合并语义。
    const vObj = tryParseObject(v);
    const curObj = tryParseObject(out[k]);
    if (vObj && curObj) {
      out[k] = JSON.stringify({ ...curObj, ...vObj });
    } else {
      out[k] = v;
    }
    applied++;
  }
  return { out, applied, skipped };
}

/** 解一个「可能是 JSON 对象的 localStorage 值」；不是对象（数组/标量/坏 JSON）返回 null */
function tryParseObject(v) {
  if (typeof v !== 'string' || !v.startsWith('{')) return null;
  try {
    const d = JSON.parse(v);
    return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
  } catch { return null; }
}

/** 可预测的备份文件名：zerokit-backup-YYYYMMDD-HHMMSS.json */
export function backupFilename(now = Date.now()) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  return `zerokit-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
}

// ============ 第二十一轮：多环境与配置档 ============
// 一套 localStorage 只有一套「当前状态」。工作/个人/演示分档 = 多个配置档
// 信封 + 当前档名。这里只做纯函数；localStorage 读写与面板 UI 在 app.js。

/** 列出全部配置档名（profiles 是 {name: envelope} 表，envelope 形如第二十轮 collectBackup 的 keys 表）。
 *  保证返回至少含 '默认'——没有存任何档时视作只有一个隐式默认档。 */
export function profileList(profiles) {
  const names = Object.keys(profiles ?? {}).filter((n) => n && typeof n === 'string');
  if (!names.length) return ['默认'];
  // 固定顺序：默认在前，其余按创建时间（信封里的 createdAt）排
  const rows = names.map((n) => ({ n, at: profiles[n]?.createdAt ?? 0 }));
  rows.sort((a, b) => (a.n === '默认' ? -1 : b.n === '默认' ? 1 : a.at - b.at));
  return rows.map((r) => r.n);
}

/** 校验配置档名：非空、去掉首尾空白、≤20 字符、不含 / 与控制字符（要进 localStorage 键名）。
 *  返回 {ok, name} 或 {ok:false, error}——错误说人话。 */
export function validProfileName(raw) {
  const name = String(raw ?? '').trim();
  if (!name) return { ok: false, error: '名字不能为空' };
  if (name.length > 20) return { ok: false, error: '名字最多 20 个字符' };
  if (/[\\/\u0000-\u001f]/.test(name)) return { ok: false, error: '名字里不能有斜杠或控制字符' };
  return { ok: true, name };
}

/** 新建/覆盖一个配置档（从当前状态复制）。
 *  profiles 加一个 {name: envelope}，envelope 带 createdAt 排序用。 */
export function upsertProfile(profiles, name, keysTable, now = Date.now()) {
  return {
    ...(profiles ?? {}),
    [name]: { keys: keysTable ?? {}, createdAt: now },
  };
}

/** 删除配置档。最后一个档不可删（返回原表 + error 说人话）——
 *  没有档的「当前档名」就没有意义，UI 也不该进入无档状态。 */
export function deleteProfile(profiles, current, name) {
  const list = profileList(profiles);
  if (list.length <= 1) return { profiles: profiles ?? {}, current, error: '至少保留一个配置档' };
  if (!(name in (profiles ?? {}))) return { profiles: profiles ?? {}, current, error: '配置档不存在' };
  const next = { ...profiles };
  delete next[name];
  // 删的是当前档 → 切到列表第一个
  const nextCurrent = current === name ? profileList(next)[0] : current;
  return { profiles: next, current: nextCurrent, error: null };
}

/** 重命名配置档：保留原 createdAt（改名不等于重建）。 */
export function renameProfile(profiles, from, to) {
  const v = validProfileName(to);
  if (!v.ok) return { profiles: profiles ?? {}, current: null, error: v.error };
  if (!(from in (profiles ?? {}))) return { profiles: profiles ?? {}, current: null, error: '配置档不存在' };
  if (v.name !== from && v.name in (profiles ?? {})) return { profiles: profiles ?? {}, current: null, error: '已有同名配置档' };
  const next = {};
  for (const [k, val] of Object.entries(profiles)) next[k === from ? v.name : k] = val;
  return { profiles: next, current: v.name, error: null };
}

// ---------------------------------------------------------------- 第二十一轮后追加：帮助与上手

/**
 * 帮助主题表：#/help 页的数据源。每段 = 标题 + 简明说明 + 「去试用」深链。
 * tryHash 用 app 内路由（#/…），由帮助页直接 location.hash 赋值跳转。
 */
export const HELP_TOPICS = [
  {
    id: 'search',
    title: '搜索',
    body: '支持中文关键词、拼音全拼、拼音首字母。打「dl」出「代理」、「xtxx」出「系统信息」。空格分词是多词 AND（每个词都要命中）。数字可直接选第 N 项。',
    tryHash: '#/',
  },
  {
    id: 'run',
    title: '执行与结果',
    body: '只读动作点「执行」直接跑；会改动/高风险动作要确认。结果可复制、下载、重跑，表格结果支持排序/筛选/列显隐/单位换算，还能跨两次执行做合并视图与逐格 diff。',
    tryHash: '#/sysinfo/overview',
  },
  {
    id: 'watch',
    title: '监控',
    body: '只读动作可设间隔自动重跑：倒计时环显示下次采样、变化格子黄高亮、数值字段带迷你趋势线；连续失败或命中指定串自动停。#/watch 面板聚合所有在跑的监控，可导出采样 CSV。',
    tryHash: '#/watch',
  },
  {
    id: 'profiles',
    title: '配置档',
    body: '外观面板里可建多个配置档（工作/个人…）：主题、收藏、参数记忆随档切换，执行历史全局共享。以当前状态一键新建，重命名/删除都有守卫。',
    tryHash: '#/',
  },
  {
    id: 'backup',
    title: '数据备份',
    body: '外观面板「数据」分组：全部个性化数据一键导出 JSON（文件名可预测）；导入有格式校验、分组预览、按类别勾选，合并不覆盖本地独有数据。',
    tryHash: '#/',
  },
  {
    id: 'safety',
    title: '安全防护',
    body: '危险参数值（rm -rf / 系统目录 / dd 直写）执行前黄条警示；同一动作 3 秒内连点会弹确认；结果与日志里的 token 默认打码；动作详情页有风险横条与失败率。',
    tryHash: '#/sysinfo/overview',
  },
];

/** 首访标记：读 localStorage 判断是否首次访问（无标记即首次）。 */
export function firstRunSeen(get) {
  try { return String(get('zerokit.firstrun') ?? '') === 'done'; } catch { return false; }
}

/** 标记首访完成（用户看完或跳过引导后调用）。 */
export function markFirstRunDone(set) {
  try { set('zerokit.firstrun', 'done'); } catch { /* 隐私模式 */ }
}

/**
 * 空搜索建议：无结果时推荐的动作。从全量动作里挑只读、带描述的，
 * 按清单顺序取前 N 个——够稳定也够便宜，不需要热度统计。
 */
export function emptySearchSuggestions(entries, limit = 5) {
  const list = Array.isArray(entries) ? entries : [];
  return list
    .filter((e) => e?.action?.risk === 'read' && e?.action?.description)
    .slice(0, Math.max(1, limit))
    .map((e) => ({ key: `${e.plugin.id}.${e.action.id}`, title: e.action.title, plugin: e.plugin.name }));
}

// ---------------- 第二十三轮：结果工作台 ----------------

/** ②结果页签标题：动作名 + 相对时间（紧凑；区别于第十八轮的标签页标题 tabTitle） */

// ==================================================================
// ===== 结果工作台 =====
// ==================================================================
export function resultTabTitle(name, ts, now = Date.now(), lg = 'zh') {
  const L = lg === 'en'
    ? { fallback: 'Result', now: 'just now', sec: (n) => `${n}s ago`, min: (n) => `${n}m ago`, hour: (n) => `${n}h ago`, day: (n) => `${n}d ago` }
    : { fallback: '结果', now: '刚刚', sec: (n) => `${n} 秒前`, min: (n) => `${n} 分钟前`, hour: (n) => `${n} 小时前`, day: (n) => `${n} 天前` };
  if (typeof name !== 'string' || !name) return L.fallback;
  if (!ts || typeof ts !== 'number') return name;
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  let rel;
  if (s < 10) rel = L.now;
  else if (s < 60) rel = L.sec(s);
  else if (s < 3600) rel = L.min(Math.floor(s / 60));
  else if (s < 86400) rel = L.hour(Math.floor(s / 3600));
  else rel = L.day(Math.floor(s / 86400));
  return `${name} · ${rel}`;
}

/**
 * ④页签逐出：超过上限先挤最老的未固定页签；全固定则不挤（调用方决定拒新或扩容）。
 * 返回新数组（不动入参）。pinned 用 id 标。
 */
export function tabEvict(tabs, limit = 8) {
  if (!Array.isArray(tabs)) return [];
  if (tabs.length <= limit) return tabs.slice();
  const unpinned = tabs.filter((t) => t && t.pinned !== true);
  if (unpinned.length === 0) return tabs.slice();   // 全固定：不挤，调用方拒绝新页签
  // 挤「最老的未固定」（ts 最小；无 ts 视为最老）
  let victim = 0;
  let minTs = Infinity;
  tabs.forEach((t, i) => {
    if (t && t.pinned !== true) {
      const ts = typeof t.ts === 'number' ? t.ts : 0;
      if (ts < minTs) { minTs = ts; victim = i; }
    }
  });
  return tabs.filter((_, i) => i !== victim);
}

/**
 * ⑤⑥结果查询：对表格行做过滤。支持普通词（子串）与数字比较（size>100、<=5、=7）。
 * 返回过滤后的行数组（浅拷贝，不改原表）。
 */
export function resultQuery(rows, q) {
  if (!Array.isArray(rows)) return [];
  if (!q || !String(q).trim()) return rows.slice();
  const terms = String(q).trim().split(/\s+/);
  // 数字比较符映射：field>10 / field>=10 / field<10 / field<=10 / field=10
  const cmpRe = /^([\w\u4e00-\u9fa5.-]+)(>=|<=|>|<|=)(-?\d+(?:\.\d+)?)$/;
  const predicates = terms.map((term) => {
    const m = cmpRe.exec(term);
    if (!m) return (r) => JSON.stringify(r).includes(term);
    const [, col, op, numStr] = m;
    const num = Number(numStr);
    const colMatch = (k) => k === col || k.endsWith(`.${col}`) || String(k).toLowerCase() === col.toLowerCase();
    return (r) => {
      for (const [k, v] of Object.entries(r ?? {})) {
        if (!colMatch(k)) continue;
        const n = typeof v === 'number' ? v : Number(String(v).replace(/^(\d+(?:\.\d+)?).*$/, '$1'));
        if (!Number.isFinite(n)) continue;
        if (op === '>' && n > num) return true;
        if (op === '<' && n < num) return true;
        if (op === '>=' && n >= num) return true;
        if (op === '<=' && n <= num) return true;
        if (op === '=' && n === num) return true;
      }
      return false;
    };
  });
  return rows.filter((r) => predicates.every((p) => p(r)));
}

/** ⑦两结果对比：键并集逐行比对，同键不同值高亮。返回 [{key, a, b, diff}] */
export function resultCompare(a, b) {
  const norm = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const A = norm(a); const B = norm(b);
  const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])];
  return keys.map((k) => {
    const va = A[k]; const vb = B[k];
    const diff = JSON.stringify(va) !== JSON.stringify(vb);
    return { key: k, a: va, b: vb, diff };
  });
}

/** ⑨复制带备注：正文 + 备注头。note 为空时原样返回。 */
export function withNoteHeader(text, note, ts) {
  const body = String(text ?? '');
  if (!note || !String(note).trim()) return body;
  const when = ts ? new Date(ts).toLocaleString() : new Date().toLocaleString();
  return `// ${String(note).trim()}（${when}）\n${body}`;
}

// ================================================================ 第二十四轮：命令与快捷键进阶

/**
 * ①内置命令表：`>` 命令模式列出的页面/工具直达命令。
 * name 是用户输入的匹配词（paletteScore 打分），go 是目标 hash（页面类）
 * 或 'batch'/'theme' 这类 UI 动作标记（由 app.js 侧解释）。
 */
export const COMMAND_LIST = [
  { icon: '⏱', name: '监控', hint: '监控面板 #/watch', go: '#/watch' },
  { icon: '?', name: '帮助', hint: '使用指南 #/help', go: '#/help' },
  { icon: '📈', name: '统计', hint: '使用统计 #/stats', go: '#/stats' },
  { icon: '▤', name: '日志', hint: '审计日志 #/logs', go: '#/logs' },
  { icon: '🛍', name: '集市', hint: '插件集市 #/market', go: '#/market' },
  { icon: '✓', name: '自检', hint: '环境自检 #/doctor', go: '#/doctor' },
  { icon: '🗂', name: '配置档', hint: '切换配置档（打开外观面板）', go: 'theme' },
  { icon: '💾', name: '备份', hint: '导出/导入个性化数据（打开外观面板）', go: 'theme' },
  { icon: '⧉', name: '批量', hint: '批量执行模式', go: 'batch' },
  { icon: '◐', name: '外观', hint: '主题与外观设置（打开外观面板）', go: 'theme' },
  { icon: '📰', name: '简报', hint: '今日简报 #/brief', go: '#/brief' },
  { icon: '⌘', name: '工作台', hint: 'AI 工作台', go: 'workbench' },
  { icon: '🤖', name: 'MCP 配置', hint: '复制 mcpServers JSON 片段', go: 'copy-mcp' },
  { icon: '🧠', name: 'AI 上下文', hint: '打包最近执行与插件清单给 AI', go: 'copy-ctx' },
  // 第四十七轮④：抽屉里的管理入口也在面板可达（键盘用户不必找 ☰）
  { icon: '☰', name: '设置抽屉', hint: '主题/语言/配置档/备份/日志/自检的统一入口', go: 'drawer' },
];

/** ③快速执行语法：`;插件.动作` → {plugin, action}；不匹配返回 null */
export function quickRunKey(text) {
  const s = String(text ?? '').trim();
  if (!s.startsWith(';')) return null;
  const body = s.slice(1);
  const dot = body.indexOf('.');
  if (dot <= 0 || dot === body.length - 1) return null;
  return { plugin: body.slice(0, dot), action: body.slice(dot + 1) };
}

/** ⑤两段式 goto：g 后 600ms 内按目标键。返回目标 hash 或 null（超时/未知键） */
export function gotoTarget(seqKey, now, armedAt, ttl = 600) {
  if (!armedAt) return null;
  if (now - armedAt > ttl) return null;
  const map = { l: '#/', h: '#/help', s: '#/stats', m: '#/watch' };
  return map[seqKey] ?? null;
}

/** ⑦页签序号切换：dir=+1/-1，环形（越过两端回绕）。返回新索引 */
export function cycleTabIndex(cur, count, dir) {
  if (!Number.isInteger(count) || count <= 0) return 0;
  const c = ((cur + dir) % count + count) % count;
  return c;
}

/** ⑨面板历史去重入栈：新条目置顶，重复的挪到顶，超限挤尾。返回新数组 */
export function pushHistory(list, entry, limit = 10) {
  const rest = (Array.isArray(list) ? list : []).filter((x) => x !== entry);
  return [entry, ...rest].slice(0, limit);
}

// ================================================================ 第二十五轮：执行链路与批处理进阶

/** ②链占位符：把 `{result.data.字段}` / `{result.stdout}` 换成上一步结果值（同 CLI chain 语义） */
export function chainFill(tpl, prev) {
  if (tpl == null) return tpl;
  let s = String(tpl);
  const stdout = prev?.stdout ?? '';
  const data = prev?.data ?? {};
  s = s.replace(/\{result\.stdout\}/g, String(stdout));
  s = s.replace(/\{result\.data\.([\w\u4e00-\u9fa5.-]+)\}/g, (_, k) => {
    let v = data;
    for (const part of k.split('.')) {
      if (v == null || typeof v !== 'object') return '';
      v = v[part];
    }
    return v == null ? '' : String(v);
  });
  return s;
}

/** ⑤批量去重：同插件+动作+参数视为重复。返回 {uniq, dups}（dups 是重复项索引） */
export function batchDedup(items) {
  const seen = new Set(); const uniq = []; const dups = [];
  (Array.isArray(items) ? items : []).forEach((it, i) => {
    const sig = `${it?.pluginId ?? it?.plugin ?? ''}.${it?.actionId ?? it?.action ?? ''}:${JSON.stringify(it?.values ?? {})}`;
    if (seen.has(sig)) { dups.push(i); return; }
    seen.add(sig); uniq.push(it);
  });
  return { uniq, dups };
}

/** ⑧并发分窗：把 N 项切成最多 size 个一组的窗口（1=串行）。返回下标数组 */
export function chunkWindows(n, size) {
  const total = Math.max(0, Math.floor(n));
  const sz = Math.max(1, Math.floor(size));
  const out = [];
  for (let i = 0; i < total; i += sz) {
    out.push(Array.from({ length: Math.min(sz, total - i) }, (_, j) => i + j));
  }
  return out;
}

/** ⑦批量清单导入校验：数组且每项有 plugin/action 才算合法。返回 {ok, items|error} */
export function parseBatchList(text) {
  let j;
  try { j = JSON.parse(text); } catch { return { ok: false, error: '不是合法 JSON' }; }
  if (!Array.isArray(j)) return { ok: false, error: '清单必须是数组' };
  const bad = j.find((x) => !x || typeof x !== 'object' || !x.plugin || !x.action);
  if (bad !== undefined) return { ok: false, error: '存在缺少 plugin/action 的条目' };
  return { ok: true, items: j };
}

// ---------------------------------------------------------------- 第二十六轮：插件生态体验

/** ①插件对比：两个插件的结构化差异（动作数/风险构成/依赖/标签口径统一后取并集）。 */
export function pluginCompare(a, b) {
  if (!a || !b || !Array.isArray(a.actions) || !Array.isArray(b.actions)) return null;
  const riskOf = (p) => {
    const m = {};
    for (const act of p.actions) m[act.risk] = (m[act.risk] || 0) + 1;
    return m;
  };
  const ra = riskOf(a); const rb = riskOf(b);
  const risks = [...new Set([...Object.keys(ra), ...Object.keys(rb)])].sort();
  const depsOf = (p) => (Array.isArray(p.pluginDeps) ? p.pluginDeps.map((d) => d.id) : []);
  return {
    a: { id: a.id, name: a.name, version: a.version, actions: a.actions.length },
    b: { id: b.id, name: b.name, version: b.version, actions: b.actions.length },
    risks: risks.map((r) => ({ risk: r, a: ra[r] || 0, b: rb[r] || 0 })),
    deps: { a: depsOf(a), b: depsOf(b) },
  };
}

/** ②版本对比：已装 vs 集市最新，返回可渲染的差异提示（null=无差异/无集市信息）。 */
export function versionDiff(installed, latest) {
  if (!latest) return null;
  if (installed === latest) return null;
  return { installed: installed || '未装', latest, hasUpdate: true };
}

/** ③依赖树：插件依赖列表 → 缩进层级树（根=自身，子=依赖，installed 标注）。 */
export function depTreeLines(id, deps, depth = 0) {
  const pad = '  '.repeat(depth);
  if (!Array.isArray(deps) || !deps.length) return [`${pad}${id}`];
  const out = [`${pad}${id}`];
  for (const d of deps) {
    out.push(`${pad}  └ ${d.id}${d.installed ? '' : '（未装）'}`);
  }
  return out;
}

/** ⑤主页动作过滤：按词 AND 匹配标题/id/描述/风险。 */
export function filterPluginActions(actions, q) {
  if (!Array.isArray(actions)) return [];
  const terms = String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return actions;
  return actions.filter((a) => {
    const hay = `${a.title || ''}\n${a.id || ''}\n${a.description || ''}\n${a.risk || ''}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/** ⑦插件标签：从 keywords/summary 提取标签集（去重排序）。 */
export function pluginTags(p) {
  if (!p) return [];
  const ks = [...(Array.isArray(p.keywords) ? p.keywords : []),
    ...(Array.isArray(p.actions) ? p.actions.flatMap((a) => a.keywords || []) : [])];
  return [...new Set(ks.filter((k) => typeof k === 'string' && k.trim()))].sort();
}

/** ⑧插件统计卡：动作数/组合数/最近使用/健康四格。 */
export function pluginStatCards(p, runStore, now = Date.now()) {
  if (!p) return null;
  const acts = Array.isArray(p.actions) ? p.actions : [];
  const chains = acts.filter((a) => Array.isArray(a.steps) && a.steps.length).length;
  let last = null; let runs = 0;
  for (const [k, list] of Object.entries(runStore || {})) {
    if (!k.startsWith(p.id + '.')) continue;
    for (const r of list || []) { runs++; if (!last || r.ts > last) last = r.ts; }
  }
  const health = p.requiresOk === false ? 'warn' : 'ok';
  return {
    actions: acts.length, chains, runs,
    lastUsed: last ? Math.round((now - last) / 60000) : null,
    health,
  };
}

/** ⑨已装插件清单：导出可分享 JSON（id/版本/来源/动作数）。 */
export function installedList(plugins) {
  if (!Array.isArray(plugins)) return { app: 'zerokit', kind: 'plugin-list', plugins: [] };
  return {
    app: 'zerokit', kind: 'plugin-list', exportedAt: new Date().toISOString(),
    plugins: plugins.map((p) => ({ id: p.id, version: p.version, source: p.source?.type || 'bundled', actions: (p.actions || []).length })),
  };
}

/** ⑥安装命令行文本（给「复制安装命令」用）。 */
export function installCommand(p) {
  if (!p) return '';
  if (p.source?.type === 'market') return `zkit plugin install ${p.id} --market ${p.source.market || 'default'}`;
  return `zkit plugin bundled`;
}

// ---------------------------------------------------------------- 第二十七轮：搜索与发现的深度

/** ①搜索命中解释：把 explain 分数摊开成人话标签（「命中：动作名·拼音」）。
 * 输入是 scoreEntry 收集的 why 数组 [[label, score, weight], ...]。 */
export function whyLabel(why) {
  const labels = (why ?? []).map((r) => r[0]).filter(Boolean);
  if (!labels.length) return '';
  const uniq = [...new Set(labels)];
  return `命中：${uniq.join('·')}`;
}

/** ⑥同义词弱路由：描述型 query 映射到可能的关键词。
 * 表是手工精选的高频意图（内存/磁盘/网络/时间/剪贴板/搜索），
 * 命中同义词的 query 在打分时把同义词也当一个 token 参与匹配。 */
// 第二十九轮⑦：大表渲染阈值——超过 OVERFLOW_ROWS 只画 PAGE_ROWS 行 + 「加载全部」。
// 导出成常量而不是散在 app.js 里：测试与 UI 引用同一份数字，改阈值不会漂移。
export const OVERFLOW_ROWS = 500;
export const PAGE_ROWS = 200;

export const SYNONYMS = {
  '内存': ['内存', 'memory', 'mem'],
  '磁盘': ['磁盘', '硬盘', 'disk', '存储'],
  '网络': ['网络', '网速', 'network', '联网'],
  '时间': ['时间', '日期', '时钟', 'time', 'date'],
  '剪贴板': ['剪贴板', '粘贴板', 'clipboard'],
  '搜索': ['搜索', '查找', '找', 'search'],
  '看看': ['', '查看', '显示'],
};

/** ⑥虚词剥离：描述型 query 的「看看/显示/帮我/查一下」这类意图词不参与 AND 匹配——
 * 它们对哪个动作都不命中，带着它们搜等于全灭。剥离后剩下的实词才进打分。 */
export const QUERY_STOPWORDS = ['看看', '显示', '帮我', '查一下', '看一下', '我想', '想要', '请'];

/** ⑥剥掉停用词后的实词列表（原样返回新数组，不改入参）。
 * 支持两种形态：整词等于停用词（「看看 内存」）和前缀粘连（「看看内存」——
 * 中文不分词，用户随手把动词和宾语连着打）。 */
export function stripStopwords(tokens) {
  const list = (tokens ?? []).filter((t) => !QUERY_STOPWORDS.includes(t));
  const stripped = [];
  for (const t of list) {
    let out = t;
    for (const w of QUERY_STOPWORDS) {
      if (out.startsWith(w) && out.length > w.length) out = out.slice(w.length);
    }
    if (out) stripped.push(out);
  }
  return stripped;
}

/** ⑥从 query 词展开同义词 tokens（原词优先级不变，同义词只作补充召回）。 */
export function expandSynonyms(tokens) {
  const out = [];
  for (const t of stripStopwords(tokens ?? [])) {
    for (const [canon, words] of Object.entries(SYNONYMS)) {
      if (words.includes(t) || t === canon) {
        for (const w of words) if (w && !out.includes(w)) out.push(w);
        if (!out.includes(canon)) out.push(canon);
      }
    }
  }
  return out;
}

/** ⑨大小写保真高亮：与 highlightSegments 相同的匹配规则（大小写不敏感），
 * 但 mark 里的文本保留原文大小写（此前 toLowerCase 后 mark 的内容也是小写副本——
 * 其实原文本来就没变，这条保证的是 query 大小写不参与匹配但也不改写原文）。 */
export function highlightSegmentsCaseKept(text, query, maxParts = 24) {
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

/** ⑤历史深链解析：#/history/<plugin>.<action> → key；不匹配返回 null。 */
export function parseHistoryHash(hash) {
  // 第五十五轮⑨：插件名/动作名可以是中文——path 段按 encodeURIComponent 编码，
  // 正则放宽到非斜杠非井号（编码后的 %2F 也拦在段外）；老 ASCII 链接不破
  const raw = String(hash ?? '');
  const m = /^#\/history\/([^/#]+)$/.exec(raw);
  if (!m || /%2f/i.test(m[1]) || m[1].includes('/')) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

/** ②最近优先加权值：最近执行过的动作在同名命中分上叠加。
 * rank 是「最近第几次执行」（0=最近一次）；没执行过返回 0。 */
export function recencyBoost(rank, base = 12) {
  if (!Number.isFinite(rank) || rank < 0) return 0;
  return Math.max(0, base - rank);
}

/* ===================== 第三十七轮：AI 协作面 ===================== */

/**
 * ① 结果 → LLM 友好的 Markdown：表格数据出 MD 表，对象出属性行，
 *   其它原样 String。带动作名与时间头的完整粘贴块。
 */
export function toAiMarkdown(res, opts = {}) {
  const name = opts.name || '结果';
  const at = opts.ts ? new Date(opts.ts).toLocaleString() : new Date().toLocaleString();
  const head = `## ${name}（${at}）\n\n`;
  const data = res && typeof res === 'object' && 'data' in res ? res.data : res;
  if (Array.isArray(data) && data.length > 0 && data.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
    const cols = [...new Set(data.flatMap((r) => Object.keys(r)))];
    const esc = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const table = [
      `| ${cols.join(' | ')} |`,
      `| ${cols.map(() => '---').join(' | ')} |`,
      ...data.slice(0, 50).map((r) => `| ${cols.map((c) => esc(r[c])).join(' | ')} |`),
    ].join('\n');
    const more = data.length > 50 ? `\n\n（共 ${data.length} 行，仅列前 50 行）` : '';
    return head + table + more;
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const props = toMarkdownProps(data);
    return head + (props || '（空对象）');
  }
  return head + '```\n' + String(data ?? '') + '\n```';
}

/**
 * ② 上下文打包：当前结果 + 最近执行 + 插件摘要 → 单段可粘贴 prompt。
 *   runs 是 runStore 数组（最新在前），plugins 是 [{id,name,actions:[{id,title}]}]。
 */
export function packContext({ current, runs = [], plugins = [], maxRuns = 3 } = {}) {
  const lines = ['# zerokit 上下文', ''];
  if (current) {
    lines.push('## 刚执行的结果', '', toAiMarkdown(current.res, { name: current.name, ts: current.ts }), '');
  }
  if (runs.length > 0) {
    lines.push('## 最近执行', '');
    for (const r of runs.slice(0, maxRuns)) {
      lines.push(`- ${r.plugin}.${r.action}（${r.ok ? '成功' : '失败'}，${new Date(r.ts).toLocaleString()}）`);
    }
    lines.push('');
  }
  if (plugins.length > 0) {
    lines.push('## 可用插件', '');
    for (const p of plugins) {
      const acts = (p.actions || []).map((a) => a.id).join(', ');
      lines.push(`- **${p.id}**（${p.name}）：${acts || '（无动作）'}`);
    }
  }
  return lines.join('\n');
}

/**
 * ③ MCP 配置片段：mcpServers JSON（含 command/args），可直接贴进客户端配置。
 */
export function toMcpConfig(cmd = 'node', script = '/path/to/zerokit/src/mcp.ts') {
  return JSON.stringify({ mcpServers: { zerokit: { command: cmd, args: [script, 'serve'] } } }, null, 2);
}

/**
 * ④ LLM 批处理 JSONL：rows 每行 → {input: 行对象, expected: null} 对（用户补期望值）。
 */
export function toLlmJsonl(rows) {
  if (!Array.isArray(rows)) return '';
  return rows.map((r) => JSON.stringify({ input: r, expected: null })).join('\n');
}

/**
 * ⑥ 监控样本 → Markdown 趋势表：时间/值/环比变化（cellDiff 文本）。
 */
export function watchTrendMarkdown(samples, valueOf = (s) => s?.value) {
  if (!Array.isArray(samples) || samples.length === 0) return '';
  const rows = samples.map((s, i) => {
    const prev = i > 0 ? valueOf(samples[i - 1]) : null;
    const d = prev === null ? '' : (cellDiff(prev, valueOf(s)) ?? '—');
    return `| ${new Date(s.ts).toLocaleTimeString()} | ${String(valueOf(s) ?? '')} | ${d} |`;
  });
  return ['| 时间 | 值 | 变化 |', '| --- | --- | --- |', ...rows].join('\n');
}

/**
 * ⑦ 执行历史单条 → curl 命令（API 形状）。token 用占位符——真令牌永远不出现在剪贴板。
 */
export function toCurl({ plugin, action, values = {}, port = 28970 } = {}) {
  const body = JSON.stringify({ plugin, action, values });
  return `curl -X POST http://127.0.0.1:${port}/api/run \\\n  -H 'Content-Type: application/json' \\\n  -H 'x-zerokit-token: <启动器页面里的令牌>' \\\n  -d '${body}'`;
}

/* ===================== 第三十八轮：定时与调度 ===================== */

/** ①新建定时任务的间隔档位：快捷选择不必手填。分钟归一，非法兜底 null。 */
export const TIMER_PRESETS = [
  { label: '每 1 分钟', sec: 60 },
  { label: '每 5 分钟', sec: 300 },
  { label: '每 10 分钟', sec: 600 },
  { label: '每 30 分钟', sec: 1800 },
  { label: '每 1 小时', sec: 3600 },
];

/** ②执行窗口判定：'09:00-18:00' 形式。窗口外返回 false（调用方记 skipped）。
 * 无窗口/空串/格式错 = 永远在窗口内（fail-open 于「限制」而不是「执行」——
 * 窗口写错不该把任务变成 7×24 全天跑？不：格式错视为无窗口并提示，见 validWindow）。 */
export function inWindow(now, win) {
  if (!win) return true;
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(String(win).trim());
  if (!m) return true;
  const mins = (h, mi) => Number(h) * 60 + Number(mi);
  const cur = now.getHours() * 60 + now.getMinutes();
  const a = mins(m[1], m[2]); const b = mins(m[3], m[4]);
  if (a <= b) return cur >= a && cur < b;
  return cur >= a || cur < b;   // 跨午夜（22:00-06:00）
}

/** 窗口格式校验：给表单即时反馈用，与 inWindow 同一正则。 */
export function validWindow(win) {
  return !win || /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.test(String(win).trim());
}

/** ⑥下次触发时间（相对）：now 与 at 都是 ms 时间戳。 */
export function nextRunLabel(at, now = Date.now()) {
  const d = at - now;
  if (d <= 0) return '马上';
  if (d < 60_000) return `${Math.ceil(d / 1000)} 秒后`;
  if (d < 3_600_000) return `${Math.ceil(d / 60_000)} 分钟后`;
  if (d < 86_400_000) return `${Math.ceil(d / 3_600_000)} 小时后`;
  return `${Math.ceil(d / 86_400_000)} 天后`;
}

/** ③错过补跑判定：上一次应触发时间（lastDue）比 now 早超过一个间隔，
 * 且该次未被执行（lastRanAt < lastDue），则补跑一次。最多一次：补跑后
 * lastRanAt 前移，不再连环补（不做风暴）。 */
export function shouldCatchUp(t, now = Date.now()) {
  if (!t || !t.interval || t.interval <= 0) return false;
  if (t.paused) return false;
  const lastDue = t.lastRanAt ?? t.createdAt ?? now;
  // 从 lastDue 起该触发而没触发的时刻
  const missed = now - lastDue >= t.interval * 1000 * 2;   // 宽一个间隔（页面切换的间隙不算错过）
  return missed && (t.lastRanAt ?? 0) < lastDue + t.interval * 1000;
}

/** ⑨导出/导入：定时任务配置序列化（运行态字段剥掉，只剩可迁移的配置）。 */
export function exportTimers(reg) {
  const out = {};
  for (const [k, t] of Object.entries(reg ?? {})) {
    out[k] = {
      title: t.title, interval: t.interval, win: t.win ?? '',
      createdAt: t.createdAt ?? null, paused: !!t.paused,
    };
  }
  return { app: 'zerokit', kind: 'timers', version: 1, exportedAt: new Date().toISOString(), timers: out };
}

export function parseTimersPack(text) {
  try {
    const p = JSON.parse(String(text));
    if (!p || p.app !== 'zerokit' || p.kind !== 'timers' || !p.timers) {
      return { ok: false, error: '不是 zerokit 定时任务导出文件（缺 app/kind/timers 标记）' };
    }
    const bad = Object.values(p.timers).some((t) => !t.interval || t.interval <= 0);
    if (bad) return { ok: false, error: '有任务的间隔不合法（须为正整数秒）' };
    return { ok: true, pack: p };
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
}

/** ⑤执行历史裁剪：每任务只留最近 N 条（默认 10）。 */
export function trimHistory(list, n = 10) {
  if (!Array.isArray(list)) return [];
  return list.slice(-n);
}

/* ===================== 第三十九轮：结果呈现最后一公里 ===================== */

/** ⑤时间戳识别：10 位秒级/13 位毫秒级数字（含数字串），且落在 2001–2099 年。 */

// ==================================================================
// ===== 结果呈现 =====
// ==================================================================
export function looksLikeTimestamp(v) {
  if (v === null || v === undefined) return false;
  const s = typeof v === 'number' ? String(v) : String(v).trim();
  if (!/^\d{10}$|^\d{13}$/.test(s)) return false;
  const n = Number(s);
  const ms = s.length === 10 ? n * 1000 : n;
  const d = new Date(ms);
  return !Number.isNaN(d.getTime()) && d.getFullYear() >= 2001 && d.getFullYear() <= 2099;
}

/** ⑤人性化：秒/毫秒转本地时间串；非时间戳原样返回。 */
export function humanTs(v) {
  if (!looksLikeTimestamp(v)) return v;
  const n = Number(String(v).trim());
  const d = new Date(String(v).trim().length === 10 ? n * 1000 : n);
  return d.toLocaleString();
}

/** ⑥空结果归因：空数组=查了没有；null/undefined=没返回；空对象=空配置。 */
export function emptyReason(data) {
  if (data === null || data === undefined) return '动作没有返回数据（null/undefined——检查动作是否真的有输出）';
  if (Array.isArray(data)) return '查了，没有匹配项（空数组——筛选条件可能太严）';
  if (typeof data === 'object' && Object.keys(data).length === 0) return '返回了空对象（动作没产出字段）';
  return null;   // 非空：调用方正常渲染
}

/** ⑧Markdown 目录：抽 ##/### 标题；≤3 个不出（没有导航价值）。 */
export function tocFromMd(md) {
  if (typeof md !== 'string') return [];
  const lines = md.split('\n');
  const out = [];
  let inFence = false;
  for (const ln of lines) {
    if (/^\s*```/.test(ln)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^(#{2,3})\s+(.+)$/.exec(ln);
    if (m) out.push({ level: m[1].length, text: m[2].trim() });
  }
  return out.length > 3 ? out : [];
}

/* ======================= 第四十七轮：信息架构与首屏 ======================= */

/**
 * ①入口三分类：执行（高频直达）/ 观察（看状态）/ 管理（低频，收抽屉）。
 * 返回 { exec:[], observe:[], manage:[] }——没归类的进 manage（宁可收起也不平铺）。
 */
export function navGroups(entries) {
  const g = { exec: [], observe: [], manage: [] };
  for (const e of entries ?? []) {
    if (g[e.kind] && Array.isArray(g[e.kind])) g[e.kind].push(e);
    else g.manage.push(e);
  }
  return g;
}

/**
 * ⑥空态文案分级：三种情境不同指引。
 * 返回 { title, hint }；调用方渲染。kind: first-run | no-plugins | no-match。
 */
export function emptyState(kind, q) {
  if (kind === 'first-run') return {
    title: '先装几个插件',
    hint: '插件是能力包。点右上「集市」浏览，或终端跑 plugin bundled 装自带的示例。',
  };
  if (kind === 'no-plugins') return {
    title: '一个插件都没有',
    hint: '终端跑 plugin bundled 装自带示例，或去集市找。装完这里就有动作了。',
  };
  // no-match
  return {
    title: `没有匹配「${q || ''}」的动作`,
    hint: '试试短一点的关键词（拼音也行）；或者 Esc 清空搜索回到全部。',
  };
}

/**
 * ⑨骨架屏行：首屏列表渲染前先画 N 行占位（避免白屏一闪）。
 */
export function skeletonRows(n = 6) {
  return Array.from({ length: Math.max(1, Math.min(n, 12)) }, (_, i) => i);
}

/**
 * ⑦结果区高度档位：按行数选 compact | normal | scroll。
 * ≤4 行紧凑、≤30 行常规、更多出滚动（调用方只管挂类名）。
 */
export function resultHeightTier(rowCount) {
  const n = Number(rowCount);
  if (!Number.isFinite(n)) return 'normal';
  if (n <= 4) return 'compact';
  if (n <= 30) return 'normal';
  return 'scroll';
}

/**
 * ⑧窄屏断点：给定视口宽，返回布局模式 desktop | narrow。
 */
export function viewportMode(width) {
  return Number(width) > 0 && Number(width) <= 720 ? 'narrow' : 'desktop';
}

// ======================= 第四十八轮：错误知识库与失败体验 =======================

/**
 * ①④常见错误知识库：UI 与 CLI 共用一份分类。
 * kind 与 src/core/suggest.ts 的 DIAG_RULES 对齐（UI 侧补两类：非零退出/解析失败）。
 */
export const ERROR_BOOK = [
  { kind: 'timeout', test: /timed? ?out|ETIMEDOUT|超时/i,
    title: '执行超时',
    steps: ['等一会再试；插件清单里可用 timeout 声明更长超时', '网络类动作先确认代理环境变量'] },
  { kind: 'not-found', test: /ENOENT|no such file|找不到文件/i,
    title: '文件或目录不存在',
    steps: ['检查路径拼写；插件的工作目录是它自己的安装目录', '辅助文件路径写进清单 cwd 或参数'] },
  { kind: 'permission', test: /permission denied|EACCES|EPERM/i,
    title: '没有权限',
    steps: ['chmod +x <脚本>（Windows：icacls）', '确认 ~/.zerokit 归当前用户'] },
  { kind: 'not-executable', test: /ENOEXEC|not executable|不是可执行文件/i,
    title: '文件在但跑不起来',
    steps: ['脚本缺执行位：chmod +x', '跨平台插件用 {python} 或自带 .bat'] },
  { kind: 'command-not-found', test: /command not found|is not recognized as|无法将.+识别为/i,
    title: '依赖的程序没装',
    steps: ['zkit doctor 列出各插件缺的运行时', '装完重跑 doctor 确认'] },
  { kind: 'exit-nonzero', test: /exit(ed)? (with )?(code )?[1-9]\d*/i,
    title: '程序报错退出（非零退出码）',
    steps: ['看下方原始输出定位报错行', '同参数重试一次排除偶发'] },
  { kind: 'parse-fail', test: /JSON|parse|解析/i,
    title: '输出解析失败',
    steps: ['插件声明了 output="json" 但实际没吐合法 JSON', '用 zkit run --out json 看原始 stdout'] },
];

/** ①把错误文本（stderr/error message）映射到知识库条目；认不出给通用兜底。 */
export function classifyError(text) {
  const raw = String(text ?? '');
  for (const e of ERROR_BOOK) {
    if (e.test.test(raw)) return { kind: e.kind, title: e.title, steps: e.steps };
  }
  return { kind: 'unknown', title: '执行失败', steps: ['看下方原始输出；重试一次排除偶发', '反复失败用 zkit doctor 自检'] };
}

/** ⑤批量执行汇总行：成功 N / 失败 M / 未跑 K（K=planned-已跑数；缺省无未跑段）。 */
export function batchSummary(done, planned) {
  const ok = done.filter((d) => d.ok).length;
  const bad = done.length - ok;
  const skipped = planned !== undefined ? Math.max(0, planned - done.length) : 0;
  const parts = [`✓ 成功 ${ok}`];
  if (bad) parts.push(`✗ 失败 ${bad}`);
  if (skipped) parts.push(`∅ 未跑 ${skipped}`);
  return parts.join(' · ');
}


// ============ 第四十九轮：结果对比与历史分析 ============

/**
 * 数值字段趋势：从动作历史里抽一个数值字段最近 N 次的序列。
 * runs: runStore[key]（每项 {ts, ok, ms, data?}）；field: 字段名。
 * 返回 null（无数据）或 { points: [{ts, v}], avg, best, worst }（best=min worst=max）。
 */
export function runTrend(runs, field, limit = 20) {
  if (!Array.isArray(runs)) return null;
  const points = [];
  for (const r of runs.slice(-limit)) {
    const v = r?.data?.[field];
    let n = NaN;
    if (typeof v === 'number') n = v;
    else if (typeof v === 'string' && v.trim() !== '') {
      n = Number(v);
      if (!Number.isFinite(n)) {
        const m = v.trim().match(/^-?\d+(?:\.\d+)?/);   // '120 MB' → 120（与 resultQuery 同语义）
        if (m) n = Number(m[0]);
      }
    }
    if (Number.isFinite(n)) points.push({ ts: r.ts, v: n });
  }
  if (points.length < 2) return null;
  const vs = points.map((p) => p.v);
  const avg = vs.reduce((a, b) => a + b, 0) / vs.length;
  return { points, avg, best: Math.min(...vs), worst: Math.max(...vs) };
}

/**
 * 失败率：runs 最近 limit 条里 ok=false 的占比。返回 { fails, total, rate }；空历史 rate=0。
 */
export function failureRate(runs, limit = 10) {
  if (!Array.isArray(runs) || runs.length === 0) return { fails: 0, total: 0, rate: 0 };
  const recent = runs.slice(-limit);
  const fails = recent.filter((r) => r && r.ok === false).length;
  return { fails, total: recent.length, rate: fails / recent.length };
}

/**
 * 耗时分布：毫秒数组 → { p50, p95, min, max, count }。空数组返回 null。
 */
export function durationStats(msList) {
  if (!Array.isArray(msList) || msList.length === 0) return null;
  const a = [...msList].sort((x, y) => x - y);
  const pick = (q) => a[Math.min(a.length - 1, Math.floor(q * a.length))];
  return { p50: pick(0.5), p95: pick(0.95), min: a[0], max: a[a.length - 1], count: a.length };
}

/**
 * 第五十轮⑨：相对亮度（WCAG）：hex → 0~1。
 * sRGB 每通道按分段公式线性化（≤0.03928 除 12.92，其余 ((c+0.055)/1.055)^2.4）。
 */
function srgbLum(hex) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => parseInt(c + c, 16)) : [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = n.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 对比度比值：1~21（同色=1，黑白=21）。两色都收 #rgb/#rrggbb。 */
export function contrastRatio(hex1, hex2) {
  const l1 = srgbLum(hex1), l2 = srgbLum(hex2);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** 字号阶梯一步：base(px) × 1.25^step，step 可为负（缩小），四舍五入到 0.5px。 */
export function typeScaleStep(base, step) {
  const r = base * Math.pow(1.25, step);
  return Math.round(r * 2) / 2;
}

/**
 * 第五十一轮⑧：搜索零结果时的「下一步建议」。
 * 输入词逐个去掉一个（留其余）后重试能命中多少动作；命中多的丢词就是建议。
 * allTokens(entry)=>string[] 由调用方给（title/desc/keywords 拼好小写）。
 * 返回 [{drop, hit}] 按 hit 降序；全都救不回来返回 []。
 */
export function suggestNext(tokens, entries) {
  if (!Array.isArray(tokens) || tokens.length < 2 || !Array.isArray(entries)) return [];
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const rest = tokens.filter((_, j) => j !== i);
    let hit = 0;
    for (const e of entries) {
      const hay = typeof e === 'string' ? e : (e.hay ?? '');
      if (rest.every((t) => hay.includes(t))) hit++;
    }
    if (hit > 0) out.push({ drop: tokens[i], hit });
  }
  out.sort((a, b) => b.hit - a.hit);
  return out.slice(0, 3);
}

/** 第五十一轮⑧：搜索词+筛选 chip 的组合标签（组合记忆入历史用）。 */
export function comboLabel(q, filter) {
  const qq = String(q ?? '').trim();
  const ff = String(filter ?? '').trim();
  if (qq && ff && ff !== 'all') return `${qq} [${ff}]`;
  return qq || '';
}

/** 第五十二轮⑨：键位表数据（? 浮层与帮助页共用）。 */
export function keyHelpList() {
  return [
    { key: '↑ ↓', what: '在结果间移动（roving focus 跟随）' },
    { key: 'PgUp / PgDn', what: '翻页跳转（长列表按视口跳）' },
    { key: 'Home / End', what: '跳到第一条 / 最后一条' },
    { key: '1–9', what: '快选第 N 条（选中后回车打开）' },
    { key: 'Alt+1–9', what: '直开第 N 条' },
    { key: 'Enter', what: '打开选中项' },
    { key: 'Ctrl+Enter', what: '打开并直接执行' },
    { key: 'Esc', what: '清空搜索 / 逐层关闭浮层' },
    { key: 'F', what: '收藏 / 取消收藏当前项' },
    { key: 'T', what: '给当前项打标签（数字键选已有标签）' },
    { key: 'Y / E', what: '结果区：复制 / 导出' },
    { key: '?', what: '显示本键位表' },
    { key: 'Ctrl+P / Ctrl+K', what: '命令面板' },
    { key: 'Ctrl+/', what: '快捷键速查' },
    { key: 'Ctrl+Shift+D', what: '深色 / 浅色一键切换' },
    { key: 'Alt+点击', what: '把动作放进批量篮' },
    { key: 'Alt+↑ / Alt+↓', what: '批量篮内移动项的位置' },
  ];
}

/** 第五十三轮⑨：单元格展示策略——空值灰 —、长文本截断长度、数字右对齐判定。 */
export function cellDisplay(v) {
  if (v === null || v === undefined || v === '') return { kind: 'empty', text: '—' };
  const raw = (v && typeof v === 'object') ? JSON.stringify(v) : String(v);
  const numeric = typeof v === 'number' || /^-?[\d.,\s%]+$/.test(raw);
  const clipAt = 48;
  const clip = !numeric && raw.length > clipAt;
  return {
    kind: clip ? 'clip' : (numeric ? 'num' : 'text'),
    text: clip ? `${raw.slice(0, clipAt - 3)}…` : raw,
    full: clip ? raw : null,
    numeric,
  };
}

/** 第五十三轮⑨：表格密度档（紧凑/标准/宽松）——行高与内边距的档位表。 */
export function tableDensity(pref) {
  const table = {
    compact: { row: '30px', pad: '3px 8px', fs: '12px' },
    normal: { row: '38px', pad: '6px 10px', fs: '13px' },
    relaxed: { row: '48px', pad: '10px 12px', fs: '14px' },
  };
  return table[pref] ?? table.normal;
}

/** 第五十三轮⑨：KV 折叠状态——折叠键集合存 localStorage，展开时子键也要记得。 */
export function kvCollapsed(stored, key, isCollapsed) {
  const set = new Set(Array.isArray(stored) ? stored : []);
  if (isCollapsed) set.add(key); else set.delete(key);
  return [...set];
}

/** 第五十四轮⑨：执行记录按天分组（倒序），每天含汇总。 */
export function timelineDays(runs) {
  const byDay = new Map();
  for (const r of runs ?? []) {
    if (!r || typeof r.ts !== 'number') continue;
    const d = new Date(r.ts);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!byDay.has(day)) byDay.set(day, { day, total: 0, fails: 0, msSum: 0, items: [] });
    const g = byDay.get(day);
    g.total += 1;
    if (!r.ok) g.fails += 1;
    g.msSum += (typeof r.ms === 'number' ? r.ms : 0);
    g.items.push(r);
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}

/** 第五十四轮⑨：0–23 时分布（柱状数据）。 */
export function groupByHour(runs) {
  const hours = Array.from({ length: 24 }, () => 0);
  for (const r of runs ?? []) {
    if (!r || typeof r.ts !== 'number') continue;
    hours[new Date(r.ts).getHours()] += 1;
  }
  return hours;
}

/** 第五十四轮⑨：本周 vs 上周对比（周一为界）。 */
export function weekCompare(runs, now = Date.now()) {
  const d = new Date(now);
  const dow = (d.getDay() + 6) % 7; // 周一=0
  const weekStart = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow).getTime();
  const lastStart = weekStart - 7 * 86400000;
  const pick = (from, to) => {
    const rs = (runs ?? []).filter((r) => r && typeof r.ts === 'number' && r.ts >= from && r.ts < to);
    const fails = rs.filter((r) => !r.ok).length;
    const ms = rs.filter((r) => typeof r.ms === 'number').map((r) => r.ms);
    return {
      total: rs.length,
      failRate: rs.length ? fails / rs.length : 0,
      avgMs: ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0,
    };
  };
  const cur = pick(weekStart, now + 1);
  const prev = pick(lastStart, weekStart);
  const delta = (a, b) => (b === 0 ? (a === 0 ? 0 : null) : (a - b) / b);
  return {
    cur, prev,
    totalDelta: delta(cur.total, prev.total),
    failDelta: prev.failRate === 0 ? (cur.failRate === 0 ? 0 : null) : (cur.failRate - prev.failRate),
    avgDelta: delta(cur.avgMs, prev.avgMs),
  };
}

/** 第五十四轮⑨：时间段内最常跑的动作 Top N（扁平 runs 列表版；与第 200 行旧 topActions(runStore) 签名不同，改名避撞）。 */
export function topActionsFlat(runs, limit = 5) {
  const cnt = new Map();
  for (const r of runs ?? []) {
    if (!r) continue;
    const label = `${r.plugin ?? ''}·${r.action ?? ''}`;
    if (!label.trim() || label === '·') continue;
    cnt.set(label, (cnt.get(label) ?? 0) + 1);
  }
  return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([label, n]) => ({ label, count: n }));
}
