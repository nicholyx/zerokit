// 文件搜索插件的回归测试。
//
// 全部在临时目录里跑：临时工作区 + 临时 ZEROKIT_HOME，不碰用户真实目录、不碰真实 HOME、不联网。
// 唯一有"副作用"的 open 动作也只在 dry-run 下验证（只报告要执行的命令），
// 不会真的弹出资源管理器窗口。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PKG_ROOT = path.resolve(import.meta.dirname, '..');
const TMP = path.join(os.tmpdir(), 'zerokit-filesearch-test');
// 必须在 import runner/paths **之前**设好：ZEROKIT_HOME 是在模块加载时读的
process.env['ZEROKIT_HOME'] = path.join(TMP, 'home');

const { loadPlugin } = await import('../src/core/manifest.ts');
const { runAction } = await import('../src/core/runner.ts');

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   <- ' + String(detail).slice(0, 400)}`);
};

const PLUGIN_DIR = path.join(PKG_ROOT, 'plugins', 'filesearch');
const SCRIPT = path.join(PLUGIN_DIR, 'filesearch.mjs');
const DATA_DIR = path.join(process.env['ZEROKIT_HOME'], 'data', 'filesearch');
const INDEX = path.join(DATA_DIR, 'index.json');

fs.rmSync(TMP, { recursive: true, force: true });

// ---- 造一个自包含的工作区 ----
// WS/report/plain.md 是刻意造的：让 "report" 既能命中文件名（Report.TXT），
// 又能命中目录名（report/），用来验证"文件名优先于路径"这条排序规则。
const WS = path.join(TMP, 'ws');
const OUTSIDE = path.join(TMP, 'outside');
const FILES = {
  readme: path.join(WS, 'readme.md'),
  report: path.join(WS, 'nested', 'Report.TXT'),
  appLog: path.join(WS, 'nested', 'deep', 'app.log'),
  plain: path.join(WS, 'report', 'plain.md'),
};
const SHOULD_SKIP = {
  nodeModules: path.join(WS, 'node_modules', 'skipme.js'),
  git: path.join(WS, '.git', 'config'),
};
for (const f of [...Object.values(FILES), ...Object.values(SHOULD_SKIP)]) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `测试文件 ${f}\n`);
}
fs.mkdirSync(OUTSIDE, { recursive: true });
const stray = path.join(OUTSIDE, 'stray.txt');
fs.writeFileSync(stray, '索引建好之后才出现的文件\n');

// ---- 加载插件 ----
const loaded = loadPlugin(PLUGIN_DIR);
const plugin = loaded.plugin;
check('清单能通过 loadPlugin 校验', Boolean(plugin), loaded.errors.join('; '));

const byId = (id) => plugin?.actions.find((a) => a.id === id);
const run = (id, values) => runAction(plugin, byId(id), { caller: 'cli', values });

{
  const ids = (plugin?.actions ?? []).map((a) => a.id).sort();
  const want = ['index', 'open', 'search', 'status'];
  check('四个动作齐全（index / search / status / open）',
    JSON.stringify(ids) === JSON.stringify(want), JSON.stringify(ids));
  check('每个动作都显式声明了合法的 risk',
    (plugin?.actions ?? []).every((a) => ['read', 'mutate', 'destructive'].includes(a.risk)),
    (plugin?.actions ?? []).map((a) => `${a.id}:${a.risk}`).join(', '));
  check('search 声明为只读、index 声明为会写',
    byId('search')?.risk === 'read' && byId('index')?.risk === 'mutate',
    `search=${byId('search')?.risk} index=${byId('index')?.risk}`);
}

// ---- 没有索引时必须明确报错，而不是返回空列表 ----
{
  const r = await run('search', { keyword: 'readme', limit: 20 });
  check('没建索引时 search 明确报错（不是空列表）',
    !r.ok && /索引/.test(r.stderr) && r.stdout.trim() === '',
    `ok=${r.ok} stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)}`);
}

// ---- 建索引 ----
{
  const r = await run('index', { dirs: WS, max: 100000 });
  const d = r.data ?? {};
  check('index 成功并报告索引文件数与耗时',
    r.ok && d['索引文件数'] === 4 && typeof d['耗时'] === 'string' && fs.existsSync(INDEX),
    JSON.stringify(d) + r.stderr);
  check('index 报告了根目录（供下次沿用）',
    Array.isArray(d['根目录']) && d['根目录'].length === 1, JSON.stringify(d['根目录']));
  check('index 报告了"无权限目录"（正常情况下为空数组）',
    Array.isArray(d['无权限目录']) && d['无权限目录'].length === 0, JSON.stringify(d['无权限目录']));
}

// ---- 跳过规则 ----
{
  const a = await run('search', { keyword: 'skipme', limit: 20 });
  const b = await run('search', { keyword: 'config', limit: 20 });
  check('node_modules 里的文件没有被索引',
    a.ok && Array.isArray(a.data) && a.data.length === 0, JSON.stringify(a.data) + a.stderr);
  check('.git 里的文件没有被索引',
    b.ok && Array.isArray(b.data) && b.data.length === 0, JSON.stringify(b.data) + b.stderr);
}

// ---- 搜索 ----
{
  const r = await run('search', { keyword: 'readme', limit: 20 });
  const rows = r.data ?? [];
  const hit = rows.find((x) => x['路径'] === FILES.readme);
  check('能按文件名搜到文件', r.ok && rows.length === 1 && Boolean(hit),
    JSON.stringify(rows) + r.stderr);
  check('结果带齐 文件名 / 路径 / 大小 / 修改时间',
    Boolean(hit) && Object.keys(hit).sort().join(',') === '修改时间,大小,文件名,路径'.split(',').sort().join(','),
    JSON.stringify(hit));
}
{
  const r = await run('search', { keyword: 'report.txt', limit: 20 });
  check('搜索不区分大小写（report.txt → Report.TXT）',
    r.ok && (r.data ?? []).some((x) => x['路径'] === FILES.report),
    JSON.stringify(r.data) + r.stderr);
}
{
  const r = await run('search', { keyword: 'APP.LOG', limit: 20 });
  check('搜索不区分大小写（APP.LOG → app.log）',
    r.ok && (r.data ?? []).some((x) => x['路径'] === FILES.appLog),
    JSON.stringify(r.data) + r.stderr);
}
{
  const r = await run('search', { keyword: 'report', limit: 20 });
  const rows = r.data ?? [];
  // Report.TXT 是文件名命中，report/plain.md 只是路径命中，前者必须排在前面
  check('文件名命中排在路径命中之前',
    rows.length === 2 && rows[0]['路径'] === FILES.report && rows[1]['路径'] === FILES.plain,
    JSON.stringify(rows) + r.stderr);
}
{
  const r = await run('search', { keyword: 'report', limit: 1 });
  check('limit 生效', r.ok && (r.data ?? []).length === 1, JSON.stringify(r.data) + r.stderr);
}

// ---- 不填 dirs 时沿用上次的根目录 ----
{
  const r = await run('index', {});
  check('不填 dirs 时沿用上次的根目录重建',
    r.ok && r.data?.['索引文件数'] === 4 && (r.data?.['根目录'] ?? [])[0] === WS,
    JSON.stringify(r.data) + r.stderr);
}

// ---- status ----
{
  const r = await run('status', {});
  check('status 报告的概况与索引一致',
    r.ok && r.data?.['文件数'] === 4 && typeof r.data?.['索引大小'] === 'string'
    && (r.data?.['覆盖根目录'] ?? [])[0] === WS,
    JSON.stringify(r.data) + r.stderr);
}

// ---- open 的安全校验 ----
{
  const a = await run('open', { path: path.join(WS, '根本没有这个文件.txt') });
  check('open 拒绝不存在的路径',
    !a.ok && /不存在/.test(a.stderr), `ok=${a.ok} stderr=${JSON.stringify(a.stderr)}`);

  const b = await run('open', { path: stray });
  check('open 拒绝存在但不在索引里的路径',
    !b.ok && /不在索引里/.test(b.stderr), `ok=${b.ok} stderr=${JSON.stringify(b.stderr)}`);
}

// open 的成功路径用 --dry-run 走一遍：验证命令构造正确，又不真的弹窗口。
// 直接在**脚本层**调用（清单里没有 dry-run 参数，走不到这条路）。
{
  const r = spawnSync(process.execPath, [
    SCRIPT, 'open', `--data-dir=${DATA_DIR}`, `--path=${FILES.report}`, '--dry-run',
  ], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  let data;
  try { data = JSON.parse(r.stdout); } catch { /* 下面统一报错 */ }
  check('open 对索引内的路径放行，并构造出 explorer /select 命令（dry-run）',
    r.status === 0 && /explorer/.test(String(data?.['方式'])) && String(data?.['方式']).includes('/select,')
    && String(data?.['方式']).includes('Report.TXT'),
    `code=${r.status} out=${r.stdout} err=${r.stderr}`);

  const bad = spawnSync(process.execPath, [
    SCRIPT, 'open', `--data-dir=${DATA_DIR}`, `--path=${FILES.report}\ncalc.exe`,
  ], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  check('open 拒绝含控制字符的路径',
    bad.status === 1 && /控制字符/.test(bad.stderr), `code=${bad.status} err=${bad.stderr}`);
}

// ---- 收尾：把临时目录整个删掉 ----
fs.rmSync(TMP, { recursive: true, force: true });
check('临时目录已清理，没留下真实痕迹', !fs.existsSync(TMP), TMP);

console.log('\n' + '='.repeat(60));
const failed = results.filter(([, ok]) => !ok).map(([n]) => n);
console.log(`通过 ${results.length - failed.length} / ${results.length}`);
if (failed.length) console.log('失败：' + failed.join(', '));
process.exit(failed.length ? 1 : 0);