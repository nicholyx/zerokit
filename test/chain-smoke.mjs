// 组合动作（type = "chain"）的回归测试。
//
// 组合动作的全部价值是「把已有动作拼起来」，所以这里钉三件事：
//   1. 引用真的能把上一步的输出带进下一步（参数、模板、prev、默认值）；
//   2. 链路写错时**第一句话就指出第几步错**，而不是跑完前两步、产生了副作用才炸；
//   3. 安全边界不因为组合而变松：风险低于步骤时 fail-closed，嵌套/后台步骤直接拒绝。
//
// 全部在临时目录里跑，不碰正式环境、不联网。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const PKG_ROOT = path.resolve(import.meta.dirname, '..');
const HOME = path.join(os.tmpdir(), 'zerokit-chain-test');
process.env['ZEROKIT_HOME'] = HOME;
fs.rmSync(HOME, { recursive: true, force: true });

const { loadPlugin } = await import('../src/core/manifest.ts');
const { runAction } = await import('../src/core/runner.ts');
const { listPlugins } = await import('../src/core/registry.ts');

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   <- ' + String(detail).slice(0, 400)}`);
};

const PLUGINS = path.join(HOME, 'plugins');

function writePlugin(id, toml, script) {
  const dir = path.join(PLUGINS, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.toml'), toml);
  if (script) fs.writeFileSync(path.join(dir, 'base.mjs'), script);
  return dir;
}

const BASE_SCRIPT = `
const args = process.argv.slice(2);
if (args[0] === 'emit') {
  process.stdout.write(JSON.stringify({ ip: '1.2.3.4', items: [{ name: 'a' }, { name: 'b' }] }) + '\\n');
} else if (args[0] === 'fail') {
  process.stderr.write('故意失败\\n');
  process.exit(3);
} else if (args[0] === 'write') {
  process.stdout.write('wrote\\n');
} else {
  process.stdout.write(JSON.stringify({ args: args.slice(1) }) + '\\n');
}
`;

writePlugin('base', `
[plugin]
id      = "base"
name    = "基础动作"
summary = "组合动作测试的下层插件"
runtime = "spawn"

[[action]]
id          = "emit"
title       = "输出结构化数据"
description = "给下一步提供 ip 与 items"
run         = ["{node}", "base.mjs", "emit"]
output      = "json"
risk        = "read"

[[action]]
id          = "echo"
title       = "回显参数"
description = "把收到的参数原样吐回来"
run         = ["{node}", "base.mjs", "echo", "{word}", "{count}"]
output      = "json"
risk        = "read"

  [[action.param]]
  name        = "word"
  type        = "string"
  default     = "hi"
  description = "要说的话"

  [[action.param]]
  name        = "count"
  type        = "integer"
  default     = 1
  description = "次数"

[[action]]
id          = "need"
title       = "必填参数"
description = "word 没有默认值"
run         = ["{node}", "base.mjs", "echo", "{word}", "0"]
output      = "json"
risk        = "read"

  [[action.param]]
  name        = "word"
  type        = "string"
  required    = true
  description = "必须给"

[[action]]
id          = "write"
title       = "有副作用的动作"
description = "用来验证风险闸门"
run         = ["{node}", "base.mjs", "write"]
risk        = "mutate"

[[action]]
id          = "bg"
title       = "后台动作"
description = "用来验证组合动作拒绝后台步骤"
run         = ["{node}", "base.mjs", "write"]
risk        = "mutate"
background  = true

[[action]]
id          = "fail"
title       = "失败动作"
description = "退出码 3"
run         = ["{node}", "base.mjs", "fail"]
risk        = "read"
`, BASE_SCRIPT);

const comboDir = writePlugin('combo', `
[plugin]
id      = "combo"
name    = "组合示例"
summary = "把已有动作拼成新能力"
runtime = "spawn"

[[action]]
id          = "chain-ok"
title       = "取数据再回显"
description = "把 emit 的 ip 传给 echo"
type        = "chain"
output      = "json"
risk        = "read"

  [[action.step]]
  use    = "base.emit"
  as     = "src"

  [[action.step]]
  use    = "base.echo"
  as     = "echo"
  params = { word = "IP {src.data.ip}", count = 2 }

[[action]]
id          = "chain-template"
title       = "模板拼一句话"
description = "用 template 引用结构化结果"
type        = "chain"
output      = "text"
risk        = "read"
template    = "IP={src.data.ip} 第二项={src.data.items.1.name}"

  [[action.step]]
  use = "base.emit"
  as  = "src"

[[action]]
id          = "chain-prev"
title       = "用上一步的结果"
description = "{prev} 与 {别名} 都要能用"
type        = "chain"
output      = "json"
risk        = "read"

  [[action.step]]
  use = "base.emit"
  as  = "first"

  [[action.step]]
  use    = "base.echo"
  as     = "echo"
  params = { word = "{prev.data.items.0.name}" }

[[action]]
id          = "chain-own-param"
title       = "组合动作自己的参数"
description = "参数默认值也要生效"
type        = "chain"
output      = "json"
risk        = "read"

  [[action.param]]
  name        = "who"
  type        = "string"
  default     = "世界"
  description = "称呼"

  [[action.step]]
  use    = "base.echo"
  as     = "echo"
  params = { word = "你好 {who}" }

[[action]]
id          = "chain-single"
title       = "单步链路"
description = "没有模板时直接拼各步 stdout"
type        = "chain"
output      = "text"
risk        = "read"

  [[action.step]]
  use = "base.emit"
  as  = "only"

[[action]]
id          = "chain-risk"
title       = "风险不够"
description = "链路 read，步骤 mutate"
type        = "chain"
risk        = "read"

  [[action.step]]
  use = "base.write"
  as  = "w"

[[action]]
id          = "chain-missing-plugin"
title       = "引用没装的插件"
description = "静态校验要拦下来"
type        = "chain"
risk        = "read"

  [[action.step]]
  use = "nope.act"
  as  = "x"

[[action]]
id          = "chain-missing-action"
title       = "引用不存在的动作"
description = "报错要列出可用动作"
type        = "chain"
risk        = "read"

  [[action.step]]
  use = "base.nope"
  as  = "x"

[[action]]
id          = "chain-nested"
title       = "嵌套组合"
description = "组合动作不能嵌套"
type        = "chain"
risk        = "read"

  [[action.step]]
  use = "combo.chain-ok"
  as  = "inner"

[[action]]
id          = "chain-self"
title       = "引用自己"
description = "self 指向本插件的组合动作"
type        = "chain"
risk        = "read"

  [[action.step]]
  use = "self.chain-ok"
  as  = "inner"

[[action]]
id          = "chain-bg"
title       = "后台步骤"
description = "后台动作没有结果可传"
type        = "chain"
risk        = "read"

  [[action.step]]
  use = "base.bg"
  as  = "b"

[[action]]
id          = "chain-unknown-param"
title       = "未知参数"
description = "步骤参数写错要立刻报"
type        = "chain"
risk        = "read"

  [[action.step]]
  use    = "base.emit"
  as     = "src"

  [[action.step]]
  use    = "base.echo"
  as     = "e"
  params = { nope = "x" }

[[action]]
id          = "chain-bad-ref"
title       = "引用取不到值"
description = "错误要指明第几步的哪个参数"
type        = "chain"
risk        = "read"

  [[action.step]]
  use = "base.emit"
  as  = "src"

  [[action.step]]
  use    = "base.echo"
  as     = "e"
  params = { word = "{src.data.missing}" }

[[action]]
id          = "chain-missing-required"
title       = "漏了必填参数"
description = "组合动作要替步骤补默认值、查必填"
type        = "chain"
risk        = "read"

  [[action.step]]
  use = "base.need"
  as  = "need"

[[action]]
id          = "chain-fail"
title       = "第二步失败"
description = "前面的输出要保留，退出码要透传"
type        = "chain"
risk        = "read"

  [[action.step]]
  use = "base.emit"
  as  = "src"

  [[action.step]]
  use = "base.fail"
  as  = "boom"
`);

// ---- 正常路径 ----
check('combo 插件能解析', Boolean(loadPlugin(comboDir).plugin), loadPlugin(comboDir).errors.join('；'));

function actionOf(pluginId, actionId) {
  const entry = listPlugins().find((e) => e.plugin?.id === pluginId);
  return { plugin: entry?.plugin, action: entry?.plugin?.actions.find((a) => a.id === actionId) };
}

async function run(pluginId, actionId, values = {}) {
  const { plugin, action } = actionOf(pluginId, actionId);
  if (!plugin || !action) throw new Error(`找不到 ${pluginId}.${actionId}`);
  return runAction(plugin, action, { caller: 'cli', values });
}

{
  const r = await run('combo', 'chain-ok');
  check('链路成功', r.ok, r.error);
  check('第一步的结构化结果进了 data', r.data?.src?.ip === '1.2.3.4', JSON.stringify(r.data));
  check('引用 {src.data.ip} 传进了下一步', r.data?.echo?.args?.[0] === 'IP 1.2.3.4', JSON.stringify(r.data?.echo));
  check('数字参数按原类型传给下游', r.data?.echo?.args?.[1] === '2', JSON.stringify(r.data?.echo));
}

{
  const r = await run('combo', 'chain-template');
  check('template 渲染', r.ok && r.stdout === 'IP=1.2.3.4 第二项=b', JSON.stringify(r.stdout));
}

{
  const r = await run('combo', 'chain-prev');
  check('{prev} 指上一步的结果', r.data?.echo?.args?.[0] === 'a', JSON.stringify(r.data?.echo));
}

{
  const r = await run('combo', 'chain-own-param', {});
  check('组合动作自己的参数默认值生效', r.data?.echo?.args?.[0] === '你好 世界', JSON.stringify(r.data?.echo));
  const r2 = await run('combo', 'chain-own-param', { who: 'zerokit' });
  check('组合动作自己的参数能覆盖默认值', r2.data?.echo?.args?.[0] === '你好 zerokit', JSON.stringify(r2.data?.echo));
}

{
  const r = await run('combo', 'chain-single');
  check('单步链路没有模板时拼接 stdout', r.ok && String(r.stdout).includes('"ip"'), r.stdout);
}

// ---- 失败路径：每一条都必须「指名道姓」地说清哪一步错 ----
const failures = [
  ['chain-risk', ['风险'], '风险低于步骤'],
  ['chain-missing-plugin', ['nope', '没装'], '引用未安装插件'],
  ['chain-missing-action', ['找不到动作', 'emit'], '引用不存在的动作'],
  ['chain-nested', ['嵌套'], '嵌套组合'],
  ['chain-self', ['嵌套'], 'self 指向组合动作'],
  ['chain-bg', ['后台'], '后台步骤'],
  ['chain-unknown-param', ['未知参数', 'nope'], '未知参数'],
  ['chain-bad-ref', ['取不到值', 'missing'], '引用取不到值'],
  ['chain-missing-required', ['必填'], '漏必填参数'],
];

for (const [id, needles, label] of failures) {
  const r = await run('combo', id);
  const ok = !r.ok && needles.every((n) => String(r.error).includes(n));
  check(`${label}：失败并给出可操作提示`, ok, `ok=${r.ok} error=${r.error}`);
}

{
  const r = await run('combo', 'chain-fail');
  check('步骤失败：链路失败并透传退出码', !r.ok && r.exitCode === 3, `ok=${r.ok} exit=${r.exitCode}`);
  check('步骤失败：前面步骤的输出保留', String(r.stdout).includes('1.2.3.4'), r.stdout);
  check('步骤失败：错误里写明第几步', String(r.error).includes('第 2 步'), r.error);
}

// ---- 清单校验：写错的结构在装载时就要报出来 ----
function parseErrors(name, toml) {
  const dir = writePlugin(`bad-${name}`, toml);
  return loadPlugin(dir).errors.join('；');
}

check('chain 没有步骤 → 报错',
  parseErrors('no-steps', `
[plugin]
id = "bad-no-steps"
name = "x"
[[action]]
id = "a"
type = "chain"
risk = "read"`).includes('至少要有一步'));

check('步骤 use 缺插件前缀 → 报错',
  parseErrors('bad-use', `
[plugin]
id = "bad-use"
name = "x"
[[action]]
id = "a"
type = "chain"
risk = "read"
  [[action.step]]
  use = "emit"`).includes('格式不对'));

check('步骤引用名重复 → 报错',
  parseErrors('dup-alias', `
[plugin]
id = "bad-dup"
name = "x"
[[action]]
id = "a"
type = "chain"
risk = "read"
  [[action.step]]
  use = "base.emit"
  as  = "same"
  [[action.step]]
  use = "base.echo"
  as  = "same"`).includes('重复'));

check('链路的引用名不能占用内置占位符',
  parseErrors('reserved-alias', `
[plugin]
id = "bad-reserved"
name = "x"
[[action]]
id = "a"
type = "chain"
risk = "read"
  [[action.step]]
  use = "base.emit"
  as  = "home"`).includes('保留名'));

check('chain 同时给 run → 报错',
  parseErrors('run', `
[plugin]
id = "bad-run"
name = "x"
[[action]]
id = "a"
type = "chain"
risk = "read"
run = ["{node}", "x.mjs"]`).includes('不能同时给 run'));

check('非 chain 动作写 template → 报错',
  parseErrors('template', `
[plugin]
id = "bad-template"
name = "x"
[[action]]
id = "a"
run = ["{node}", "x.mjs"]
risk = "read"
template = "hi {a}"`).includes('只属于组合动作'));

check('非法 type → 报错并列出可选值',
  parseErrors('type', `
[plugin]
id = "bad-type"
name = "x"
[[action]]
id = "a"
type = "combo"
risk = "read"`).includes('exec / http / chain'));

// ---- 四个面：CLI 的 show / run / doctor 都要认这条链路 ----
function cli(args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [path.join(PKG_ROOT, 'src', 'cli.ts'), ...args], {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ZEROKIT_HOME: HOME, NO_COLOR: '1', ...extraEnv },
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

{
  const show = cli(['show', 'combo']);
  check('CLI show 展示链路步骤', show.code === 0 && show.out.includes('组合：base.emit → base.echo'),
    show.out.slice(0, 600));
  check('CLI show 展示步骤与引用名', show.out.includes('base.emit') && show.out.includes('{src}'), show.out.slice(0, 600));
}

{
  const run = cli(['run', 'combo', 'chain-ok', '--json']);
  let parsed;
  try { parsed = JSON.parse(run.out.slice(run.out.indexOf('{'))); } catch { parsed = undefined; }
  check('CLI run 跑通组合动作（--json 输出结构化结果）',
    run.code === 0 && parsed?.data?.echo?.args?.[0] === 'IP 1.2.3.4', run.out.slice(0, 500));
}

{
  const doctor = cli(['doctor']);
  check('CLI doctor 提前指出链路引用了没装的插件',
    doctor.out.includes('组合动作 chain-missing-plugin') && doctor.out.includes('没装'),
    doctor.out.slice(0, 800));
}

console.log('\n' + '='.repeat(60));
const failed = results.filter(([, ok]) => !ok).map(([n]) => n);
console.log(`通过 ${results.length - failed.length} / ${results.length}`);
if (failed.length) console.log('失败：' + failed.join(', '));
process.exit(failed.length ? 1 : 0);
