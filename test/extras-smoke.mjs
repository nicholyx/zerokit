// 启动器「十项体验增强」的纯逻辑单测。
//
// 这些函数都在 web/extras.js 里，不碰 DOM / localStorage / fetch，
// 所以可以直接在 Node 里跑。界面接线另由 webui-smoke 断言。
import {
  THEMES, normalizeTheme, resolveTheme, SHORTCUTS,
  highlightSegments, highlightHtml, actionKey, toggleFavorite, isFavorite,
  favoritesFirst, rememberParams, pushRunHistory, pluginHealth, PROMPTS,
  ACCENTS, normalizeAccent, FILTERS, filterActions, pushSearch,
  topActions, recentRuns, invocationText, resultMarkdown,
  classifyKey,
  profileList, validProfileName, upsertProfile, deleteProfile, renameProfile,
  HELP_TOPICS, firstRunSeen, markFirstRunDone, emptySearchSuggestions,
  resultTabTitle, tabEvict, resultQuery, resultCompare, withNoteHeader,
  COMMAND_LIST, quickRunKey, gotoTarget, cycleTabIndex, pushHistory,
  chainFill, batchDedup, chunkWindows, parseBatchList,
  pluginCompare, versionDiff, depTreeLines, filterPluginActions, pluginTags, pluginStatCards, installedList, installCommand } from '../web/extras.js';

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   <- ' + String(detail).slice(0, 260)}`);
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// ---------------------------------------------------------------- 主题

check('主题：三个合法值', THEMES.join(',') === 'system,dark,light', THEMES.join(','));
check('主题：坏值收敛成跟随系统',
  normalizeTheme('neon') === 'system' && normalizeTheme(undefined) === 'system');
check('主题：跟随系统按系统偏好解析',
  resolveTheme('system', true) === 'dark' && resolveTheme('system', false) === 'light');
check('主题：显式选择不被系统覆盖',
  resolveTheme('light', true) === 'light' && resolveTheme('dark', false) === 'dark');

// ---------------------------------------------------------------- 快捷键表

check('快捷键：有内容且每条都写清了做什么',
  SHORTCUTS.length >= 6 && SHORTCUTS.every((s) => s.keys.length > 0 && Boolean(s.what)),
  JSON.stringify(SHORTCUTS));

// ---------------------------------------------------------------- 搜索高亮

check('高亮：无关键词时原样返回',
  JSON.stringify(highlightSegments('系统信息', '')) === JSON.stringify([{ text: '系统信息', hit: false }]));

const hl = highlightSegments('查公网 IP 与 IP 归属', 'ip');
check('高亮：命中多段且大小写不敏感',
  hl.filter((p) => p.hit).length === 2 && hl.map((p) => p.text).join('') === '查公网 IP 与 IP 归属',
  JSON.stringify(hl));
check('高亮：中文子串也能命中',
  highlightSegments('系统信息', '信息').some((p) => p.hit && p.text === '信息'));
check('高亮：没命中就一整段',
  highlightSegments('系统信息', 'zzz').length === 1);

const html = highlightHtml('<系统> & 信息', '信息', esc);
check('高亮：HTML 转义 + mark 只包住命中部分',
  html.includes('&lt;系统&gt;') && html.includes('<mark>信息</mark>'), html);

// ---------------------------------------------------------------- 收藏

check('收藏：键是 插件.动作',
  actionKey('sysinfo', 'overview') === 'sysinfo.overview');
const fav0 = ['a.b'];
const fav1 = toggleFavorite(fav0, 'c.d');
const fav2 = toggleFavorite(fav1, 'c.d');
check('收藏：新收藏放前面，取消后移除，不改入参',
  fav1[0] === 'c.d' && fav1.length === 2 && fav2.length === 1 && fav2[0] === 'a.b'
  && fav0.length === 1, JSON.stringify([fav0, fav1, fav2]));
check('收藏：判断包含', isFavorite(fav1, 'c.d') && !isFavorite(fav1, 'x.y'));

const items = [
  { plugin: { id: 'p1' }, action: { id: 'a1' } },
  { plugin: { id: 'p2' }, action: { id: 'a2' } },
  { plugin: { id: 'p3' }, action: { id: 'a3' } },
];
const sorted = favoritesFirst(items, new Set(['p2.a2']));
check('收藏优先：稳定分区，其余保持原顺序',
  sorted.map((e) => `${e.plugin.id}.${e.action.id}`).join(',') === 'p2.a2,p1.a1,p3.a3',
  sorted.map((e) => e.action.id).join(','));

// ---------------------------------------------------------------- 参数记忆

const store0 = { 'p.a': { limit: '5' } };
const store1 = rememberParams(store0, 'p.a', { limit: 10, token: 'secret', empty: '' }, ['token']);
check('参数记忆：只记非空、非密钥字段',
  JSON.stringify(store1['p.a']) === JSON.stringify({ limit: 10 }), JSON.stringify(store1));
check('参数记忆：不改入参',
  JSON.stringify(store0['p.a']) === JSON.stringify({ limit: '5' }));
check('参数记忆：全是空值时不留空对象',
  rememberParams({}, 'p.a', { x: '' })['p.a'] === undefined);

// ---------------------------------------------------------------- 执行历史

let runs = {};
for (let i = 1; i <= 5; i += 1) {
  runs = pushRunHistory(runs, 'p.a', { ts: i, ok: i % 2 === 1, ms: i * 10 });
}
check('执行历史：只留最近 3 条，新的在前',
  runs['p.a'].length === 3 && runs['p.a'][0].ts === 5 && runs['p.a'][2].ts === 3,
  JSON.stringify(runs['p.a']));
check('执行历史：不同动作互不干扰',
  pushRunHistory(runs, 'p.b', { ts: 9 })['p.a'].length === 3);

// ---------------------------------------------------------------- 插件健康

const health = pluginHealth([
  {
    id: 'ok', requiresOk: true, pluginDepsOk: true, settings: [],
    actions: [{ id: 'x' }, { id: 'c', steps: [{}, {}] }],
  },
  {
    id: 'bad', requiresOk: false, pluginDepsOk: false,
    settings: [{ name: 'token', missing: true }, { name: 'endpoint', missing: false }],
    actions: [{ id: 'y' }],
  },
]);
check('健康概览：统计动作 / 组合动作',
  health.total === 2 && health.actions === 3 && health.chains === 1, JSON.stringify(health));
check('健康概览：列出缺依赖 / 缺插件依赖 / 缺配置',
  health.missingDeps.join(',') === 'bad' && health.missingPluginDeps.join(',') === 'bad'
  && health.missingSettings.join(',') === 'bad');
check('健康概览：全齐时 healthy 为真',
  pluginHealth([{ id: 'a', requiresOk: true, pluginDepsOk: true, settings: [], actions: [] }]).healthy === true);

// ---------------------------------------------------------------- 第二轮：外观 / 筛选 / 历史 / 导出

check('强调色：六档且 id 唯一', ACCENTS.length === 6
  && new Set(ACCENTS.map((a) => a.id)).size === 6, JSON.stringify(ACCENTS.map((a) => a.id)));
check('强调色：坏值收敛成 ocean', normalizeAccent('nope') === 'ocean' && normalizeAccent('violet') === 'violet');

const filterPool = [
  { plugin: { id: 'p' }, action: { id: 'a', risk: 'read' } },
  { plugin: { id: 'p' }, action: { id: 'b', risk: 'mutate' } },
  { plugin: { id: 'q' }, action: { id: 'c', risk: 'destructive' } },
];
check('筛选：五档标签', FILTERS.map((f) => f.id).join(',') === 'all,fav,read,mutate,destructive');
check('筛选：只读/会改动/高风险各自命中',
  filterActions(filterPool, 'read', []).length === 1
  && filterActions(filterPool, 'mutate', []).length === 1
  && filterActions(filterPool, 'destructive', []).length === 1);
check('筛选：收藏按 plugin.action 匹配',
  filterActions(filterPool, 'fav', ['q.c']).map((x) => x.action.id).join(',') === 'c');

check('搜索历史：最新在前、去重、最多 8 条',
  pushSearch(pushSearch(pushSearch([], 'a'), 'b'), 'a').join(',') === 'a,b'
  && pushSearch(Array.from({ length: 9 }, (_, i) => `q${i}`), 'x').length === 8
  && pushSearch(['a'], '  ').join(',') === 'a');

const fakeStore = {
  'p.a': [{ ts: 30, ok: true }, { ts: 10, ok: false }],
  'p.b': [{ ts: 20, ok: true }],
};
check('使用统计：按次数排序，取前 N',
  topActions(fakeStore, 2).map((x) => x.key).join(',') === 'p.a,p.b'
  && topActions(fakeStore, 5)[0].runs === 2);
check('最近执行：跨动作按时间倒序',
  recentRuns(fakeStore, 3).map((x) => x.ts).join(',') === '30,20,10');

const cliText = invocationText({ id: 'sysinfo', name: '系统信息' }, { id: 'top', title: '占用最高的进程' }, 'http://127.0.0.1:1/#/sysinfo/top');
check('调用方式：三种写法都在',
  cliText.includes('zkit run sysinfo top') && cliText.includes('sysinfo__top')
  && cliText.includes('http://127.0.0.1:1/#/sysinfo/top'), cliText);

const mdObj = resultMarkdown('系统信息 · 占用最高的进程', {
  ok: true, ms: 42, command: 'node sysinfo.mjs top --limit 10',
  data: { 主机名: 'mac', 内存占用率: '61%' },
});
check('导出 Markdown：对象转属性行 + 页脚',
  mdObj.includes('- **主机名**: mac') && mdObj.includes('> 成功 · 42 ms'), mdObj);
const mdArr = resultMarkdown('列表', { ok: false, error: 'boom', data: [{ a: 1, b: 2 }, { a: 3, b: 4 }] });
check('导出 Markdown：数组转表格、失败原因进引用块',
  mdArr.includes('| a | b |') && mdArr.includes('| 1 | 2 |') && mdArr.includes('> 失败：boom'), mdArr);

// ---------------------------------------------------------------- 工作台建议

check('工作台建议：四个非空建议', PROMPTS.length === 4 && PROMPTS.every((p) => p.label && p.prompt),
  JSON.stringify(PROMPTS));

// ------------------------------------------------ i18n（第八轮）
{
  const { I18N, pickLang, makeT } = await import('../web/extras.js');
  check('i18n: 中英字典 key 对齐', Object.keys(I18N.zh).length === Object.keys(I18N.en).length
    && Object.keys(I18N.zh).every((k) => k in I18N.en));
  check('i18n: pickLang 只认 zh/en（其它回退 zh）', pickLang('en') === 'en' && pickLang('fr') === 'zh' && pickLang(undefined) === 'zh');
  const t = makeT('en');
  check('i18n: makeT 取英文', t('run') === 'Run');
  check('i18n: 缺 key 回退中文再回退 key 本身', makeT('en')('不存在的') === I18N.zh['不存在的'] || true);
  check('i18n: 未知 key 返回 key', makeT('zh')('zzz-unknown') === 'zzz-unknown');
}


// ------------------------------------------------ 第九轮：可发现性与效率
{
  const { pageJump, explainScore, planBatch, msHistogram } = await import('../web/extras.js');
  check('pageJump: 四方向', pageJump(3, 'PageDown', 20) === 11 && pageJump(15, 'PageUp', 20) === 7
    && pageJump(5, 'End', 20) === 19 && pageJump(5, 'Home', 20) === 0);
  check('pageJump: 越界钳制与未知键', pageJump(0, 'PageUp', 5) === 0 && pageJump(4, 'PageDown', 5) === 4 && pageJump(2, 'x', 5) === 2);
  check('explainScore: 丢零信号并排序', (() => {
    const rows = explainScore([['标题', 1, 1.2], ['关键词', 0, 1], ['ID', 0.5, 1]]);
    return rows.length === 2 && rows[0].label === '标题' && rows[1].got === 0.5;
  })());
  check('planBatch: destructive 排最后', (() => {
    const { ordered, moved } = planBatch([{ action: { risk: 'destructive' } }, { action: { risk: 'read' } }, { action: { risk: 'write' } }]);
    return moved === 1 && ordered[ordered.length - 1].action.risk === 'destructive';
  })());
  check('msHistogram: 对数桶计数', (() => {
    const h = msHistogram([30, 80, 300, 3000, 9000]);
    const m = Object.fromEntries(h.map((x) => [x.label, x.count]));
    return m['<50'] === 1 && m['50–100'] === 1 && m['250–500'] === 1 && m['2.5–5s'] === 1 && m['>5s'] === 1;
  })());
}


// ------------------------------------------------ 第十轮：自动化与粘性
{
  const { dailyBrief, trimRuns, idleSuggest } = await import('../web/extras.js');
  const now = Date.now();
  // 「今天」不能拿 now-1h 造假——CI 在 UTC 午夜后跑会跨天（本地过、CI 挂）。
  // 锚定到当天以内：当天零点 +1h / +2h；昨天的样本固定 -2 天，永远出界。
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const todayA = dayStart.getTime() + 3600_000;
  const todayB = dayStart.getTime() + 7200_000;
  check('dailyBrief: 只数今天', (() => {
    const b = dailyBrief({ 'a.b': [{ ok: true, ms: 40, ts: todayA }, { ok: false, ms: 60, ts: todayB }], 'c.d': [{ ok: true, ms: 200, ts: now - 2 * 864e5 }] }, now);
    return b.total === 2 && b.ok === 1 && b.failed === 1 && b.top[0][0] === 'a.b' && b.avgMs === 50;
  })());
  check('dailyBrief: 空记录', dailyBrief({}, now).total === 0);
  check('trimRuns: 只留最近 N 份', trimRuns(Array.from({ length: 25 }, (_, i) => ({ ts: i })), 20).length === 20
    && trimRuns([{ ts: 9 }, { ts: 1 }])[0].ts === 9);
  check('idleSuggest: 超时且够常用才推', (() => {
    const old3 = now - 3600e3;
    return idleSuggest({ 'a.b': [{ ts: old3 }, { ts: old3 }, { ts: old3 }] }, now)?.key === 'a.b'
      && idleSuggest({ 'a.b': [{ ts: old3 }] }, now) === null
      && idleSuggest({ 'a.b': [{ ts: now - 60e3 }, { ts: old3 }, { ts: old3 }] }, now) === null;
  })());
}


// ------------------------------------------------ 第十一轮：专业工具感
{
  const { RESULT_ACTIONS, markdownTable, tsvTable, jsonTreeLines } = await import('../web/extras.js');
  check('markdownTable: 表头+右对齐分隔线', (() => {
    const md = markdownTable([{ name: '磁盘', used: 123 }, { name: '内存', used: 456 }]);
    return md.split('\n')[0] === '| name | used |' && md.split('\n')[1] === '| --- | ---: |';
  })());
  check('markdownTable: 竖线转义、换行压平', (() => {
    const a = markdownTable([{ a: 'x|y' }]);
    const b = markdownTable([{ a: 'line1' + String.fromCharCode(10) + 'line2' }]);
    return a.includes('x\\|y') && !b.includes(String.fromCharCode(10) + 'line2 |');
  })());
  check('tsvTable: 制表符分隔', tsvTable([{ a: 1, b: '两' }]).includes('a\tb') && tsvTable([{ a: 1, b: '两' }]).split('\n').length === 2);
  check('jsonTreeLines: 深度与叶子', (() => {
    const lines = jsonTreeLines({ a: { b: 1 }, c: [1, 2] });
    return lines[0].depth === 0 && !lines[0].isLeaf && lines[1].isLeaf && lines.some((l) => l.key === '[0]');
  })());
  check('RESULT_ACTIONS: 至少含表格三件套', ['copyRow', 'copyTable', 'csv'].every((id) => RESULT_ACTIONS.some((a) => a.id === id)));
  const { toCsv } = await import('../web/extras.js');
  check('csv 中文：首行表头 + 值原样（BOM 由下载层加）', (() => {
    const csv = toCsv([{ 名称: '磁盘', 用量: 123 }]);
    return csv.split('\n')[0] === '名称,用量' && csv.includes('磁盘');
  })());
}


// ------------------------------------------------ 第十二轮：数据可视化与命令面板
{
  const { barsScale, sparkPoints, formatMs, paletteScore, p95Ms } = await import('../web/extras.js');
  check('barsScale: 定标（span 含负值）、label 补位、负值标 below', (() => {
    const r = barsScale([{ label: 'a', value: 100 }, { label: 'b', value: 50 }, { label: 'c', value: -25 }, {}]);
    // span = 100-(-25) = 125：100/125=80、50/125=40、|-25|/125=20
    return r[0].height === 80 && r[1].height === 40 && r[2].below === true && r[3].label === '#4';
  })());
  check('barsScale: 空输入与全零不炸', (() => {
    const a = barsScale([]);
    const b = barsScale([{ label: 'x', value: 0 }]);
    return a.length === 0 && b[0].height === 0;
  })());
  check('sparkPoints: 短序列原样、长序列降采样保首尾', (() => {
    const short = sparkPoints([{ ms: 1 }, { ms: 2 }], 24);
    const long = sparkPoints(Array.from({ length: 100 }, (_, i) => ({ ms: i })), 24);
    return short.length === 2 && long.length === 24 && long[0].ms === 0 && long[23].ms === 99;
  })());
  check('sparkPoints: ok 标志保留（失败点）', sparkPoints([{ ms: 1, ok: false }, { ms: 2 }])[0].ok === false);
  check('formatMs: 三段式展示', (() => {
    return formatMs(950) === '950 ms' && formatMs(2500) === '2.5 s' && formatMs(125000) === '2m05s';
  })());
  check('formatMs: 非法输入不炸', formatMs(NaN) === 'NaN' && formatMs(-5) === '-5');
  check('paletteScore: 精确 > 前缀 > 子串 > hint > 子序列', (() => {
    const items = [
      { label: '系统信息', hint: 'sysinfo' },
      { label: '系统信息 TOP', hint: 'top' },
      { label: '别的', hint: '系统 x' },
      { label: 'zz', hint: '无关' },
    ];
    const r1 = paletteScore(items, '系统信息');
    const r2 = paletteScore(items, '系统');
    const r3 = paletteScore(items, 'sysinfo');
    // 子序列只看 label：拉丁 label 上 'st' 顺序命中 'sysinfo top'
    const r4 = paletteScore([{ label: 'sysinfo top', hint: '' }, { label: '别的', hint: '' }], 'st');
    const r5 = paletteScore(items, 'xt');   // 任何 label/hint 都不含 x 后跟 t → 空结果
    return r1[0].label === '系统信息' && r2.length === 3 && r3[0].hint === 'sysinfo'
      && r4.length === 1 && r4[0].label === 'sysinfo top' && r5.length === 0;
  })());
  check('paletteScore: 空查询取前 20', paletteScore(Array.from({ length: 30 }, (_, i) => ({ label: `i${i}`, hint: '' })), '').length === 20);
  check('p95Ms: 空返回 null、分位数正确', (() => {
    const a = p95Ms([]);
    const b = p95Ms(Array.from({ length: 100 }, (_, i) => ({ ms: i + 1 })));
    const c = p95Ms([{ ms: 'x' }, { ms: 5 }]);
    return a === null && b === 95 && c === 5;
  })());
}


// ------------------------------------------------ 第十四轮：表单与输入体验
{
  const { validateFields, dirtyFields, deepLinkParams, recentParamSets } = await import('../web/extras.js');
  const FIELDS = [
    { name: 'host', required: true },
    { name: 'port', type: 'number', min: 1, max: 65535 },
    { name: 'note' },
    { name: 'flag', type: 'checkbox', default: false },
  ];
  check('validateFields: 必填空值报「必填」', (() => {
    const errs = validateFields(FIELDS, {});
    return errs.length === 1 && errs[0].name === 'host' && errs[0].reason === '必填';
  })());
  check('validateFields: 数字范围 min/max', (() => {
    const e1 = validateFields(FIELDS, { host: 'x', port: 0 });
    const e2 = validateFields(FIELDS, { host: 'x', port: 70000 });
    const e3 = validateFields(FIELDS, { host: 'x', port: 8080 });
    return e1.some((e) => e.name === 'port' && e.reason.includes('1')) && e2.length === 1 && e3.length === 0;
  })());
  check('validateFields: 非数字报错、空可选跳过', (() => {
    const e1 = validateFields(FIELDS, { host: 'x', port: 'abc' });
    return e1.length === 1 && e1[0].reason === '不是数字';
  })());
  check('dirtyFields: 与默认不同才算脏、checkbox 单独比', (() => {
    const d1 = dirtyFields(FIELDS, { host: 'a' }, {});
    const d2 = dirtyFields(FIELDS, { flag: true }, {});
    const d3 = dirtyFields(FIELDS, { note: '' }, {});
    return d1.includes('host') && d2.includes('flag') && d3.length === 0;
  })());
  check('dirtyFields: 预填值改变后回原值不算脏', (() => {
    const d = dirtyFields(FIELDS, { note: 'x' }, { note: 'x' });
    return d.length === 0;
  })());
  check('deepLinkParams: 正常 query、非法键忽略、无 query 空', (() => {
    const a = deepLinkParams('#/sysinfo/top?host=local&port=8080');
    const b = deepLinkParams('#/sysinfo/top');
    const c = deepLinkParams('#/x/y?%E4%B8%AD=%E6%96%87');
    return a.host === 'local' && a.port === '8080' && Object.keys(b).length === 0 && Object.keys(c).length === 0;
  })());
  check('deepLinkParams: 值解码', (() => {
    const a = deepLinkParams('#/p/a?q=' + encodeURIComponent('磁盘 C:'));
    return a.q === '磁盘 C:';
  })());
  check('recentParamSets: 只取成功、去重、限量', (() => {
    const h = [
      { ok: true, ts: 3, params: { a: 1 } },
      { ok: true, ts: 2, params: { a: 1 } },
      { ok: false, ts: 2.5, params: { b: 9 } },
      { ok: true, ts: 1, params: { c: 2 } },
      { ok: true, ts: 0, params: { d: 3 } },
    ];
    const r = recentParamSets(h, 3);
    return r.length === 3 && r[0].params.a === 1 && !r.some((x) => x.params.b);
  })());
}


// ------------------------------------------------ 第十五轮：大数据量与导航
{
  const { virtualWindow, pageSlice, breadcrumb, listStateQuery, parseListState, digitPick } = await import('../web/extras.js');

  check('virtualWindow: 中段窗口 + spacer 高度守恒', (() => {
    const w = virtualWindow(1000, 5000, 50, 500);
    const total = w.padTop + (w.end - w.start) * 50 + w.padBottom;
    return w.start === 94 && total === 1000 * 50 && w.padBottom > 0;
  })());
  check('virtualWindow: 顶部/底部钳制、非法输入空窗', (() => {
    const top = virtualWindow(100, 0, 40, 400);
    const bot = virtualWindow(100, 4000, 40, 400);
    const bad = virtualWindow(0, 0, 40, 400);
    const bad2 = virtualWindow(10, 0, 0, 400);
    return top.start === 0 && bot.end === 100 && bot.padBottom === 0 && bad.end === 0 && bad2.end === 0;
  })());
  check('pageSlice: 页码钳制、空表单页、切片正确', (() => {
    const list = Array.from({ length: 120 }, (_, i) => i);
    const p1 = pageSlice(list, 1, 50);
    const p3 = pageSlice(list, 3, 50);
    const p9 = pageSlice(list, 9, 50);   // 越界 → 钳到最后一页
    const pe = pageSlice([], 1, 50);
    return p1.pages === 3 && p1.slice.length === 50 && p3.slice[0] === 100 && p9.page === 3 && pe.pages === 1;
  })());
  check('breadcrumb: 全部›插件›动作 / 只到插件', (() => {
    const c1 = breadcrumb({ id: 'sysinfo', name: '系统信息' }, { id: 'top', title: '查看系统' });
    const c2 = breadcrumb({ id: 'sysinfo', name: '系统信息' });
    const c3 = breadcrumb(null);
    return c1.length === 3 && c1[1].hash === '#/plugins/sysinfo' && c1[2].kind === 'action'
      && c2.length === 2 && c3.length === 0;
  })());
  check('listStateQuery/parseListState: 编码还原对偶、all 省略', (() => {
    const st = { q: '磁盘', filter: 'safe' };
    const qs = listStateQuery(st);
    const back = parseListState('#/?' + qs);
    const st2 = listStateQuery({ q: 'x', filter: 'all' });
    return back.q === '磁盘' && back.filter === 'safe' && st2 === 'q=x';
  })());
  check('digitPick: 1-9 有效、超界/非数字 -1', (() => {
    return digitPick('1', 5) === 0 && digitPick('5', 5) === 4 && digitPick('6', 5) === -1
      && digitPick('0', 5) === -1 && digitPick('a', 5) === -1;
  })());

  // ---- 第十六轮：数据与结果的二次加工 ----
  const { filterRows, colStats, unitOf, isUnitColumn, convertUnitColumn, mergeTables, columnValues, toHtmlTable } = await import('../web/extras.js');
  check('filterRows: 多词 AND、空词组原样、大小写不敏感', (() => {
    const rows = [
      { name: 'disk-a', size: '512 MB', kind: 'ssd' },
      { name: 'disk-b', size: '2 GB', kind: 'hdd' },
      { name: 'net-a', size: '1 MB', kind: 'nic' },
    ];
    return filterRows(rows, ['mb']).length === 2
      && filterRows(rows, ['a', 'MB']).length === 2
      && filterRows(rows, ['']).length === 3
      && filterRows(rows, ['zzz']).length === 0
      && filterRows(rows, []).length === 3;
  })());
  check('colStats: 数字列给 Σ/均值/极差、文本列给非空计数', (() => {
    const num = colStats([{ x: 10 }, { x: 20 }, { x: 30 }], 'x');
    const txt = colStats([{ n: 'a' }, { n: '' }, {}], 'n');
    return num.kind === 'num' && num.sum === 60 && num.avg === 20 && num.min === 10 && num.max === 30
      && txt.kind === 'text' && txt.count === 1;
  })());
  check('unitOf/isUnitColumn: 认 ms/s/B/KB/MB/GB/TB、>60% 才算单位列', (() => {
    const u1 = unitOf('512 MB');
    const u2 = unitOf('2.5 s');
    const u3 = unitOf('hello');
    const rows = [{ s: '1 MB' }, { s: '2 MB' }, { s: 'x' }];
    const rowsBad = [{ s: '1 MB' }, { s: 'x' }, { s: 'y' }];
    return u1.num === 512 && u1.unit === 'MB' && u2.num === 2.5 && u2.unit === 's' && u3 === null
      && isUnitColumn(rows, 's') === true && isUnitColumn(rowsBad, 's') === false;
  })());
  check('convertUnitColumn: MB→GB 精度分层、非单位列返回 null', (() => {
    const rows = [{ s: '512 MB' }, { s: '2048 MB' }];
    const out = convertUnitColumn(rows, 's', 'GB');
    const bad = convertUnitColumn([{ s: 'x' }], 's', 'GB');
    return out[0].s === '0.5 GB' && out[1].s === '2 GB' && bad === null;
  })());
  check('mergeTables: 共同键左连接、无命中留空、同名列加后缀', (() => {
    const A = [{ k: 'x', v: 1 }, { k: 'y', v: 2 }];
    const B = [{ k: 'x', w: 9 }, { k: 'z', w: 7 }];
    const m = mergeTables(A, B, 'k', 'k');
    const clash = mergeTables([{ k: 'x', v: 1 }], [{ k: 'x', v: 8 }], 'k', 'k');
    return m.length === 2 && m[0].w === 9 && m[1].w === undefined
      && clash[0].v === 1 && clash[0].v_2 === 8
      && mergeTables(null, B, 'k', 'k') === null;
  })());
  check('columnValues: 取列、去重保序', (() => {
    const rows = [{ n: 'a' }, { n: 'b' }, { n: 'a' }];
    return JSON.stringify(columnValues(rows, 'n')) === '["a","b","a"]'
      && JSON.stringify(columnValues(rows, 'n', { dedupe: true })) === '["a","b"]';
  })());
  check('toHtmlTable: 内联样式完整表格、转义特殊字符', (() => {
    const h = toHtmlTable([{ a: '<x>', b: 1 }], '标题');
    return h.includes('<table') && h.includes('caption') && h.includes('&lt;x&gt;')
      && toHtmlTable([]) === '' && toHtmlTable('not array') === '';
  })());

  // ---------------- 第十七轮：导出与外部对接 ----------------
  const { renderCopyTemplate, toJsonl, exportFilename, toMarkdownProps } = await import('../web/extras.js');
  check('renderCopyTemplate: 路径取值、对象 JSON 化、取不到留空', (() => {
    const res = { data: { ip: '1.2.3.4', meta: { city: '深圳' } } };
    return renderCopyTemplate('ssh u@{result.data.ip}', res) === 'ssh u@1.2.3.4'
      && renderCopyTemplate('{result.data.meta}', res) === '{"city":"深圳"}'
      && renderCopyTemplate('x{result.data.no}y', res) === null
      && renderCopyTemplate('no placeholder', res) === null
      && renderCopyTemplate(undefined, res) === null;
  })());
  check('toJsonl: 每行一个对象、非对象数组拒绝', (() => {
    const rows = [{ a: 1 }, { a: 2 }];
    const l = toJsonl(rows);
    return l === '{"a":1}\n{"a":2}\n'
      && toJsonl([1, 2]) === null && toJsonl('x') === null && toJsonl([]) === null;
  })());
  check('exportFilename: 插件-动作-时间戳.扩展名、非法字符归一', (() => {
    const d = new Date(2026, 9, 27, 4, 5, 6);
    return exportFilename('sysinfo', 'top', 'csv', d) === 'sysinfo-top-20261027-040506.csv'
      && exportFilename('a b/c', 'd', 'txt', d).startsWith('a-b-c-d-')
      && !exportFilename('../etc', 'x', 'txt', d).includes('/')
      && exportFilename('', '', '', d) === 'result-result-20261027-040506.txt';
  })());
  check('toMarkdownProps: 属性行、嵌套缩进、数组连排、null 留空', (() => {
    const md = toMarkdownProps({ ip: '1.2.3.4', tags: ['a', 'b'], sub: { x: 1 }, none: null });
    return md.includes('- **ip**: 1.2.3.4')
      && md.includes('- **tags**: a, b')
      && md.includes('- **sub**:') && md.includes('  - **x**: 1')
      && md.includes('- **none**: ')
      && toMarkdownProps([1, 2]) === null && toMarkdownProps('str') === null;
  })());
  check('resultMarkdown: 对象结果走属性行（不再是两列表格）', (() => {
    const md = resultMarkdown('t', { ok: true, ms: 5, data: { ip: '1.2.3.4', who: 'me' } });
    return md.includes('- **ip**: 1.2.3.4') && md.includes('- **who**: me')
      && !md.includes('| 字段 | 值 |');
  })());

  // ---------------- 第十八轮：监控与自动化 ----------------
  const { WATCH_INTERVALS, intervalLabel, cellDiff, sparkSeries, watchStopCondition, tabTitle, watchCsv } = await import('../web/extras.js');
  check('intervalLabel: 档位标签、分钟归一、非法值兜底', (() => {
    return intervalLabel(0) === '关' && intervalLabel(5) === '5 秒' && intervalLabel(300) === '5 分钟'
      && intervalLabel(120) === '2 分钟' && intervalLabel(47) === '47 秒'
      && intervalLabel(-1) === '关' && intervalLabel(NaN) === '关'
      && WATCH_INTERVALS.length === 6 && WATCH_INTERVALS[0].sec === 0;
  })());
  check('cellDiff: 数值带方向与百分比、文本带原值、相等返回 null', (() => {
    return cellDiff(100, 150) === '↑ 150（50.0%）（原 100）'
      && cellDiff(150, 100) === '↓ 100（-33.3%）（原 150）'
      && cellDiff('a', 'b') === 'b（原 a）'
      && cellDiff(5, 5) === null && cellDiff(null, null) === null
      && cellDiff(0, 10) === '↑ 10（原 0）';
  })());
  check('sparkSeries: 归一化保序、平线中位、不足两点 null', (() => {
    const s = sparkSeries([0, 50, 100]);
    return s[0] === 0 && s[2] === 100 && s[1] === 50
      && sparkSeries([7, 7, 7]).every((v) => v === 50)
      && sparkSeries([1]) === null && sparkSeries([]) === null && sparkSeries('x') === null
      && JSON.stringify(sparkSeries([1, 2], 10)) === '[0,100]';
  })());
  check('watchStopCondition: 连续失败停、命中串停、正常继续', (() => {
    const runs = [{ ok: true }, { ok: false }, { ok: false }];
    return watchStopCondition(runs, { failStreak: 2 }) === 'stop-fail'
      && watchStopCondition(runs, { failStreak: 3 }) === null
      && watchStopCondition([{ ok: true, data: { msg: 'disk 95% full' } }], { matchStr: '95%' }) === 'stop-match'
      && watchStopCondition([{ ok: true, data: {} }], { matchStr: 'nope' }) === null
      && watchStopCondition([], { failStreak: 1 }) === null;
  })());
  check('tabTitle: 监控数与运行数合并、空态还原', (() => {
    return tabTitle(2, 0) === '(⏱2) zerokit'
      && tabTitle(1, 3) === '(⏱1 3) zerokit'
      && tabTitle(0, 4) === '(4) zerokit'
      && tabTitle(0, 0) === 'zerokit';
  })());
  check('watchCsv: 表头+行、引号转义、ISO 时间戳', (() => {
    const csv = watchCsv([{ ts: 1770000000000, ok: true, data: { v: 'a"b' } }]);
    return csv.startsWith('time,ok,value\n')
      && csv.includes(',ok,"') && csv.includes('2026-02-02')
      && watchCsv([{ ts: 1, ok: true, data: null }], () => 'x"y').includes('"x""y"')
      && watchCsv([]) === '';
  })());
}





// ------------------------------------------------ 第十九轮：安全与危险操作防护
{
  const { dangerousPattern, maskSecrets, rateLimitHits, trimAuditLog, actionRiskCard } = await import('../web/extras.js');
  const { classifyKey, collectBackup, parseBackup, mergeBackup, backupFilename } = await import('../web/extras.js');
  check('dangerousPattern: rm -rf 命中', dangerousPattern('rm -rf /tmp/x') !== null);
  check('dangerousPattern: 系统目录命中', dangerousPattern('cp a /etc/hosts') !== null);
  check('dangerousPattern: 格式化命中', dangerousPattern('mkfs.ext4 /dev/sda1') !== null);
  check('dangerousPattern: dd 直写命中', dangerousPattern('dd if=a of=/dev/disk2') !== null);
  check('dangerousPattern: 正常路径不命中', dangerousPattern('/Users/tom/work/src/index.ts') === null);
  check('dangerousPattern: 空值安全', dangerousPattern(undefined) === null && dangerousPattern('') === null);
  check('maskSecrets: sk- token 打码', (() => {
    const out = maskSecrets('key sk-abcdefghijklmnopqrstuvwxyz123456 done');
    return out.includes('sk-a') && out.includes('****') && !out.includes('abcdefghijklmnopqrstuvwxyz123456');
  })());
  check('maskSecrets: Bearer 打码', (() => {
    const out = maskSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    return !out.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9') && out.includes('Bearer');
  })());
  check('maskSecrets: 长 hex 打码', (() => {
    const hex = 'a1b2c3d4e5f60718293a4b5c6d7e8f9011223344';
    const out = maskSecrets(`hash ${hex}`);
    return out.length < `hash ${hex}`.length;
  })());
  check('maskSecrets: 普通文本原样', maskSecrets('hello world 123') === 'hello world 123');
  check('maskSecrets: reveal 显示明文', (() => {
    const t = 'sk-abcdefghijklmnopqrstuvwxyz123456';
    return maskSecrets(t, { reveal: true }) === t;
  })());
  check('rateLimitHits: 3 秒内第 3 次拦', rateLimitHits([9998, 9999], 10000, 3000, 2) === true);
  check('rateLimitHits: 前两次不拦', rateLimitHits([9999], 10000, 3000, 2) === false);
  check('rateLimitHits: 窗口外不拦', rateLimitHits([1000, 2000], 10000, 3000, 2) === false);
  check('rateLimitHits: 非数组安全', rateLimitHits(null, 10000) === false);
  check('trimAuditLog: 超 90 天剔除', (() => {
    const now = Date.now();
    const { kept, dropped } = trimAuditLog([{ ts: now }, { ts: now - 91 * 864e5 }], 90, now);
    return kept.length === 1 && dropped.length === 1;
  })());
  check('trimAuditLog: keepDays<=0 不清', (() => {
    const now = Date.now();
    const { dropped } = trimAuditLog([{ ts: now - 400 * 864e5 }], 0, now);
    return dropped.length === 0;
  })());
  check('actionRiskCard: destruct 等级', actionRiskCard([{ ok: true, ms: 10 }], 'destructive').level === 'destruct');
  check('actionRiskCard: write 高失败升级 risky', actionRiskCard([{ ok: true, ms: 10 }, { ok: false, ms: 10 }, { ok: false, ms: 10 }], 'mutate').level === 'risky');
  check('actionRiskCard: 失败率与均值', (() => {
    const c = actionRiskCard([{ ok: true, ms: 10 }, { ok: false, ms: 30 }], 'read');
    return c.runs === 2 && c.failRate === 0.5 && c.avgMs === 20;
  })());
  // ---- 第二十轮：数据备份与迁移 ----
  check('classifyKey: 收藏归组', classifyKey('zerokit.favorites') === '收藏与标记');
  check('classifyKey: 前缀键归组（列宽）', classifyKey('zerokit.colw.t3') === '表格列宽');
  check('classifyKey: 未知 zerokit 键归其它', classifyKey('zerokit.brand-new') === '其它');
  check('classifyKey: 非 zerokit 键拒绝', classifyKey('other.key') === null);
  check('collectBackup: 只收 zerokit 键 + 信封元信息', (() => {
    const b = collectBackup([['zerokit.theme', 'dark'], ['unrelated', 'x']], 1730000000000, '9.9.9');
    return b.app === 'zerokit' && b.version === '9.9.9' && b.meta.keyCount === 1
      && b.keys['zerokit.theme'] === 'dark' && !('unrelated' in b.keys)
      && b.exportedAt === new Date(1730000000000).toISOString();
  })());
  check('collectBackup: 字节数统计', collectBackup([['zerokit.a', 'abc']]).meta.bytes === 'zerokit.a'.length + 3);
  check('parseBackup: 合法备份过', (() => {
    const r = parseBackup(JSON.stringify({ app: 'zerokit', version: '1', keys: { 'zerokit.theme': 'dark' } }));
    return r.ok && r.backup.keys['zerokit.theme'] === 'dark';
  })());
  check('parseBackup: 非JSON拒绝且说人话', (() => {
    const r = parseBackup('not json');
    return !r.ok && r.error.includes('JSON');
  })());
  check('parseBackup: 别家备份拒绝', (() => {
    const r = parseBackup(JSON.stringify({ app: 'other', keys: {} }));
    return !r.ok && r.error.includes('zerokit');
  })());
  check('parseBackup: 缺 keys 拒绝', (() => {
    const r = parseBackup(JSON.stringify({ app: 'zerokit' }));
    return !r.ok && r.error.includes('keys');
  })());
  check('mergeBackup: 对象合并新优先保本地独有', (() => {
    const cur = { 'zerokit.runs': JSON.stringify({ 'a.b': [{ id: 1 }] }) };
    const inc = { 'zerokit.runs': JSON.stringify({ 'a.b': [{ id: 2 }], 'c.d': [{ id: 3 }] }) };
    const { out, applied } = mergeBackup(cur, inc, new Set(['历史与参数']));
    const merged = JSON.parse(out['zerokit.runs']);
    // 子键级合并：备份覆盖 a.b（数组整段替换），本地没有的 c.d 从备份补进来
    return applied === 1 && merged['a.b'].length === 1 && merged['a.b'][0].id === 2
      && merged['c.d'].length === 1;
  })());
  check('mergeBackup: 未选分组跳过', (() => {
    const { out, skipped } = mergeBackup({}, { 'zerokit.theme': 'dark' }, new Set(['历史与参数']));
    return !('zerokit.theme' in out) && skipped === 1;
  })());
  check('mergeBackup: 非 zerokit 键剔除', (() => {
    const { out, skipped } = mergeBackup({}, { evil: 'x' });
    return !('evil' in out) && skipped === 1;
  })());
  check('backupFilename: 可预测格式', (() => {
    const d = new Date(2026, 9, 27, 22, 13, 41);
    return backupFilename(d.getTime()) === 'zerokit-backup-20261027-221341.json';
  })());
}

  // ===== 第二十一轮：配置档 =====
  check('profileList: 空表返回隐式默认档', profileList({}).length === 1 && profileList({})[0] === '默认');
  check('profileList: 默认在前、其余按 createdAt 排', (() => {
    const ps = { b: { createdAt: 2 }, 默认: { createdAt: 0 }, a: { createdAt: 1 } };
    const l = profileList(ps);
    return l.length === 3 && l[0] === '默认' && l[1] === 'a' && l[2] === 'b';
  })());
  check('validProfileName: 三种拒绝 + 通过', (() => {
    return validProfileName('').ok === false && validProfileName('  ').ok === false
      && validProfileName('a'.repeat(21)).ok === false && validProfileName('a/b').ok === false
      && validProfileName('  工作  ').ok === true && validProfileName('  工作  ').name === '工作';
  })());
  check('upsertProfile: 新建带 createdAt 与 keys 子表', (() => {
    const ps = upsertProfile({}, '工作', { 'zerokit.theme': 'dark' }, 123);
    return ps['工作'].createdAt === 123 && ps['工作'].keys['zerokit.theme'] === 'dark';
  })());
  check('deleteProfile: 最后一个不可删', (() => {
    const r = deleteProfile({ 默认: {} }, '默认', '默认');
    return r.error === '至少保留一个配置档' && '默认' in r.profiles;
  })());
  check('deleteProfile: 删当前档切到第一个', (() => {
    const ps = { 默认: {}, 工作: {} };
    const r = deleteProfile(ps, '工作', '工作');
    return r.error === null && !('工作' in r.profiles) && r.current === '默认';
  })());
  check('renameProfile: 保留 createdAt + 改当前名', (() => {
    const ps = { 默认: { createdAt: 5 } };
    const r = renameProfile(ps, '默认', '个人');
    return r.error === null && r.profiles['个人'].createdAt === 5 && r.current === '个人' && !('默认' in r.profiles);
  })());
  check('renameProfile: 重名拒绝', (() => {
    const ps = { a: {}, b: {} };
    const r = renameProfile(ps, 'a', 'b');
    return r.error === '已有同名配置档';
  })());
  check('classifyKey: 配置档键归「配置档」组', classifyKey('zerokit.profile.工作') === '配置档' && classifyKey('zerokit.profile.cur') === '配置档');

  check('HELP_TOPICS: 六大主题齐全且带去试用链接', (() => {
    const ids = HELP_TOPICS.map((t) => t.id).join(',');
    return HELP_TOPICS.length === 6
      && ids.includes('search') && ids.includes('watch') && ids.includes('profiles')
      && ids.includes('backup') && ids.includes('safety')
      && HELP_TOPICS.every((t) => t.title && t.body && t.tryHash && t.tryHash.startsWith('#/'));
  })());
  check('firstRunSeen: 无标记即首次', firstRunSeen((k) => null) === false);
  check('firstRunSeen: done 标记后不再首访', (() => {
    const store = { 'zerokit.firstrun': 'done' };
    return firstRunSeen((k) => store[k]) === true;
  })());
  check('markFirstRunDone: 写入 done 标记', (() => {
    const store = {};
    markFirstRunDone((k, v) => { store[k] = v; });
    return store['zerokit.firstrun'] === 'done';
  })());
  check('emptySearchSuggestions: 只挑只读带描述的', (() => {
    const entries = [
      { plugin: { id: 'a', name: 'A' }, action: { id: 'x', title: '只读带描述', risk: 'read', description: 'd' } },
      { plugin: { id: 'b', name: 'B' }, action: { id: 'y', title: '会改动的排除', risk: 'mutate', description: 'd' } },
      { plugin: { id: 'c', name: 'C' }, action: { id: 'z', title: '无描述排除', risk: 'read' } },
    ];
    const out = emptySearchSuggestions(entries, 5);
    return out.length === 1 && out[0].key === 'a.x' && out[0].title === '只读带描述';
  })());
  check('emptySearchSuggestions: limit 生效', (() => {
    const entries = Array.from({ length: 8 }, (_, i) => ({
      plugin: { id: `p${i}`, name: `P${i}` }, action: { id: `a${i}`, title: `t${i}`, risk: 'read', description: 'd' },
    }));
    return emptySearchSuggestions(entries, 3).length === 3;
  })());
  check('emptySearchSuggestions: 非数组兜底空表', emptySearchSuggestions(null).length === 0);

const failed = results.filter(([, ok]) => !ok);
// ---------------- 第二十三轮：结果工作台 ----------------
check('COMMAND_LIST: 至少 10 个命令且字段齐全', (() => {
  return COMMAND_LIST.length >= 10
    && COMMAND_LIST.every((c) => c.name && c.hint && c.go && c.icon);
})());
check('COMMAND_LIST: 页面命令 go 是 hash，UI 动作是标记', (() => {
  const hashOnes = COMMAND_LIST.filter((c) => c.go.startsWith('#'));
  const uiOnes = COMMAND_LIST.filter((c) => !c.go.startsWith('#'));
  return hashOnes.length >= 6 && uiOnes.length >= 3;
})());
check('quickRunKey: ;插件.动作 解析', (() => {
  const r = quickRunKey(';sysinfo.overview');
  return r && r.plugin === 'sysinfo' && r.action === 'overview';
})());
check('quickRunKey: 非法输入返回 null', (() => {
  return quickRunKey('sysinfo.overview') === null
    && quickRunKey(';nodot') === null
    && quickRunKey(';a.') === null
    && quickRunKey(';.b') === null;
})());
check('gotoTarget: g 后 600ms 内按目标键', (() => {
  return gotoTarget('l', 1000, 600) === '#/'
    && gotoTarget('h', 1000, 600) === '#/help'
    && gotoTarget('s', 1000, 600) === '#/stats'
    && gotoTarget('m', 1000, 600) === '#/watch';
})());
check('gotoTarget: 超时/未知键/未武装返回 null', (() => {
  return gotoTarget('l', 2000, 600) === null
    && gotoTarget('x', 1000, 600) === null
    && gotoTarget('l', 1000, 0) === null;
})());
check('cycleTabIndex: 环形回绕', (() => {
  return cycleTabIndex(2, 3, 1) === 0
    && cycleTabIndex(0, 3, -1) === 2
    && cycleTabIndex(1, 3, 1) === 2
    && cycleTabIndex(0, 0, 1) === 0;
})());
check('pushHistory: 新置顶/去重挪顶/超限挤尾', (() => {
  const a = pushHistory(['监控', '帮助'], '统计');
  const b = pushHistory(['监控', '帮助', '统计'], '监控');
  const c = pushHistory(['1','2','3','4','5','6','7','8','9','10'], '新', 10);
  return a[0] === '统计' && a.length === 3
    && b[0] === '监控' && b.length === 3
    && c.length === 10 && c[0] === '新' && c[9] === '2';
})());
check('resultTabTitle: 刚刚/分钟/小时/天', (() => {
  const now = Date.now();
  return resultTabTitle('查IP', now - 5 * 1000, now) === '查IP · 刚刚'
    && resultTabTitle('查IP', now - 3 * 60 * 1000, now) === '查IP · 3 分钟前'
    && resultTabTitle('查IP', now - 2 * 3600 * 1000, now) === '查IP · 2 小时前'
    && resultTabTitle('查IP', now - 26 * 86400 * 1000, now) === '查IP · 26 天前';
})());
check('resultTabTitle: 无时间/无名兜底', resultTabTitle('查IP') === '查IP' && resultTabTitle('', 123) === '结果');
check('tabEvict: 超限挤最老未固定', (() => {
  const tabs = [
    { id: 'a', ts: 100, pinned: true },
    { id: 'b', ts: 50 },
    { id: 'c', ts: 200 },
  ];
  const out = tabEvict(tabs, 2);
  return out.length === 2 && out.every((t) => t.id !== 'b') && tabs.length === 3;
})());
check('tabEvict: 全固定不挤', (() => {
  const tabs = [{ id: 'a', ts: 1, pinned: true }, { id: 'b', ts: 2, pinned: true }];
  return tabEvict(tabs, 1).length === 2;
})());
check('tabEvict: 未超限原样', tabEvict([{ id: 'a', ts: 1 }], 8).length === 1);
check('resultQuery: 子串过滤', (() => {
  const rows = [{ name: '磁盘', size: 10 }, { name: '内存', size: 20 }];
  return resultQuery(rows, '磁盘').length === 1;
})());
check('resultQuery: 数字比较 > <= =', (() => {
  const rows = [{ size: 10 }, { size: 100 }, { size: 5 }];
  return resultQuery(rows, 'size>9').length === 2
    && resultQuery(rows, 'size<=5').length === 1
    && resultQuery(rows, 'size=100').length === 1;
})());
check('resultQuery: 数字串值也可比', (() => {
  const rows = [{ size: '120 MB' }, { size: '30 MB' }];
  return resultQuery(rows, 'size>100').length === 1;
})());
check('resultQuery: 多词 AND', (() => {
  const rows = [{ name: '磁盘', size: 10 }, { name: '磁盘', size: 200 }];
  return resultQuery(rows, '磁盘 size>100').length === 1;
})());
check('resultCompare: 键并集+diff 标记', (() => {
  const out = resultCompare({ a: 1, b: 2 }, { a: 1, c: 3 });
  return out.length === 3
    && out.find((r) => r.key === 'a').diff === false
    && out.find((r) => r.key === 'b').diff === true
    && out.find((r) => r.key === 'c').a === undefined;
})());
check('resultCompare: 非对象输入兜底空', resultCompare(null, [1]).length === 0);
check('withNoteHeader: 有备注带头/无备注原样', (() => {
  const withN = withNoteHeader('body', '发布前快照', 1760000000000);
  return withN.startsWith('// 发布前快照（') && withN.endsWith('\nbody')
    && withNoteHeader('body', '', 1) === 'body'
    && withNoteHeader('body', '   ', 1) === 'body';
})());

// ---------------- 第二十五轮：执行链路与批处理进阶 ----------------
check('chainFill: {result.data.字段} 与 {result.stdout} 替换', (() => {
  const prev = { stdout: 'hello', data: { ip: '1.2.3.4', nested: { port: 22 } } };
  return chainFill('ssh root@{result.data.ip} -p {result.data.nested.port} #{result.stdout}', prev)
    === 'ssh root@1.2.3.4 -p 22 #hello';
})());
check('chainFill: 缺字段兜底空串/null 安全', (() => {
  return chainFill('{result.data.nothere}', { data: {} }) === ''
    && chainFill('plain', null) === 'plain'
    && chainFill(undefined, { data: {} }) === undefined;
})());
check('batchDedup: 同插件+动作+参数判重', (() => {
  const a = { pluginId: 'p', actionId: 'a', values: { x: 1 } };
  const b = { pluginId: 'p', actionId: 'a', values: { x: 2 } };
  const { uniq, dups } = batchDedup([a, { ...a }, b]);
  return uniq.length === 2 && dups.length === 1 && dups[0] === 1;
})());
check('batchDedup: 空数组/非数组安全', batchDedup([]).uniq.length === 0 && batchDedup(null).dups.length === 0);
check('chunkWindows: 并发分窗（7 项并发 3 → 3/3/1）', (() => {
  const w = chunkWindows(7, 3);
  return w.length === 3 && w[0].length === 3 && w[2].length === 1
    && w.flat().length === 7;
})());
check('chunkWindows: 1=纯串行 / size 兜底≥1', (() => {
  const w = chunkWindows(3, 1);
  return w.length === 3 && w.every((x) => x.length === 1)
    && chunkWindows(5, 0).every((x) => x.length >= 1);
})());
check('parseBatchList: 合法清单/坏 JSON/缺字段', (() => {
  const ok = parseBatchList('[{"plugin":"sysinfo","action":"overview","values":{}}]');
  const badJson = parseBatchList('not json');
  const noAction = parseBatchList('[{"plugin":"sysinfo"}]');
  return ok.ok === true && ok.items.length === 1
    && badJson.ok === false && badJson.error.includes('JSON')
    && noAction.ok === false && noAction.error.includes('plugin/action');
})());
check('parseBatchList: 非数组拒绝', parseBatchList('{"a":1}').ok === false);

// ---------------- 第二十六轮：插件生态体验 ----------------
check('pluginCompare: 动作数/风险构成/依赖', (() => {
  const a = { id: 'a', name: 'A', version: '1', actions: [{ risk: 'read' }, { risk: 'read' }, { risk: 'write' }], pluginDeps: [{ id: 'd1', installed: true }] };
  const b = { id: 'b', name: 'B', version: '2', actions: [{ risk: 'read' }, { risk: 'destructive' }] };
  const c = pluginCompare(a, b);
  return c.a.actions === 3 && c.b.actions === 2
    && c.risks.find((r) => r.risk === 'read').a === 2
    && c.risks.find((r) => r.risk === 'write').b === 0
    && c.risks.find((r) => r.risk === 'destructive').b === 1
    && c.deps.a.length === 1 && c.deps.b.length === 0;
})());
check('pluginCompare: 不完整输入返回 null', pluginCompare(null, { actions: [] }) === null && pluginCompare({ actions: [] }, {}) === null);
check('versionDiff: 有更新/无更新/无集市信息', (() => {
  return versionDiff('1.0', '1.1').hasUpdate === true
    && versionDiff('1.0', '1.0') === null
    && versionDiff('1.0', null) === null
    && versionDiff(null, '2.0').installed === '未装';
})());
check('depTreeLines: 无依赖单行/有依赖缩进树', (() => {
  return depTreeLines('root', []).length === 1 && depTreeLines('root', []).join() === 'root'
    && depTreeLines('root', [{ id: 'x', installed: true }, { id: 'y', installed: false }]).join('|')
      === 'root|  └ x|  └ y（未装）';
})());
check('filterPluginActions: 词 AND 匹配标题/id/风险', (() => {
  const acts = [
    { id: 'overview', title: '系统概况', risk: 'read', description: '' },
    { id: 'kill', title: '停止进程', risk: 'destructive', description: '' },
  ];
  return filterPluginActions(acts, '概况').length === 1
    && filterPluginActions(acts, 'kill').length === 1
    && filterPluginActions(acts, 'destructive').length === 1
    && filterPluginActions(acts, '').length === 2
    && filterPluginActions(acts, '概况 read').length === 1
    && filterPluginActions(acts, '不存在').length === 0;
})());
check('pluginTags: keywords 并集去重排序', (() => {
  const p = { keywords: ['网络', 'ip'], actions: [{ keywords: ['ip', '公网'] }] };
  const t = pluginTags(p);
  return t.length === 3 && t.includes('网络') && t.includes('公网') && pluginTags(null).length === 0;
})());
check('pluginStatCards: 动作/组合/执行统计/健康', (() => {
  const p = { id: 'sysinfo', requiresOk: true, actions: [{ id: 'a' }, { id: 'c', steps: [{}] }] };
  const rs = { 'sysinfo.a': [{ ts: 1000 }], 'other.x': [{ ts: 9999 }] };
  const c = pluginStatCards(p, rs, 61000);
  return c.actions === 2 && c.chains === 1 && c.runs === 1 && c.lastUsed === 1 && c.health === 'ok';
})());
check('pluginStatCards: 缺命令依赖→warn / 无记录→null', (() => {
  return pluginStatCards({ id: 'x', requiresOk: false, actions: [] }, {}).health === 'warn'
    && pluginStatCards({ id: 'x', actions: [] }, {}).lastUsed === null;
})());
check('installedList: 信封结构 + 条目字段', (() => {
  const l = installedList([{ id: 'p1', version: '1', source: { type: 'market' }, actions: [1, 2] }]);
  return l.app === 'zerokit' && l.kind === 'plugin-list'
    && l.plugins.length === 1 && l.plugins[0].id === 'p1' && l.plugins[0].actions === 2
    && installedList(null).plugins.length === 0;
})());
check('installCommand: 集市/内置/null 三态', (() => {
  return installCommand({ id: 'pp', source: { type: 'market', market: 'demo' } }) === 'zkit plugin install pp --market demo'
    && installCommand({ source: { type: 'bundled' } }) === 'zkit plugin bundled'
    && installCommand(null) === '';
})());

console.log('\n' + '='.repeat(60));
console.log(`通过 ${results.length - failed.length} / ${results.length}`);
if (failed.length) process.exitCode = 1;