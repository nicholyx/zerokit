// 启动器「十项体验增强」的纯逻辑单测。
//
// 这些函数都在 web/extras.js 里，不碰 DOM / localStorage / fetch，
// 所以可以直接在 Node 里跑。界面接线另由 webui-smoke 断言。
import {
  THEMES, normalizeTheme, resolveTheme, SHORTCUTS,
  highlightSegments, highlightHtml, actionKey, toggleFavorite, isFavorite,
  favoritesFirst, rememberParams, pushRunHistory, pluginHealth, PROMPTS,
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

// ---------------------------------------------------------------- 工作台建议

check('工作台建议：四个非空建议', PROMPTS.length === 4 && PROMPTS.every((p) => p.label && p.prompt),
  JSON.stringify(PROMPTS));

const failed = results.filter(([, ok]) => !ok);
console.log('\n' + '='.repeat(60));
console.log(`通过 ${results.length - failed.length} / ${results.length}`);
if (failed.length) process.exitCode = 1;
