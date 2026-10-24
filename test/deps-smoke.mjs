// 插件依赖（[requires] plugins）的冒烟测试。
//
// 覆盖：清单解析与校验 → 依赖状态/反向依赖/依赖树 → CLI 的 add/deps/remove/show/doctor
// → 「--with-deps 从自带示例补齐」与「解析不到的依赖明确报错」。
// 全部在临时 ZEROKIT_HOME 里跑（自包含、不联网、不依赖本机已装插件）。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'zerokit-deps-smoke-'));
process.env['ZEROKIT_HOME'] = TMP_HOME;

const { loadPlugin, parseManifest } = await import('../src/core/manifest.ts');
const { PLUGINS_DIR } = await import('../src/core/paths.ts');
const deps = await import('../src/core/deps.ts');

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   <- ' + String(detail).slice(0, 400)}`);
};

function cli(args) {
  return spawnSync(process.execPath, ['src/cli.ts', ...args], {
    cwd: ROOT,
    env: { ...process.env, ZEROKIT_HOME: TMP_HOME, NO_COLOR: '1' },
    encoding: 'utf8', timeout: 120000, windowsHide: true,
  });
}

/** 在插件目录外造一份「安装源」，模拟从目录安装 */
function sourceDir(name, files) {
  const dir = path.join(TMP_HOME, 'sources', name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), body);
  }
  return dir;
}

const ECHO = 'process.stdout.write("hello\\n");\n';
const ACTION = `
[[action]]
id          = "hello"
title       = "打个招呼"
description = "验证依赖补装后能直接跑"
run         = ["{node}", "echo.mjs"]
risk        = "read"
`;

const CONSUMER = `[plugin]
id      = "consumer"
name    = "依赖消费方"
summary = "依赖 ip"

[requires]
plugins = ["ip"]
${ACTION}`;

const CHAINER = `[plugin]
id      = "chainer"
name    = "链路消费方"
summary = "组合动作引用别的插件（依赖应自动折算）"

[[action]]
id          = "combo"
title       = "组合"
description = "两步：本插件 + 已安装的 ip"
type        = "chain"
output      = "text"
risk        = "read"

  [[action.step]]
  use = "self.hello"
  as  = "a"

  [[action.step]]
  use = "sysinfo.overview"
  as  = "sys"
${ACTION}`;

const GHOST = `[plugin]
id      = "ghostly"
name    = "依赖不存在的插件"
summary = "测解析不到的依赖"

[requires]
plugins = ["ghost"]
${ACTION}`;

// ---------------------------------------------------------------- 1. 清单解析

{
  const r = parseManifest(CONSUMER, '/tmp');
  check('清单：[requires] plugins 解析成 pluginDeps', r.plugin?.pluginDeps.join(',') === 'ip', JSON.stringify(r));
  check('清单：plugins 不会被当成命令依赖', Object.keys(r.plugin?.requires ?? {}).length === 0,
    JSON.stringify(r.plugin?.requires));
}

{
  const toml = `[plugin]
id      = "mixed"
name    = "混合依赖"
summary = "命令 + 插件"

[requires]
python = ">=3.10"
plugins = ["ip", "sysinfo"]
${ACTION}`;
  const r = parseManifest(toml, '/tmp');
  check('清单：命令依赖与插件依赖各归各位',
    r.plugin?.requires['python'] === '>=3.10' && r.plugin?.pluginDeps.join(',') === 'ip,sysinfo',
    JSON.stringify({ req: r.plugin?.requires, deps: r.plugin?.pluginDeps }));
}

{
  const r = parseManifest(CHAINER, '/tmp');
  check('清单：组合动作的跨插件引用自动折算成依赖',
    r.plugin?.pluginDeps.includes('sysinfo'), JSON.stringify(r.plugin?.pluginDeps));
  check('清单：自动折算的依赖会给一条提醒',
    r.warnings.some((w) => w.includes('推导出插件依赖')), JSON.stringify(r.warnings));
}

{
  const toml = CONSUMER.replace('id      = "consumer"', 'id      = "consumer"')
    .replace('plugins = ["ip"]', 'plugins = ["consumer"]');
  const r = parseManifest(toml, '/tmp');
  check('清单：插件不能依赖自己（报错）',
    r.errors.some((e) => e.includes('自己')), JSON.stringify(r.errors));
}

{
  const toml = CONSUMER.replace('plugins = ["ip"]', 'plugins = ["IP"]');
  const r = parseManifest(toml, '/tmp');
  check('清单：非法的插件 id 会被拒绝',
    r.errors.some((e) => e.includes('不是合法插件 id')), JSON.stringify(r.errors));
}

{
  const toml = CONSUMER.replace('plugins = ["ip"]', 'plugins = "ip"');
  const r = parseManifest(toml, '/tmp');
  check('清单：plugins 写成字符串时给出可照抄的正确写法',
    r.errors.some((e) => e.includes('数组')), JSON.stringify(r.errors));
}

{
  const toml = CONSUMER.replace('plugins = ["ip"]', 'plugins = ["ip", "ip"]');
  const r = parseManifest(toml, '/tmp');
  check('清单：重复的依赖只算一次', r.plugin?.pluginDeps.join(',') === 'ip', JSON.stringify(r.plugin?.pluginDeps));
}

// ---------------------------------------------------------------- 2. 依赖模块

{
  const consumerDir = sourceDir('consumer', { 'plugin.toml': CONSUMER, 'echo.mjs': ECHO });
  const p = loadPlugin(consumerDir).plugin;
  const states = deps.depStates(p);
  check('模块：未安装的依赖标记为未安装', states.length === 1 && !states[0].installed,
    JSON.stringify(states));
  check('模块：缺失依赖列表', deps.missingDeps(p).join(',') === 'ip', JSON.stringify(deps.missingDeps(p)));
  check('模块：还能装吗——自带示例里能找到', deps.depStates(p).length === 1);

  // 先装一个「依赖 ip」的插件，验证反向依赖
  const add = cli(['plugin', 'add', consumerDir]);
  check('CLI：缺依赖时安装照常成功', add.status === 0, add.stderr);
  check('CLI：安装后给出缺依赖的提示与可照抄命令',
    add.stderr.includes('缺少插件依赖') && add.stderr.includes('zkit plugin install ip'), add.stderr);

  const consumers = deps.dependents('ip');
  check('模块：反向依赖能查到谁在依赖它', consumers.includes('consumer'), JSON.stringify(consumers));

  const show = cli(['show', 'consumer']);
  check('CLI：show 里列出插件依赖与未安装状态',
    show.stdout.includes('插件 ip') && show.stdout.includes('未安装'), show.stdout);

  const depsOut = cli(['plugin', 'deps', 'consumer']);
  check('CLI：plugin deps 打印依赖树', depsOut.stdout.includes('ip') && depsOut.status === 1, depsOut.stdout);

  const depsAll = cli(['plugin', 'deps']);
  check('CLI：不带参数时列出全局缺失',
    depsAll.stdout.includes('consumer') && depsAll.stdout.includes('ip'), depsAll.stdout);
}

// ---------------------------------------------------------------- 3. 卸载保护

{
  // 先把依赖装上，否则「依赖它」的插件本身也跑不起来，测不到卸载保护
  const addDep = cli(['plugin', 'install', 'ip', '--yes']);
  check('CLI：可以单独安装依赖（自带示例优先）',
    addDep.status === 0 && fs.existsSync(path.join(PLUGINS_DIR, 'ip', 'plugin.toml')), addDep.stderr);

  const blocked = cli(['plugin', 'remove', 'ip']);
  check('CLI：还有插件依赖时卸载被拦住',
    blocked.status === 1 && blocked.stderr.includes('还有插件依赖'), blocked.stderr);

  const forced = cli(['plugin', 'remove', 'ip', '--force']);
  check('CLI：--force 才能强行卸载', forced.status === 0, forced.stderr);

  const doc = cli(['doctor']);
  check('CLI：doctor 报出缺失的插件依赖',
    doc.status === 1 && doc.stdout.includes('缺少插件依赖'), doc.stdout);
}

// ---------------------------------------------------------------- 4. --with-deps

{
  const dir = sourceDir('withdeps', {
    'plugin.toml': CONSUMER.replace('"consumer"', '"withdeps"').replace('"依赖消费方"', '"withdeps"'),
    'echo.mjs': ECHO,
  });
  const r = cli(['plugin', 'add', dir, '--with-deps']);
  check('CLI：--with-deps 从自带示例补齐依赖',
    r.status === 0 && fs.existsSync(path.join(PLUGINS_DIR, 'ip', 'plugin.toml')), r.stdout + r.stderr);
  check('CLI：补装过程有可读的回执', r.stdout.includes('补装依赖 ip'), r.stdout + r.stderr);
}

{
  const dir = sourceDir('ghostly', { 'plugin.toml': GHOST, 'echo.mjs': ECHO });
  const r = cli(['plugin', 'add', dir, '--with-deps']);
  check('CLI：解析不到的依赖明确报错（不是静默跳过）',
    r.status === 1 && r.stderr.includes('找不到插件 "ghost"'), r.stdout + r.stderr);
  check('CLI：补依赖失败不影响插件本身落盘',
    fs.existsSync(path.join(PLUGINS_DIR, 'ghostly', 'plugin.toml')), '插件没装上');
}

// ---------------------------------------------------------------- 5. 链式插件端到端

{
  const dir = sourceDir('chainer', { 'plugin.toml': CHAINER, 'echo.mjs': ECHO });
  const add = cli(['plugin', 'add', dir, '--with-deps']);
  check('CLI：组合动作的隐含依赖也能被 --with-deps 补齐',
    add.status === 0, add.stdout + add.stderr);

  const run = cli(['run', 'chainer', 'combo', '--yes']);
  check('CLI：补齐后组合动作能直接执行（本机信息 + 自己的动作）',
    run.status === 0 && run.stdout.includes('hello') && run.stdout.includes('核心数'),
    run.stdout + run.stderr);
}

console.log('\n' + '='.repeat(60));
console.log(`通过 ${results.filter(([, ok]) => ok).length} / ${results.length}`);
process.exitCode = results.every(([, ok]) => ok) ? 0 : 1;
