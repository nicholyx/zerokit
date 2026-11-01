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
  { keys: ['↑', '↓'], whatKey: 'scResultNav' },
  { keys: ['Enter'], whatKey: 'scOpenRun' },
  { keys: ['Ctrl', 'Enter'], whatKey: 'scConfirmRun' },
  { keys: ['Esc'], whatKey: 'scEsc' },
  { keys: ['?'], whatKey: 'scAi' },
  { keys: ['Ctrl', '/'], whatKey: 'scCheat' },
  { keys: ['Ctrl', 'K'], whatKey: 'scFocus' },
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
  // 第六十九轮⑤：[ / ] 键（或点 chip）只看带参数/无参数动作
  { id: 'has-params', label: '带参数' },
  { id: 'no-params', label: '无参数' },
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
  // 第六十九轮⑤：带/无参数过滤（chain 步骤参数不算——看的是动作自身入参；
  // 前端动作对象里参数字段叫 fields，内核清单叫 params，两处都认）
  const paramCount = (e) => (e.action.fields ?? e.action.params ?? []).length;
  if (filter === 'has-params') return list.filter((e) => paramCount(e) > 0);
  if (filter === 'no-params') return list.filter((e) => paramCount(e) === 0);
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
    modeSaved: '收藏', modeMcp: 'MCP', modeDetail: '详情', modeDash: '仪表盘',
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
    statsTitle: '使用统计',
    statsEmpty: '还没有执行记录',
    statsEmptyHint: '随便跑一个只读动作，这里就会开始长出来',
    statsTotal: '总执行次数',
    statsOkRate: (ok, total) => `成功率（${ok} 成功）`,
    statsAvgMs: '平均耗时',
    statsTop: '最活跃的插件',
    statsWhen: '一天中的什么时候在用',
    statsMsDist: '一次跑多久（毫秒分布）',
    statsLast7: '近 7 天',
    statsRunsN: (n) => `${n} 次`,
    statsRunsFail: (n, pct) => `${n} 次（失败 ${pct}%）`,
    statsRunsShare: (n, pct) => `${n} 次（占 ${pct}%）`,
    statsPrivacy: '全部来自本机执行记录，不上传任何数据',
    statsBackupTitle: '偏好备份',
    statsBackupWhat: '收藏、备注、别名、标签、快捷键、主题',
    statsBackupHow: (k) => `换电脑或清浏览器数据前，先导出一份 JSON；导入时只认 zerokit${k} 开头的键`,
    statsAllLocal: '全部只存在这台机器的浏览器里',
    statsOpenPlugHome: '点开插件主页',
    drawerLang: '语言 Language', drawerLogs: '日志', drawerDoctor: '自检', drawerSaved: '收藏',
    updateAvailablePre: '有新版本 ', updateAvailablePost: ' 可用', updateLaterDone: '三天内不再提醒', updateView: '查看', updateLaterBtn: '稍后', updateLaterTitle: '三天后再提醒', updateDismissBtn: '✕', updateDismissTitle: '本次会话不再显示',
    drawerImportSnap: '导入快照', drawerTimers: '定时', drawerBrief: '简报', drawerWatch: '监控', drawerHelp: '帮助',
    drawerLangTitle: 'Switch language / 切换语言',
    drawerLogsTitle: '审计日志：每次执行、被拒、失败都记着',
    drawerDoctorTitle: '环境自检：解释器、插件依赖、必填配置',
    drawerSavedTitle: '收藏的结果：钉住重要的输出',
    drawerImportSnapTitle: '导入 .zkresult 快照文件：回放别人分享的结果',
    drawerTimersTitle: '定时任务：界面开着才跑的自动执行',
    drawerBriefTitle: '今日简报：跑了多少、成败、最常用',
    watchStarted: (label) => `监控已开启：每 ${label} 重跑一次（#/watch 面板聚合查看）`,
    watchStopped: '监控已停止',
    watchAutoFail: (n) => `监控已自动停：连续 ${n} 次失败`,
    watchAutoMatch: '监控已自动停：结果命中了停止串',
    watchAlertTitle: 'zerokit 监控告警',
    watchNotifyTitle: 'zerokit 监控',
    riskTip: (n, r, m, d) => `动作数 ${n}：只读 ${r}、会改动 ${m}、高风险 ${d}（点击整行折叠/展开）`,
    missingDeps: '缺依赖',
    sortNoteRecent: '按最近使用排序（m 键切回插件序）',
    recentHead: '最近执行',
    recentSearchLabel: '最近搜索',
    filterLabels: { all: '全部', fav: '收藏', 'has-params': '带参数', 'no-params': '无参数', read: '只读', mutate: '会改动', destructive: '高风险' },
    sugMarket: (q) => `去集市找一个能做这件事的插件`,
    sugAskAi: (q) => `问 AI 工作台：「${q}」`,
    sugTryThese: '试试这些（都是只读、安全）：',
    emptyNoMatchTitle: (q) => `没有匹配「${q || ''}」的动作`,
    logAll: '全部', logAllow: '允许', logDeny: '被拒', logError: '失败', logToday: '今天',
    drawerHelp: '使用指南',
    memBrought: '已带入上次参数', memForget: '清除记忆',
    previewTip: '先看真正会执行的命令行（密钥打码），再决定跑不跑', previewCmd: '预览命令',
    batchSelected: (n) => `已选 ${n} 项`, batchDups: (n) => `重复 ${n}`,
    moreTip: '更多操作：调用方式 / 配置 / 分享 / 定时 / 监控 / 结果处理', more: '更多',
    invokeWays: '三种调用方式',
    whyHit: '命中', whyNick: '昵称', whyActionId: '动作ID', whyTitle: '动作名', whyPluginAction: '插件.动作', whyPinyin: '拼音', whyTags: '标签',
    chainSteps: (n) => `组合 ${n} 步`, smartMatch: '智能匹配', looksLike: (v) => `内容看起来是${v}，可以直接用`,
    sumOf: '小计', avgLabel: '均值', tfootSum: (sum, avg) => `合计 ${sum} · 均值 ${avg}`,
    rowsWindowed: (shown, total, page) => `${shown} / ${total} 行（大表只画前 ${page} 行保流畅）`,
    loadAllRows: (n) => `加载全部 ${n} 行`, rowsTotal: (n) => `共 ${n} 行`, rowsFiltered: (n, total) => `${n} / ${total} 行（筛选中）`,
    copiedCol: (col, dedup, n) => `已复制列「${col}」${dedup ? '（去重后' : '（'}${n} 行）`,
    ctxCopyCell: '复制单元格', ctxCopyRow: '复制整行', ctxCopyTable: '复制整表（TSV）', ctxFilterEq: (col, v) => `只看「${col} = ${v}」`,
    cellUnit: '单元格', rowUnit: '整行', tableUnit: '整表', copiedWhat: (what) => `已复制${what}`, copyDenied: '复制被浏览器拒绝',
    sortBy: '排序：', sortName: '名称', sortActions: '动作数', sortInstalled: '最近安装',
    watchDlgTitle: (name) => `监控「${name}」`, watchDlgHelp: '界面开着才会跑。每次采样记录结果，变化会高亮，可在 #/watch 面板聚合查看。',
    watchRerunEvery: '重跑间隔', watchFailLabel: '连续失败几次自动停（0 = 不停）', watchMatchLabel: '结果包含此串自动停（留空 = 不启用）',
    watchMatchPh: '如 error / 90%', watchStartBtn: '开始监控', cancel: '取消',
    importDone: (applied, skipped) => `导入完成：应用 ${applied} 项、跳过 ${skipped} 项，即将刷新…`,
    cmpDiffCount: (n) => `对比出 ${n} 处差异`, cmpNoKeys: '两条没有可比的键',
    timerDlgTitle: (name) => `定时执行：${name}`, timerDlgHelp: '界面开着才会跑。只读动作才允许定时（有副作用的自动跑风险太大）。',
    timerSecLabel: '间隔（秒）', timerPresets: '快捷档位', timerWinLabel: '执行窗口（可空，如 09:00-18:00，窗口外跳过）',
    timerUseVals: '用当前表单值作为定时参数', timerSaveBtn: (upd) => `${upd ? '更新' : '开始'}定时`,
    timerMinSec: '间隔至少 10 秒', timerWinBad: '窗口格式应为 HH:MM-HH:MM',
    whyLabelPrefix: '命中：',
            fbCopied: '✓ 已复制',
    fbCopyFail: '复制失败',
    fbCopyPlain: '复制',
    fbCopiedPlain: '已复制',
    fbCopiedNote: '已复制(带备注)',
    fbCopiedIndent: '已复制(缩进)',
    fbCopyMcp: '复制 mcpServers',
    fbCopiedLink: '已复制链接',
    fbShare: '分享',
    fbSerializing: '序列化中…',
    fbSaving: '保存中…',
    fbSaved: '✓ 已保存，下一次执行立即生效',
    fbSaveFail: '保存失败：',
    fbExported: '已导出',
    fbExportMd: '导出 Markdown',
    fbSnapshotDone: '快照已导出（.zkresult.json）',
    fbOpening: '打开中…',
    fbOpened: '已打开',
    fbOpenFail: '编辑器打不开：',
    fbOpenedAt: '已在编辑器打开：',
    fbFailed: '失败',
    fbChecking: '检查中…',
    fbFold: '展开',
    fbCollapse: '收起',
    fbNoHits: '没有命中',
    fbHits: '处',
    fbTimerReadOnly: '只有只读动作能定时执行（有副作用的自动跑风险太大）',
    fbWatchReadOnly: '只有只读动作能监控（有副作用的自动跑风险太大）',
    fbShareNoResult: '还没有执行结果，先跑一次再分享',
    fbShareCardDone: '分享卡已复制到剪贴板',
    fbShareCardFallback: '复制被拒绝；已暂存（',
    fbCopyNoHttps: '复制失败（非 https 环境）',
    fbNeedPluginId: '先填插件 id',
    tlSplitterTip: '拖拽调节分栏宽度（双击复位）',
    tlPeekLast: '回看上次结果',
    tlEye: '显示/隐藏明文',
    tlHkBtn: '把 F1–F12 里某个键绑给这个动作，全局按一下就打开',
    tlWmd: '把采样导出成 Markdown 趋势表（时间/值/变化），贴给 AI 或进文档',
    tlWriteBack: '写回剪贴板',
    tlDelItem: '删除这条',
    psTimeline: '时间线',
    psBrief: '今日简报',
    psWatch: '监控面板',
    sugDropTitle: '丢一个词试试：',
    rsFailBadge: '✗ 失败', rsActionFail: '动作失败',
    bsOk: '成功', bsFail: '失败', bsSkip: '未跑',
helpTry: '去试用', helpTitle: '使用指南', helpIntro: '启动器能做什么、怎么上手，都在这一页。每段都有「去试用」直达。', helpTryTip: '跳到这个功能试一下',
helpSearchTitle: '搜索', helpSearchBody: '支持中文关键词、拼音全拼、拼音首字母。打「dl」出「代理」、「xtxx」出「系统信息」。空格分词是多词 AND（每个词都要命中）。数字可直接选第 N 项。',
    helpRunTitle: '执行与结果', helpRunBody: '只读动作点「执行」直接跑；会改动/高风险动作要确认。结果可复制、下载、重跑，表格结果支持排序/筛选/列显隐/单位换算，还能跨两次执行做合并视图与逐格 diff。',
    helpWatchTitle: '监控', helpWatchBody: '只读动作可设间隔自动重跑：倒计时环显示下次采样、变化格子黄高亮、数值字段带迷你趋势线；连续失败或命中指定串自动停。#/watch 面板聚合所有在跑的监控，可导出采样 CSV。',
    helpProfilesTitle: '配置档', helpProfilesBody: '外观面板里可建多个配置档（工作/个人…）：主题、收藏、参数记忆随档切换，执行历史全局共享。以当前状态一键新建，重命名/删除都有守卫。',
    helpBackupTitle: '数据备份', helpBackupBody: '外观面板「数据」分组：全部个性化数据一键导出 JSON（文件名可预测）；导入有格式校验、分组预览、按类别勾选，合并不覆盖本地独有数据。',
    helpSafetyTitle: '安全防护', helpSafetyBody: '危险参数值（rm -rf / 系统目录 / dd 直写）执行前黄条警示；同一动作 3 秒内连点会弹确认；结果与日志里的 token 默认打码；动作详情页有风险横条与失败率。',
    scResultNav: '在结果里上下选择', scOpenRun: '打开动作 / 执行', scConfirmRun: '直接确认执行（会改动）并记住', scEsc: '返回上一层 / 清空搜索',
    scAi: '切到 AI 工作台（在搜索框开头输入）', scCheat: '打开这份快捷键速查', scFocus: '聚焦搜索框',
    khResultNav: '在结果间移动（roving focus 跟随）', khPage: '翻页跳转（长列表按视口跳）', khHomeEnd: '跳到第一条 / 最后一条',
    khQuickPick: '快选第 N 条（选中后回车打开）', khDirectOpen: '直开第 N 条', khOpen: '打开选中项', khOpenRun: '打开并直接执行',
    khEsc: '清空搜索 / 逐层关闭浮层', khFav: '收藏 / 取消收藏当前项', khTag: '给当前项打标签（数字键选已有标签）',
    khCopyExport: '结果区：复制 / 导出', khShow: '显示本键位表', khPalette: '命令面板', khCheat: '快捷键速查',
    khTheme: '深色 / 浅色一键切换', khBasket: '把动作放进批量篮', khBasketMove: '批量篮内移动项的位置',
    drawerImportSnapTitle: '导入 .zkresult 快照文件：回放别人分享的结果', footerSavedTitle: '收藏的结果：钉住重要的输出（#/saved）', shortcutsTitle: '打开快捷键速查（Ctrl + /）', defaultProfileName: '默认',
    emptyParen: '空', histDelTip: '删掉这条搜索记录', clearAll: '清空',
    invokeTip: '这个动作在 CLI / MCP / 深链里怎么调', invoke: '调用方式',
    cfgTip: '这个插件的长期配置（端点、密钥等），保存后立即生效', cfgPlugin: '配置插件',
    qrTip: '生成深链二维码，手机扫码直达这个动作', qr: '二维码',
    shareLinkTip: '复制带当前参数的完整深链', shareLink: '分享深链',
    timerTip: '只读动作按间隔自动执行（界面开着才跑）', timer: '定时',
    watchTip: '监控模式：自动重跑+变更追踪+倒计时环（#/watch 聚合面板）', watch: '监控',
    maskTip: '结果里的 token/密钥/长十六进制串默认打码——切换显示明文', maskToggle: '脱敏切换',
    purgeTip: '清除当前结果与本地运行历史（含参数记忆），审计日志不动', purge: '清除痕迹',
    shareCardTip: '把这次结果生成一张摘要卡（复制到剪贴板）', shareCard: '分享卡',
    picked2: (n) => `已选 ${n}/2 条`, pickedN: (n) => `已选 ${n} 个`, recentTrendN: (n) => `最近 ${n} 次趋势`,
    batchRunLabel: (n) => `顺序执行篮子里的 ${n} 个动作`, batchRunSeq: '顺序执行',
    batchDedupLabel: '去掉同动作同参数的重复项', batchDedupBtn: '去重',
    batchExportLabel: '导出批量清单 JSON', batchExportBtn: '导出清单',
    batchImportLabel: '导入批量清单 JSON', batchImportBtn: '导入',
    batchConc: '并发', batchClearLabel: '清空批量篮', batchClearBtn: '清空',
    batchDestructiveLast: 'destructive 排最后', moveUp: '上移', moveDown: '下移',
    removeFromBasket: '移出篮子', paren: (v) => `（并发 ${v}）`,
    batchRetryDone: '失败项重跑完成', batchAllDone: '批量执行完成',
    watching: '监控中', watchEvery: (iv, runs, chg) => `每 ${iv} · 已采样 ${runs} 次 · 变更 ${chg} 次`,
    nextRunIn: '下次执行倒计时', stop: '停止',
    copyJsonTip: '复制动作定义 JSON（写文档 / 分享给他人用）', copyJson: '复制 JSON',
    resetTip: '把所有参数清回清单默认值', resetDefaults: '恢复默认',
    foldToggle: '点这里折叠 / 展开结果', foldUp: '收起',
    copyResTip: '复制结果；Shift=美化 JSON；Alt=带备注与时间', copy: '复制',
    snapTip: '导出 .zkresult 快照（含元数据；对方可导入回放）', snapshot: '快照',
    saveTip: '把结果存成文本文件', download: '下载',
    mdTip: '导出成 Markdown（表格/代码块），方便贴进文档或 Issue', exportMd: '导出 Markdown',
    shareMdTip: '导出分享 Markdown 单文件（含执行信息折叠头，贴 Issue/文档即用）', shareMd: '分享 MD',
    shareHtmlTip: '导出分享 HTML 单文件（内联样式，双击浏览器直接看，无外链）', shareHtml: '分享 HTML',
    shareCopyTip: '复制分享文本（Markdown，含元数据头；超过 50KB 自动截断）', shareCopy: '复制分享',
    csvTip: '导出成 CSV，Excel / Numbers 直接打开', exportCsv: '导出 CSV',
    jsonTip: '导出成 JSON，给脚本接着处理', exportJson: '导出 JSON',
    jsonlTip: '导出 JSONL（每行一个 JSON，jq / ndjson 友好）', exportJsonl: '导出 JSONL',
    llmTip: '导出 LLM 批处理 JSONL（每行 {input,expected}，补上期望值就是评测集）', llmJsonl: 'LLM JSONL',
    mdTableTip: '复制为 Markdown 表格（数字列右对齐）', copyMdTable: '复制 MD 表',
    tsvTip: '复制为 TSV（Excel/Numbers 直接粘贴）', copyTsv: '复制 TSV',
    htmlTip: '复制为 HTML 表格（贴进邮件/文档带格式）', copyHtmlTable: '复制 HTML 表',
    aiTip: '复制为 LLM 友好的 Markdown（表格/属性行+动作名+时间）——直接粘进 AI 对话', forAi: '给 AI',
    ctxTip: '打包当前结果+最近执行+插件清单成一段上下文，粘给 AI 免得重新描述', aiContext: 'AI 上下文',
    termTip: '终端模式查看：等宽字体、自动滚到底（进入后 w=换行开关 t=顶 b=底）', terminal: '终端',
    editTip: '把结果文本丢给外部编辑器（ZEROKIT_EDITOR 环境变量，没配用系统默认）', openEditor: '编辑器打开',
    againTip: '用同样的参数再跑一次', runAgain: '再跑一次',
    pinTip: '把这条结果钉进收藏夹（#/saved），重启后还在', pin: '收藏',
    noteTip: '给这次执行写一句备注（本机保存）', note: '备注',
    openDirTip: '在系统文件管理器里打开导出目录', openDir: '打开目录',
    findInRes: '在结果里找…（实时高亮，Enter 下一个）',
    deniedHint: '下次执行前，可以先用「预览命令」看清楚再跑。',
    whyHit: '为什么命中', whySignal: '信号', whyScore: '分', whyWeight: '权重',
    aliasHelp: '之后在搜索框直接输入短名，回车就是这个动作',
    nicknameHelp: '搜索时优先命中；列表里显示在原名旁',
    tagsHelp: '#标签可搜索，列表里显示',
    runOk: '成功', runFail: '失败', minsAgo: (n) => `${n} 分钟前`,
    rerunTitle: '用上次的参数再跑一次', rerun: '重跑',
    coOccur: (n) => `历史共现 ${n} 次`, coOccurHint: '（历史共现 ≥2 次）',
    trendTip: (n, f, avg, best, worst) => `最近 ${n} 次 ${f}：均值 ${avg} · 最好 ${best} · 最差 ${worst}`,
    trendN: (n, avg) => `(${n}次 均值${avg})`,
    durTip: (mn, p50, p95, mx) => `耗时分布：最快 ${mn} · P50 ${p50} · P95 ${p95} · 最慢 ${mx}`,
    failWarn: (total, fails, pct) => `⚠ 最近 ${total} 次里失败 ${fails} 次（${pct}%）——这个动作最近不太稳，看看错误分类卡里的建议`,
    cmpLastTip: '当前结果与上一次对比', cmpLast: '与上次对比',
    sparkTip: (n, mx) => `近 ${n} 次耗时走势（最高 ${mx}）`,
    histFillTip: '点击填入这个历史值',
    chainDry: '试走一遍（不执行，只推演每步会拿到什么形状）',
    chainSrc: (ref) => `输入来自：${ref}`,
    unfav: '取消收藏', fav: '收藏这个动作',
    chainN: (n) => `组合 ${n} 步`, noDesc: '（这个动作没写说明）',
    logTrimmed: (n) => `已自动清理 ${n} 条超期日志（>90 天；config.toml 可关）`,
    logsTitle: '审计日志', logsSub: '每次执行、被拒、失败都在这里；只在本机 ~/.zerokit/logs/',
    logFilterPh: '过滤：插件 / 动作 / 错误（支持 ms>100 这类数字比较）',
    logCsvTitle: '把当前过滤结果导出 CSV（时间/插件/动作/决策/耗时/退出码）',
    logReload: '刷新', logShowDenied: '看被拒记录', logShowAll: '看全部记录', loading: '读取中…',
    doctorTitle: '环境自检', doctorSub: '解释器、插件依赖、必填配置——有问题的直接给修复命令',
    doctorReload: '重新检查', doctorChecking: '检查中…', doctorFailed: (m) => `自检失败：${m}`,
    scopeRuns: '执行历史', scopeSearches: '搜索历史', scopeSaved: '结果快照', scopeTimers: '定时任务',
    profileDelConfirm: (n) => `删除配置档「${n}」？该档的外观/收藏/参数记忆将一并删除。`,
    backupExported: (n, b, f) => `已导出 ${n} 个键（${b} 字符）→ ${f}`,
    exportedDone: '已导出', watchCsvDone: (n) => `已导出 ${n} 次采样 CSV`,
    emptyNoMatchHint: '试试短一点的关键词（拼音也行）；或者 Esc 清空搜索回到全部。',
    emptyWhyNoMatch: '可能是词太具体，也可能这个能力还没装进来。',
    emptyWhyNoPlugins: '装上第一个插件，启动器就会开始认识你的电脑。',
    emptyHereBlank: '这里还空着',
    emptyNoMatchShort: '试试短一点的关键词。',
    clearSearchBrowse: '清空搜索，浏览全部动作',
    favDone: '已收藏（双击同款取消）',
    favBtnDone: '已收藏',
    favOn: (title) => `已收藏：${title}`,
    favOff: (title) => `已取消收藏：${title}`,
    scopeNoData: (label) => `${label}：没有数据`,
    scopeWiped: (label, n) => `✓ 已清除 ${label} ${n} 条`,
    scopeWipeConfirm: (label, n) => `清除「${label}」（共 ${n} 条）？此操作不可撤销。`,
    profileCreated: (name) => `已新建配置档「${name}」（以当前状态为基础）`,
    profileSwitched: (name) => `已切换到配置档「${name}」`,
    profileNewPrompt: '新配置档名字（以当前状态为基础）：',
    profileRenamePrompt: '重命名当前配置档为：',
    splitAt: (n) => `分栏 ${n}%`,
    splitReset: '分栏已复位',
    layoutLabel: (l) => `布局：${l}`,
    fontScaleLabel: (m) => `字号：${m}`,
    fontNames: { s: '小', m: '中', l: '大' },
    cmdWatch: '监控', cmdWatchHint: '监控面板 #/watch',
    cmdHelp: '帮助', cmdHelpHint: '使用指南 #/help',
    cmdStats: '统计', cmdStatsHint: '使用统计 #/stats',
    cmdLogs: '日志', cmdLogsHint: '审计日志 #/logs',
    cmdMarket: '集市', cmdMarketHint: '插件集市 #/market',
    cmdDoctor: '自检', cmdDoctorHint: '环境自检 #/doctor',
    cmdProfile: '配置档', cmdProfileHint: '切换配置档（打开外观面板）',
    cmdBackup: '备份', cmdBackupHint: '导出/导入个性化数据（打开外观面板）',
    cmdBatch: '批量', cmdBatchHint: '批量执行模式',
    cmdTheme: '外观', cmdThemeHint: '主题与外观设置（打开外观面板）',
    cmdBrief: '简报', cmdBriefHint: '今日简报 #/brief',
    cmdWorkbench: '工作台', cmdWorkbenchHint: 'AI 工作台',
    cmdMcp: 'MCP 配置', cmdMcpHint: '复制 mcpServers JSON 片段',
    cmdCtx: 'AI 上下文', cmdCtxHint: '打包最近执行与插件清单给 AI',
    cmdDrawer: '设置抽屉', cmdDrawerHint: '主题/语言/配置档/备份/日志/自检的统一入口',
    recentCmd: '最近用过', pluginLabel: '插件',
    batchHas: (n) => `批量篮里已有 ${n} 项，Alt+点击列表项继续加`,
    batchEmpty: '批量模式：按住 Alt 点击列表项加入批量篮',
    dataHead: '数据', exportData: '⬇ 导出数据', importData: '⬆ 导入数据', purgeData: '🧹 清除痕迹',
    exportTitle: '把所有个性化数据（收藏、历史、参数记忆、外观设置）打包成 JSON 下载',
    importTitle: '从备份 JSON 恢复：可预览、可选择类别、合并不覆盖',
    purgeTitle: '清除本地结果与运行历史（含参数记忆），审计日志不动',
    wipeHead: '分类清除', wipeRuns: '🕘 执行历史', wipeSearches: '🔍 搜索历史',
    wipeSaved: '💾 结果快照', wipeTimers: '⏲ 定时任务',
    wipeRunsTitle: '只清执行历史（localStorage zerokit.runs），收藏与设置不动',
    wipeSearchesTitle: '只清搜索历史', wipeSavedTitle: '只清保存的结果快照', wipeTimersTitle: '只清定时任务',
    profileHead: '配置档', profileNew: '＋ 新建', profileRename: '✏ 重命名', profileDel: '🗑 删除',
    profileSwitchTitle: '切换到此配置档', profileNewTitle: '以当前状态为基础新建配置档',
    profileRenameTitle: '重命名当前配置档', profileDelTitle: '删除当前配置档（至少保留一个）',
    // 第一百轮：设置抽屉四大区可见文案（i18n 体检首批迁移）
    themeHead: '主题', accentHead: '强调色', fontHead: '字体大小', aiHead: 'AI 辅助',
    themeSystem: '跟随系统', themeDark: '深色', themeLight: '浅色',
    fontS: '小', fontM: '中', fontL: '大',
    aiOn: '已开启', aiOff: '已关闭',
    aiToggleTitle: '关闭后隐藏所有 AI 相关按钮（给 AI / AI 上下文 / curl / MCP 配置）——本机不留 AI 使用痕迹于界面',
    langHead: '语言 Language',
  },
  en: {
    modeCommand: 'Commands', modePlugins: 'Plugins', modeMarket: 'Market', modeStats: 'Stats',
    modeBrief: 'Brief', modeWatch: 'Watch', modeHelp: 'Help', modeTimers: 'Timers',
    modeLogs: 'Logs', modeDoctor: 'Doctor', modePs: 'Running', modeWorkbench: 'Workbench',
    modeSaved: 'Saved', modeMcp: 'MCP', modeDetail: 'Detail', modeDash: 'Dashboard',
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
    statsTitle: 'Usage stats',
    statsEmpty: 'No runs yet',
    statsEmptyHint: 'Run any read-only action and this page starts growing',
    statsTotal: 'Total runs',
    statsOkRate: (ok, total) => `Success rate (${ok} succeeded)`,
    statsAvgMs: 'Avg duration',
    statsTop: 'Most active plugins',
    statsWhen: 'Time of day usage',
    statsMsDist: 'How long each run takes (ms distribution)',
    statsLast7: 'Last 7 days',
    statsRunsN: (n) => `${n} runs`,
    statsRunsFail: (n, pct) => `${n} runs (${pct}% failed)`,
    statsRunsShare: (n, pct) => `${n} runs (${pct}% of total)`,
    statsPrivacy: 'All from local run records — nothing is uploaded',
    statsBackupTitle: 'Preference backup',
    statsBackupWhat: 'favorites, notes, aliases, tags, hotkeys, theme',
    statsBackupHow: (k) => `Before switching machines or clearing browser data, export a JSON; import only accepts keys starting with zerokit${k}`,
    statsAllLocal: 'Everything lives in this machine\'s browser only',
    statsOpenPlugHome: 'Open plugin home',
    drawerLang: 'Language', drawerLogs: 'Logs', drawerDoctor: 'Doctor', drawerSaved: 'Saved',
    updateAvailablePre: 'New version ', updateAvailablePost: ' is available', updateLaterDone: 'Won\'t remind for 3 days', updateView: 'View', updateLaterBtn: 'Later', updateLaterTitle: 'Remind me in 3 days', updateDismissBtn: '✕', updateDismissTitle: 'Hide for this session',
    drawerImportSnap: 'Import snap', drawerTimers: 'Timers', drawerBrief: 'Brief', drawerWatch: 'Watch', drawerHelp: 'Help',
    drawerLangTitle: 'Switch language / 切换语言',
    drawerLogsTitle: 'Audit log: every run, denial and failure is recorded',
    drawerDoctorTitle: 'Environment check: interpreters, plugin deps, required config',
    drawerSavedTitle: 'Saved results: pin important outputs',
    drawerImportSnapTitle: 'Import a .zkresult snapshot: replay shared results',
    drawerTimersTitle: 'Scheduled tasks: auto-runs while the UI is open',
    drawerBriefTitle: 'Today brief: runs, pass/fail, most used',
    watchStarted: (label) => `Watch started: rerun every ${label} (see #/watch panel)`,
    watchStopped: 'Watch stopped',
    watchAutoFail: (n) => `Watch auto-stopped: ${n} consecutive failures`,
    watchAutoMatch: 'Watch auto-stopped: result matched the stop string',
    watchAlertTitle: 'zerokit watch alert',
    watchNotifyTitle: 'zerokit watch',
    riskTip: (n, r, m, d) => `${n} actions: ${r} read, ${m} mutating, ${d} high-risk (click row to fold)`,
    missingDeps: 'missing deps',
    sortNoteRecent: 'Sorted by recent use (press m for plugin order)',
    recentHead: 'Recent runs',
    recentSearchLabel: 'Recent searches',
    filterLabels: { all: 'All', fav: 'Favorites', 'has-params': 'With params', 'no-params': 'No params', read: 'Read', mutate: 'Mutating', destructive: 'High risk' },
    sugMarket: (q) => 'Find a plugin for this in the market',
    sugAskAi: (q) => `Ask the AI workbench: "${q}"`,
    sugTryThese: 'Try these (all read-only, safe):',
    emptyNoMatchTitle: (q) => `No actions matching "${q || ''}"`,
    logAll: 'All', logAllow: 'Allowed', logDeny: 'Denied', logError: 'Failed', logToday: 'Today',
    drawerHelp: 'Usage guide',
    memBrought: 'Last params filled in', memForget: 'Forget',
    previewTip: 'Preview the exact command line (secrets masked) before running', previewCmd: 'Preview',
    batchSelected: (n) => `${n} selected`, batchDups: (n) => `${n} dup`,
    moreTip: 'More actions: invoke / config / share / timers / watch / result tools', more: 'More',
    invokeWays: 'Three ways to invoke',
    whyHit: 'hit', whyNick: 'nickname', whyActionId: 'action ID', whyTitle: 'action name', whyPluginAction: 'plugin.action', whyPinyin: 'pinyin', whyTags: 'tags',
    chainSteps: (n) => `chain of ${n} steps`, smartMatch: 'smart match', looksLike: (v) => `content looks like ${v} — ready to use`,
    sumOf: 'subtotal', avgLabel: 'avg', tfootSum: (sum, avg) => `sum ${sum} · avg ${avg}`,
    rowsWindowed: (shown, total, page) => `${shown} / ${total} rows (big table renders first ${page} rows for smoothness)`,
    loadAllRows: (n) => `Load all ${n} rows`, rowsTotal: (n) => `${n} rows in total`, rowsFiltered: (n, total) => `${n} / ${total} rows (filtered)`,
    copiedCol: (col, dedup, n) => `Column "${col}" copied (${n} rows${dedup ? ', deduped' : ''})`,
    ctxCopyCell: 'Copy cell', ctxCopyRow: 'Copy row', ctxCopyTable: 'Copy whole table (TSV)', ctxFilterEq: (col, v) => `Only show "${col} = ${v}"`,
    cellUnit: 'cell', rowUnit: 'row', tableUnit: 'table', copiedWhat: (what) => `${what} copied`, copyDenied: 'Copy rejected by browser',
    sortBy: 'Sort:', sortName: 'Name', sortActions: 'Actions', sortInstalled: 'Recently installed',
    watchDlgTitle: (name) => `Watch "${name}"`, watchDlgHelp: 'Runs only while the UI is open. Each sample is recorded, changes get highlighted; see the #/watch panel.',
    watchRerunEvery: 'Rerun interval', watchFailLabel: 'Auto-stop after N consecutive failures (0 = never)', watchMatchLabel: 'Auto-stop when result contains this string (empty = off)',
    watchMatchPh: 'e.g. error / 90%', watchStartBtn: 'Start watching', cancel: 'Cancel',
    importDone: (applied, skipped) => `Import done: ${applied} applied, ${skipped} skipped, refreshing…`,
    cmpDiffCount: (n) => `${n} differences found`, cmpNoKeys: 'No comparable keys between the two',
    timerDlgTitle: (name) => `Scheduled run: ${name}`, timerDlgHelp: 'Runs only while the UI is open. Read-only actions only — auto-running side effects is too risky.',
    timerSecLabel: 'Interval (seconds)', timerPresets: 'Quick presets', timerWinLabel: 'Run window (optional, e.g. 09:00-18:00; skipped outside)',
    timerUseVals: 'Use current form values as scheduled params', timerSaveBtn: (upd) => `${upd ? 'Update' : 'Start'} schedule`,
    timerMinSec: 'Interval must be at least 10 seconds', timerWinBad: 'Window format should be HH:MM-HH:MM',
    whyLabelPrefix: 'matched: ',
            fbCopied: '✓ Copied',
    fbCopyFail: 'Copy failed',
    fbCopyPlain: 'Copy',
    fbCopiedPlain: 'Copied',
    fbCopiedNote: 'Copied (with note)',
    fbCopiedIndent: 'Copied (indented)',
    fbCopyMcp: 'Copy mcpServers',
    fbCopiedLink: 'Link copied',
    fbShare: 'Share',
    fbSerializing: 'Serializing…',
    fbSaving: 'Saving…',
    fbSaved: '✓ Saved — effective on next run',
    fbSaveFail: 'Save failed: ',
    fbExported: 'Exported',
    fbExportMd: 'Export Markdown',
    fbSnapshotDone: 'Snapshot exported (.zkresult.json)',
    fbOpening: 'Opening…',
    fbOpened: 'Opened',
    fbOpenFail: 'Cannot open editor: ',
    fbOpenedAt: 'Opened in editor: ',
    fbFailed: 'Failed',
    fbChecking: 'Checking…',
    fbFold: 'Expand',
    fbCollapse: 'Collapse',
    fbNoHits: 'No hits',
    fbHits: ' hits',
    fbTimerReadOnly: 'Only read-only actions can be scheduled (auto-running side effects is too risky)',
    fbWatchReadOnly: 'Only read-only actions can be watched (auto-running side effects is too risky)',
    fbShareNoResult: 'Run it once before sharing — there is no result yet',
    fbShareCardDone: 'Share card copied to clipboard',
    fbShareCardFallback: 'Copy denied; stashed (',
    fbCopyNoHttps: 'Copy failed (non-HTTPS context)',
    fbNeedPluginId: 'Plugin id required',
    tlSplitterTip: 'Drag to resize the split (double-click to reset)',
    tlPeekLast: 'View last result',
    tlEye: 'Show/hide plaintext',
    tlHkBtn: 'Bind one of F1–F12 to this action — press it anywhere to open',
    tlWmd: 'Export samples as a Markdown trend table (time/value/change) — paste to AI or docs',
    tlWriteBack: 'Write back to clipboard',
    tlDelItem: 'Delete this entry',
    psTimeline: 'Timeline',
    psBrief: 'Today',
    psWatch: 'Watch Panel',
    sugDropTitle: 'Drop a word and try again:',
    rsFailBadge: '✗ failed', rsActionFail: 'Action failed',
    bsOk: 'ok', bsFail: 'failed', bsSkip: 'skipped',
helpTry: 'Try it', helpTitle: 'User Guide', helpIntro: 'What the launcher can do and how to get started — all on this page. Every section has a direct try-it link.', helpTryTip: 'Jump to this feature and try it',
helpSearchTitle: 'Search', helpSearchBody: 'Chinese keywords, full pinyin, or pinyin initials all work. Type "dl" for the proxy, "xtxx" for system info. Space-separated terms are AND-ed. Numbers pick the Nth result directly.',
    helpRunTitle: 'Run & results', helpRunBody: 'Read-only actions run instantly; mutating/high-risk ones ask first. Results can be copied, downloaded, re-run; tables support sorting, filtering, column visibility, unit conversion, merged views and cell-level diffs.',
    helpWatchTitle: 'Watch', helpWatchBody: 'Read-only actions can auto-rerun on an interval: a countdown ring shows the next sample, changed cells highlight yellow, numeric fields get mini trend lines; auto-stop on failures or a matched string. The #/watch panel aggregates everything and exports CSV.',
    helpProfilesTitle: 'Profiles', helpProfilesBody: 'The appearance panel hosts multiple profiles (work/personal…): theme, favorites and param memory switch with the profile, run history is global. Create from current state in one click; rename/delete are guarded.',
    helpBackupTitle: 'Backup', helpBackupBody: 'The "Data" group in the appearance panel exports all personalization as JSON (predictable filename); import has format validation, grouped preview, per-category checkboxes, and merges without overwriting local-only data.',
    helpSafetyTitle: 'Safety', helpSafetyBody: 'Dangerous parameter values (rm -rf /, system dirs, raw dd) trigger a yellow warning; rapid re-clicks within 3s ask for confirmation; tokens in results and logs are masked by default; the action page shows a risk bar and failure rate.',
    scResultNav: 'Move up/down in results', scOpenRun: 'Open action / run', scConfirmRun: 'Confirm & run (mutating) and remember', scEsc: 'Go back one level / clear search',
    scAi: 'Switch to AI workbench (type ? at the start of the search box)', scCheat: 'Open this shortcut cheat sheet', scFocus: 'Focus the search box',
    khResultNav: 'Move between results (roving focus follows)', khPage: 'Page jump (long lists jump by viewport)', khHomeEnd: 'Jump to first / last',
    khQuickPick: 'Quick-pick the Nth (Enter to open)', khDirectOpen: 'Directly open the Nth', khOpen: 'Open the selected item', khOpenRun: 'Open and run directly',
    khEsc: 'Clear search / close overlays layer by layer', khFav: 'Favorite / unfavorite the current item', khTag: 'Tag the current item (number keys pick existing tags)',
    khCopyExport: 'Result area: copy / export', khShow: 'Show this key table', khPalette: 'Command palette', khCheat: 'Shortcut cheat sheet',
    khTheme: 'Toggle dark / light', khBasket: 'Put the action into the batch basket', khBasketMove: 'Move items inside the batch basket',
    drawerImportSnapTitle: 'Import a .zkresult snapshot: replay a shared result', footerSavedTitle: 'Saved results: pin important outputs (#/saved)', shortcutsTitle: 'Open the shortcut cheat sheet (Ctrl + /)', defaultProfileName: 'Default',
    emptyParen: 'empty', histDelTip: 'Remove this search entry', clearAll: 'Clear',
    invokeTip: 'How to call this action from CLI / MCP / deep links', invoke: 'Invoke',
    cfgTip: 'Long-lived plugin settings (endpoints, keys); effective immediately', cfgPlugin: 'Plugin settings',
    qrTip: 'QR code of the deep link; scan on phone to jump here', qr: 'QR code',
    shareLinkTip: 'Copy the full deep link with current params', shareLink: 'Share link',
    timerTip: 'Auto-run a read-only action on an interval (UI must stay open)', timer: 'Timer',
    watchTip: 'Watch mode: auto rerun + change tracking + countdown ring (#/watch)', watch: 'Watch',
    maskTip: 'Tokens/keys/long hex in results are masked by default — toggle to reveal', maskToggle: 'Unmask',
    purgeTip: 'Clear current result and local run history (incl. param memory); audit log untouched', purge: 'Purge traces',
    shareCardTip: 'Generate a summary card of this result (copied to clipboard)', shareCard: 'Share card',
    picked2: (n) => `${n}/2 picked`, pickedN: (n) => `${n} picked`, recentTrendN: (n) => `trend of last ${n}`,
    batchRunLabel: (n) => `Run the ${n} actions in the basket sequentially`, batchRunSeq: 'Run all',
    batchDedupLabel: 'Drop duplicates with same action and params', batchDedupBtn: 'Dedup',
    batchExportLabel: 'Export basket list as JSON', batchExportBtn: 'Export list',
    batchImportLabel: 'Import basket list from JSON', batchImportBtn: 'Import',
    batchConc: 'Concurrency', batchClearLabel: 'Clear the basket', batchClearBtn: 'Clear',
    batchDestructiveLast: 'destructive runs last', moveUp: 'Move up', moveDown: 'Move down',
    removeFromBasket: 'Remove from basket', paren: (v) => ` (concurrency ${v})`,
    batchRetryDone: 'Failed-item rerun done', batchAllDone: 'Batch run done',
    watching: 'Watching', watchEvery: (iv, runs, chg) => `every ${iv} · ${runs} samples · ${chg} changes`,
    nextRunIn: 'Countdown to next run', stop: 'Stop',
    copyJsonTip: 'Copy the action definition JSON (for docs / sharing)', copyJson: 'Copy JSON',
    resetTip: 'Reset all params to manifest defaults', resetDefaults: 'Reset',
    foldToggle: 'Click to fold / unfold the result', foldUp: 'Fold',
    copyResTip: 'Copy result; Shift = pretty JSON; Alt = with note & time', copy: 'Copy',
    snapTip: 'Export a .zkresult snapshot (with metadata; others can import & replay)', snapshot: 'Snapshot',
    saveTip: 'Save the result as a text file', download: 'Download',
    mdTip: 'Export as Markdown (table/code block) for docs or issues', exportMd: 'Export MD',
    shareMdTip: 'Export a self-contained share Markdown (with collapsible header)', shareMd: 'Share MD',
    shareHtmlTip: 'Export a self-contained share HTML (inline styles, no external links)', shareHtml: 'Share HTML',
    shareCopyTip: 'Copy share text (Markdown with metadata header; truncated past 50KB)', shareCopy: 'Copy share',
    csvTip: 'Export as CSV for Excel / Numbers', exportCsv: 'Export CSV',
    jsonTip: 'Export as JSON for scripts', exportJson: 'Export JSON',
    jsonlTip: 'Export JSONL (one JSON per line; jq / ndjson friendly)', exportJsonl: 'Export JSONL',
    llmTip: 'Export LLM batch JSONL ({input,expected} per line; add expected to make an eval set)', llmJsonl: 'LLM JSONL',
    mdTableTip: 'Copy as a Markdown table (numeric columns right-aligned)', copyMdTable: 'Copy MD table',
    tsvTip: 'Copy as TSV (paste straight into Excel/Numbers)', copyTsv: 'Copy TSV',
    htmlTip: 'Copy as an HTML table (formatted in email/docs)', copyHtmlTable: 'Copy HTML table',
    aiTip: 'Copy LLM-friendly Markdown (table/attrs + action + time) — paste into AI chat', forAi: 'For AI',
    ctxTip: 'Bundle result + recent runs + plugin list as context for AI', aiContext: 'AI context',
    termTip: 'Terminal view: monospace, auto-scroll (w=wrap t=top b=bottom)', terminal: 'Terminal',
    editTip: 'Open result text in an external editor (ZEROKIT_EDITOR, else system default)', openEditor: 'In editor',
    againTip: 'Run again with the same params', runAgain: 'Run again',
    pinTip: 'Pin this result to favorites (#/saved); survives restart', pin: 'Pin',
    noteTip: 'Write a short note for this run (stored locally)', note: 'Note',
    openDirTip: 'Open the export folder in the system file manager', openDir: 'Open folder',
    findInRes: 'Find in result… (live highlight, Enter for next)',
    deniedHint: 'Next time, use Preview to see the exact command before running.',
    whyHit: 'Why it matched', whySignal: 'Signal', whyScore: 'Score', whyWeight: 'Weight',
    aliasHelp: 'Type this short name in search and Enter jumps here',
    nicknameHelp: 'Search hits it first; shown next to the original name in the list',
    tagsHelp: '#tags are searchable and shown in the list',
    runOk: 'ok', runFail: 'failed', minsAgo: (n) => `${n} min ago`,
    rerunTitle: 'Run again with last params', rerun: 'Rerun',
    coOccur: (n) => `Co-occurred ${n} times`, coOccurHint: '(co-occurrence ≥ 2)',
    trendTip: (n, f, avg, best, worst) => `Last ${n} runs of ${f}: avg ${avg} · best ${best} · worst ${worst}`,
    trendN: (n, avg) => `(${n} runs, avg ${avg})`,
    durTip: (mn, p50, p95, mx) => `Duration: min ${mn} · P50 ${p50} · P95 ${p95} · max ${mx}`,
    failWarn: (total, fails, pct) => `⚠ ${fails} of last ${total} runs failed (${pct}%) — this action is shaky lately; check the error-class card for advice`,
    cmpLastTip: 'Compare current result with the previous one', cmpLast: 'Compare last',
    sparkTip: (n, mx) => `Duration trend of last ${n} runs (max ${mx})`,
    histFillTip: 'Click to fill this history value',
    chainDry: 'Dry-run (no execution; previews each step shape)',
    chainSrc: (ref) => `Input from: ${ref}`,
    unfav: 'Unfavorite', fav: 'Favorite this action',
    chainN: (n) => `Chain of ${n} steps`, noDesc: '(no description)',
    logTrimmed: (n) => `Auto-cleaned ${n} expired log entries (>90 days; disable in config.toml)`,
    logsTitle: 'Audit log', logsSub: 'Every run, denial and failure lands here; local-only at ~/.zerokit/logs/',
    logFilterPh: 'Filter: plugin / action / error (numeric compare like ms>100 works)',
    logCsvTitle: 'Export current filter as CSV (time/plugin/action/decision/duration/exit code)',
    logReload: 'Reload', logShowDenied: 'Show denied', logShowAll: 'Show all', loading: 'Loading…',
    doctorTitle: 'Doctor', doctorSub: 'Interpreters, plugin deps, required settings — with fix commands when broken',
    doctorReload: 'Re-check', doctorChecking: 'Checking…', doctorFailed: (m) => `Doctor failed: ${m}`,
    scopeRuns: 'Run history', scopeSearches: 'Search history', scopeSaved: 'Saved results', scopeTimers: 'Timers',
    profileDelConfirm: (n) => `Delete profile "${n}"? Its appearance, favorites and remembered params will be removed too.`,
    backupExported: (n, b, f) => `Exported ${n} keys (${b} chars) → ${f}`,
    exportedDone: 'Exported', watchCsvDone: (n) => `Exported ${n} samples as CSV`,
    emptyNoMatchHint: 'Try a shorter keyword (pinyin works too), or press Esc to clear and browse all.',
    emptyWhyNoMatch: 'The keyword may be too specific, or this capability is not installed yet.',
    emptyWhyNoPlugins: 'Install your first plugin and the launcher starts learning your machine.',
    emptyHereBlank: 'Nothing here yet',
    emptyNoMatchShort: 'Try a shorter keyword.',
    clearSearchBrowse: 'Clear search and browse all actions',
    favDone: 'Favorited (double-tap again to undo)',
    favBtnDone: 'Favorited',
    favOn: (title) => `Favorited: ${title}`,
    favOff: (title) => `Unfavorited: ${title}`,
    scopeNoData: (label) => `${label}: no data`,
    scopeWiped: (label, n) => `✓ Cleared ${label} (${n} entries)`,
    scopeWipeConfirm: (label, n) => `Clear "${label}" (${n} entries)? This cannot be undone.`,
    profileCreated: (name) => `Profile "${name}" created (based on current state)`,
    profileSwitched: (name) => `Switched to profile "${name}"`,
    profileNewPrompt: 'New profile name (based on current state):',
    profileRenamePrompt: 'Rename current profile to:',
    splitAt: (n) => `Split at ${n}%`,
    splitReset: 'Split reset',
    layoutLabel: (l) => `Layout: ${l}`,
    fontScaleLabel: (m) => `Font size: ${m}`,
    fontNames: { s: 'S', m: 'M', l: 'L' },
    cmdWatch: 'Watch', cmdWatchHint: 'Watch panel #/watch',
    cmdHelp: 'Help', cmdHelpHint: 'User guide #/help',
    cmdStats: 'Stats', cmdStatsHint: 'Usage stats #/stats',
    cmdLogs: 'Logs', cmdLogsHint: 'Audit log #/logs',
    cmdMarket: 'Market', cmdMarketHint: 'Plugin market #/market',
    cmdDoctor: 'Doctor', cmdDoctorHint: 'Environment check #/doctor',
    cmdProfile: 'Profiles', cmdProfileHint: 'Switch profile (opens settings panel)',
    cmdBackup: 'Backup', cmdBackupHint: 'Export/import personalization (opens settings panel)',
    cmdBatch: 'Batch', cmdBatchHint: 'Batch run mode',
    cmdTheme: 'Theme', cmdThemeHint: 'Theme & appearance (opens settings panel)',
    cmdBrief: 'Brief', cmdBriefHint: 'Today brief #/brief',
    cmdWorkbench: 'Workbench', cmdWorkbenchHint: 'AI workbench',
    cmdMcp: 'MCP config', cmdMcpHint: 'Copy mcpServers JSON snippet',
    cmdCtx: 'AI context', cmdCtxHint: 'Pack recent runs & plugin list for AI',
    cmdDrawer: 'Settings', cmdDrawerHint: 'Unified entry: theme/lang/profiles/backup/logs/doctor',
    recentCmd: 'Recent', pluginLabel: 'plugin',
    batchHas: (n) => `Batch has ${n} items — Alt+click list items to add more`,
    batchEmpty: 'Batch mode: Alt+click list items to add to the batch',
    dataHead: 'Data', exportData: '⬇ Export', importData: '⬆ Import', purgeData: '🧹 Purge',
    exportTitle: 'Download all personalization data (favorites, history, params, appearance) as JSON',
    importTitle: 'Restore from a backup JSON: preview, pick categories, merge without overwriting',
    purgeTitle: 'Clear local results and run history (params included); audit log untouched',
    wipeHead: 'Scoped wipe', wipeRuns: '🕘 Run history', wipeSearches: '🔍 Searches',
    wipeSaved: '💾 Snapshots', wipeTimers: '⏲ Timers',
    wipeRunsTitle: 'Clear run history only (zerokit.runs); favorites and settings untouched',
    wipeSearchesTitle: 'Clear search history only', wipeSavedTitle: 'Clear saved result snapshots only', wipeTimersTitle: 'Clear timers only',
    profileHead: 'Profiles', profileNew: '＋ New', profileRename: '✏ Rename', profileDel: '🗑 Delete',
    profileSwitchTitle: 'Switch to this profile', profileNewTitle: 'Create a new profile from current state',
    profileRenameTitle: 'Rename current profile', profileDelTitle: 'Delete current profile (at least one remains)',
    themeHead: 'Theme', accentHead: 'Accent', fontHead: 'Font size', aiHead: 'AI assist',
    themeSystem: 'System', themeDark: 'Dark', themeLight: 'Light',
    fontS: 'S', fontM: 'M', fontL: 'L',
    aiOn: 'On', aiOff: 'Off',
    aiToggleTitle: 'Hide all AI-related buttons when off — no AI traces left in the UI',
    langHead: '语言 Language',
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
  // 第九十六轮⑧：布局键也进备份（外观与设置组）
  { prefix: 'zerokit.layout.', label: '外观与设置' },
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
    titleKey: 'helpSearchTitle',
    bodyKey: 'helpSearchBody',
    tryHash: '#/',
  },
  {
    id: 'run',
    titleKey: 'helpRunTitle',
    bodyKey: 'helpRunBody',
    tryHash: '#/sysinfo/overview',
  },
  {
    id: 'watch',
    titleKey: 'helpWatchTitle',
    bodyKey: 'helpWatchBody',
    tryHash: '#/watch',
  },
  {
    id: 'profiles',
    titleKey: 'helpProfilesTitle',
    bodyKey: 'helpProfilesBody',
    tryHash: '#/',
  },
  {
    id: 'backup',
    titleKey: 'helpBackupTitle',
    bodyKey: 'helpBackupBody',
    tryHash: '#/',
  },
  {
    id: 'safety',
    titleKey: 'helpSafetyTitle',
    bodyKey: 'helpSafetyBody',
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
// 第一百零一轮：name/hint 走 I18N（cmdWatch 等键），匹配与历史记录用稳定 id——
// 切语言后 cmdhist 里存的旧中文名仍能命中（fallback 按 name 匹配保留）。
export const COMMAND_LIST = [
  { id: 'cmdWatch', icon: '⏱', nameKey: 'cmdWatch', hintKey: 'cmdWatchHint', go: '#/watch' },
  { id: 'cmdHelp', icon: '?', nameKey: 'cmdHelp', hintKey: 'cmdHelpHint', go: '#/help' },
  { id: 'cmdStats', icon: '📈', nameKey: 'cmdStats', hintKey: 'cmdStatsHint', go: '#/stats' },
  { id: 'cmdLogs', icon: '▤', nameKey: 'cmdLogs', hintKey: 'cmdLogsHint', go: '#/logs' },
  { id: 'cmdMarket', icon: '🛍', nameKey: 'cmdMarket', hintKey: 'cmdMarketHint', go: '#/market' },
  { id: 'cmdDoctor', icon: '✓', nameKey: 'cmdDoctor', hintKey: 'cmdDoctorHint', go: '#/doctor' },
  { id: 'cmdProfile', icon: '🗂', nameKey: 'cmdProfile', hintKey: 'cmdProfileHint', go: 'theme' },
  { id: 'cmdBackup', icon: '💾', nameKey: 'cmdBackup', hintKey: 'cmdBackupHint', go: 'theme' },
  { id: 'cmdBatch', icon: '⧉', nameKey: 'cmdBatch', hintKey: 'cmdBatchHint', go: 'batch' },
  { id: 'cmdTheme', icon: '◐', nameKey: 'cmdTheme', hintKey: 'cmdThemeHint', go: 'theme' },
  { id: 'cmdBrief', icon: '📰', nameKey: 'cmdBrief', hintKey: 'cmdBriefHint', go: '#/brief' },
  { id: 'cmdWorkbench', icon: '⌘', nameKey: 'cmdWorkbench', hintKey: 'cmdWorkbenchHint', go: 'workbench' },
  { id: 'cmdMcp', icon: '🤖', nameKey: 'cmdMcp', hintKey: 'cmdMcpHint', go: 'copy-mcp' },
  { id: 'cmdCtx', icon: '🧠', nameKey: 'cmdCtx', hintKey: 'cmdCtxHint', go: 'copy-ctx' },
  // 第四十七轮④：抽屉里的管理入口也在面板可达（键盘用户不必找 ☰）
  { id: 'cmdDrawer', icon: '☰', nameKey: 'cmdDrawer', hintKey: 'cmdDrawerHint', go: 'drawer' },
];

// ---------------- 第八十五轮：命令面板分组与快捷键提示 ----------------

/**
 * 给命令条目分组：page=页面路由 / op=常用操作 / null=动作与插件（不分组平铺）。
 * 输入为空时用分组头分段展示；非空输入打分混排（分组头反而碍事）。
 */
export function paletteGroup(cmd) {
  if (cmd.group === 'page') return '页面';
  if (cmd.group === 'op') return '操作';
  return null;
}

/**
 * 渲染前的排序：最近使用过的命令（cmdhist，新的在前）排到同组最前。
 * hist 是命令名数组（如 ['日志', '监控']）。
 */
export function boostRecent(items, hist) {
  const rank = new Map(hist.map((h, i) => [h, i]));
  return [...items].sort((a, b) => {
    const ra = rank.has(a.label) ? rank.get(a.label) : Infinity;
    const rb = rank.has(b.label) ? rank.get(b.label) : Infinity;
    return ra - rb;
  });
}

/**
 * Tab 补全：输入是列表中某条目的唯一前缀时返回补全后的文本，否则 null。
 * 匹配用 label 去掉可能的 '> ' 命令前缀。
 */
export function tabComplete(query, labels) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const hits = labels.filter((l) => l.toLowerCase().startsWith(q));
  return hits.length === 1 ? hits[0] : null;
}

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
export function whyLabel(why, T) {
  const labels = (why ?? []).map((r) => r[0]).filter(Boolean);
  if (!labels.length) return '';
  const uniq = [...new Set(labels)];
  const prefix = T?.whyLabelPrefix ?? '命中：';
  return `${prefix}${uniq.join('·')}`;
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
export function emptyState(kind, q, ttIn) {
  if (kind === 'first-run') return {
    title: '先装几个插件',
    hint: '插件是能力包。点右上「集市」浏览，或终端跑 plugin bundled 装自带的示例。',
    art: 'box',   // 第五十九轮⑨：空态插画类型（CSS 画）
  };
  if (kind === 'no-plugins') return {
    title: '一个插件都没有',
    hint: '终端跑 plugin bundled 装自带示例，或去集市找。装完这里就有动作了。',
    art: 'box',
  };
  // no-match（第一百零一轮：tt=t 注入，键文案走 I18N；不传则退中文——纯函数单测兼容）
  const tt = ttIn ?? I18N.zh;
  return {
    title: (tt.emptyNoMatchTitle ?? I18N.zh.emptyNoMatchTitle)(q),
    hint: tt.emptyNoMatchHint ?? I18N.zh.emptyNoMatchHint,
    art: 'search',
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
  { kind: 'timeout', test: /timed? ?out|ETIMEDOUT|超时/i },
  { kind: 'not-found', test: /ENOENT|no such file|找不到文件/i },
  { kind: 'permission', test: /permission denied|EACCES|EPERM/i },
  { kind: 'not-executable', test: /ENOEXEC|not executable|不是可执行文件/i },
  { kind: 'command-not-found', test: /command not found|is not recognized as|无法将.+识别为/i },
  { kind: 'exit-nonzero', test: /exit(ed)? (with )?(code )?[1-9]\d*/i },
  { kind: 'parse-fail', test: /JSON|parse|解析/i },
];

/**
 * 错误知识库文案表（第一百零八轮双语化）：kind → {title, steps}。
 * T 传 I18N[pickLang(lang)] 形态的语言表；缺键回退 zh。
 */
export const ERROR_BOOK_TEXT = {
  zh: {
    timeout: { title: '执行超时', steps: ['等一会再试；插件清单里可用 timeout 声明更长超时', '网络类动作先确认代理环境变量'] },
    'not-found': { title: '文件或目录不存在', steps: ['检查路径拼写；插件的工作目录是它自己的安装目录', '辅助文件路径写进清单 cwd 或参数'] },
    permission: { title: '没有权限', steps: ['chmod +x <脚本>（Windows：icacls）', '确认 ~/.zerokit 归当前用户'] },
    'not-executable': { title: '文件在但跑不起来', steps: ['脚本缺执行位：chmod +x', '跨平台插件用 {python} 或自带 .bat'] },
    'command-not-found': { title: '依赖的程序没装', steps: ['zkit doctor 列出各插件缺的运行时', '装完重跑 doctor 确认'] },
    'exit-nonzero': { title: '程序报错退出（非零退出码）', steps: ['看下方原始输出定位报错行', '同参数重试一次排除偶发'] },
    'parse-fail': { title: '输出解析失败', steps: ['插件声明了 output="json" 但实际没吐合法 JSON', '用 zkit run --out json 看原始 stdout'] },
    unknown: { title: '执行失败', steps: ['看下方原始输出；重试一次排除偶发', '反复失败用 zkit doctor 自检'] },
  },
  en: {
    timeout: { title: 'Timed out', steps: ['Wait a moment and retry; declare a longer timeout in the plugin manifest if needed', 'For network actions check proxy environment variables first'] },
    'not-found': { title: 'File or directory not found', steps: ['Check the path spelling; a plugin working directory is its own install directory', 'Put auxiliary file paths in the manifest cwd or params'] },
    permission: { title: 'Permission denied', steps: ['chmod +x <script> (Windows: icacls)', 'Make sure ~/.zerokit belongs to the current user'] },
    'not-executable': { title: 'File exists but cannot run', steps: ['Script missing the execute bit: chmod +x', 'Cross-platform plugins should use {python} or ship a .bat'] },
    'command-not-found': { title: 'Required program not installed', steps: ['zkit doctor lists missing runtimes per plugin', 'Re-run doctor after installing to confirm'] },
    'exit-nonzero': { title: 'Program exited with an error (non-zero exit code)', steps: ['Look at the raw output below to locate the failing line', 'Retry once with the same params to rule out a flake'] },
    'parse-fail': { title: 'Output parse failure', steps: ['The plugin declared output="json" but did not produce valid JSON', 'Use zkit run --out json to see raw stdout'] },
    unknown: { title: 'Run failed', steps: ['Check the raw output below; retry once to rule out a flake', 'Repeated failures: run zkit doctor'] },
  },
};

/** ①把错误文本（stderr/error message）映射到知识库条目；认不出给通用兜底。 */
export function classifyError(text, T) {
  const raw = String(text ?? '');
  const table = (T && ERROR_BOOK_TEXT.en === T) ? ERROR_BOOK_TEXT.en : ERROR_BOOK_TEXT.zh;
  for (const e of ERROR_BOOK) {
    if (e.test.test(raw)) {
      const x = table[e.kind] ?? ERROR_BOOK_TEXT.zh[e.kind];
      return { kind: e.kind, title: x.title, steps: x.steps };
    }
  }
  const u = table.unknown ?? ERROR_BOOK_TEXT.zh.unknown;
  return { kind: 'unknown', title: u.title, steps: u.steps };
}

/**
 * ④⑤一键报错文本：分类标题 + 命令 + 环境三行 + stderr 全文（围栏包裹）。
 * 贴 issue 一发入魂——报错可搜索、环境不用追问。
 */
export function errorReport(kind, title, command, errorText, env = {}) {
  const fence = '```';
  const lines = [];
  lines.push(`# zerokit failed: ${title} (${kind})`);
  if (command) lines.push(`Command: ${command}`);
  if (env && Object.keys(env).length) lines.push(`Env: ${env.platform ?? '?'} · Node ${env.node ?? '?'} · zerokit ${env.version ?? '?'}`);
  lines.push('');
  lines.push(fence);
  lines.push(String(errorText ?? '').trim() || '(no stderr)');
  lines.push(fence);
  return lines.join('\n');
}

/** ⑤批量执行汇总行：成功 N / 失败 M / 未跑 K（K=planned-已跑数；缺省无未跑段）。 */
export function batchSummary(done, planned, T) {
  const ok = done.filter((d) => d.ok).length;
  const bad = done.length - ok;
  const skipped = planned !== undefined ? Math.max(0, planned - done.length) : 0;
  const parts = [`✓ ${(T && T.bsOk) || '成功'} ${ok}`];
  if (bad) parts.push(`✗ ${(T && T.bsFail) || '失败'} ${bad}`);
  if (skipped) parts.push(`∅ ${(T && T.bsSkip) || '未跑'} ${skipped}`);
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
    { key: '↑ ↓', whatKey: 'khResultNav' },
    { key: 'PgUp / PgDn', whatKey: 'khPage' },
    { key: 'Home / End', whatKey: 'khHomeEnd' },
    { key: '1–9', whatKey: 'khQuickPick' },
    { key: 'Alt+1–9', whatKey: 'khDirectOpen' },
    { key: 'Enter', whatKey: 'khOpen' },
    { key: 'Ctrl+Enter', whatKey: 'khOpenRun' },
    { key: 'Esc', whatKey: 'khEsc' },
    { key: 'F', whatKey: 'khFav' },
    { key: 'T', whatKey: 'khTag' },
    { key: 'Y / E', whatKey: 'khCopyExport' },
    { key: '?', whatKey: 'khShow' },
    { key: 'Ctrl+P / Ctrl+K', whatKey: 'khPalette' },
    { key: 'Ctrl+/', whatKey: 'khCheat' },
    { key: 'Ctrl+Shift+D', whatKey: 'khTheme' },
    { key: 'Alt+点击', whatKey: 'khBasket' },
    { key: 'Alt+↑ / Alt+↓', whatKey: 'khBasketMove' },
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

// ============================================================
// 第六十四轮：剪贴板工作流——内容识别、历史留痕、动作推荐
// ============================================================

/** 识别剪贴板文本类型（纯函数，不碰 navigator）。返回 kind + 置信依据。 */
export function classifyClip(text) {
  const s = (text ?? '').trim();
  if (!s) return { kind: 'empty', why: '空' };
  // 纯 10 位数字（秒级 ts）或 13 位（毫秒级）
  if (/^\d{10}$/.test(s)) return { kind: 'ts', why: '10 位数字（Unix 秒）' };
  if (/^\d{13}$/.test(s)) return { kind: 'ts', why: '13 位数字（Unix 毫秒）' };
  // URL（http/https）
  if (/^https?:\/\/\S+$/i.test(s)) return { kind: 'url', why: '以 http(s):// 开头' };
  // IP（v4）
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s)) {
    const ok = s.split('.').every((p) => Number(p) <= 255);
    if (ok) return { kind: 'ip', why: '点分四段且每段 ≤255' };
  }
  // JSON（对象或数组开头结尾配对 + 能被 parse）
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try { JSON.parse(s); return { kind: 'json', why: '合法 JSON' }; } catch { /* 不是 */ }
  }
  // 文件路径（POSIX 绝对 / Windows 盘符 / ~/ 开头）
  if (/^(\/|\.{1,2}\/|~\/|[A-Za-z]:[\\/])\S+/.test(s) && !s.includes('\n')) {
    return { kind: 'path', why: '以 / ~/ 盘符开头且无换行' };
  }
  // Base64（≥16 字符、合法字符集、长度 4 的倍数；排除纯十六进制误报）
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length >= 16 && s.length % 4 === 0 && !/^[0-9a-f]+$/i.test(s)) {
    return { kind: 'base64', why: 'Base64 字符集且长度对齐' };
  }
  // 纯数字（非 ts 长度）
  if (/^\d+(\.\d+)?$/.test(s)) return { kind: 'number', why: '纯数字' };
  return { kind: 'text', why: '普通文本' };
}

/** 剪贴板历史去重入库：同内容只留最新（时间戳更新、挪到队首）。上限 max 条。 */
export function pushClipHistory(list, text, now = Date.now(), max = 20) {
  const t = String(text ?? '');
  if (!t.trim()) return list;
  const rest = list.filter((x) => x.text !== t);
  const item = { text: t.length > 500 ? t.slice(0, 500) : t, full: t.length, at: now };
  return [item, ...rest].slice(0, max);
}

/** 识别结果 → 推荐动作（actionKey 列表；命中不到给空数组，UI 自己兜底「全部动作」）。 */
export function clipSuggestions(kind) {
  const map = {
    ts: ['quick.ts2date'],
    url: ['convert.url-decode', 'convert.url-encode'],
    ip: ['ip.public'],
    json: ['convert.json-pretty', 'convert.json-min'],
    base64: ['convert.b64'],
    path: [],
    number: ['convert.digits'],
    text: [],
    empty: [],
  };
  return map[kind] ?? [];
}

// ============================================================
// 第六十五轮：结果导出与分享——Markdown/HTML 单文件、分享文本
// ============================================================

/** 分享元数据头（Markdown 折叠块）。meta: {plugin, action, at?, params?, ms?, ok?} */
export function shareMetaHeader(meta) {
  const when = meta.at ? new Date(meta.at).toLocaleString() : new Date().toLocaleString();
  const params = meta.params && Object.keys(meta.params).length
    ? '\n' + Object.entries(meta.params).map(([k, v]) => `- ${k}: ${typeof v === 'string' && /secret|token|key|password/i.test(k) ? '••••' : String(v)}`).join('\n')
    : '';
  return [
    '<details><summary>执行信息</summary>',
    '',
    `- 插件：${meta.plugin ?? '-'}　动作：${meta.action ?? '-'}`,
    `- 时间：${when}${meta.ms != null ? `　耗时：${formatMs(meta.ms)}` : ''}${meta.ok != null ? `　结果：${meta.ok ? '成功' : '失败'}` : ''}`,
    `- 由 zerokit 生成${params}`,
    '',
    '</details>',
    '',
  ].join('\n');
}

const SHARE_CUT = 50 * 1024;   // 50KB 正文保护线

/** 结果 → 分享 Markdown。大正文截断标注（完整版留在导出文件里由调用方决定）。 */
export function toShareMarkdown(result, meta, { full = true } = {}) {
  const head = shareMetaHeader(meta);
  let body;
  if (Array.isArray(result)) {
    body = markdownTable(result.slice(0, full ? result.length : 200));
  } else if (result && typeof result === 'object') {
    body = toMarkdownProps(result) ?? `- \`${JSON.stringify(result).slice(0, 200)}\``;
  } else {
    body = '```text\n' + String(result ?? '') + '\n```';
  }
  const text = head + '\n' + body + '\n';
  if (text.length > SHARE_CUT && !full) {
    return text.slice(0, SHARE_CUT) + '\n\n…（内容超过 50KB 已截断，完整结果请看导出文件）\n';
  }
  return text;
}

/** HTML 转义。 */
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 结果 → 单文件 HTML（内联样式，双击即看）。 */
export function toShareHtml(result, meta, { full = true } = {}) {
  const md = toShareMarkdown(result, meta, { full });
  // 极简 MD→HTML：表格行、代码块、列表、details 直译 + 段落兜底（分享够用，不做全解析器）
  const lines = md.split('\n');
  const out = [];
  let inCode = false, inTable = false;
  const rowCells = (l) => l.replace(/^\||\|$/g, '').split('|').map((c) => `<td>${escHtml(c.trim())}</td>`).join('');
  for (const l of lines) {
    if (l.startsWith('```')) { out.push(inCode ? '</code></pre>' : '<pre><code>'); inCode = !inCode; continue; }
    if (inCode) { out.push(escHtml(l)); continue; }
    if (/^\|.*\|$/.test(l.trim())) {
      if (/^\|[\s:-]+\|$/.test(l.trim()) || /^\|[\s:|-]+\|$/.test(l.trim())) continue;   // 分隔行
      if (!inTable) { out.push('<table>'); inTable = true; }
      out.push(`<tr>${rowCells(l.trim())}</tr>`);
      continue;
    }
    if (inTable) { out.push('</table>'); inTable = false; }
    if (l.startsWith('<details>')) { out.push('<details open><summary>执行信息</summary><div class="meta">'); continue; }
    if (l === '</details>') { out.push('</div></details>'); continue; }
    if (l.startsWith('- ')) { out.push(`<li>${escHtml(l.slice(2))}</li>`); continue; }
    if (!l.trim()) { out.push(''); continue; }
    out.push(`<p>${escHtml(l)}</p>`);
  }
  if (inTable) out.push('</table>');
  const title = `${meta.plugin ?? ''}.${meta.action ?? ''} 结果`;
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(title)}</title>
<style>
body{font:14px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:860px;margin:24px auto;padding:0 16px;color:#1f2328}
.meta{font-size:12px;color:#57606a;background:#f6f8fa;border-radius:8px;padding:8px 12px}
table{border-collapse:collapse;margin:12px 0}
td{border:1px solid #d0d7de;padding:4px 10px}
tr:nth-child(2n) td{background:#f6f8fa}
pre{background:#f6f8fa;border-radius:8px;padding:12px;overflow:auto}
code{font-family:ui-monospace,Menlo,monospace;font-size:13px}
</style></head><body>
${out.join('\n')}
</body></html>`;
}


// ---------------- 第六十九轮：信息密度与浏览效率 ----------------

/**
 * 参数摘要 tooltip：一行说清参数名/类型/必填（悬停不点进去就能看全）。
 * params 形如 [{name,type,required?,description?}]；空数组返回 ''。
 */
export function paramsHint(params) {
  if (!Array.isArray(params) || params.length === 0) return '';
  const parts = params.slice(0, 6).map((prm) => {
    const t = prm.type ? `:${prm.type}` : '';
    const req = prm.required ? '*' : '';
    return `${prm.name}${t}${req}`;
  });
  const more = params.length > 6 ? ` …共 ${params.length} 个` : '';
  return `参数：${parts.join('  ')}${more}（* 必填）`;
}

/**
 * 最近使用排序：按 runs 里该动作最近执行时间降序；没跑过的按原序垫底（稳定）。
 * entries: [{key, order}]；recentMap: {actionKey: lastTs}。
 */
export function recencyOrder(entries, recentMap) {
  const idx = new Map(entries.map((e, i) => [e.key, i]));
  return [...entries].sort((a, b) => {
    const ta = recentMap[a.key] ?? 0;
    const tb = recentMap[b.key] ?? 0;
    if (ta !== tb) return tb - ta;
    return (idx.get(a) ?? 0) - (idx.get(b) ?? 0);
  });
}


// ---------------- 第七十轮：操作连续性 ----------------

/**
 * 历史共现统计：从执行历史里找「做完 A 之后最常接着做」的动作。
 * runs: {actionKey: [{ts, ok}]} 或已展开的 [{actionKey, ts, ok}] 序列；
 * 这里吃扁平时序数组（调用方展开），按时间排序后数相邻对（窗口 = 紧邻）。
 * 返回 [{key, count}] 按 count 降序，最多 limit 条；不含 fromKey 自己。
 */
export function coActions(flatRuns, fromKey, limit = 3) {
  if (!Array.isArray(flatRuns)) return [];
  const seq = flatRuns
    .filter((r) => r && r.ok && r.ts)
    .sort((a, b) => a.ts - b.ts);
  const counts = new Map();
  for (let i = 1; i < seq.length; i++) {
    if (seq[i - 1].actionKey === fromKey && seq[i].actionKey !== fromKey) {
      const k = seq[i].actionKey;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

/**
 * 展开执行历史为扁平时序数组（供 coActions）。
 * runs: {actionKey: [{ts, ok}]}
 */
export function flattenRuns(runs) {
  const out = [];
  for (const [actionKey, arr] of Object.entries(runs ?? {})) {
    if (!Array.isArray(arr)) continue;
    for (const r of arr) {
      if (r && typeof r.ts === 'number') out.push({ actionKey, ts: r.ts, ok: !!r.ok });
    }
  }
  return out;
}

// ==================== 第七十二轮：上下文与智能默认 ====================

/**
 * ①剪贴板感知：判断剪贴板文本与参数类型的匹配度。
 * 返回 null（不匹配）或 { field, reason }——reason 是给人看的「为什么建议填这里」。
 * 规则刻意保守：宁可少建议，不要把剪贴板隐私内容到处标。
 */
export function clipboardMatch(text, fields) {
  if (!text || typeof text !== 'string' || text.length > 100_000) return null;
  const t = text.trim();
  if (!t || t.length < 1) return null;
  // 先整条剪贴板定性，再找字段——顺序不能反过来：
  // 「1760000000」既是数字也是时间戳，按字段遍历顺序谁先到谁抢走，
  // 值的语义应优先于字段的出现顺序
  const looksLikeTs = /^1[6-9]\d{8}(?:\d{3})?$/.test(t);
  for (const f of fields) {
    if (!f || f.type === 'checkbox' || f.type === 'select') continue;
    if (looksLikeTs && f.type !== 'number' && /ts|time|日期|时间/i.test(f.name)) {
      return { field: f.name, reason: '剪贴板像时间戳' };
    }
    if (f.type === 'number') {
      if (!looksLikeTs && /^-?\d+(?:\.\d+)?$/.test(t)) return { field: f.name, reason: '剪贴板是数字' };
      continue;
    }
    if (/^https?:\/\/\S+$/i.test(t)) {
      if (/url|link|href|地址|链接/i.test(f.name)) return { field: f.name, reason: '剪贴板是网址' };
      continue;
    }
    // 路径样子的值只建议给名字像路径的字段（不把任意文本灌进 path 参数）
    if (/^(?:~|\.{0,2}\/|\/|[A-Za-z]:[\\/])\S/.test(t)) {
      if (/path|dir|file|目录|路径|文件/i.test(f.name)) return { field: f.name, reason: '剪贴板像路径' };
      continue;
    }
    // 通用文本：只建议给名字含关键词的字段（query/q/text/内容/搜索），且剪贴板较短
    if (t.length <= 200 && /^(query|q|text|content|搜索|内容|关键字|关键词)$/i.test(f.name)) {
      return { field: f.name, reason: '剪贴板是短文本' };
    }
  }
  return null;
}

/**
 * ②参数历史：从该动作的执行历史里取同名字段的历史取值（最近优先、去重、限量）。
 * runs: runStore[key] 数组（unshift 语义首位最新）
 */
export function paramHistory(runs, fieldName, limit = 5) {
  if (!Array.isArray(runs) || !fieldName) return [];
  const seen = new Set();
  const out = [];
  for (const r of runs) {
    const v = r?.values?.[fieldName];
    if (v === undefined || v === null || v === '') continue;
    const key = String(v);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * ③智能默认占位：无默认无历史时按参数类型给 placeholder 建议（不填值——占位只是提示形状）。
 */
export function suggestPlaceholder(field) {
  if (!field || field.type === 'checkbox' || field.type === 'select') return '';
  if (field.type === 'number') return String(field.min ?? 0);
  const n = field.name ?? '';
  if (/url|link|href/i.test(n)) return 'https://';
  if (/path|dir|file/i.test(n)) return '~/' ;
  if (/ts$|time|date/i.test(n)) return '1760000000';
  if (/^q$|query|search|搜索/i.test(n)) return '关键词';
  if (/mail/i.test(n)) return 'user@example.com';
  return '';
}

/**
 * ⑦表单 dirty 高亮判定：当前值 ≠ 初始值即 dirty（checkbox 单独比，字符串归一后比）。
 */
export function isFieldDirty(field, current, initial) {
  if (!field) return false;
  if (field.type === 'checkbox') return Boolean(current) !== Boolean(initial);
  const norm = (v) => (v === undefined || v === null ? '' : String(v));
  return norm(current) !== norm(initial);
}

// ---------------------------------------------------------------- 第九十轮：首页仪表盘

/**
 * 仪表盘问候：按小时给一句人话（与顶栏状态胶囊同一套措辞，单一来源）。
 */
export function dashGreeting(hour = new Date().getHours()) {
  if (hour < 5) return '夜深了';
  if (hour < 9) return '早上好';
  if (hour < 12) return '午安';
  if (hour < 18) return '下午好';
  return '晚上好';
}

/**
 * 仪表盘四宫格的空态判定：每个 widget 一句引导（无收藏→教收藏、无历史→教跑第一条、
 * 无监控→教开监控、统计永不为空——零执行也是「0 次」本身）。
 */
export function dashEmpty(kind) {
  switch (kind) {
    case 'favs': return { title: '还没有收藏', hint: '列表里按 F 或点星标，常用的动作会出现在这里' };
    case 'runs': return { title: '还没有执行记录', hint: '随便跑一个动作（比如 系统信息 → 系统概况），回来就能看到它' };
    case 'watch': return { title: '没有在跑的监控', hint: '详情页开「监控」，数据变了它会告诉你' };
    default: return null;
  }
}

/**
 * 仪表盘统计摘要：今日 N 次 / 成功率 / 最常用动作——包一层 dailyBrief，
 * 只是把 top 的 key 翻成显示名（查不到的 key 原样返回，卸载的插件不至于显示 undefined）。
 */
export function dashStats(brief, nameOf) {
  const b = brief ?? { total: 0, ok: 0, failed: 0, top: [], avgMs: 0 };
  const rate = b.total ? Math.round((b.ok / b.total) * 100) : 0;
  return {
    total: b.total, ok: b.ok, rate,
    avgMs: b.avgMs ?? 0,
    topName: b.top?.[0]?.[0] ? (nameOf?.(b.top[0][0]) ?? b.top[0][0]) : '',
  };
}


// ============ 第九十三轮：分享与深链闭环 ============

/** ①② 生成详情深链：#/插件id/动作id?字段=值——只带非 secret 字段，值 encodeURIComponent。
 * 与 deepLinkParams 互逆：deepLinkParams(encodeDeepLink('sysinfo','overview',{a:'1'})).a === '1'。 */
export function encodeDeepLink(pluginId, actionId, values = {}, fields = []) {
  const parts = [];
  const byName = new Map((fields ?? []).map((f) => [f?.name ?? f, f]));
  // 无定义时按名字猜 secret（拿不到清单的场景，宁可多剔也不错放）
  const looksSecret = (k) => /secret|token|password|passwd|api[_-]?key|credential/i.test(k);
  for (const [k, v] of Object.entries(values ?? {})) {
    if (v == null || v === '' || v === false) continue; // 默认值/空不带，链接短
    const f = byName.get(k);
    if (f?.secret || (!f && looksSecret(k))) continue; // secret 永不进链接（会进聊天记录）
    if (!/^[\w.-]+$/.test(k)) continue;
    // 有字段定义时只带定义过的键——链接即表单，别把动态杂键漏进去
    if (byName.size > 0 && !byName.has(k)) continue;
    parts.push(`${k}=${encodeURIComponent(String(v))}`);
  }
  const q = parts.length ? `?${parts.join('&')}` : '';
  return `#/${encodeURIComponent(pluginId)}/${encodeURIComponent(actionId)}${q}`;
}

/** ③ 结果快照信封：{app:'zerokit',kind:'zkresult',version,savedAt,action:{plugin,name},result}。 */
export function buildZkresult(result, action = {}, version = '0.0.0') {
  return {
    app: 'zerokit',
    kind: 'zkresult',
    version,
    savedAt: new Date().toISOString(),
    action: { plugin: action?.plugin ?? '', action: action?.action ?? '', title: action?.title ?? '' },
    result: result ?? null,
  };
}

/** ④⑧ 解析+校验快照：非 zerokit 快照 / 缺 result / 缺 app 各自报错；返回 {ok,snapshot|error}。 */
export function parseZkresult(text) {
  let j;
  try { j = JSON.parse(String(text ?? '')); } catch { return { ok: false, error: '不是合法 JSON' }; }
  if (!j || typeof j !== 'object') return { ok: false, error: '快照不是对象' };
  if (j.app !== 'zerokit' || j.kind !== 'zkresult') return { ok: false, error: '不是 zerokit 结果快照（app/kind 不匹配）' };
  if (!('result' in j)) return { ok: false, error: '快照缺 result 字段' };
  if (!j?.savedAt || Number.isNaN(Date.parse(j.savedAt))) return { ok: false, error: '快照时间戳不合法' };
  return { ok: true, snapshot: j };
}

/** ⑦ 复制命令带注释头：zkit run … 前面加一行「# 插件名 · 动作名」。 */
export function commandWithNote(argvLine, pluginName = '', actionName = '') {
  const note = pluginName || actionName ? `# ${[pluginName, actionName].filter(Boolean).join(' · ')}\n` : '';
  return `${note}${argvLine}`;
}

/** ⑥ 收藏备注规范化：截 60 字、去首尾空白；空串=无备注。 */
export function favNote(note) {
  const t = String(note ?? '').trim();
  return t ? t.slice(0, 60) : '';
}

// ==================== 第九十六轮：布局、手势与记忆 ====================

/** ① 布局预设三档：normal（默认）/wide-list（列表占 44%）/wide-detail（列表 30%） */
export const LAYOUT_PRESETS = {
  normal: { label: '常规', listPct: 38 },
  'wide-list': { label: '宽列表', listPct: 50 },
  'wide-detail': { label: '宽详情', listPct: 30 },
};

/** 分栏宽度百分比 → 合法值（26–60 之间钳制，非法回 38） */
export function clampListPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 38;
  return Math.round(Math.min(60, Math.max(26, n)));
}

/** 拖拽换算：起拖位置+起拖宽度+当前位移+容器宽 → 新百分比（含钳制） */
export function dragPct(startX, startPct, curX, containerW) {
  if (!containerW || containerW < 100) return clampListPct(startPct);
  const dPct = ((curX - startX) / containerW) * 100;
  return clampListPct(startPct + dPct);
}

/** ⑦ Ctrl+滚轮缩放：当前字号档 → 上/下一档（s<m<l，边界不动） */
const FS_ORDER = ['s', 'm', 'l'];
export function nextFontScale(cur, dir) {
  const i = FS_ORDER.indexOf(cur === 's' || cur === 'm' || cur === 'l' ? cur : 'm');
  return FS_ORDER[Math.min(FS_ORDER.length - 1, Math.max(0, i + (dir > 0 ? 1 : -1)))];
}

/** ⑧ 布局键归类：layout.* 进备份「外观与设置」组（供 classifyKey 扩展用） */
export function isLayoutKey(key) {
  return typeof key === 'string' && (key.startsWith('zerokit.layout.') || key === 'zerokit.font-scale');
}

// ==================== 第九十七轮：结果的再呈现与注释 ====================

/** ① 单位人性化：1024 进制 B→KB/MB/GB/TB；1000 进制 ms→s（≥10000ms 才换档）。
 *  返回 null 表示「不值得换」（原样显示）。 */
export function humanCell(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const abs = Math.abs(v);
  // 毫秒优先：整千且 ≥10s——「15 s」比「14.6 KB」对执行耗时列更有意义（整千毫秒是常见档，字节数很少整千）
  if (abs >= 1000 && v % 1000 === 0) {
    return { text: `${v / 1000} s`, unit: 's' };
  }
  if (abs >= 1024) {
    // 字节数特征：整数且 ≥1024——B 换算（1024 进制）
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let n = v; let i = 0;
    while (Math.abs(n) >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return { text: `${Math.round(n * 10) / 10} ${units[i]}`, unit: units[i] };
  }
  return null;
}

/** 列是否「数值为主」：≥70% 单元格可解析为有限数字（复用第十六轮 isUnitColumn 阈值口径）。 */
export function numericShare(values) {
  const vals = values.filter((x) => x !== null && x !== undefined && x !== '');
  if (!vals.length) return 0;
  const n = vals.filter((x) => typeof x === 'number' ? Number.isFinite(x) : Number.isFinite(Number(String(x).replace(/[,\s]/g, ''))));
  return n.length / vals.length;
}

/** ② 分组小计段：按首列（cols[0]）连续相同值分段。
 *  返回 [{value, start, end, agg:{col(列名),kind:'sum'|'avg',total}}|null]。
 *  段内数值列（≥70% 可解析）才出小计；段长>3 用 avg 否则 sum（长段求和无意义）。 */
export function groupSegments(rows, cols) {
  if (!Array.isArray(rows) || rows.length < 3 || !Array.isArray(cols) || cols.length < 2) return [];
  const first = cols[0];
  const segs = [];
  let start = 0;
  for (let i = 1; i <= rows.length; i++) {
    const cur = i < rows.length ? String(rows[i]?.[first] ?? '') : null;
    const prev = String(rows[start]?.[first] ?? '');
    if (cur === null || cur !== prev) {
      const len = i - start;
      if (len >= 2) {
        let agg = null;
        for (let c = 1; c < cols.length && !agg; c++) {
          const name = cols[c];
          const nums = rows.slice(start, i).map((r) => Number(r?.[name])).filter(Number.isFinite);
          if (nums.length >= len * 0.7) {
            agg = { col: name, kind: len > 3 ? 'avg' : 'sum', total: len > 3 ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : nums.reduce((a, b) => a + b, 0) };
          }
        }
        segs.push({ value: prev, start, end: i - 1, agg });
      }
      start = i;
    }
  }
  return segs.length ? segs : [];
}

/** ⑦ 单元格对齐：数值右对齐判据（number 或纯数字串，含千分位/小数/负号/百分号）。 */
export function cellAlign(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? 'r' : 'l';
  if (typeof v !== 'string') return 'l';
  return /^-?[\d,]+(\.\d+)?%?$/.test(v.trim()) ? 'r' : 'l';
}

/** ③ 迷你条比例：v / max（0–1，负数或 0 给 0，max≤0 给 0）。 */
export function barShare(v, max) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
  if (typeof max !== 'number' || max <= 0) return 0;
  return Math.min(1, v / max);
}

// ==================== 第九十八轮：执行队列与并发可视化 ====================

/** ① 批量计数快照：{total, done, running, queued, failed}。
 * 状态表 states[i] ∈ 'queued'|'running'|'ok'|'fail'；缺项按 queued 计。 */
export function batchCounts(states) {
  const s = Array.isArray(states) ? states : [];
  const c = { total: s.length, done: 0, running: 0, queued: 0, failed: 0, ok: 0 };
  for (const st of s) {
    if (st === 'ok') { c.ok++; c.done++; }
    else if (st === 'fail') { c.failed++; c.done++; }
    else if (st === 'running') c.running++;
    else c.queued++;
  }
  return c;
}

/** ① 计数行文案：「3 排队 / 2 并行 / 5 完成（含 1 失败）」；全完成时「全部 N 项完成（M 失败）」。 */
export function batchCountsLabel(c) {
  if (!c || c.total === 0) return '';
  if (c.done >= c.total) {
    return c.failed ? `全部 ${c.total} 项完成（${c.failed} 失败）` : `全部 ${c.total} 项完成`;
  }
  const parts = [`${c.queued} 排队`, `${c.running} 并行`, `${c.done} 完成`];
  if (c.failed) parts[2] += `（含 ${c.failed} 失败）`;
  return parts.join(' / ');
}

/** ② 单项状态行图标。 */
export function batchStateIcon(st) {
  return st === 'ok' ? '✓' : st === 'fail' ? '✗' : st === 'running' ? '▸' : '·';
}

/** ④ CLI --chain 串跑：把逗号串拆成动作引用列表（trim + 空项过滤）。 */
export function parseChainSpec(spec) {
  if (typeof spec !== 'string' || !spec.trim()) return [];
  return spec.split(',').map((x) => x.trim()).filter(Boolean);
}
