// 集市面板的冒烟测试：后端 API + 前端接线。
//
// 自包含：临时 ZEROKIT_HOME + 本地集市目录（只读本地文件，不联网、不克隆）。
// 集市本身就是一个 git 仓库 + market.json，这里只造目录，走 path: 来源分支。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zerokit-market-ui-'));
process.env['ZEROKIT_HOME'] = TMP;
const { startServer } = await import('../src/server.ts');

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   <- ' + String(detail).slice(0, 300)}`);
};

// ---------------------------------------------------------------- 造一个本地集市

const REPO = path.join(TMP, 'demo-market');
function writePlugin(id, name) {
  const dir = path.join(REPO, 'plugins', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.toml'), `
[plugin]
id      = "${id}"
name    = "${name}"
version = "1.0.0"
summary = "${name} 的摘要"

[[action]]
id          = "hello"
title       = "打招呼"
description = "输出一句话"
run         = ["{node}", "-e", "console.log('hello from ${id}')"]
output      = "text"
risk        = "read"
`);
}
writePlugin('alpha', '阿尔法');
writePlugin('beta', '贝塔');
fs.writeFileSync(path.join(REPO, 'market.json'), JSON.stringify({
  name: '演示集市',
  description: '测试用的集市',
  plugins: [
    { id: 'alpha', name: '阿尔法', summary: '第一个', version: '1.0.0', tags: ['demo'], source: 'path:plugins/alpha' },
    { id: 'beta', name: '贝塔', summary: '第二个', version: '1.0.0', tags: ['demo'], source: 'path:plugins/beta' },
  ],
}, null, 2));

// ---------------------------------------------------------------- 服务

const server = await startServer({ port: 0 });
const BASE = server.url;
const html = await (await fetch(BASE + '/')).text();
const TOKEN = /name="zk-token" content="([0-9a-f]+)"/.exec(html)?.[1];

async function get(p) {
  const res = await fetch(BASE + p);
  return { status: res.status, data: await res.json() };
}
async function post(p, body, withToken = true) {
  const headers = { 'content-type': 'application/json' };
  if (withToken && TOKEN) headers['x-zerokit-token'] = TOKEN;
  const res = await fetch(BASE + p, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}

try {
  // 1. 添加集市（本地目录）
  const added = await post('/api/market/add', { source: REPO });
  check('添加本地集市成功', added.status === 200 && added.data.ok === true,
    JSON.stringify(added.data).slice(0, 200));
  check('返回的集市名来自 market.json', added.data.markets?.[0]?.name === '演示集市',
    JSON.stringify(added.data.markets?.[0]?.name));

  // 2. 列表
  const list = await get('/api/markets');
  check('集市列表带插件条目（2 个）', list.data.markets?.[0]?.plugins?.length === 2,
    JSON.stringify(list.data.markets?.[0]?.plugins?.map((p) => p.id)));
  check('未安装的条目 installedVersion 为空',
    list.data.markets?.[0]?.plugins?.every((p) => !p.installedVersion),
    JSON.stringify(list.data.markets?.[0]?.plugins?.map((p) => p.installedVersion)));
  check('total 汇总正确', list.data.total === 2, String(list.data.total));

  // 3. 预览：摊开动作 + 确认令牌
  const preview = await post('/api/market/preview', { id: 'alpha' });
  check('预览要求确认（needConfirm）', preview.status === 200 && preview.data.needConfirm === true,
    JSON.stringify(preview.data).slice(0, 160));
  check('预览摊开动作与真实命令',
    preview.data.actions?.[0]?.id === 'hello'
      && /console\.log/.test(preview.data.actions[0].command),
    JSON.stringify(preview.data.actions));
  check('预览里的 action 标记为只读', preview.data.actions?.[0]?.risk === 'read',
    JSON.stringify(preview.data.actions?.[0]?.risk));

  // 4. 令牌校验
  const noToken = await post('/api/market/install', { id: 'alpha' });
  check('没有确认令牌拒绝安装（403）', noToken.status === 403, String(noToken.status));
  const badToken = await post('/api/market/install', { id: 'alpha', confirm: 'deadbeef' });
  check('确认令牌不对拒绝安装（403）', badToken.status === 403, String(badToken.status));
  const wrongScope = await post('/api/market/install', {
    id: 'beta', confirm: preview.data.confirm,
  });
  check('用 alpha 的令牌装 beta 被拒（令牌绑定集市+id）', wrongScope.status === 403,
    JSON.stringify(wrongScope.data));

  // 5. 正确安装
  const installed = await post('/api/market/install', {
    id: 'alpha', market: '演示集市', confirm: preview.data.confirm,
  });
  check('带正确令牌安装成功', installed.status === 200 && installed.data.ok === true,
    JSON.stringify(installed.data).slice(0, 220));
  const plugins = (await get('/api/plugins')).data.plugins ?? [];
  check('装完出现在插件列表里', plugins.some((p) => p.id === 'alpha'),
    JSON.stringify(plugins.map((p) => p.id)));
  const after = await get('/api/markets');
  const alpha = after.data.markets?.[0]?.plugins?.find((p) => p.id === 'alpha');
  check('集市里标出「已装 v1.0.0」', alpha?.installedVersion === '1.0.0',
    JSON.stringify(alpha));

  // 6. 重复安装
  const again = await post('/api/market/preview', { id: 'alpha' });
  const dup = await post('/api/market/install', {
    id: 'alpha', market: '演示集市', confirm: again.data.confirm,
  });
  check('重复安装给出可读原因（不覆盖）',
    dup.data.ok === false && /已存在/.test(dup.data.message ?? ''),
    JSON.stringify(dup.data).slice(0, 200));

  // 7. 本地集市刷新 & 移除
  const refreshed = await post('/api/market/refresh', { name: '演示集市' });
  check('本地集市刷新直接提示无需刷新',
    refreshed.data.ok === true && /无需刷新/.test(refreshed.data.message ?? ''),
    JSON.stringify(refreshed.data).slice(0, 160));
  const removed = await post('/api/market/remove', { name: '演示集市' });
  check('移除集市成功', removed.data.ok === true, JSON.stringify(removed.data).slice(0, 160));
  const empty = await get('/api/markets');
  check('移除后集市列表为空', (empty.data.markets ?? []).length === 0,
    JSON.stringify(empty.data.markets));
  const still = (await get('/api/plugins')).data.plugins ?? [];
  check('移除集市不影响已装的插件', still.some((p) => p.id === 'alpha'),
    JSON.stringify(still.map((p) => p.id)));

  // 8. 会话令牌
  const anon = await post('/api/market/add', { source: REPO }, false);
  check('没有会话令牌的写请求被拒（403）', anon.status === 403, String(anon.status));

  // 9. 前端接线（纯静态文件，拼错函数名会在这里暴露）
  const indexHtml = await (await fetch(BASE + '/')).text();
  const appJs = await (await fetch(BASE + '/app.js')).text();
  check('启动器顶部有「集市」入口', /id="marketBtn"/.test(indexHtml));
  check('前端有集市面板与会话令牌调用',
    /function showMarket/.test(appJs) && /api\/market\/preview/.test(appJs)
      && /id="marketPreview"/.test(appJs));
} catch (e) {
  check('异常：' + e.message, false);
} finally {
  server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}

const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n通过 ${results.length - failed} / ${results.length}`);
process.exitCode = failed ? 1 : 0;
