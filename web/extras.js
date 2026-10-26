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
    out.push('| 字段 | 值 |', '| --- | --- |');
    for (const [k, v] of Object.entries(data)) {
      out.push(`| ${cell(k)} | ${cell(typeof v === 'object' ? JSON.stringify(v) : v)} |`);
    }
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
