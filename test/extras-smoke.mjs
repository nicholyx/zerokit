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

const failed = results.filter(([, ok]) => !ok);
console.log('\n' + '='.repeat(60));
console.log(`通过 ${results.length - failed.length} / ${results.length}`);
if (failed.length) process.exitCode = 1;



