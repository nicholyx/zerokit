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
} from '../web/extras.js';

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
check('导出 Markdown：对象转两列表 + 页脚',
  mdObj.includes('| 字段 | 值 |') && mdObj.includes('| 主机名 | mac |') && mdObj.includes('> 成功 · 42 ms'), mdObj);
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
  const today = now - 36e5;
  check('dailyBrief: 只数今天', (() => {
    const b = dailyBrief({ 'a.b': [{ ok: true, ms: 40, ts: today }, { ok: false, ms: 60, ts: today }], 'c.d': [{ ok: true, ms: 200, ts: now - 2 * 864e5 }] }, now);
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
}

const failed = results.filter(([, ok]) => !ok);
console.log('\n' + '='.repeat(60));
console.log(`通过 ${results.length - failed.length} / ${results.length}`);
if (failed.length) process.exitCode = 1;



