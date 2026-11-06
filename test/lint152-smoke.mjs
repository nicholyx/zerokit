// lint152-smoke：第一百五十二轮——L13–L20 八条新规则（fixture 正反例成对）
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- lint152 ${extra}`); } };
console.log('lint152-smoke');

const home = mkdtempSync(path.join(tmpdir(), 'l152-'));
/** 造 fixture 插件并 lint，返回全文输出。 */
function lintFixture(toml) {
  const dir = path.join(home, 'plugins', 'fx152');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'plugin.toml'), toml);
  const r = spawnSync(process.execPath, [CLI, 'plugin', 'lint', 'fx152'], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home } });
  return (r.stdout ?? '') + (r.stderr ?? '');
}

const HEAD = '[plugin]\nid = "fx152"\nname = "fixture"\nversion = "0.1.0"\nsummary = "第一百五十二轮体检 fixture 插件"\nkeywords = ["t"]\n';

// L13 enum 无 options（error）+ 参数缺 description（warn）
{
  const out = lintFixture(HEAD + `
[[action]]
id = "pick"
title = "选"
description = "选一个选项出来给人看"
risk = "read"
run = ["echo", "x"]
output = "text"
params = [{ name = "mode", type = "enum" }]
`);
  check('L13 enum 无 options 拦截', out.includes('L13') && out.includes('enum 但没有 options') || out.includes('必须给出 enum'));
  // 缺 description 的正例：用干净 fixture（enum 完整但 description 只有 2 字）
{
  const out = lintFixture(HEAD + `
[[action]]
id = "pick"
title = "选"
description = "选一个选项出来给人看"
risk = "read"
run = ["echo", "x"]
output = "text"
params = [{ name = "mode", type = "enum", options = ["a","b"], description = "" }]
`);
  check('L13 参数缺 description warn', out.includes('L13') && out.includes('参数 "mode" 缺 description'));
}
}
// L13 反例：enum 带 options + description 完整 → 不出 L13
{
  const out = lintFixture(HEAD + `
[[action]]
id = "pick"
title = "选"
description = "选一个选项出来给人看"
risk = "read"
run = ["echo", "x"]
output = "text"
params = [{ name = "mode", type = "enum", options = ["a","b"], description = "选哪个档位" }]
`);
  check('L13 反例干净', !out.includes('L13'));
}
// L14 use 语法错（加载层拦截）
{
  const out = lintFixture(HEAD + `
[[action]]
id = "gen"
title = "生成"
description = "生成一个数字返回给调用方使用"
risk = "read"
run = ["echo", "x"]
output = "text"

[[action]]
id = "pipeline"
title = "流水线"
description = "把两步串起来跑完出结果"
risk = "read"
type = "chain"
template = "done"
steps = [{ use = "nope-style", as = "first" }]
`);
  check('L14 use 语法拦截（加载层）', out.includes('格式不对'));
}
// L14 引用本插件不存在的动作（无语法错，到达 lint 层）
{
  const out = lintFixture(HEAD + `
[[action]]
id = "gen"
title = "生成"
description = "生成一个数字返回给调用方使用"
risk = "read"
run = ["echo", "{\\"ok\\":true,\\"value\\":1}"]
output = "json"

[[action]]
id = "pipeline"
title = "流水线"
description = "把两步串起来跑完出结果"
risk = "read"
type = "chain"
template = "done"
steps = [{ use = "self.missing", as = "second" }]
`);
  check('L14 引用不存在', out.includes('不存在的动作 "missing"') || out.includes('missing'));
}
{
  const out = lintFixture(HEAD + `
[[action]]
id = "gen"
title = "生成"
description = "生成一个数字返回给调用方使用"
risk = "read"
run = ["echo", "hi"]
output = "text"

[[action]]
id = "pipeline"
title = "流水线"
description = "把两步串起来跑完出结果"
risk = "read"
type = "chain"
template = "v={first.data.value}"
steps = [{ use = "self.gen", as = "first" }]
`);
  check('L14 被引动作非 json error', out.includes('未声明 output = "json"'));
  check('L15 别名不存在', (out.includes('L15') && out.includes('别名')) || out.includes('别名'));
}
// L15 反例：别名存在 → 无 L15
{
  const out = lintFixture(HEAD + `
[[action]]
id = "gen"
title = "生成"
description = "生成一个数字返回给调用方使用"
risk = "read"
run = ["echo", "{\\"ok\\":true,\\"value\\":1}"]
output = "json"

[[action]]
id = "pipeline"
title = "流水线"
description = "把两步串起来跑完出结果"
risk = "read"
type = "chain"
template = "值是 {first.data.value}"
steps = [{ use = "self.gen", as = "first" }]
`);
  check('L15 反例干净（含 L14）', !out.includes('L15'));
}
// L16 python 无 encoding（info）——fixture 用 run ["python3","-c","print(1)"]
{
  const out = lintFixture(HEAD + `
[[action]]
id = "py"
title = "跑脚本"
description = "用 python 跑一个最简单的脚本"
risk = "read"
run = ["python3", "-c", "print(1)"]
output = "text"
`);
  check('L16 python 未声明 encoding info', out.includes('L16') && out.includes('默认 utf-8'));
}
// L17 timeout 越界
{
  const out = lintFixture(HEAD + `
[[action]]
id = "slow"
title = "慢动作"
description = "一个等待很久的演示动作"
risk = "read"
run = ["echo", "x"]
output = "text"
timeout = 900
`);
  check('L17 timeout 900 warn', out.includes('L17') && out.includes('900'));
}
// L18 {setting.x} 未声明
{
  const out = lintFixture(HEAD + `
[[action]]
id = "use"
title = "用设置"
description = "引用一个不存在的设置项演示报错"
risk = "read"
run = ["echo", "{setting.ghost}"]
output = "text"
`);
  check('L18 未声明 setting 拦截', out.includes('L18') && out.includes('ghost') || out.includes('ghost'));
}
// L19 service 无 port 无 pidFile
{
  const out = lintFixture(HEAD + `
[[action]]
id = "probe"
title = "探"
description = "一个最普通的演示动作"
risk = "read"
run = ["echo", "x"]
output = "text"

[[service]]
id = "svc"
title = "服务"
description = "没有检测手段的示范服务"
`);
  check('L19 无 port/pidFile 拦截', out.includes('L19') && out.includes('无法检测') || out.includes('port') && out.includes('pidFile'));
}
// L20 重复 action id（加载层已报错退出非零——lint 输出里也应能看到重复事实）
{
  const out = lintFixture(HEAD + `
[[action]]
id = "dup"
title = "一"
description = "第一个同名动作的说明文字"
risk = "read"
run = ["echo", "1"]
output = "text"

[[action]]
id = "dup"
title = "二"
description = "第二个同名动作的说明文字"
risk = "read"
run = ["echo", "2"]
output = "text"
`);
  check('L20 重复 id 拦截（加载层）', out.includes('重复') || out.includes('"dup"'));
}
// 内置插件不回归：quick 全量 lint 无 error
{
  const r = spawnSync(process.execPath, [CLI, 'plugin', 'bundled'], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home } });
  const r2 = spawnSync(process.execPath, [CLI, 'plugin', 'lint', 'quick'], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home } });
  const m = /error (\d+)/.exec(r2.stdout ?? '');
  check('内置 quick 无新 error', m?.[1] === '0', (m?.[1] ?? '?'));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
