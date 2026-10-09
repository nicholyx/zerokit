// 插件 web 面（render = "web"）的冒烟测试。
//
// 覆盖四层：清单校验 → server 静态托���与桥注入 → API 面透传 → 桥协议本身。
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
}

// ---------------------------------------------------------------- 3. API 面透传

{
  const res = await fetch(BASE + '/api/plugins');
  const data = await res.json();
  const demo = (data.plugins ?? []).find((p) => p.id === 'webdemo');
  check('API：/api/plugins 把 render = "web" 带给前端',
    demo?.actions?.some((a) => a.id === 'now' && a.render === 'web'),
    JSON.stringify(demo?.actions?.map((a) => [a.id, a.render])));

  // 端到端：从页面抠出令牌，跑一次动作，确认返回里 render 正确（前端据此换 iframe）
  const html = await (await fetch(BASE + '/')).text();
  const token = /name="zk-token" content="([0-9a-f]+)"/.exec(html)?.[1];
  check('API：应用前端能拿到会话令牌', Boolean(token), 'index.html 里没有 zk-token');
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
}

close();

// ---------------------------------------------------------------- 收尾

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${'='.repeat(60)}\n通过 ${results.length - failed.length} / ${results.length}`);
if (failed.length > 0) {
  console.log('失败项：');
  for (const [name] of failed) console.log(`  - ${name}`);
}
fs.rmSync(TMP_HOME, { recursive: true, force: true });
process.exit(failed.length > 0 ? 1 : 0);
