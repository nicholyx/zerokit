// 第二轮界面增强的三个 HTTP 接口：审计日志 / 环境自检 / 命令预览。
//
// 这三个接口是「前端拿数据」的唯一入口，单独冒烟比只测页面更稳：
// 全部在临时 ZEROKIT_HOME 里跑，不联网、不依赖本机已装插件。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'zerokit-ui2-smoke-'));
process.env['ZEROKIT_HOME'] = TMP_HOME;

const { loadPlugin } = await import('../src/core/manifest.ts');
const { PLUGINS_DIR } = await import('../src/core/paths.ts');
const { startServer } = await import('../src/server.ts');
const { runAction } = await import('../src/core/runner.ts');

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   <- ' + String(detail).slice(0, 300)}`);
};

// ---------------------------------------------------------------- 造插件

const dir = path.join(PLUGINS_DIR, 'demo');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'demo.mjs'), `
const [mode, ...rest] = process.argv.slice(2);
if (mode === 'boom') { process.stderr.write('故意失败\\n'); process.exit(3); }
process.stdout.write(JSON.stringify({ mode, rest }) + '\\n');
`);
fs.writeFileSync(path.join(dir, 'plugin.toml'), `
[plugin]
id      = "demo"
name    = "接口冒烟"
summary = "日志 / 自检 / 预览"

[[action]]
id          = "hello"
title       = "打招呼"
description = "说句话"
run         = ["{node}", "demo.mjs", "hello"]
risk        = "read"

[[action]]
id          = "boom"
title       = "失败"
description = "退出码 3"
run         = ["{node}", "demo.mjs", "boom"]
risk        = "read"

[[action]]
id          = "with-secret"
title       = "带密钥"
description = "预览必须打码"
params      = [{ name = "token", type = "string", secret = true, required = true }]
run         = ["{node}", "demo.mjs", "secret", "{token}"]
risk        = "read"

[[action]]
id          = "combo"
title       = "组合"
description = "一步链路"
type        = "chain"
output      = "text"
risk        = "read"

  [[action.step]]
  use = "self.hello"
  as  = "h"
`);

const loaded = loadPlugin(dir);
check('测试插件清单可解析', Boolean(loaded.plugin), (loaded.errors || []).join('; ') || JSON.stringify(loaded));
const plugin = loaded.plugin;

// 跑几次，制造审计记录（audit.log）
const hello = plugin.actions.find((a) => a.id === 'hello');
const boom = plugin.actions.find((a) => a.id === 'boom');
await runAction(plugin, hello, { caller: 'cli', values: {} });
await runAction(plugin, hello, { caller: 'cli', values: {} });
await runAction(plugin, boom, { caller: 'cli', values: {} });

const { url: BASE, close } = await startServer({ port: 0 });
const html = await (await fetch(BASE + '/')).text();
const TOKEN = /name="zk-token" content="([0-9a-f]+)"/.exec(html)?.[1];

async function getJson(p) {
  const res = await fetch(BASE + p);
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function postJson(p, body, token = TOKEN) {
  const res = await fetch(BASE + p, {
    method: 'POST',
    headers: token ? { 'x-zerokit-token': token, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

try {
  check('拿到会话令牌', Boolean(TOKEN));

  // ---- 环境自检
  {
    const { status, body } = await getJson('/api/doctor');
    const p = body?.plugins?.find((x) => x.id === 'demo');
    check('GET /api/doctor：返回环境与插件摘要',
      status === 200 && body.node?.version && body.tools?.some((t) => t.name === 'node' && t.ok)
      && body.summary?.plugins >= 1, JSON.stringify(body?.summary));
    check('GET /api/doctor：插件问题带结构化 level 与 hint',
      Boolean(p) && Array.isArray(p.problems) && (p.problems.length === 0
        || p.problems.every((x) => (x.level === 'error' || x.level === 'warning') && x.text)),
      JSON.stringify(p));
  }

  // ---- 审计日志
  {
    const { status, body } = await getJson('/api/logs?limit=200');
    check('GET /api/logs：默认读 audit.log 并倒序',
      status === 200 && body.file === 'audit.log' && body.entries.length === 3
      && body.entries[0].ts >= body.entries[1].ts, JSON.stringify(body?.counts));
    check('GET /api/logs：统计总数 / 拒绝数 / 失败数',
      body.counts.total === 3 && body.counts.deny === 1 && body.counts.error === 1,
      JSON.stringify(body?.counts));
    check('GET /api/logs：条目带审计字段',
      ['ts', 'plugin', 'action', 'caller', 'decision'].every((k) => k in body.entries[0]),
      JSON.stringify(body.entries[0]));

    const errors = await getJson('/api/logs?decision=error');
    check('GET /api/logs：decision=error 只返回失败记录',
      errors.body.entries.length >= 1 && errors.body.entries.every((e) => e.error),
      JSON.stringify(errors.body.entries.map((e) => e.action)));
    const hello = await getJson('/api/logs?q=hello');
    check('GET /api/logs：q 过滤命中动作名',
      hello.body.entries.length >= 1 && hello.body.entries.every((e) => e.action === 'hello'),
      JSON.stringify(hello.body.entries.map((e) => e.action)));
    const one = await getJson('/api/logs?limit=1');
    check('GET /api/logs：limit 生效', one.body.entries.length === 1, String(one.body.entries.length));
    const denied = await getJson('/api/logs?file=denied');
    check('GET /api/logs：失败/被拒另有 denied.log 单独一份',
      denied.body.file === 'denied.log' && denied.body.exists === true
      && denied.body.entries.length >= 1 && denied.body.entries.every((e) => e.decision === 'deny'),
      JSON.stringify(denied.body));
  }

  // ---- 命令预览
  {
    const noToken = await postJson('/api/preview', { plugin: 'demo', action: 'hello', values: {} }, '');
    check('POST /api/preview：没有会话令牌被拒', noToken.status === 403, String(noToken.status));

    const secret = await postJson('/api/preview', {
      plugin: 'demo', action: 'with-secret', values: { token: 'super-secret-9' },
    });
    check('POST /api/preview：密钥在预览里打码',
      secret.status === 200 && secret.body.masked === true
      && secret.body.command.includes('******') && !secret.body.command.includes('super-secret-9'),
      JSON.stringify(secret.body));

    const chain = await postJson('/api/preview', { plugin: 'demo', action: 'combo', values: {} });
    check('POST /api/preview：组合动作展示整条链路',
      chain.status === 200 && chain.body.command.includes('self.hello') && chain.body.hasPlaceholders === true,
      JSON.stringify(chain.body));

    const missing = await postJson('/api/preview', { plugin: 'nope', action: 'hello', values: {} });
    check('POST /api/preview：插件不存在返回 404', missing.status === 404, String(missing.status));

    const bad = await postJson('/api/preview', { plugin: 'demo', action: 'with-secret', values: {} });
    check('POST /api/preview：必填参数缺失返回 400', bad.status === 400, JSON.stringify(bad.body));
  }
} finally {
  close();
  fs.rmSync(TMP_HOME, { recursive: true, force: true });
}

const failed = results.filter(([, ok]) => !ok);
console.log('\n' + '='.repeat(60));
console.log(`通过 ${results.length - failed.length} / ${results.length}`);
if (failed.length) process.exitCode = 1;
