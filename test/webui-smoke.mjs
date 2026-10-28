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
    appJs.text.includes("aria-label=\"${fav ? '取消收藏' : '收藏这个动作'}\""),
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
    appJs.text.includes('riskTally') && appJs.text.includes('只读 ${riskTally.read || 0}'),
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
  check('44宿-1 sendContext 带 appearance', /appearance: \{[\s\S]*?dark:[\s\S]*?accent:[\s\S]*?fontScale:[\s\S]*?lang:/.test(appSrc));
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

// ---------------------------------------------------------------- 收尾

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${'='.repeat(60)}\n通过 ${results.length - failed.length} / ${results.length}`);
if (failed.length > 0) {
  console.log('失败项：');
  for (const [name] of failed) console.log(`  - ${name}`);
}
fs.rmSync(TMP_HOME, { recursive: true, force: true });
process.exit(failed.length > 0 ? 1 : 0);
