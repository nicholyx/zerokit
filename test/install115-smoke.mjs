// install115-smoke：第一百一十五轮——插件安装/卸载/升级体验
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- install115`); } };
const home = mkdtempSync(path.join(tmpdir(), 'i115-'));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 90000, cwd: PKG_ROOT, env: { ...process.env, ZEROKIT_HOME: home } });
console.log(`install115-smoke（${home}）`);

// 纯函数
const { installSummary, prechecks, uninstallPreview, upgradeDiff, versionGap, appendInstallHistory, readInstallHistory } = await import('../src/core/install115.ts');
const fake = (over = {}) => ({
  id: 'x', name: 'X', version: '1.0.0', description: '', actions: [
    { id: 'a', title: 'a', description: '', risk: 'read', params: [{ name: 'p', type: 'string', description: '', required: true }], type: 'exec', run: ['echo'] },
    { id: 'b', title: 'b', description: '', risk: 'mutate', params: [], type: 'exec', run: ['echo'] },
    { id: 'c', title: 'c', description: '', risk: 'destructive', params: [], type: 'exec', run: ['echo'] },
  ], pluginDeps: [], ...over,
});

// ① installSummary 风险分档
{
  const s = installSummary(fake());
  check('① 三档计数', s.counts.read === 1 && s.counts.mutate === 1 && s.counts.destructive === 1);
  check('① risky 列出非只读', s.risky.join() === 'b,c');
}
// ② prechecks 聚合
{
  const p2 = fake({ pluginDeps: ['nosuch'] });
  const items = prechecks(p2, [{ name: 'python', ok: false, hint: 'brew install python' }]);
  check('② dep+require 两类聚合', items.length === 2 && items[0].kind === 'dep' && !items[0].ok && items[1].kind === 'require' && !items[1].ok);
  check('② 提示带安装命令', items[0].hint === 'zkit plugin install nosuch');
}
// ③ uninstallPreview
{
  const u = uninstallPreview(fake(), ['demo']);
  check('③ 反向依赖+动作数+数据保留', u.dependents.join() === 'demo' && u.losing === 3 && u.dataKept === true);
}
// ④ upgradeDiff 动作+参数两维
{
  const next = fake({
    version: '1.1.0', actions: [
      { id: 'a', title: 'a', description: '', risk: 'read', params: [{ name: 'p', type: 'string', description: '', required: true }, { name: 'q', type: 'string', description: '', required: true }], type: 'exec', run: ['echo'] },
      { id: 'd', title: 'd', description: '', risk: 'read', params: [], type: 'exec', run: ['echo'] },
    ],
  });
  const d = upgradeDiff(fake(), next);
  check('④ 新增/移除动作', d.added.join() === 'd' && d.removed.join() === 'b,c');
  check('④ 参数变化', d.paramChanged.length === 1 && d.paramChanged[0].action === 'a' && d.paramChanged[0].addedParams.join() === 'q');
}
// ⑤ versionGap 三态
check('⑤ 新/同版/可升级', versionGap(undefined, '1.0') === 'new' && versionGap('1.0', '1.0') === '' && versionGap('1.0', '1.1') === 'upgradable');
// ⑥ 流水落盘+上限
{
  const h2 = mkdtempSync(path.join(tmpdir(), 'i115h-'));
  for (let i = 0; i < 205; i++) appendInstallHistory(h2, { ts: `2026-11-02T00:00:${String(i % 60).padStart(2, '0')}`, plugin: `p${i}`, kind: 'install' }, 200);
  const list = readInstallHistory(h2);
  check('⑥ 上限 200 截旧', list.length === 200 && list[0].plugin === 'p5');
  rmSync(h2, { recursive: true, force: true });
}
// ⑥' 空目录读不炸
check("⑥' 空历史", readInstallHistory(mkdtempSync(path.join(tmpdir(), 'i115e-'))).length === 0);

// CLI 端到端
run(['plugin', 'bundled']);
{
  const r = run(['plugin', 'install', 'convert', '--yes']);
  const all = r.stdout + r.stderr;
  check('⑥ CLI 安装出摘要行', all.includes('刚装进来的能力：9 个只读'));
  const r2 = run(['plugin', 'history']);
  check('⑥ history 见安装流水', (r2.stdout + r2.stderr).includes('安装') && (r2.stdout + r2.stderr).includes('convert v'));
}
{
  const r = run(['plugin', 'remove', 'convert']);
  const all = r.stdout + r.stderr;
  check('③ 卸载预览动作数', all.includes('将失去：9 个动作'));
  check('③ 数据保留说明', all.includes('持久数据'));
  const r2 = run(['plugin', 'history']);
  check('⑥ 卸载进流水', (r2.stdout + r2.stderr).includes('卸载  convert'));
}
{
  // ⑦ --yes 已有（本轮核实）+ 非 TTY 无 --yes 拒绝
  const r = run(['plugin', 'install', 'quick']);
  check('⑦ 无 --yes 非 TTY 拒绝且提示', (r.stdout + r.stderr).includes('--yes'));
}
{
  // ⑤ 市市搜索版本差
  run(['market', 'add', '.']);
  run(['plugin', 'install', 'quick', '--yes']);
  const r = run(['market', 'search', 'quick']);
  check('⑤ 搜索行带已装标记', (r.stdout + r.stderr).includes('✓ 已装同版'));
}
// ⑧ remove 反向依赖提示已存在（第八十七轮建）——静态核实
{
  const src = await import('node:fs').then((m) => m.readFileSync(CLI, 'utf8'));
  check('⑧ remove 反向依赖拦截在', src.includes("还有插件依赖"));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
