// 插件脚手架与开发模式的测试：plugin new 生成 → plugin dev 链接 →
// 改清单即生效 → remove 只删链接不碰源目录 → dev 转正（add 换成真实复制）。
//
// 自包含：临时 ZEROKIT_HOME（插件目录）+ 临时工作目录（生成/开发用），
// 不依赖本机已装的插件或数据目录。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(import.meta.dirname, '..');
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'zerokit-scaffold-home-'));
const TMP_WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'zerokit-scaffold-work-'));
process.env['ZEROKIT_HOME'] = TMP_HOME;

const { scaffoldPlugin } = await import('../src/core/scaffold.ts');
const { addFromDir, devLink, findPlugin, removePlugin } = await import('../src/core/registry.ts');
const { checkUpdate } = await import('../src/core/update.ts');
const { readSource } = await import('../src/core/sources.ts');

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   <- ' + String(detail).slice(0, 300)}`);
};

/** 目录内容的快照（相对路径 → 文件内容），用于断言源目录在 remove 后原样 */
function snapshot(dir) {
  const out = {};
  const walk = (d, prefix) => {
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else out[rel] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(dir, '');
  return out;
}

// ---------------------------------------------------------------- new
{
  const r = scaffoldPlugin('demo', { dir: TMP_WORK });
  check('new：生成成功且返回目录', r.ok && r.dir === path.join(TMP_WORK, 'demo'));
  check('new：生成物通过清单校验（脚手架与校验规则一致）', !!r.load?.plugin, r.load?.errors);
  const names = r.files.sort().join(',');
  check('new：node 模板的文件齐全（toml + main.mjs + README）',
    names === 'README.md,main.mjs,plugin.toml', names);

  const again = scaffoldPlugin('demo', { dir: TMP_WORK });
  check('new：目录已存在时拒绝且不覆盖', !again.ok && fs.existsSync(path.join(TMP_WORK, 'demo', 'plugin.toml')));

  const bad = scaffoldPlugin('Demo!', { dir: TMP_WORK });
  check('new：非法 id（大写/感叹号）在生成前拒绝', !bad.ok && !fs.existsSync(path.join(TMP_WORK, 'Demo!')));

  const py = scaffoldPlugin('pydemo', { dir: TMP_WORK, runtime: 'python' });
  check('new：python 模板生成 main.py 且校验通过',
    py.ok && py.files.includes('main.py') && !!py.load?.plugin, py.load?.errors);

  const web = scaffoldPlugin('webdemo', { dir: TMP_WORK, web: true });
  check('new：--web 附带 web/index.html', web.ok && web.files.includes('web/index.html'));
  check('new：--web 的清单把动作标成 render = "web"',
    web.ok && /render\s*=\s*"web"/.test(fs.readFileSync(path.join(web.dir, 'plugin.toml'), 'utf8')));
}

// ---------------------------------------------------------------- dev：链接与即改即生效
{
  const r = devLink(path.join(TMP_WORK, 'demo'));
  check('dev：链接成功', r.ok, r.message);

  const entry = findPlugin('demo');
  check('dev：链接后 listPlugins 能加载到插件', !!entry?.plugin);

  const linked = fs.lstatSync(path.join(TMP_HOME, 'plugins', 'demo'));
  check('dev：插件目录里确实是个链接', linked.isSymbolicLink());

  const before = entry.plugin.actions.map((a) => a.id);
  // 往源目录的清单追加一个动作——开发迭代的最小单位
  fs.appendFileSync(path.join(TMP_WORK, 'demo', 'plugin.toml'), `
[[action]]
id          = "ping"
title       = "探活"
description = "追加的动作，用于验证改清单即生效。"
run         = ["{node}", "main.mjs", "{name}"]
output      = "text"
risk        = "read"
`);
  const after = findPlugin('demo').plugin.actions.map((a) => a.id);
  check('dev：改源目录清单后无需重装即可见（hello → hello+ping）',
    before.join() === 'hello' && after.join() === 'hello,ping', `${before} -> ${after}`);

  const src = readSource(path.join(TMP_WORK, 'demo'));
  check('dev：来源记录写在源目录且 type = dev', src?.type === 'dev' && src.path === path.join(TMP_WORK, 'demo'));

  // ---------------------------------------------------------------- remove：只删链接
  const snapBefore = snapshot(path.join(TMP_WORK, 'demo'));
  const okRemove = removePlugin('demo');
  const snapAfter = snapshot(path.join(TMP_WORK, 'demo'));
  check('remove：卸载 dev 插件成功', okRemove);
  check('remove：源目录完好无损（逐文件比对）',
    JSON.stringify(snapBefore) === JSON.stringify(snapAfter));
  check('remove：插件目录里的链接已删除', !fs.existsSync(path.join(TMP_HOME, 'plugins', 'demo')));
}

// ---------------------------------------------------------------- dev 转正与 update 分流
{
  devLink(path.join(TMP_WORK, 'demo'));
  const upd = checkUpdate('demo');
  check('update：dev 插件不 available，提示开发模式',
    !upd.available && upd.source?.type === 'dev' && /开发模式/.test(upd.reason ?? ''), upd.reason);

  // 转正：dev 状态下 add 同一目录 = 换成真实复制
  const r = addFromDir(path.join(TMP_WORK, 'demo'), {
    source: { type: 'dir', installedAt: new Date().toISOString(), installedVersion: '' },
  });
  check('转正：dev 状态下 add 同一目录成功', r.ok, r.message);
  const st = fs.lstatSync(path.join(TMP_HOME, 'plugins', 'demo'));
  check('转正：插件目录变成真实目录（不再是链接）', !st.isSymbolicLink());
  const src = readSource(path.join(TMP_HOME, 'plugins', 'demo'));
  check('转正：来源记录变成 dir（转正后的 update 走「重新 add」提示）', src?.type === 'dir');

  const upd2 = checkUpdate('demo');
  check('update：转正后按本地目录安装如实提示', !upd2.available && /本地目录/.test(upd2.reason ?? ''), upd2.reason);
  removePlugin('demo');
}

// ---------------------------------------------------------------- CLI 端到端（命令路由真实可走）
{
  const sh = (args) => spawnSync(process.execPath, ['src/cli.ts', ...args], {
    cwd: PKG_ROOT, encoding: 'utf8', timeout: 60000, windowsHide: true,
    env: { ...process.env, ZEROKIT_HOME: TMP_HOME },
  });
  const cliNew = sh(['plugin', 'new', 'clidemo', '--dir', TMP_WORK]);
  check('CLI：zkit plugin new 走得通且打印四个面', cliNew.status === 0 && /四个面/.test(cliNew.stdout), cliNew.stderr);

  const cliVal = sh(['plugin', 'validate', path.join(TMP_WORK, 'clidemo')]);
  check('CLI：zkit plugin validate 走得通', cliVal.status === 0 && /清单有效/.test(cliVal.stdout), cliVal.stderr);

  const cliDev = sh(['plugin', 'dev', path.join(TMP_WORK, 'clidemo')]);
  const cliRun = sh(['run', 'clidemo', 'hello', '--name', '测试']);
  check('CLI：zkit plugin dev 后 run 能跑出生成动作的输出',
    cliDev.status === 0 && cliRun.status === 0 && /你好，测试/.test(cliRun.stdout),
    `${cliDev.stderr} ${cliRun.stderr}${cliRun.stdout}`);

  const cliRm = sh(['plugin', 'remove', 'clidemo']);
  check('CLI：remove dev 插件后源目录还在',
    cliRm.status === 0 && fs.existsSync(path.join(TMP_WORK, 'clidemo', 'plugin.toml')), cliRm.stderr);
}

// ---------------------------------------------------------------- 收尾
fs.rmSync(TMP_HOME, { recursive: true, force: true });
fs.rmSync(TMP_WORK, { recursive: true, force: true });

const passed = results.filter(([, ok]) => ok).length;
console.log(`\n${'='.repeat(60)}\n通过 ${passed} / ${results.length}`);
if (passed !== results.length) process.exit(1);
