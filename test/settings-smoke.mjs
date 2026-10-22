// 插件设置项（[[setting]]）的冒烟测试。
//
// 覆盖四层：清单校验 → 存储与打码 → 执行时注入（占位符 / 环境变量 / http）
// → CLI 的 config 子命令与 doctor。全部在临时目录里跑（自包含、不联网）。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
// 先设环境再 import 内核：paths 在模块加载时读 ZEROKIT_HOME
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'zerokit-settings-smoke-'));
process.env['ZEROKIT_HOME'] = TMP_HOME;
// 测试要连本机回环 http 服务：把外部代理变量清掉，避免请求被导去代理
for (const k of ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY',
  'all_proxy', 'ALL_PROXY', 'no_proxy', 'NO_PROXY']) {
  delete process.env[k];
}

const { loadPlugin } = await import('../src/core/manifest.ts');
const { PLUGINS_DIR } = await import('../src/core/paths.ts');
const { buildArgv, displayCommand, runAction } = await import('../src/core/runner.ts');
const { applyDefaults } = await import('../src/core/schema.ts');
const cfg = await import('../src/core/pluginConfig.ts');

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   <- ' + String(detail).slice(0, 300)}`);
};

const isWin = process.platform === 'win32';

function writePlugin(id, toml, files = {}) {
  const dir = path.join(PLUGINS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.toml'), toml);
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

const PRINT = 'process.stdout.write(JSON.stringify(process.argv.slice(2)) + "\\n");\n';
const ENVDUMP = 'process.stdout.write(JSON.stringify({\n'
  + '  token: process.env.ZEROKIT_SETTING_TOKEN ?? null,\n'
  + '  retries: process.env.ZEROKIT_SETTING_RETRIES ?? null,\n'
  + '  endpoint: process.env.ZEROKIT_SETTING_ENDPOINT ?? null,\n'
  + '}) + "\\n");\n';

const CONF_TOML = `[plugin]
id      = "conf"
name    = "设置项测试"
summary = "测 [[setting]]"

[[setting]]
name        = "endpoint"
type        = "string"
default     = "https://example.com/api"
description = "接口地址"

[[setting]]
name   = "token"
type   = "string"
secret = true

[[setting]]
name    = "retries"
type    = "integer"
default = 2

[[setting]]
name    = "enabled"
type    = "boolean"
default = false

[[setting]]
name    = "mode"
type    = "enum"
enum    = ["fast", "slow"]
default = "fast"

[[action]]
id          = "echo"
title       = "回声"
description = "把设置项当参数打出来"
run         = ["{node}", "print.mjs", "{setting.endpoint}", "{setting.token}", "{setting.retries}", "{setting.enabled}", "{setting.mode}"]
risk        = "read"

[[action]]
id          = "envdump"
title       = "环境变量"
description = "设置项同时注入环境变量"
run         = ["{node}", "env.mjs"]
risk        = "read"

[[action]]
id          = "pass-sep"
title       = "密码分参"
description = "密钥参数作为独立 argv 元素"
run         = ["echo", "--password", "{pass}"]
risk        = "read"

  [[action.param]]
  name   = "pass"
  type   = "string"
  secret = true

[[action]]
id          = "pass-inline"
title       = "密码内联"
description = "密钥参数嵌在同一个元素里（前缀不匹配也必须打码）"
run         = ["echo", "--password={pass}"]
risk        = "read"

  [[action.param]]
  name   = "pass"
  type   = "string"
  secret = true

[[action]]
id          = "fetch"
title       = "从设置里的地址取数据"
description = "http 动作用设置项拼 URL"
type        = "http"
url         = "{setting.endpoint}?t={setting.token}"
output      = "json"
risk        = "read"
`;

const loaded = loadPlugin(writePlugin('conf', CONF_TOML, {
  'print.mjs': PRINT,
  'env.mjs': ENVDUMP,
}));
const plugin = loaded.plugin;
check('清单：合法设置项被解析', loaded.errors.length === 0 && plugin?.settings.length === 5,
  JSON.stringify(loaded.errors));
if (!plugin) {
  console.log(`\n${'='.repeat(60)}\n通过 0 / ${results.length}`);
  process.exit(1);
}

// ---------------------------------------------------------------- 1. 清单校验

function badToml(settings, extra = '') {
  return `[plugin]
id = "bad"
name = "坏清单"
summary = "测校验"

${settings}

[[action]]
id = "a"
title = "a"
description = "a"
run = ["echo", "hi"]
risk = "read"
${extra}
`;
}

function errorsOf(settings, extra = '') {
  const dir = fs.mkdtempSync(path.join(TMP_HOME, 'bad-'));
  fs.writeFileSync(path.join(dir, 'plugin.toml'), badToml(settings, extra));
  return loadPlugin(dir);
}

{
  const r = errorsOf(`[[setting]]
name   = "token"
type   = "string"
secret = true`);
  check('清单：secret 没写 required 时自动视为必填',
    r.errors.length === 0 && r.plugin?.settings[0]?.required === true,
    `${r.errors.join(' | ')} ${JSON.stringify(r.plugin?.settings)}`);
  const opt = errorsOf(`[[setting]]
name     = "token"
type     = "string"
secret   = true
required = false`);
  check('清单：secret 可以显式声明为可选（required = false）',
    opt.errors.length === 0 && opt.plugin?.settings[0]?.required === false,
    JSON.stringify(opt.plugin?.settings));
}

{
  const r = errorsOf(`[[setting]]
name     = "x"
type     = "string"
required = true
default  = "v"`);
  check('清单：required 给默认值只是警告（默认值让 required 失去意义）',
    r.warnings.some((w) => w.includes('required = true') && w.includes('默认值')),
    JSON.stringify(r.warnings));
}

{
  const r = errorsOf(`[[setting]]
name    = "n"
type    = "integer"
default = "abc"`);
  check('清单：默认值类型不符被拒绝',
    r.errors.some((e) => e.includes('默认值') && e.includes('整数')), r.errors.join(' | '));
}

{
  const r = errorsOf(`[[setting]]
name = "n"
type = "strange"`);
  check('清单：未知设置项类型被拒绝',
    r.errors.some((e) => e.includes('不支持')), r.errors.join(' | '));
}

{
  const r = errorsOf(`[[setting]]
name = "dup"
type = "string"

[[setting]]
name = "dup"
type = "string"`);
  check('清单：设置项重名被拒绝',
    r.errors.some((e) => e.includes('重复')), r.errors.join(' | '));
}

{
  const r = errorsOf('', `url = "{setting.nope}"`);
  // 把 url 放到 http 动作上更贴近真实误用
  const dir = fs.mkdtempSync(path.join(TMP_HOME, 'bad2-'));
  fs.writeFileSync(path.join(dir, 'plugin.toml'), `[plugin]
id = "bad2"
name = "坏引用"
summary = "测引用校验"

[[setting]]
name = "endpoint"
type = "string"
default = "https://example.com"

[[action]]
id = "a"
title = "a"
description = "a"
type = "http"
url = "{setting.endpoint}/{setting.nope}"
risk = "read"
`);
  const r2 = loadPlugin(dir);
  check('清单：引用了未声明的设置项被拒绝（http 动作）',
    r2.errors.some((e) => e.includes('setting.nope') && e.includes('没有声明')),
    r2.errors.join(' | '));
}

// ---------------------------------------------------------------- 2. 存储与打码

const secret = 'tok-abc123';
const before = cfg.publicSettings(plugin);
{
  check('存储：没配过的密钥项 → 未设置且标记 missing',
    before.find((s) => s.name === 'token')?.source === 'unset'
    && before.find((s) => s.name === 'token')?.missing === true,
    JSON.stringify(before));
  check('存储：有默认值的项 → source = default 且回显默认值',
    before.find((s) => s.name === 'endpoint')?.source === 'default'
    && before.find((s) => s.name === 'endpoint')?.value === 'https://example.com/api',
    JSON.stringify(before.find((s) => s.name === 'endpoint')));
  check('存储：命中必填缺失时给出可复制的修复命令',
    cfg.settingsHints(plugin, cfg.resolveSettings(plugin)).some((h) => h.includes('--stdin')),
    JSON.stringify(cfg.settingsHints(plugin, cfg.resolveSettings(plugin))));
}

{
  const w = cfg.writeSettings(plugin, { token: secret, retries: 3 });
  check('存储：写入成功并回读', w.ok === true && w.view?.values['token'] === secret,
    JSON.stringify(w));
  const file = cfg.settingsPath(plugin.id);
  check('存储：落在 ZEROKIT_HOME/settings/<插件>.json', fs.existsSync(file), file);
  if (!isWin) {
    const mode = fs.statSync(file).mode & 0o777;
    check('存储：文件权限 0600（只有当前用户可读）', mode === 0o600, mode.toString(8));
  }
  const after = cfg.publicSettings(plugin);
  const tok = after.find((s) => s.name === 'token');
  check('打码：publicSettings 不回显密钥明文，只给掩码',
    tok?.value === undefined && tok?.masked === cfg.SECRET_MASK,
    JSON.stringify(tok));
}

{
  const bad = cfg.writeSettings(plugin, { retries: 'abc' });
  check('存储：类型不符的值拒绝写入', bad.ok === false && /整数/.test(bad.error ?? ''),
    JSON.stringify(bad));
  const unknown = cfg.writeSettings(plugin, { nope: 1 });
  check('存储：未声明的设置项拒绝写入并列出可用项',
    unknown.ok === false && /没有声明/.test(unknown.error ?? ''), JSON.stringify(unknown));
}

// ---------------------------------------------------------------- 3. 执行时注入

const action = (id) => plugin.actions.find((a) => a.id === id);

async function run(id, values = {}, secretValues) {
  const a = action(id);
  const parsed = applyDefaults(a, values);
  return runAction(plugin, a, {
    caller: 'cli', values: parsed.values,
    ...(secretValues ? { secretValues } : {}),
  });
}

{
  // 先把 token 清掉，验证"缺失必填设置就不执行"的 fail-closed
  cfg.writeSettings(plugin, { token: null });
  const r = await run('echo');
  check('执行：必填设置缺失时拒绝执行，并给出修复命令',
    r.ok === false && /缺少必填设置项/.test(r.error ?? '') && /zkit config conf set token/.test(r.error ?? ''),
    r.error);
  check('执行：被拒时不会跑出半截命令', r.argv.length === 0 && r.command === '',
    JSON.stringify(r.argv));
  cfg.writeSettings(plugin, { token: secret });
}

{
  const r = await run('echo');
  let argv = [];
  try { argv = JSON.parse(r.stdout.trim()); } catch { /* 下面断言会报错 */ }
  check('注入：设置项按声明类型进入 argv（默认值、整数、布尔、枚举）',
    r.ok === true
    && argv[0] === 'https://example.com/api'
    && argv[1] === secret
    && argv[2] === '3'
    && argv[3] === 'false'
    && argv[4] === 'fast',
    JSON.stringify(argv));
  check('注入：审计里记录的 argv 已打码', r.argv.includes(cfg.SECRET_MASK) && !r.argv.includes(secret),
    JSON.stringify(r.argv));
  check('注入：展示命令里也没有密钥', !r.command.includes(secret), r.command);

  const env = await run('envdump');
  let seen = {};
  try { seen = JSON.parse(env.stdout.trim()); } catch { /* ignore */ }
  check('注入：同时提供 ZEROKIT_SETTING_<NAME> 环境变量',
    seen.token === secret && seen.retries === '3' && seen.endpoint === 'https://example.com/api',
    JSON.stringify(seen));
}

{
  const sep = await run('pass-sep', { pass: 'hunter2' });
  check('打码：独立元素的密钥参数', sep.argv.join(' ').includes('******')
    && !sep.argv.join(' ').includes('hunter2') && !sep.command.includes('hunter2'),
    JSON.stringify(sep.argv));
}

{
  // 回归：以前用前缀匹配打码，`--password={pass}` 这种内联写法会漏
  const inline = await run('pass-inline', { pass: 'hunter2' });
  check('打码：密钥参数嵌在同一元素里也不漏（前缀匹配的老 bug）',
    !inline.argv.join(' ').includes('hunter2') && !inline.command.includes('hunter2'),
    JSON.stringify(inline.argv));
}

{
  const a = action('pass-inline');
  const built = buildArgv(plugin, a, { pass: 's3cr3t' }, ['s3cr3t']);
  check('打码：上游传来的密钥字面量也能兜底抹掉',
    displayCommand(built.redacted).includes('******')
    && !displayCommand(built.redacted).includes('s3cr3t'),
    displayCommand(built.redacted));
}

// ---------------------------------------------------------------- 4. http 动作

const received = [];
const server = http.createServer((req, res) => {
  received.push({ url: req.url ?? '' });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ hello: 'world', path: req.url }));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
cfg.writeSettings(plugin, { endpoint: `http://127.0.0.1:${port}/data` });

{
  const r = await run('fetch');
  check('http：URL 里的设置项被展开，请求真的发到目标地址',
    r.ok === true && r.data?.hello === 'world'
    && received.some((x) => x.url.startsWith('/data')),
    JSON.stringify({ r, received }).slice(0, 300));
  check('http：展示命令把 URL 里的密钥打码，但请求带的是真值',
    r.command.includes(cfg.SECRET_MASK) && !r.command.includes(secret)
    && received.some((x) => x.url.includes(`t=${secret}`)),
    r.command);
}

server.close();
cfg.writeSettings(plugin, { endpoint: 'https://example.com/api' });
cfg.writeSettings(plugin, { token: null });

// ---------------------------------------------------------------- 5. CLI

function cli(args, input) {
  return spawnSync(process.execPath, ['src/cli.ts', ...args], {
    cwd: ROOT,
    env: { ...process.env, ZEROKIT_HOME: TMP_HOME },
    encoding: 'utf8', timeout: 60000, windowsHide: true,
    ...(input !== undefined ? { input } : {}),
  });
}

{
  const list = cli(['config', 'conf', 'list', '--json']);
  let parsed = [];
  try { parsed = JSON.parse(list.stdout); } catch { /* ignore */ }
  check('CLI：config list --json 输出机器可读的设置项',
    list.status === 0 && parsed.plugin === 'conf' && parsed.settings?.length === 5
    && parsed.settings.find((s) => s.name === 'token')?.missing === true,
    `${list.status} ${list.stdout.slice(0, 200)}`);
  check('CLI：list 不回显任何密钥明文', !list.stdout.includes(secret), list.stdout.slice(0, 200));
}

{
  const set = cli(['config', 'conf', 'set', 'retries', '5']);
  const get = cli(['config', 'conf', 'get', 'retries', '--json']);
  let parsed = {};
  try { parsed = JSON.parse(get.stdout); } catch { /* ignore */ }
  check('CLI：set / get 走同一条存储', set.status === 0 && parsed.value === 5,
    `${set.status} ${get.stdout}`);
}

{
  const set = cli(['config', 'conf', 'set', 'token', '--stdin'], `${secret}\n`);
  const get = cli(['config', 'conf', 'get', 'token']);
  const reveal = cli(['config', 'conf', 'get', 'token', '--reveal']);
  check('CLI：密钥经 --stdin 写入，get 默认只回掩码',
    set.status === 0 && get.stdout.trim() === cfg.SECRET_MASK
    && !set.stdout.includes(secret),
    `${set.status} ${get.stdout} ${set.stdout}`);
  check('CLI：显式 --reveal 才回显真实值', reveal.stdout.trim() === secret, reveal.stdout);
  check('CLI：--stdin 写入时给出「别进 shell 历史」的提醒',
    /shell 历史/.test(set.stderr), set.stderr);
}

{
  const bad = cli(['config', 'conf', 'set', 'retries', 'abc']);
  check('CLI：非法值拒绝写入且退出码非 0', bad.status !== 0 && /整数/.test(bad.stderr),
    `${bad.status} ${bad.stderr}`);
  const missing = cli(['config', 'conf', 'set']);
  check('CLI：缺参数时打印用法', missing.status === 2 && /config/.test(missing.stderr),
    `${missing.status} ${missing.stderr}`);
}

{
  const unset = cli(['config', 'conf', 'unset', 'retries']);
  const get = cli(['config', 'conf', 'get', 'retries']);
  check('CLI：unset 清掉后回到默认值', unset.status === 0
    && get.stdout.trim() === '2', `${unset.status} ${get.stdout}`);
}

{
  // 密钥还在：doctor 不该把明文打出来
  const withSecret = cli(['doctor']);
  check('CLI：doctor 不泄露密钥明文', !withSecret.stdout.includes(secret),
    withSecret.stdout.slice(0, 400));
  // 清掉密钥后：doctor 要主动指出缺哪一项、怎么补
  cli(['config', 'conf', 'unset', 'token']);
  const doctor = cli(['doctor']);
  check('CLI：doctor 指出缺少必填设置项',
    /缺少必填设置项/.test(doctor.stdout)
    && /zkit config conf set token --stdin/.test(doctor.stdout),
    doctor.stdout.slice(0, 400));
}

// ---------------------------------------------------------------- 收尾

fs.rmSync(TMP_HOME, { recursive: true, force: true });
const passed = results.filter(([, ok]) => ok).length;
const failed = results.length - passed;
console.log(`\n${'='.repeat(60)}`);
console.log(`通过 ${passed} / ${results.length}`);
if (failed > 0) process.exit(1);
