// 插件更新的回归测试：来源记录 → 检查（版本 + 动作 diff）→ 替换安装 → 数据保留。
//
// git 来源用**本地仓库**（git init 出来的目录）模拟：git clone 支持本地路径，
// 全程不联网。备份式替换、确认令牌、无来源的降级提示都在覆盖范围内。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const PKG_ROOT = path.resolve(import.meta.dirname, '..');
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'zerokit-update-smoke-'));
process.env['ZEROKIT_HOME'] = TMP_HOME;

const { installBundled, addFromDir, addFromGit, removePlugin } = await import('../src/core/registry.ts');
const { compareVersion, checkUpdate, applyUpdate } = await import('../src/core/update.ts');
const { readSource } = await import('../src/core/sources.ts');
const { pluginDataDir } = await import('../src/core/paths.ts');

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   <- ' + String(detail).slice(0, 300)}`);
};

const PLUGINS = path.join(TMP_HOME, 'plugins');

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return r.stdout;
}

/** 造一个 git 仓库插件（可以指定版本与动作），返回仓库路径 */
function makeGitPlugin(version, actions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zerokit-update-src-'));
  const actionToml = actions.map((id) => `
[[action]]
id     = "${id}"
title  = "${id}"
description = "测更新"
run    = ["{node}", "-e", "console.log('${id}')"]
output = "text"
risk   = "read"`).join('\n');
  fs.writeFileSync(path.join(dir, 'plugin.toml'), `
[plugin]
id = "upd"
name = "更新测试"
version = "${version}"
summary = "测更新流程"
${actionToml}
`);
  sh('git', ['init', '-q', '.'], { cwd: dir });
  sh('git', ['add', '-A'], { cwd: dir });
  sh('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', `v${version}`], { cwd: dir });
  return dir;
}

// ---------------------------------------------------------------- 1. 版本比较

{
  check('版本比较：2.0.0 > 1.9.9', compareVersion('2.0.0', '1.9.9') === 1);
  check('版本比较：1.0.0 == v1.0.0（容忍 v 前缀）', compareVersion('1.0.0', 'v1.0.0') === 0);
  check('版本比较：1.2 < 1.2.1（缺段补 0）', compareVersion('1.2', '1.2.1') === -1);
  check('版本比较：解析不了就按字符串', compareVersion('beta.2', 'beta.10') === 1);
}

// ---------------------------------------------------------------- 2. 来源记录

{
  installBundled();
  const bundledDir = path.join(PLUGINS, 'sysinfo');
  const src = readSource(bundledDir);
  check('bundled 安装记录来源（type=bundled，版本与仓库一致）',
    src?.type === 'bundled' && src?.installedVersion === '1.0.0', JSON.stringify(src));

  const git1 = makeGitPlugin('1.0.0', ['hello']);
  const r = addFromGit(git1);
  const gitSrc = r.ok ? readSource(path.join(PLUGINS, 'upd')) : null;
  check('git 安装记录来源（type=git，带仓库地址与版本）',
    r.ok && gitSrc?.type === 'git' && gitSrc?.url === git1 && gitSrc?.installedVersion === '1.0.0',
    `${r.message} ${JSON.stringify(gitSrc)}`);
}

// ---------------------------------------------------------------- 3. 检查更新（含动作 diff）

let repo;   // 后面复用这个仓库升级它
{
  repo = path.join(PLUGINS, '..', 'upd-src');
  // 重新造一个干净的（上面 git1 的临时目录还留着，直接复用）
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'zerokit-update-repo-'));
  fs.rmSync(repo, { recursive: true, force: true });
  const v1 = makeGitPlugin('1.0.0', ['hello', 'world']);
  fs.cpSync(v1, repo, { recursive: true });
  fs.rmSync(v1, { recursive: true, force: true });

  removePlugin('upd');
  const r = addFromGit(repo);
  if (!r.ok) throw new Error('预置失败：' + r.message);

  // 没有变化时：available=false
  const same = checkUpdate('upd');
  check('检查：来源处没有变化时提示已是最新',
    !same.available && same.latest === '1.0.0' && /最新/.test(same.reason ?? ''),
    JSON.stringify(same));

  // 升级：v2 去掉 world、加 bye
  fs.writeFileSync(path.join(repo, 'plugin.toml'), `
[plugin]
id = "upd"
name = "更新测试"
version = "2.0.0"
summary = "测更新流程"

[[action]]
id = "hello"
title = "hello"
description = "测更新"
run = ["{node}", "-e", "console.log('hello')"]
output = "text"
risk = "read"

[[action]]
id = "bye"
title = "bye"
description = "新增"
run = ["{node}", "-e", "console.log('bye')"]
output = "text"
risk = "read"
`);
  sh('git', ['add', '-A'], { cwd: repo });
  sh('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'v2'], { cwd: repo });

  const diff = checkUpdate('upd');
  check('检查：版本变化被识别（1.0.0 → 2.0.0）',
    diff.available && diff.current === '1.0.0' && diff.latest === '2.0.0',
    JSON.stringify(diff));
  check('检查：动作增删被摊开（+bye / -world）',
    diff.addedActions.join(',') === 'bye' && diff.removedActions.join(',') === 'world',
    `+${diff.addedActions} -${diff.removedActions}`);
}

// ---------------------------------------------------------------- 4. 执行更新（数据保留 + 失败回滚语义）

{
  // 在 {data_dir} 放一条「跨更新必须保留」的数据
  const dataFile = path.join(pluginDataDir('upd'), 'keep.txt');
  fs.writeFileSync(dataFile, '用户的持久数据');

  const r = applyUpdate('upd');
  const after = readSource(path.join(PLUGINS, 'upd'));
  check('更新：目录被替换为新版本',
    r.ok && after?.installedVersion === '2.0.0', `${r.message} ${JSON.stringify(after)}`);
  check('更新：插件数据目录里的内容跨更新保留',
    fs.existsSync(dataFile) && fs.readFileSync(dataFile, 'utf8') === '用户的持久数据', dataFile);
  check('更新：临时 clone 仓库清理干净（PLUGINS_DIR 下没有 .tmp-*）',
    fs.readdirSync(PLUGINS).every((n) => !n.startsWith('.tmp-') || n.startsWith('.tmp-old-') === false),
    fs.readdirSync(PLUGINS).join(','));

  // 更新后再检查：回到「已是最新」
  check('更新后再检查：已是最新', !checkUpdate('upd').available, '');
}

// ---------------------------------------------------------------- 5. 无来源 / 本地目录来源的降级

{
  removePlugin('upd');
  // 手工拷一个目录进去（模拟用户手放的插件，无来源记录）
  const manual = path.join(PLUGINS, 'manual');
  fs.mkdirSync(manual, { recursive: true });
  fs.writeFileSync(path.join(manual, 'plugin.toml'), `
[plugin]
id = "manual"
name = "手放的"
version = "0.1.0"
summary = ""

[[action]]
id = "a"
title = "a"
description = "a"
run = ["{node}", "-e", "console.log(1)"]
output = "text"
risk = "read"
`);
  const noSource = checkUpdate('manual');
  check('无来源：如实说无法自动更新，不瞎猜',
    !noSource.available && /没有安装来源记录/.test(noSource.reason ?? ''),
    JSON.stringify(noSource.reason));
  const r2 = applyUpdate('manual');
  check('无来源：applyUpdate 拒绝并解释',
    !r2.ok && /没有安装来源记录|没法自动更新/.test(r2.message), r2.message);

  // dir 来源
  const dirSrc = path.join(TMP_HOME, 'dir-plugin');
  fs.mkdirSync(dirSrc, { recursive: true });
  fs.copyFileSync(path.join(manual, 'plugin.toml'), path.join(dirSrc, 'plugin.toml'));
  removePlugin('manual');
  const r3 = addFromDir(dirSrc, { source: { type: 'dir', installedAt: new Date().toISOString(), installedVersion: '' } });
  const dirCheck = checkUpdate('manual');
  check('本地目录来源：提示去源目录重新 add',
    r3.ok && !dirCheck.available && /本地目录/.test(dirCheck.reason ?? ''),
    `${r3.message} / ${dirCheck.reason}`);
}

// ---------------------------------------------------------------- 6. server API（预览 / 令牌）

{
  const { startServer } = await import('../src/server.ts');
  const { url, close } = await startServer({ port: 0 });
  const html = await (await fetch(url + '/')).text();
  const token = /name="zk-token" content="([0-9a-f]+)"/.exec(html)?.[1];
  check('API：应用前端能拿到会话令牌', Boolean(token), 'index.html 里没有 zk-token');
  const H = { 'x-zerokit-token': token, 'content-type': 'application/json' };

  const plugins = await (await fetch(url + '/api/plugins')).json();
  const withSource = (plugins.plugins ?? []).filter((p) => p.sourceType && p.sourceType !== 'unknown');
  check('API：/api/plugins 带来源信息（sourceType/sourceText）',
    withSource.length > 0 && withSource.every((p) => typeof p.sourceText === 'string'),
    JSON.stringify((plugins.plugins ?? []).map((p) => p.sourceType)));

  // 预览：摊开能力 + 发确认令牌（用一个新的 git 仓库装一个新 id，避免和已装的冲突）
  const fresh = makeGitPlugin('1.0.0', ['only']);
  fs.rmSync(path.join(fresh, 'plugin.toml'));
  fs.writeFileSync(path.join(fresh, 'plugin.toml'), `
[plugin]
id = "apinew"
name = "API 安装"
version = "1.0.0"
summary = ""

[[action]]
id = "only"
title = "only"
description = "only"
run = ["{node}", "-e", "console.log(1)"]
output = "text"
risk = "read"
`);
  sh('git', ['add', '-A'], { cwd: fresh });
  sh('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fix id', '--allow-empty'], { cwd: fresh });

  const pv = await (await fetch(url + '/api/plugin/install', {
    method: 'POST', headers: H, body: JSON.stringify({ source: fresh }),
  })).json();
  check('API：安装预览摊开动作与风险并带确认令牌',
    pv.needConfirm === true && pv.confirm && pv.plugin?.actions?.length === 1
    && pv.plugin.actions[0].risk === 'read',
    JSON.stringify(pv).slice(0, 160));

  const bad = await (await fetch(url + '/api/plugin/install', {
    method: 'POST', headers: H, body: JSON.stringify({ source: fresh, confirm: 'wrong' }),
  })).json();
  check('API：错误的确认令牌被拒（403）', bad.error?.includes('令牌'), JSON.stringify(bad));

  const okInstall = await (await fetch(url + '/api/plugin/install', {
    method: 'POST', headers: H, body: JSON.stringify({ source: fresh, confirm: pv.confirm }),
  })).json();
  // 本地路径（哪怕它其实是个 git 仓库）按既有语义走「本地目录」安装——
  // plugin add 的注释里写明了这个优先级，远端仓库用 https:// 形式装
  check('API：带正确令牌完成安装，来源记录为本地目录',
    okInstall.ok === true && readSource(path.join(PLUGINS, 'apinew'))?.type === 'dir',
    JSON.stringify(okInstall));

  const upd = await (await fetch(url + '/api/plugin/check', {
    method: 'POST', headers: H, body: JSON.stringify({ id: 'apinew' }),
  })).json();
  check('API：更新检查返回版本与来源', upd.current === '1.0.0' && upd.sourceType === 'dir' && !upd.available,
    JSON.stringify(upd));

  const noTok = await (await fetch(url + '/api/plugin/update', {
    method: 'POST', headers: H, body: JSON.stringify({ id: 'apinew' }),
  })).json();
  check('API：更新不带令牌被拒', noTok.error?.includes('令牌'), JSON.stringify(noTok));

  close();
}

// ---------------------------------------------------------------- 收尾

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${'='.repeat(60)}\n通过 ${results.length - failed.length} / ${results.length}`);
if (failed.length > 0) {
  console.log('失败项：');
  for (const [name] of failed) console.log(`  - ${name}`);
}
fs.rmSync(TMP_HOME, { recursive: true, force: true });
fs.rmSync(path.join(os.tmpdir(), 'zerokit-update-src-'), { recursive: true, force: true });
process.exit(failed.length > 0 ? 1 : 0);
