// 集市冒烟测试：走真实 CLI，验证「添加集市 → 搜索 → 审查 → 安装」整条链路，
// 以及两个安全边界：目录穿越必须被拒、安装前的审查必须把危险动作摊开。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PKG_ROOT = path.resolve(import.meta.dirname, '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
const TMP = path.join(os.tmpdir(), 'zerokit-market-test');
const HOME = path.join(TMP, 'home');

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   <- ' + String(detail).slice(0, 400)}`);
};

function cli(args, opts = {}) {
  const out = spawnSync(process.execPath, [CLI, ...args], {
    cwd: PKG_ROOT,
    env: { ...process.env, ZEROKIT_HOME: HOME, PYTHONIOENCODING: 'utf-8' },
    encoding: 'utf8',
    input: opts.input ?? '',
    windowsHide: true,
    timeout: 120000,
  });
  return { code: out.status, out: (out.stdout ?? '') + (out.stderr ?? '') };
}

// ---- 搭一个临时集市：复制仓库里的示例插件 + 生成索引 ----
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, 'market'), { recursive: true });
fs.mkdirSync(HOME, { recursive: true });
fs.cpSync(path.join(PKG_ROOT, 'plugins'), path.join(TMP, 'market', 'plugins'), { recursive: true });

const marketDir = path.join(TMP, 'market');
let r = cli(['market', 'index', marketDir, '测试集市', '用于测试']);
check('market index 能生成索引', r.code === 0 && fs.existsSync(path.join(marketDir, 'market.json')), r.out);

// 目录穿越：条目 source 指向集市仓库之外，必须被拒
const evilDir = path.join(TMP, 'evil-market');
fs.mkdirSync(evilDir, { recursive: true });
fs.cpSync(path.join(PKG_ROOT, 'plugins', 'sysinfo'), path.join(TMP, 'outside-sysinfo'), { recursive: true });
fs.writeFileSync(path.join(evilDir, 'market.json'), JSON.stringify({
  name: '恶意集市',
  plugins: [{ id: 'evil', name: '恶意插件', source: 'path:../outside-sysinfo' }],
}, null, 2));

// ---- 用例 ----
r = cli(['market', 'add', marketDir]);
check('添加本地集市目录', r.code === 0 && /已添加集市/.test(r.out), r.out);

r = cli(['market', 'list']);
// 不写死个数：仓库里的示例插件会增减，写死了每加一个插件测试就红一次
const listed = Number(/测试集市\s+(\d+) 个插件/.exec(r.out)?.[1] ?? 0);
check('列出集市并显示插件数', /测试集市/.test(r.out) && listed >= 3, r.out);

r = cli(['market', 'search', '代理']);
check('按中文关键词搜到插件', /proxy/.test(r.out) && /白名单代理/.test(r.out), r.out);

r = cli(['market', 'search', 'sysinfo']);
check('按 id/keywords 也能搜到', /sysinfo/.test(r.out), r.out);

// 非交互环境下不给 --yes 必须拒绝（失败要往安全的一侧倒）
r = cli(['plugin', 'install', 'proxy']);
check('非交互环境下拒绝安装并要求显式确认', r.code === 1 && /无法确认/.test(r.out), r.out);

// 审查输出必须把每个动作的真实命令和风险等级摊开
const reviewOk = /共 7 个动作/.test(r.out)
  && /\{python\} proxy\.py stop/.test(r.out)
  && /高风险/.test(r.out)
  && /auth/.test(r.out);
check('安装前把全部动作的真实命令与风险等级摊开', reviewOk, r.out);

r = cli(['plugin', 'install', 'proxy', '--yes']);
check('显式确认后安装成功', r.code === 0 && /已安装/.test(r.out), r.out);

r = cli(['list']);
check('安装后在插件列表里可见', /proxy/.test(r.out) && /allow-domain/.test(r.out), r.out);

check('留下了安装快照（用于发现装后偷改）',
  fs.existsSync(path.join(HOME, 'installed', 'proxy.json')),
  fs.readdirSync(path.join(HOME, 'installed')).join(','));

r = cli(['plugin', 'install', 'proxy', '--yes']);
check('重复安装被拒并给出卸载指引', r.code === 1 && /已存在/.test(r.out), r.out);

r = cli(['plugin', 'install', '根本没有这个', '--yes']);
check('装不存在的插件给出可操作提示', r.code === 1 && /market search/.test(r.out), r.out);

// ---- 恶意集市 ----
r = cli(['market', 'add', evilDir]);
check('恶意集市本身可以添加（索引不执行任何东西）', r.code === 0, r.out);
r = cli(['plugin', 'install', 'evil', '--yes']);
check('条目里的目录穿越 source 在安装时被拒',
  r.code === 1 && /非法|拒绝/.test(r.out), r.out);

r = cli(['market', 'remove', '测试集市']);
check('移除集市', r.code === 0 && /已移除/.test(r.out), r.out);
r = cli(['market', 'list']);
check('移除后不再列出', !/测试集市/.test(r.out), r.out);

console.log('\n' + '='.repeat(60));
const failed = results.filter(([, ok]) => !ok).map(([n]) => n);
console.log(`通过 ${results.length - failed.length} / ${results.length}`);
if (failed.length) console.log('失败：' + failed.join(', '));
process.exit(failed.length ? 1 : 0);