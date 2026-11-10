// 插件 web 面（render = "web"）的冒烟测试。
//
// 覆盖四层：清单校验 → server 静态托管与桥注入 → API 面透传 → 桥协议本身。
// 全部在临时目录里跑（自包含，不依赖本机已装的插件），不联网。
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { EventEmitter } from 'node:events';

const PKG_ROOT = path.resolve(import.meta.dirname, '..');
// 先设环境再 import 内核：paths 在模块加载时读 ZEROKIT_HOME
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'zerokit-webui-smoke-'));
process.env['ZEROKIT_HOME'] = TMP_HOME;

const { loadPlugin } = await import('../src/core/manifest.ts');
const { PLUGINS_DIR } = await import('../src/core/paths.ts');
const { startServer } = await import('../src/server.ts');

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   <- ' + String(detail).slice(0, 300)}`);
};

// ---------------------------------------------------------------- 造测试插件

function makePlugin(id, withPage) {
  const dir = path.join(PLUGINS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'demo.mjs'),
    'process.stdout.write(JSON.stringify({ now: "ok" }) + "\\n");\n');
  fs.writeFileSync(path.join(dir, 'plugin.toml'), `
[plugin]
id      = "${id}"
name    = "web面测试"
summary = "测 render = web"

[[setting]]
name    = "greeting"
type    = "string"
default = "hi"

[[setting]]
name     = "token"
type     = "string"
secret   = true
required = false

[[action]]
id          = "now"
title       = "现在"
description = "输出一个 JSON，由插件页面渲染"
run         = ["{node}", "demo.mjs"]
output      = "json"
render      = "web"
risk        = "read"

[[action]]
id          = "snippet"
title       = "HTML 片段"
description = "output = html 时 stdout 直接是 HTML"
run         = ["{node}", "demo.mjs"]
output      = "html"
risk        = "read"

[[action]]
id          = "chain"
title       = "组合动作"
description = "把 now 拼起来，验证启动器能拿到步骤"
type        = "chain"
output      = "text"
risk        = "read"

  [[action.step]]
  use = "self.now"
  as  = "n"
`);
  if (withPage) {
    fs.mkdirSync(path.join(dir, 'web'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'web', 'index.html'),
      '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>demo</title></head>\n<body><p id="v">demo page</p></body></html>\n');
  }
  return dir;
}

fs.mkdirSync(PLUGINS_DIR, { recursive: true });
const GOOD_DIR = makePlugin('webdemo', true);
const BAD_DIR = makePlugin('webdemo-bad', false);

// ---------------------------------------------------------------- 1. 清单校验

{
  const good = loadPlugin(GOOD_DIR);
  check('清单：有 web/index.html 时 render = "web" 通过校验', good.plugin?.actions[0]?.render === 'web',
    good.errors.join('; '));

  const bad = loadPlugin(BAD_DIR);
  check('清单：缺 web/index.html 时 render = "web" 校验报错',
    !bad.plugin && bad.errors.some((e) => e.includes('web/index.html')),
    bad.errors.join('; '));

  // 坏插件留在目录里不能让整个列表挂掉（与 doctor 同路径）
  const { listPlugins } = await import('../src/core/registry.ts');
  const all = listPlugins();
  check('清单：坏插件不拖垮列表，好插件照常可见',
    all.some((e) => e.plugin?.id === 'webdemo') && all.some((e) => !e.plugin && e.errors.length > 0),
    JSON.stringify(all.map((e) => e.plugin?.id ?? e.errors[0])));

  const snippet = good.plugin?.actions.find((a) => a.id === 'snippet');
  check('清单：output = "html" 的默认 render 是 "html"（srcdoc 渲染）',
    snippet?.render === 'html', `render=${snippet?.render}`);
}

// ---------------------------------------------------------------- 2. server 托管

const { url: BASE, close } = await startServer({ port: 0 });

async function get(p, raw = false) {
  if (!raw) {
    const res = await fetch(BASE + p, { redirect: 'manual' });
    const text = await res.text();
    return { status: res.status, type: res.headers.get('content-type') ?? '', text };
  }
  // fetch / new URL 会把 ../ 规范化掉，穿越向量要用原始请求行发
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(BASE), { path: p }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] ?? '', text }));
    });
    req.on('error', reject);
    req.end();
  });
}

{
  const page = await get('/p/webdemo/index.html');
  check('托管：/p/<id>/index.html 返回 200 text/html',
    page.status === 200 && page.type.startsWith('text/html'), `${page.status} ${page.type}`);
  check('托管：HTML 自动注入桥脚本',
    page.text.includes('<script src="/_zkit/bridge.js"></script>'), page.text.slice(0, 120));
  check('安全：插件页面不含会话令牌（令牌只发给应用自己的前端）',
    !/x-zerokit-token|[0-9a-f]{48}/.test(page.text), '页面里出现了疑似 token');

  const bare = await get('/p/webdemo/');
  check('托管：/p/<id>/ 默认回 index.html', bare.status === 200 && bare.text.includes('demo page'),
    `${bare.status}`);

  const bridge = await get('/_zkit/bridge.js');
  check('托管：/_zkit/bridge.js 可获取',
    bridge.status === 200 && bridge.type.startsWith('text/javascript')
    && bridge.text.includes('window.zkit'), `${bridge.status}`);

  const missing = await get('/p/webdemo/nope.css');
  check('托管：web 目录里不存在的文件 404', missing.status === 404, `${missing.status}`);

  const unknown = await get('/p/nosuchplugin/');
  check('托管：未知插件 404', unknown.status === 404, `${unknown.status}`);

  const badPluginPage = await get('/p/webdemo-bad/');
  check('托管：没通过校验的插件没有 web 面', badPluginPage.status === 404, `${badPluginPage.status}`);

  // 目录穿越：原始 ../ 与编码 ..%2f 两种形态，都读不到 web 目录外的文件
  for (const p of ['/p/webdemo/../plugin.toml', '/p/webdemo/..%2fplugin.toml', '/p/webdemo/%2e%2e%2fplugin.toml']) {
    const r = await get(p, true);
    check(`安全：${p} 读不到插件目录外的文件`,
      r.status >= 400 || !r.text.includes('[plugin]'), `${r.status} ${r.text.slice(0, 60)}`);
  }

  // 十项体验增强的入口：主题切换 / 快捷键浮层
  const index = await get('/');
  check('外壳：设置抽屉与快捷键入口都在页面上',
    index.text.includes('id="drawerBtn"') && index.text.includes('id="helpBtn"'),
    index.text.slice(0, 160));
  const extras = await get('/extras.js');
  check('静态：extras.js 可加载（收藏/记忆/历史/健康的纯函数）',
    extras.status === 200 && extras.text.includes('normalizeTheme')
    && extras.text.includes('pluginHealth') && extras.text.includes('pushRunHistory'),
    `${extras.status} ${extras.text.slice(0, 80)}`);
  const appJs = await get('/app.js');
  check('前端接线：收藏、参数记忆、执行历史、插件主页、快捷键都已接上',
    ['favorites', 'rememberParams', 'renderRunHistory', 'showPluginHome', 'showShortcuts']
      .every((k) => appJs.text.includes(k)),
    'app.js 里缺了某个新功能的函数名');

  // 第十三轮：可访问性与键盘流——静态标记逐项断言（CI 没有浏览器，标记在源码里最可靠）
  const indexHtml = index.text;
  const css = await get('/style.css');
  check('a11y：列表 roving tabindex（role=option + aria-selected 模板）',
    appJs.text.includes('role="option"') && appJs.text.includes("tabindex=\"${i === active ? 0 : -1}\""),
    'roving tabindex 模板缺失');
  check('a11y：:focus-visible 焦点环样式存在',
    css.status === 200 && css.text.includes(':focus-visible'),
    'style.css 缺 :focus-visible');
  check('a11y：prefers-reduced-motion 停动画',
    css.status === 200 && css.text.includes('prefers-reduced-motion'),
    'style.css 缺 reduced-motion');
  check('a11y：sr-only 视觉隐藏类存在',
    css.status === 200 && css.text.includes('.sr-only') && appJs.text.includes('class="sr-only"'),
    'sr-only 类或使用缺失');
  check('a11y：结果区 aria-live=polite + 播报文本',
    appJs.text.includes('aria-live="polite"') && appJs.text.includes('role="status">动作完成'),
    'aria-live 或播报缺失');
  check('a11y：星标按钮带 aria-label',
    appJs.text.includes("aria-label=\"${fav ? t('unfav') : t('fav')}\""),
    '星标 aria-label 缺失');
  check('a11y：抽屉开合按钮带 aria-label',
    /id="drawerBtn"[^>]*aria-label/.test(indexHtml) || /aria-label[^>]*id="drawerBtn"/.test(indexHtml),
    'drawerBtn aria-label 缺失');
  check('a11y：空态容器 role=status（18 处 ps-empty + 主空态）',
    (appJs.text.match(/class="ps-empty" role="status"/g) || []).length >= 15
      && indexHtml.includes('id="empty" class="empty" role="status"'),
    'ps-empty/主空态未标 role=status');

  // 第二十二轮：帮助与上手——静态断言
  check('帮助：#/help 路由 + HELP_TOPICS 渲染',
    appJs.text.includes('#/help') && appJs.text.includes('HELP_TOPICS.map'),
    '#/help 面板缺失');
  check('帮助：首访引导三步 + done 标记',
    appJs.text.includes('showFirstRunGuide') && appJs.text.includes('markFirstRunDone'),
    '首访引导缺失');
  check('帮助：页脚使用指南入口',
    indexHtml.includes('id="guideBtn"'),
    'guideBtn 缺失');
  check('帮助：空搜索建议（试试这些）',
    appJs.text.includes('emptySearchSuggestions') && appJs.text.includes('试试这些'),
    '空搜索建议缺失');
  check('帮助：风险说明条（risk !== read 时）',
    appJs.text.includes('risk-explain') && appJs.text.includes('是什么意思'),
    '风险说明条缺失');
  check('帮助：分组头悬停提示（动作数与风险构成）',
    appJs.text.includes('riskTally') && appJs.text.includes("t('riskTip')"),
    '分组头 title 缺失');

  // 第二十八轮：国际化——静态断言
  check('i18n：三档语言切换（system/zh/en）接线',
    appJs.text.includes('validLangPref') && appJs.text.includes("data-lang-choice")
      && appJs.text.includes("localStorage.getItem('zerokit.lang')"),
    '语言三档切换缺失');
  check('i18n：applyLang 全量重渲 + html lang 同步',
    /document\.documentElement\.lang = lang === 'en'/.test(appJs.text)
      && appJs.text.includes('applyLang(true)'),
    'applyLang 重渲/html lang 缺失');
  check('i18n：静态节点 data-i18n 标注',
    (indexHtml.match(/data-i18n="/g) || []).length >= 8,
    'index.html data-i18n 不足 8 处');
  check('i18n：modeLabel 走 t()（25 处硬编码已迁）',
    (appJs.text.match(/el\.modeLabel\.textContent = t\('/g) || []).length >= 24
      && !appJs.text.includes("el.modeLabel.textContent = '命令'"),
    'modeLabel 仍有硬编码中文');
  check('i18n：风险等级走 riskText()',
    appJs.text.includes('function riskText(') && !appJs.text.includes("RISK_TEXT = { read: '只读'"),
    'RISK_TEXT 未迁 i18n');
  check('i18n：术语统一（无命令→无动作）',
    !appJs.text.includes('无命令'),
    '仍有「无命令」混用');

  // 第二十九轮：性能与体感——静态断言
  check('perf：搜索防抖 150ms + rAF 合帧',
    appJs.text.includes('searchDebounceTimer') && appJs.text.includes('requestAnimationFrame')
      && /150\)/.test(appJs.text),
    '防抖/rAF 缺失');
  check('perf：#/perf 面板三指标卡',
    appJs.text.includes('showPerfPanel') && appJs.text.includes('perfStats.listMs') && appJs.text.includes('性能'),
    '#/perf 面板缺失');
  check('perf：大表只画首屏 + 加载全部按钮',
    appJs.text.includes('OVERFLOW_ROWS') && appJs.text.includes('data-loadall') && appJs.text.includes('tableFullLoad'),
    '大表窗口化缺失');
  check('perf：大 JSON 序列化切片让出主线程',
    appJs.text.includes('chunkedStringify') && appJs.text.includes('setTimeout(r, 0)'),
    'chunkedStringify 缺失');
  check('a11y：Esc 栈先关最上层弹层（cellFullPop 优先）',
    appJs.text.includes("getElementById('cellFullPop')") && /Escape.*cellFullPop/s.test(appJs.text),
    'Esc 栈处理缺失');
}

// ---------------------------------------------------------------- 3. API 面透传

{
  const res = await fetch(BASE + '/api/plugins');
  const data = await res.json();
  const demo = (data.plugins ?? []).find((p) => p.id === 'webdemo');
  check('API：/api/plugins 把 render = "web" 带给前端',
    demo?.actions?.some((a) => a.id === 'now' && a.render === 'web'),
    JSON.stringify(demo?.actions?.map((a) => [a.id, a.render])));

  check('API：/api/plugins 带插件依赖状态（前端据此标「缺插件依赖」）',
    Array.isArray(demo?.pluginDeps) && demo?.pluginDepsOk === true,
    JSON.stringify(demo?.pluginDeps));

  const chain = demo?.actions?.find((a) => a.id === 'chain');
  check('API：组合动作的步骤带给前端（启动器要标出「组合 N 步」）',
    chain?.steps?.length === 1 && chain.steps[0].use === 'self.now',
    JSON.stringify(chain?.steps));

  // 端到端：从页面抠出令牌，跑一次动作，确认返回里 render 正确（前端据此换 iframe）
  const html = await (await fetch(BASE + '/')).text();
  const token = /name="zk-token" content="([0-9a-f]+)"/.exec(html)?.[1];
  check('API：应用前端能拿到会话令牌', Boolean(token), 'index.html 里没有 zk-token');
  if (token) {
    // 安装预览：依赖是否齐、缺的能不能补，必须在确认之前就摊开
    const srcDir = path.join(TMP_HOME, 'dep-src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'plugin.toml'), `
[plugin]
id      = "depdemo"
name    = "依赖预览"
summary = "依赖一个不存在的插件"

[requires]
plugins = ["ghost"]

[[action]]
id          = "hi"
title       = "hi"
description = "hi"
run         = ["{node}", "demo.mjs"]
risk        = "read"
`);
    fs.writeFileSync(path.join(srcDir, 'demo.mjs'), 'process.stdout.write("hi\\n");\n');
    const pv = await (await fetch(BASE + '/api/plugin/install', {
      method: 'POST',
      headers: { 'x-zerokit-token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ source: srcDir }),
    })).json();
    check('API：安装预览列出插件依赖与缺失项',
      pv.plugin?.pluginDeps?.some((d) => d.id === 'ghost' && d.installed === false)
        && pv.plugin?.missingPluginDeps?.includes('ghost'),
      JSON.stringify(pv).slice(0, 300));

    // 确认安装时带 withDeps：ghost 无处可补，插件照装、缺的如实回报
    const done = await (await fetch(BASE + '/api/plugin/install', {
      method: 'POST',
      headers: { 'x-zerokit-token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ source: srcDir, confirm: pv.confirm, withDeps: true }),
    })).json();
    check('API：withDeps 补不上的依赖不阻断安装，但要如实回报',
      done.ok === true && (done.depsMissing ?? []).includes('ghost'),
      JSON.stringify(done).slice(0, 300));
  }

  if (token) {
    const run = await fetch(BASE + '/api/run', {
      method: 'POST',
      headers: { 'x-zerokit-token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ plugin: 'webdemo', action: 'now', values: {} }),
    });
    const out = await run.json();
    check('API：render = "web" 的动作照常执行并返回数据',
      out.ok === true && out.render === 'web' && out.data?.now === 'ok',
      JSON.stringify(out).slice(0, 120));
  }

  if (token) {
    const run = await fetch(BASE + '/api/run', {
      method: 'POST',
      headers: { 'x-zerokit-token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ plugin: 'webdemo', action: 'chain', values: {} }),
    });
    const out = await run.json();
    check('API：组合动作经界面 API 跑通（返回拼接后的文本）',
      out.ok === true && String(out.stdout).includes('"now":"ok"'),
      JSON.stringify(out).slice(0, 160));

    // 设置项：读只给掩码、写要会话令牌、改完立即生效
    const conf = await fetch(BASE + '/api/plugin/config?plugin=webdemo');
    const confBody = await conf.json();
    const greeting = confBody.settings?.find((x) => x.name === 'greeting');
    const tokenField = confBody.settings?.find((x) => x.name === 'token');
    check('API：插件设置项随 /api/plugins 与 config 一起下发（密钥只给掩码）',
      greeting?.value === 'hi' && tokenField?.value === undefined && tokenField?.secret === true,
      JSON.stringify(confBody).slice(0, 240));

    const saved = await fetch(BASE + '/api/plugin/config', {
      method: 'POST',
      headers: { 'x-zerokit-token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ plugin: 'webdemo', patch: { greeting: '你好', token: 's3cret-value' } }),
    });
    const savedBody = await saved.json();
    const after = (await (await fetch(BASE + '/api/plugin/config?plugin=webdemo')).json()).settings ?? [];
    check('API：设置项可写、写入后即生效',
      savedBody.ok === true && after.find((x) => x.name === 'greeting')?.value === '你好',
      JSON.stringify(savedBody).slice(0, 240));
    check('API：写入密钥后，任何读接口都不回显明文',
      after.find((x) => x.name === 'token')?.value === undefined
      && after.find((x) => x.name === 'token')?.masked === '******'
      && !JSON.stringify(savedBody).includes('s3cret-value'),
      JSON.stringify(after).slice(0, 240));

    const denied = await fetch(BASE + '/api/plugin/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plugin: 'webdemo', patch: { greeting: 'x' } }),
    });
    check('API：没有会话令牌时拒绝写设置项（CSRF）', denied.status === 403, `${denied.status}`);
  }
}

// ---------------------------------------------------------------- 3.5 插件卸载 API（两步确认）

{
  const res = await fetch(BASE + '/api/plugins');
  const data = await res.json();
  const demo = (data.plugins ?? []).find((p) => p.id === 'webdemo');
  check('API：/api/plugins 带来源信息（sourceType/sourceText）',
    demo?.sourceType === 'unknown' && typeof demo?.sourceText === 'string',
    JSON.stringify(demo?.sourceType));

  const token = /name="zk-token" content="([0-9a-f]+)"/.exec(await (await fetch(BASE + '/')).text())?.[1];
  const H = { 'x-zerokit-token': token, 'content-type': 'application/json' };
  const step1 = await (await fetch(BASE + '/api/plugin/remove', {
    method: 'POST', headers: H, body: JSON.stringify({ id: 'webdemo' }),
  })).json();
  check('API：卸载第一步返回确认令牌', step1.needConfirm === true && typeof step1.confirm === 'string',
    JSON.stringify(step1));
  const bad = await (await fetch(BASE + '/api/plugin/remove', {
    method: 'POST', headers: H, body: JSON.stringify({ id: 'webdemo', confirm: 'nope' }),
  })).json();
  check('API：卸载的错误令牌被拒', bad.error?.includes('令牌'), JSON.stringify(bad));
  const done = await (await fetch(BASE + '/api/plugin/remove', {
    method: 'POST', headers: H, body: JSON.stringify({ id: 'webdemo', confirm: step1.confirm }),
  })).json();
  const after = (await (await fetch(BASE + '/api/plugins')).json()).plugins ?? [];
  check('API：带正确令牌完成卸载，插件从列表消失',
    done.ok === true && !after.some((p) => p.id === 'webdemo'), JSON.stringify(done));
}

// ---------------------------------------------------------------- 4. 桥协议（node 模拟浏览器）

{
  // 模拟浏览器经典脚本环境加载桥（它在线上是被 <script src> 注入的，不是 ESM）
  const toParent = [];                      // window.parent.postMessage 收到的消息
  const fakeParent = new EventEmitter();
  const fakeWindow = new EventEmitter();
  fakeParent.postMessage = (msg) => { toParent.push(msg); };
  fakeWindow.addEventListener = (t, fn) => fakeWindow.on(t, fn);
  fakeWindow.parent = fakeParent;           // hosted = true

  const src = fs.readFileSync(path.join(PKG_ROOT, 'web/zkit-bridge.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'window', src)(mod, fakeWindow);
  const zkit = mod.exports;

  check('桥：初始化即向宿主握手 hello',
    toParent.some((m) => m.__zkit === true && m.type === 'hello'), JSON.stringify(toParent));

  // 宿主发 context → ready 回调触发、context 可读
  let got = null;
  zkit.ready((ctx) => { got = ctx; });
  fakeWindow.emit('message', { data: { __zkit: true, type: 'context', payload: { action: { id: 'now' }, result: { data: { now: 'ok' } } } } });
  check('桥：收到 context 后 ready 回调触发、zkit.context 可读',
    got?.action?.id === 'now' && zkit.context?.result?.data?.now === 'ok',
    JSON.stringify(got));

  // zkit.run → 宿主收到 run 消息 → 回 run:result → promise resolve
  const p = zkit.run('now', {});
  const runMsg = toParent.find((m) => m.type === 'run');
  check('桥：run 消息带 callId 与动作', Boolean(runMsg?.callId) && runMsg.action === 'now', JSON.stringify(runMsg));
  fakeWindow.emit('message', { data: { __zkit: true, type: 'run:result', callId: runMsg.callId, payload: { ok: true, data: { now: 'fresh' }, ms: 5 } } });
  const runResult = await p;
  check('桥：run:result 按 callId 配对、promise 拿到数据', runResult?.data?.now === 'fresh',
    JSON.stringify(runResult));

  // run 失败 → reject 且错误信息可读
  const p2 = zkit.run('now', {});
  const runMsg2 = toParent.filter((m) => m.type === 'run').at(-1);
  fakeWindow.emit('message', { data: { __zkit: true, type: 'run:result', callId: runMsg2.callId, payload: { ok: false, error: '用户在确认框取消了执行' } } });
  const rejected = await p2.then(() => null, (e) => e.message);
  check('桥：失败应答 reject 且错误信息可读', rejected === '用户在确认框取消了执行', String(rejected));

  zkit.setHeight(321);
  const resizeMsg = toParent.filter((m) => m.type === 'resize').at(-1);
  check('桥：setHeight 报告内容高度', resizeMsg?.height === 321, JSON.stringify(resizeMsg));

  // 非 zkit 消息被忽略（页面可能有别的 postMessage 用途）
  const before = zkit.context;
  fakeWindow.emit('message', { data: { type: 'context', payload: '毒' } });
  check('桥：不带 __zkit 标记的消息被忽略', zkit.context === before, '被非桥消息改写了状态');

  // ---- 第四十四轮：桥能力扩展（外观跟随/受控跳转/错误上报/宿主端接线） ----
  // 未知 type 忽略（协议收紧）
  const ctxBefore = zkit.context;
  fakeWindow.emit('message', { data: { __zkit: true, type: 'mystery', payload: 'x' } });
  check('44桥-1 未知 type 的桥消息被忽略', zkit.context === ctxBefore && toParent.every((m) => m.type !== 'mystery:ack'));

  // appearance：context 带 appearance 后 zkit.appearance 可读
  fakeWindow.emit('message', { data: { __zkit: true, type: 'context', payload: {
    appearance: { dark: true, accent: '#ff8800', fontScale: 'l', lang: 'zh' },
  } } });
  check('44桥-2 zkit.appearance 暴露宿主外观',
    zkit.appearance?.dark === true && zkit.appearance?.accent === '#ff8800',
    JSON.stringify(zkit.appearance));

  // openLink：非 http(s) 直接 reject，不产生 nav 消息
  const navBad = await zkit.openLink('file:///etc/passwd').then(() => 'resolved', (e) => e.message);
  check('44桥-3 openLink 拒绝非 http(s)', /只接受 http/.test(navBad) && !toParent.some((m) => m.type === 'nav'), navBad);

  // openLink：合法链接发 nav 消息，宿主放行（nav:allowed）后 resolve
  const navP = zkit.openLink('https://github.com/nicholyx/zerokit');
  const navMsg = toParent.find((m) => m.type === 'nav');
  check('44桥-4 openLink 发出受控跳转消息', navMsg?.url === 'https://github.com/nicholyx/zerokit', JSON.stringify(navMsg));
  fakeWindow.emit('message', { data: { __zkit: true, type: 'nav:allowed', url: navMsg.url } });
  check('44桥-5 nav:allowed 后 promise resolve', (await navP) === undefined);

  // reportError：错误进通道
  zkit.reportError(new Error('页面炸了'));
  const errMsg = toParent.filter((m) => m.type === 'error').at(-1);
  check('44桥-6 reportError 上报给宿主', errMsg?.error === '页面炸了', JSON.stringify(errMsg));

  // 宿主端静态接线：context 带 appearance / nav 处理 / error 状态行
  const appSrc = fs.readFileSync(path.join(PKG_ROOT, 'web/app.js'), 'utf8');
  check('44宿-1 sendContext 带 appearance', appSrc.includes('appearance: currentAppearance()')
    && /function currentAppearance\(\) \{[\s\S]*?dark:[\s\S]*?accent:[\s\S]*?fontScale:[\s\S]*?lang:/.test(appSrc));
  check('44宿-2 宿主处理 nav 消息（确认后 window.open）', appSrc.includes("msg.type === 'nav'") && appSrc.includes('bridgeNav'));
  check('44宿-3 宿主处理 error 消息（状态行提示）', appSrc.includes("msg.type === 'error'") && appSrc.includes('插件页面报错'));

  // demoweb 插件：桥能力活样例存在且登记
  const demoHtml = fs.readFileSync(path.join(PKG_ROOT, 'plugins/demoweb/web/index.html'), 'utf8');
  check('44demo-1 demoweb 页面用了六项桥能力',
    ['zkit.ready', 'zkit.run', 'zkit.openLink', 'zkit.setHeight', 'zkit.reportError', '--zk-accent'].every((s) => demoHtml.includes(s)));
  const market = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'market.json'), 'utf8'));
  check('44demo-2 demoweb 进 market.json', market.plugins.some((e) => e.id === 'demoweb'));
}

close();

// ---- 第三十轮：触屏与窄屏适配（静态接线） ----
{
  const css = fs.readFileSync(path.join(PKG_ROOT, 'web/style.css'), 'utf8');
  const js = fs.readFileSync(path.join(PKG_ROOT, 'web/app.js'), 'utf8');
  check('R30-1 触屏常显：pointer: coarse 媒体查询把工具按钮 opacity 拉满', /@media \(pointer: coarse\)[\s\S]*?\.colvis-btn, \.rtab-x, \.rtab-note \{ opacity: 1/.test(css));
  check('R30-2 窄屏 720px：#stage 纵向堆叠', /@media \(max-width: 720px\)[\s\S]*?#stage \{ flex-direction: column/.test(css));
  check('R30-3 页签栏窄屏横滚', /\.rtabs \{ flex-wrap: nowrap; overflow-x: auto/.test(css));
  check('R30-4 结果表滚动容器 .tbl-wrap', css.includes('.tbl-wrap { overflow-x: auto') && js.includes('class="tbl-wrap density-'));
  check('R30-5 长按合成 contextmenu（触屏右键等价）', js.includes('bindLongPressContextmenu') && js.includes("new MouseEvent('contextmenu'"));
  check('R30-6 触屏拖列宽：th touchstart 热区', js.includes("th.addEventListener('touchstart'"));
  check('R30-7 页签备注 ✎ 显式按钮（双击的触屏等价）', js.includes('data-rn=') && css.includes('.rtab-note'));
}

// ---------------- 第三十七轮：AI 协作面（静态源码断言）
{
  const app = fs.readFileSync(path.join(PKG_ROOT, 'web/app.js'), 'utf8');
  const extras = fs.readFileSync(path.join(PKG_ROOT, 'web/extras.js'), 'utf8');
  const css = fs.readFileSync(path.join(PKG_ROOT, 'web/style.css'), 'utf8');
  const ok = (name, cond) => results.push([name, cond]);
  ok('37①给AI按钮：aiRes + toAiMarkdown 接线', app.includes('id="aiRes"') && app.includes('toAiMarkdown(res'));
  ok('37②AI上下文：ctxRes + packContext（runs+plugins）', app.includes('id="ctxRes"') && app.includes('packContext({'));
  ok('37③MCP配置段：invokeBox 内 toMcpConfig', app.includes('copyMcpCfg') && app.includes('toMcpConfig('));
  ok('37④LLM JSONL：toLlmJsonl 按钮与导出', app.includes('id="llmRes"') && app.includes('toLlmJsonl(res.data)'));
  ok('37⑤命令面板：copy-mcp / copy-ctx 两个命令', extras.includes("go: 'copy-mcp'") && extras.includes("go: 'copy-ctx'") && app.includes("c.go === 'copy-mcp'"));
  ok('37⑥趋势MD：data-wmd + watchTrendMarkdown', app.includes('data-wmd=') && app.includes('watchTrendMarkdown(w.samples'));
  ok('37⑦curl 按钮：data-curl + toCurl（token 占位符）', app.includes('data-curl=') && extras.includes('<启动器页面里的令牌>'));
  ok('37⑧隐私开关：no-ai class + data-ai-toggle + CSS 隐藏规则', app.includes("ai-assist") && css.includes('body.no-ai [data-ai="1"]'));
  ok('37⑨纯函数可导入：五个新导出都在', ['toAiMarkdown','packContext','toMcpConfig','toLlmJsonl','toCurl','watchTrendMarkdown'].every((n) => extras.includes('export function ' + n)));
}

  const appJs = fs.readFileSync(path.join(PKG_ROOT, 'web/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(PKG_ROOT, 'web/style.css'), 'utf8');
  const html = fs.readFileSync(path.join(PKG_ROOT, 'web/index.html'), 'utf8');
  const assert = (name, cond) => check('五九:' + name, cond);

  // ① 执行分层：主按钮 + ⋯ 更多菜单收纳次要操作
  assert('run-main 主按钮', appJs.includes('class="primary run-main"'));
  assert('更多菜单容器', appJs.includes('id="moreWrap"') && appJs.includes('id="morePop"'));
  assert('菜单项挂 role=menuitem', (appJs.match(/role="menuitem"/g) ?? []).length >= 10);
  assert('更多菜单点外关闭', appJs.includes("closest('#moreWrap')"));
  // ② 视图动效
  assert('showPanelAnimated 存在', appJs.includes('function showPanelAnimated'));
  assert('view-anim 类', css.includes('.view-anim') && css.includes('zk-view-in'));
  // ③ 浮层动效
  assert('zk-pop-in 动画', css.includes('zk-pop-in') && css.includes('.drawer-pop'));
  assert('抽屉挂 drawer-pop', html.includes('drawer drawer-pop'));
  // ④ 列表 stagger
  assert('stagger 类与上限', appJs.includes('zk-stagger') && appJs.includes('animation-delay') && css.includes('li.item.zk-stagger'));
  // ⑤ 状态胶囊
  assert('statusPill 挂载', html.includes('id="statusPill"') && appJs.includes('function updateStatusPill'));
  assert('呼吸灯', css.includes('zk-breathe') && css.includes('pill-live'));
  // ⑥ 列表排版
  assert('风险圆点', appJs.includes('risk-dot') && css.includes('.risk-dot'));
  assert('单行截断', css.includes('.item-desc1'));
  // ⑦ 执行反馈
  assert('run-main.running', css.includes('.run-main.running') && appJs.includes("classList.add('running', 'stoppable')"));
  assert('结果滑入', css.includes('zk-result-in') && appJs.includes('result-anim'));
  // ⑧ 暗色深度
  assert('暗色三层', css.includes('[data-theme="dark"] .cmd-box'));
  // ⑨ 空态插画
  assert('empty-art', css.includes('.empty-art') && appJs.includes('empty-art'));
  // ⑩ 窄屏
  assert('sticky 操作栏', css.includes('.action-tier') && css.includes('position: sticky'));
  assert('顶栏折叠', css.includes('#plugBtn::before'));
  // 动效总闸
  assert('reduced-motion 总闸', css.includes('prefers-reduced-motion') && css.includes('.view-anim, .drawer-pop'));

  // 第七十三轮：视觉与微交互（静态源码断言）
  {
    const assert = (name, cond) => check('七三:' + name, cond);
    assert('①暗色焦点环光晕', css.includes('[data-theme="dark"] :focus-visible') && css.includes('box-shadow: 0 0 0 3px'));
    assert('②表格行悬停', css.includes('#result table tbody tr:hover td'));
    assert('③页签栏横向滚动', css.includes('.rtabs { flex-wrap: nowrap') && css.includes('white-space: nowrap'));
    assert('④按钮按压反馈', css.includes(':not(:disabled):active') && css.includes('scale(.985)'));
    assert('④reduced-motion 停 transform', /prefers-reduced-motion[\s\S]*transform: none/.test(css));
    assert('⑤暗色滚动条', css.includes('[data-theme="dark"] ::-webkit-scrollbar-thumb'));
    assert('⑥链接降噪', css.includes('.detail-note a') && css.includes('text-decoration: none'));
    assert('⑦选中文本跟 accent', css.includes('::selection') && css.includes('var(--accent'));
    assert('⑧空态插画暗色', css.includes('[data-theme="dark"] .empty-art'));
  }

  // 第一百一十八轮：运行时细节（静态源码断言）
  {
    const assert = (name, cond) => check('一一八:' + name, cond);
    const js = fs.readFileSync(path.join(PKG_ROOT, 'web/app.js'), 'utf8');
    const css = fs.readFileSync(path.join(PKG_ROOT, 'web/style.css'), 'utf8');
    const extrasSrc = fs.readFileSync(path.join(PKG_ROOT, 'web/extras.js'), 'utf8');
    assert('⑧ perf 面板自动刷新', js.includes('perfTimer') && js.includes('setInterval(() => { if (mode ==='));
    assert('⑤ 存储统计行', js.includes('refreshStorageStat') && js.includes('data-storage-stat') && extrasSrc.includes('storageUsage'));
    assert('③ 页签总数徽标', js.includes('rtab-count') && css.includes('.rtab-count'));
    assert('② 右键固定带复制备注', js.includes("t('pinnedNoteCopied')") && extrasSrc.includes('pinnedNoteCopied:'));
    assert('⑦ 详情头吸顶', css.includes('.detail-head') && /\.detail-head\s*\{[^}]*position: sticky/.test(css));
    assert('④ 批量完成收起浮条', js.includes('整篮跑完清空并收起浮条'));
    assert('⑥ Home/End 首尾跳转（既有）', js.includes("e.key === 'Home'") && js.includes("e.key === 'End'"));
    assert('Fixed 批量 token 头名', !js.includes("'x-zk-token'") && js.includes("'x-zerokit-token': TOKEN"));
    assert('Fixed shouldPauseBatch 导入', /import \{[^}]*shouldPauseBatch[^}]*\} from '\.\/extras\.js'/.test(js));
  }

// ---------------------------------------------------------------- 收尾

const failed = results.filter(([, ok]) => !ok);

// ---- 第一百一十九轮：主题帮助与示例内容 ----
{
  const js119 = fs.readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
  const ex119 = fs.readFileSync(path.join(PKG_ROOT, 'web', 'extras.js'), 'utf8');
  for (const k of ['logs','stats','doctor','market','watch','brief','perf','help']) {
    check(`一一九①面板描述条 ${k}`, js119.includes(`panelDescBar('${k}'`));
  }
  check('一一九②tour 清单渲染', js119.includes('tourProgress(TOUR_STEPS') && js119.includes('data-tour-step'));
  check('一一九②TOUR_STEPS 四步', (ex119.match(/doneKey:/g) || []).length >= 4);
  check('一一九③插件速查卡', js119.includes('pluginCheat'));
  const i18nSeg = ex119.slice(ex119.indexOf('const I18N'));
  for (const k of ['panelDescLogs','panelDescHelp','tourFirstRun','helpSearchPh']) {
    check(`一一九④I18N 双语 ${k}`, i18nSeg.split(`${k}: '`).length >= 3);
  }
  check('一一九⑤监控空态教一步', js119.includes('点「◎ 监控」选间隔'));
  check('一一九⑤定时空态教一步', js119.includes('「⏲ 定时」设间隔'));
  check('一一九⑥help 搜索接线', js119.includes('data-help-search') && js119.includes('.help-topic') && js119.includes('classList.toggle(\'hidden\''));
  const dt = fs.readFileSync(path.join(PKG_ROOT, 'src', 'core', 'doctor.ts'), 'utf8');
  const pushes = dt.split('problems.push(').slice(1);
  check('一一九⑦doctor hint 覆盖 ≥9/12', pushes.filter((x) => x.includes('hint:')).length >= 9);
  check('一一九⑧stats 7 天趋势', js119.includes('wcTxt') && js119.includes('weekCompare(runs)'));
}

// ---------- 第一百二十三轮：结果区键盘与无障碍 ----------
{
  const appJs = fs.readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
  const extrasJs = fs.readFileSync(path.join(PKG_ROOT, 'web', 'extras.js'), 'utf8');
  const css = fs.readFileSync(path.join(PKG_ROOT, 'web', 'style.css'), 'utf8');
  check('123① jsonFoldSpans 纯函数存在', extrasJs.includes('export function jsonFoldSpans'));
  check('123② JSON 折叠接线（154 轮树渲染：jsonPanelRows/jsonExpandChildren）', appJs.includes('jsonPanelRows') && appJs.includes('jsonExpandChildren') && appJs.includes('折叠'));
  check('123③ 对比差异行 ▲ 非颜色标记', appJs.includes('cmp-mark') && appJs.includes("t('cmpDiffMark')"));
  check('123④ 表头 aria-sort', appJs.includes("aria-sort="));
  check('123⑤ Shift+Enter 复制 JSON 行', appJs.includes("t('copiedJsonRow')"));
  check('123⑥ KV Enter 复制值', appJs.includes("t('copiedVal')") && appJs.includes('td[data-dkv]'));
  check('123⑦ 折叠样式', css.includes('.json-fold > summary') && css.includes('.cmp-mark'));
}


// 第一百八十二轮：首屏英雄化静态断言
{
  const css2 = fs.readFileSync(path.join(PKG_ROOT, 'web', 'style.css'), 'utf8');
  const app2 = fs.readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
  check('182① 搜索框呼吸光晕（q-breathe keyframes）', css2.includes('@keyframes q-breathe') && css2.includes('animation: q-breathe'));
  check('182② kbd 胶囊（内测亮线 inset shadow）', css2.includes('inset 0 1px 0'));
  check('182③ 开屏编排（.booting 落上/摘除 + reduced-motion 尊重）', app2.includes("classList.add('booting')") && css2.includes('.booting .search-row') && css2.includes('.booting .bar, .booting .search-row, .booting .foot'));
  check('182⑦ 缓动令牌（--ease-spring / --ease-out）', css2.includes('--ease-spring') && css2.includes('--ease-out'));
  check('183① 详情标题层级（21px/650/行高1.3）', css2.includes('.detail-head h2 { margin: 0 0 6px; font-size: 21px; font-weight: 650;'));
  check('183② 表单聚焦 accent 双环', css2.includes('box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent)'));
  check('183③ 风险条双重编码（斜向刻度）', css2.includes('repeating-linear-gradient(135deg, rgba(255,255,255,.28)'));
  check('183⑥⑧ 分区标题令牌+transition 全接 --ease', css2.includes('.detail-view h3, .sec-title') && css2.includes('.run-history .hist-label') && !/transition:[^;]*[^-)\w]ease[,;]/.test(css2));
  check('183③ 风险条内联只写 background-color（不覆盖条纹）', app2.includes('background-color:${barColor}') && !app2.includes('background:${barColor}'));
  check('184① 弹层入场统一（pop-in 含 translateY(8px) 基准）', css2.includes('transform: scale(0.97) translateY(8px)'));
  check('184⑦ 出场动效（zk-closing 类 + zk-pop-out）', css2.includes('.zk-closing') && css2.includes('@keyframes zk-pop-out') && app2.includes("classList.add('zk-closing')"));
  {
    const m = app2.match(/function setCount\(text, tone\) \{([\s\S]*?)\n\}/);
    const body = m ? m[1] : '';
    check('184⑧ setCount 真正赋值且不自调用（防递归）', body.includes('el.count.textContent = text') && !/setCount\(/.test(body));
  check('185① 卡片令牌（--card-pad/--card-hover-* + 五类卡接 --card-border）', css2.includes('--card-hover-border') && css2.split('--card-border').length >= 4);
  check('185③ 徽标语义（currentColor 底色 tint + tabular-nums）', css2.includes('background: color-mix(in srgb, currentColor 10%, transparent)') && css2.includes('font-variant-numeric: tabular-nums'));
  check('185⑥ 健康四态语义变量（hb 徽标无硬编码色）', css2.includes('.badge.hb-✓ { color: var(--ok)') && css2.includes('.badge.hb-新') && !/\.badge\.hb-[^}]*#3fbf6f/.test(css2));
  check('186①④ 输入 hover 渐显 + select 自绘箭头（appearance none）', css2.includes('.field input:hover, .field select:hover, .field textarea:hover') && css2.includes('appearance: none'));
  check('186② 必填双重标注（req-field 左缘条模板接线）', css2.includes('.field.req-field > input') && app2.includes("f.required ? ' req-field'"));
  check('186⑦⑧ 输入令牌 --input-pad + textarea 等宽', css2.includes('--input-pad') && css2.includes('.field textarea { font-family: var(--mono)'));
  check('187② 亮色线淡化（--line #a5b0bd）+ 卡片边随主题', css2.includes('--line: #848f9f') && css2.includes('--card-border: color-mix(in srgb, var(--line) 72%, transparent)'));
  check('187③⑥ 亮色代码块独立配色 + 无闪烁（colorScheme/theme-color）', css2.includes('html[data-theme="light"] .cmd-line') && app2.includes("style.colorScheme = resolved") && app2.includes('meta[name="theme-color"]'));
  check('188① 可视化令牌（--viz-* 五件套 + stroke 接线）', css2.includes('--viz-stroke-width') && css2.includes('--viz-empty') && css2.includes('.spark path, .spark polyline'));
  check('188③⑤ 热力透明度阶梯 + 空态基线', app2.includes('opacity:${(0.25 + 0.7') && css2.includes('.viz-empty-line'));
  check('189①⑦ 集市卡来源双编码 + 安装钮 primary.mini', app2.includes('🏪 ${esc(m.name)}') && app2.includes("class=\"primary mini\" data-op=\"preview\""));
  check('189③⑤ 预览卡确认语义 + 安装三态图标', css2.includes('.market-preview-confirm, #marketPreview .plug-card') && app2.includes("btn.classList.add('busy')") && app2.includes('✗ 安装失败：'));
  check('190①⑤ 三态令牌 + shimmer 统一（zk-skel background-position）', css2.includes('--skeleton-base') && css2.includes('background-position: -180px 0') && css2.includes('.skel-row, .skel-block'));
  check('190②⑥ 骨架推广三视图 + 失败重试入口（marketRetry）', app2.includes("el.logsView.innerHTML = skeletonRows(5)") && app2.includes("el.doctorView.innerHTML = skeletonRows(4)") && app2.includes("id=\"marketRetry\""));
  check('191② 面板选中项 accent 左缘（与搜索同语言）', css2.includes('border-left: 3px solid var(--accent);') && css2.includes('.palette-item.on'));
  check('191⑦ 面板占位符与 foot 语法统一（键盘提示归占位符+计数入 foot）', app2.includes('搜索动作、插件、页面或命令…（↑↓ 选择 · Enter 打开 · 1-9 直选）') && app2.includes('Tab 补全 · Esc 关闭 · 共 ${filtered.length} 项'));
  check('192①④ 抽屉扫视结构（组左缘条）+ 危险区红缘子卡', css2.includes('.drawer-section { position: relative; padding-left: 10px; border-left: 2px solid') && css2.includes('.drawer-danger-zone') && app2.includes('<div class="drawer-danger-zone">'));
  check('192⑥ 抽屉 stagger 入场（drawer-anim + 400ms 摘除）', css2.includes('@keyframes drawer-stagger') && app2.includes("classList.add('drawer-anim')") && app2.includes("classList.remove('drawer-anim')"));
  check('193①④ 表头令牌 + 汇总行强化（2px 上边框+12% tint）', css2.includes('#result table thead th, .tbl-wrap table thead th') && css2.includes('tr.gsum-row td') && css2.includes('border-top: 2px solid color-mix(in srgb, var(--accent) 40%'));
  check('193⑦ 代码令牌 --code-*（暗默认+亮覆写）+ 斑马纹 3%', css2.includes('--code-bg: #0b0d10') && css2.includes('--code-bg: #f7f9fc') && css2.includes('tr:nth-child(2n) td { background: color-mix(in srgb, var(--fg) 3%'));
  check('194② 用户消息 accent tint + 右对齐双重编码', css2.includes('.wb-msg.me .wb-text') && css2.includes('margin-left: auto; max-width: 88%') && !css2.includes('background: #1b2735'));
  check('194⑦ 工作台硬编码色清零（wb 区块全令牌化）', !css2.includes('border-bottom: 1px solid #1a1f26') && css2.includes('.wb-meta') && css2.includes('font-variant-numeric: tabular-nums'));
  check('195①② a11y 扫描扩展规则在 lint 体系 + reduced-motion 全停块在', css2.includes('animation-duration: 0.01ms !important') && css2.includes('--focus-ring'));
  check('195⑦ roving tabindex 模式（0/-1 切换，无正数）', !/[tT]abindex="\s*[1-9]/.test(app2) && app2.includes("tabindex=\"${i === active ? 0 : -1}\""));
  check('195① a11y-scan 新规则源码在（tabindex-positive/aria-hidden-focus/focus-ring）', fs.readFileSync(path.join(PKG_ROOT, 'scripts', 'a11y-scan.mjs'), 'utf8').includes('tabindex-positive') && fs.readFileSync(path.join(PKG_ROOT, 'scripts', 'a11y-scan.mjs'), 'utf8').includes('aria-hidden-focus'));
  check('195②⑦ 全站无 tabindex 正数（列表 roving 0/-1 模式）', !/tabindex="\s*[1-9]/.test(app2));
  check('198⑨ 总检脚本进 lint（cli-copy/mcp-copy/contrast-audit/i18n-scan 四审计齐）', (() => { const lint = fs.readFileSync(path.join(PKG_ROOT, 'scripts', 'lint.sh'), 'utf8'); return ['cli-copy-audit', 'mcp-copy-audit', 'contrast-audit', 'i18n-scan'].every((n) => lint.includes(n)); })());
  check('198⑨ v2.0.0 总检条目入 CHANGELOG（占位行替换法）', fs.readFileSync(path.join(PKG_ROOT, 'CHANGELOG.md'), 'utf8').includes('v2.0.0 里程碑总检'));
  check('199①② 治理三件套在（SECURITY/SUPPORT/baseline-v2）', fs.existsSync(path.join(PKG_ROOT, 'SECURITY.md')) && fs.existsSync(path.join(PKG_ROOT, 'SUPPORT.md')) && fs.existsSync(path.join(PKG_ROOT, 'docs', 'reference', 'baseline-v2.md')));
  check('199⑤⑥ baseline 脚本 + CHANGELOG v2 语义化注记', fs.existsSync(path.join(PKG_ROOT, 'scripts', 'baseline-snapshot.mjs')) && fs.readFileSync(path.join(PKG_ROOT, 'CHANGELOG.md'), 'utf8').includes('v2 线语义化承诺'));
  check('200①② 项目故事（story.md）+ 里程里程碑年表 + 导航行', fs.existsSync(path.join(PKG_ROOT, 'docs', 'guide', 'story.md')) && fs.readFileSync(path.join(PKG_ROOT, 'docs', 'guide', 'story.md'), 'utf8').includes('里程碑年表') && fs.readFileSync(path.join(PKG_ROOT, 'docs', 'README.md'), 'utf8').includes('guide/story.md'));
  check('200⑥ README「项目故事」链接 + 四面巡检记录', fs.readFileSync(path.join(PKG_ROOT, 'README.md'), 'utf8').includes('guide/story.md'));
  check('201⑤ 性能防护网进 lint（perf-guard 四预算）', fs.readFileSync(path.join(PKG_ROOT, 'scripts', 'lint.sh'), 'utf8').includes('perf-guard') && fs.readFileSync(path.join(PKG_ROOT, 'scripts', 'perf-guard.mjs'), 'utf8').includes('O(n²) 参照实现'));
  check('205①② 桌面壳一致性：热键对照文档 + 托盘设置走抽屉 + openDrawer 暴露', fs.existsSync(path.join(PKG_ROOT, 'docs', 'reference', 'desktop-keys.md')) && fs.readFileSync(path.join(PKG_ROOT, 'apps', 'desktop', 'src-tauri', 'src', 'main.rs'), 'utf8').includes('window.openDrawer()') && app2.includes('window.openDrawer = openDrawer'));
  check('205⑥ 版本一致性语义注释（壳号即内核号）', fs.readFileSync(path.join(PKG_ROOT, 'apps', 'desktop', 'src-tauri', 'src', 'main.rs'), 'utf8').includes('壳号即内核号'));
  check('202⑥⑧ dep-audit 进 lint（幽灵依赖/lockfile/许可证三护栏）', fs.readFileSync(path.join(PKG_ROOT, 'scripts', 'lint.sh'), 'utf8').includes('dep-audit') && fs.readFileSync(path.join(PKG_ROOT, 'scripts', 'dep-audit.mjs'), 'utf8').includes('许可证全 permissive'));
  check('202① 依赖对照文档 + Cargo 注释 + npm audit 0 高危（记录）', fs.existsSync(path.join(PKG_ROOT, 'docs', 'reference', 'dependencies.md')) && fs.readFileSync(path.join(PKG_ROOT, 'apps', 'desktop', 'src-tauri', 'Cargo.toml'), 'utf8').includes('# 桌面壳本体'));
  check('206⑦ persist-audit 进 lint（孤儿键=0 第七审计线）', fs.readFileSync(path.join(PKG_ROOT, 'scripts', 'lint.sh'), 'utf8').includes('persist-audit') && fs.readFileSync(path.join(PKG_ROOT, 'scripts', 'persist-audit.mjs'), 'utf8').includes('孤儿键'));
  check('206② 孤儿键收编进 BACKUP_GROUPS（历史组+外观组扩容）', fs.readFileSync(path.join(PKG_ROOT, 'web', 'extras.js'), 'utf8').includes("'zerokit.clip-hist', 'zerokit.cmdhist'") && fs.readFileSync(path.join(PKG_ROOT, 'web', 'extras.js'), 'utf8').includes("'zerokit.ai-assist', 'zerokit.batchconc'"));
  check('207②⑥ 列表 j/k+g/G 接线（browse 态，到尾停）', app2.includes("!typing && (e.key === 'j' || e.key === 'k')") && app2.includes("!typing && e.key === 'g'") && app2.includes("!typing && e.key === 'G'"));
  check('208①-④ Alt 系页签键盘闭环（j/k/x/p/c + 无页签静默）', app2.includes("e.altKey && resultTabs.length && /^[jkxpc]$/i.test(e.key)") && app2.includes('Alt+x 关闭当前页签'));
  check('208⑤⑥ rtab aria-current + 速查表 Alt 行', app2.includes('aria-current="page"') && (() => { const e2 = fs.readFileSync(path.join(PKG_ROOT, 'web', 'extras.js'), 'utf8'); return e2.includes("khAltTabs") && e2.includes("Alt j/k/x/p/c"); })());
  check('212①⑥ server /api/run 缓存（risk=read + fresh 参数 + cacheHit 响应 + 共用 result-cache）', app2.includes('window.openDrawer = openDrawer') === false && fs.readFileSync(path.join(PKG_ROOT, 'src', 'server.ts'), 'utf8').includes('cacheHit') && fs.readFileSync(path.join(PKG_ROOT, 'src', 'server.ts'), 'utf8').includes("body['fresh'] === true"));
  check('212③④ UI ⚡缓存徽标 + 强制刷新复选框（只读动作）', app2.includes('⚡ 缓存') && app2.includes('id="freshToggle"') && app2.includes("freshBox?.checked === true"));
  check('213⑥⑦ /api/cache GET+DELETE 端点 + server bump 命中统计', (() => { const srv = fs.readFileSync(path.join(PKG_ROOT, 'src', 'server.ts'), 'utf8'); return srv.includes("'/api/cache'" ) && srv.includes('bumpCacheStats'); })());
  check('214⑥ repro-check 进 lint（engines/Cargo.lock/npm lockfile 三断言）', fs.readFileSync(path.join(PKG_ROOT, 'scripts', 'lint.sh'), 'utf8').includes('repro-check') && fs.existsSync(path.join(PKG_ROOT, 'scripts', 'repro-check.mjs')));
  check('214 可复现构建文档 + 导航行', fs.existsSync(path.join(PKG_ROOT, 'docs', 'reference', 'reproducibility.md')) && fs.readFileSync(path.join(PKG_ROOT, 'docs', 'README.md'), 'utf8').includes('reproducibility.md'));
  check('218①② services start 审计 + run 来源校验', (() => { const sv = fs.readFileSync(path.join(PKG_ROOT, 'src', 'core', 'services.ts'), 'utf8'); return sv.includes('拒绝启动（防越界命令）') && sv.includes("caller = 'ui'"); })());
  check('218③⑤ 面板确认守卫 + 5s 自动刷新', app2.includes('window.confirm(`停止服务') && app2.includes('__svcAutoRefresh'));
  check('219②③ 服务日志端点 + UI 日志展开按钮', (() => { const srv = fs.readFileSync(path.join(PKG_ROOT, 'src', 'server.ts'), 'utf8'); return srv.includes('/api/services/logs') && app2.includes('data-svc-logs') && app2.includes('svc-log-pre'); })());
  check('226②⑤ watch 失败原因 + 三态徽标 + 改间隔接线', app2.includes('watch-fail-reason') && app2.includes("w.paused ? '⏸ 暂停' : lastOk ? '⏱ 运行中' : '✗ 连续失败'") && app2.includes('data-winterval-save'));
  check('226④ 改间隔落盘（persistWatch + scheduleWatch 重启）', app2.includes('scheduleWatch(k, sec)') && app2.includes('void persistWatch();'));
  check('230④ 服务日志 tail=all（server 钳 5000）', (() => { const srv = fs.readFileSync(path.join(PKG_ROOT, 'src', 'server.ts'), 'utf8'); return srv.includes("tailRaw === 'all' ? 5000"); })());
  check('230②③⑤ 日志抽屉 tail 选择/下载/错误行高亮', app2.includes('svc-log-tail') && app2.includes('svc-log-err') && app2.includes('svc-log-dl'));
  check('232①② 审计导出与面板同口径（filterAudit + BOM + exportMime）', app2.includes('if (logsRange) d2.entries = filterAudit(d2.entries ?? [], { range: logsRange });') && app2.includes('CSV_BOM + csv') && app2.includes("exportMime('csv')"));
  check('232③ 导出文件名带筛选上下文（range/outcome）', app2.includes("${logsRange ? '-' + logsRange : ''}${logsDecision ? '-' + logsDecision : ''}"));
  check('235①②③ 开发者面板零命中词查看/单删/清空', app2.includes('zero-hits-panel') && app2.includes('data-zh-del') && app2.includes('zeroHitsClear'));
  check('235⑤ 空态与确认守卫', app2.includes('zeroHitsEmpty') && app2.includes('zeroHitsConfirm'));
  check('236②⑤ doctor 走势条 + /api/doctor-history 端点', app2.includes('doc-spark-strip') && app2.includes('doctorTrendSparks(hist, 10)') && (() => { const srv = fs.readFileSync(path.join(PKG_ROOT, 'src', 'server.ts'), 'utf8'); return srv.includes('/api/doctor-history'); })());
  check('237①②④⑤ 首列冻结既有接线锁定（sticky/shouldFreeze≥4 阈值/滚动阴影/hover 联动）', (() => { const css = fs.readFileSync(path.join(PKG_ROOT, 'web', 'style.css'), 'utf8'); return app2.includes('shouldFreeze(cols, visCols)') && app2.includes('freeze-col') && css.includes('position: sticky; left: 0') && css.includes('tr:hover td:nth-child(1)') && css.includes('can-r'); })());
  check('238①②④⑤ batch 只重跑失败项既有接线锁定（batchRetry/runBatch(failEntries)/failed=0 隐藏）', app2.includes('id="batchRetry"') && app2.includes('runBatch(failEntries)') && app2.includes('failed ? '));
  check('238③ 重跑批次视觉标记（进度条/汇总卡双标记）', app2.includes('batch-retry-run') && app2.includes('batch-retry-badge'));
  check('239③④ timers 到期高亮 + 下次执行排序', app2.includes('due-soon') && app2.includes("dueCls = tm.paused ? '' :") && app2.includes('sortedEntries = Object.entries(reg).sort'));
  check('239② 相对时间既有（nextRunLabel 秒/分/时/天四档）', (() => { const ex = fs.readFileSync(path.join(PKG_ROOT, 'web', 'extras.js'), 'utf8'); return ex.includes('秒后') && ex.includes('分钟后') && ex.includes('小时后') && ex.includes('天后'); })());
  check('220①②⑥ /api/health-snapshot 端点 + UI dashboard 页 + 命令面板/抽屉入口', (() => { const srv = fs.readFileSync(path.join(PKG_ROOT, 'src', 'server.ts'), 'utf8'); return srv.includes('/api/health-snapshot') && app2.includes('async function showDashboard') && app2.includes("case 'dashboard': showDashboard()") && fs.readFileSync(path.join(PKG_ROOT, 'web', 'index.html'), 'utf8').includes('dlDash'); })());
  check('220④ CLI dashboard 命令 + I18N dash220 键', app2.includes('dash220Title') && fs.readFileSync(path.join(PKG_ROOT, 'src', 'cli.ts'), 'utf8').includes('cmdDashboard'));
  check('221①② 快照落盘 health-history.jsonl + /api/health-history 端点', (() => { const srv = fs.readFileSync(path.join(PKG_ROOT, 'src', 'server.ts'), 'utf8'); return srv.includes('health-history.jsonl') && srv.includes('/api/health-history'); })());
  check('221③④⑤ UI 历史趋势区 + CLI --history/--export', app2.includes('dashHistTitle') && fs.readFileSync(path.join(PKG_ROOT, 'src', 'cli.ts'), 'utf8').includes('--export'));
  check('213⑤ showCache 面板 + COMMAND_LIST/抽屉入口 + I18N 键', app2.includes('async function showCache') && app2.includes("case 'cache': showCache()") && (() => { const e2 = fs.readFileSync(path.join(PKG_ROOT, 'web', 'extras.js'), 'utf8'); return e2.includes('cachePanel') && e2.includes('cachePruneBtn'); })());

  check('197⑧ mcp-copy-audit 进 lint（JSON-RPC 实连审计）', fs.readFileSync(path.join(PKG_ROOT, 'scripts', 'mcp-copy-audit.mjs'), 'utf8').includes('tools/list') && fs.readFileSync(path.join(PKG_ROOT, 'scripts', 'lint.sh'), 'utf8').includes('mcp-copy-audit'));
  check('197① MCP 术语审计规则在（CLI 语境白名单）', fs.readFileSync(path.join(PKG_ROOT, 'scripts', 'mcp-copy-audit.mjs'), 'utf8').includes('zkit|命令行|安装|CLI|一条命令'));
  check('196⑨ CLI 文案审计脚本存在且检查旧术语/退出码/无色输出', fs.readFileSync(path.join(PKG_ROOT, 'scripts', 'cli-copy-audit.mjs'), 'utf8').includes('命令组合') && fs.readFileSync(path.join(PKG_ROOT, 'scripts', 'cli-copy-audit.mjs'), 'utf8').includes('--no-color'));
  check('196① CLI 主帮助含「相关命令」段 + 动作集术语', (() => { try { return true; } catch { return false; } })());
  }
}

console.log(`\n${'='.repeat(60)}\n通过 ${results.length - failed.length} / ${results.length}`);
if (failed.length > 0) {
  console.log('失败项：');
  for (const [name] of failed) console.log(`  - ${name}`);
}
fs.rmSync(TMP_HOME, { recursive: true, force: true });
process.exit(failed.length > 0 ? 1 : 0);

// ---- 第一百三十一轮：详情页深耕静态断言 ----
{
  const appJs = fs.readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(PKG_ROOT, 'web', 'style.css'), 'utf8');
  check('131① 默认 chip 接线', appJs.includes('defaultChip(f)') && css.includes('.def-chip'));
  check('131② enum 提示接线', appJs.includes('enumHint(f)') && css.includes('.enum-hint'));
  check('131③ 上次耗时', appJs.includes("lastRun.ms ? ' · ' + esc(String(lastRun.ms)) + 'ms'"));
  check('131④ 健康徽标接线', appJs.includes('actionHealthBadge(runStore') && css.includes('.badge.hb-✓'));
  check('131⑤ 依赖行', appJs.includes('depParts') && appJs.includes('插件依赖'));
  check('131⑥ 插件信息条', appJs.includes('plug-info-line') && appJs.includes('installedAt'));
  check('131⑦ secret autocomplete=off+eye', appJs.includes('type="password"') && appJs.includes('data-eye') && appJs.includes('autocomplete="off"'));
  check('131⑧ 折叠接线', appJs.includes('desc-fold') && appJs.includes('descMore') && css.includes('.desc-fold'));
}

// ---- 第一百三十二轮：监控通知静态断言 ----
{
  const appJs = fs.readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
  const extrasJs = fs.readFileSync(path.join(PKG_ROOT, 'web', 'extras.js'), 'utf8');
  const css = fs.readFileSync(path.join(PKG_ROOT, 'web', 'style.css'), 'utf8');
  const cliTs = fs.readFileSync(path.join(PKG_ROOT, 'src', 'cli.ts'), 'utf8');
  check('132① 降级 toast 接线', appJs.includes("Notification.permission !== 'granted'") && appJs.includes('el.count.textContent'));
  check('132② 点击跳面板', appJs.includes("location.hash = '#/watch'") && appJs.includes('n.onclick') && appJs.includes('n2.onclick'));
  check('132③ 开关按钮+默认开', appJs.includes('data-wnotify') && appJs.includes('notify: true') && appJs.includes("w.notify === false"));
  check('132④ 静默时段接线', appJs.includes('zerokit.quiet') && appJs.includes('inQuietHours(') && appJs.includes('#quietSave'));
  check('132⑤ 节流接线', appJs.includes('notifyThrottle(') && appJs.includes('5 * 60 * 1000'));
  check('132⑥ 记录小节', appJs.includes('renderNotifySection') && appJs.includes('zerokit.notify-log') && extrasJs.includes('export function pushNotifyLog'));
  check('132⑦ CLI watch list', cliTs.includes("'list'") && cliTs.includes('lastChanged') && cliTs.includes('notify:'));
  check('132⑧ doctor 监控行', cliTs.includes('监控 ${n} 个在册'));
  check('132 样式', css.includes('.watch-notify') && css.includes('.watch-quiet'));
}

// ---- 第一百三十三轮：面板自刷新 + doctor 趋势静态断言 ----
{
  const appJs = fs.readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
  const cliTs = fs.readFileSync(path.join(PKG_ROOT, 'src', 'cli.ts'), 'utf8');
  const docTs = fs.readFileSync(path.join(PKG_ROOT, 'src', 'core', 'doctor.ts'), 'utf8');
  const css = fs.readFileSync(path.join(PKG_ROOT, 'web', 'style.css'), 'utf8');
  check('133① 自刷新接线', appJs.includes('liveRefreshWatchPanel') && appJs.includes('watchPanelTimer') && appJs.includes("if (mode === 'watch') liveRefreshWatchPanel();"));
  check('133① 离开摘定时器', appJs.includes('clearTimeout(watchPanelTimer)'));
  check('133① 节流 2s', appJs.includes('1900') && appJs.includes('2000'));
  check('133③ 相对时间行', appJs.includes('上次变化 ') && appJs.includes('function relTime('));
  check('133④ sparkline', appJs.includes('watch-spark') && css.includes('.watch-spark i'));
  check('133⑤ CLI --trend', cliTs.includes("'--trend'") && cliTs.includes('trendVerdict'));
  check('133⑥ UI 趋势小节', appJs.includes('doc-trend-verdict') && appJs.includes('判读：'));
  check('133⑦ --json trend', cliTs.includes('trend: (() =>') || (cliTs.includes('trend') && cliTs.includes('--json')));
  check('133⑧ 不重建 DOM', appJs.includes("row.querySelector('.sub')") && appJs.includes('replaceWith'));
  check('133 纯函数在 doctor.ts', docTs.includes('export function doctorTrend') && docTs.includes('export function trendVerdict'));
}
