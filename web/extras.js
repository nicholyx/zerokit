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
    searchPlaceholder: '搜索动作、插件、内容…（Ctrl+K 专注）',
    run: '执行', back: '返回', close: '关闭', copy: '复制', cancel: '取消',
    confirm: '确认执行', all: '全部', favorite: '收藏', settings: '设置',
    shortcuts: '快捷键', theme: '主题', empty: '什么都没有', noResult: '没有匹配的动作',
    langLabel: '中/EN',
  },
  en: {
    modeCommand: 'Commands', modePlugins: 'Plugins', modeMarket: 'Market', modeStats: 'Stats',
    searchPlaceholder: 'Search actions, plugins, content… (Ctrl+K)',
    run: 'Run', back: 'Back', close: 'Close', copy: 'Copy', cancel: 'Cancel',
    confirm: 'Confirm', all: 'All', favorite: 'Favorite', settings: 'Settings',
    shortcuts: 'Shortcuts', theme: 'Theme', empty: 'Nothing here', noResult: 'No matching actions',
    langLabel: '中/EN',
  },
};

export function pickLang(v) {
  return v === 'en' ? 'en' : 'zh';
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
