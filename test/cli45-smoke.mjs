/**
 * 第四十五轮：CLI 人体工学冒烟（cliX 纯函数 + CLI 端到端）。
 * 自包含：临时 ZEROKIT_HOME，不联网。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

let pass = 0; let fail = 0;
const ok = (cond, label, extra = '') => { if (cond) pass++; else { fail++; console.error(`FAIL: ${label} ${extra}`); } };
const REPO = path.resolve(import.meta.dirname, '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'zk-cli45-'));
const cli = (args) => spawnSync(process.execPath, [path.join(REPO, 'src/cli.ts'), ...args], {
  encoding: 'utf8', env: { ...process.env, ZEROKIT_HOME: HOME },
});

// Windows 盘符路径动态 import 必须走 file:// URL（ERR_UNSUPPORTED_ESM_URL_SCHEME）
const cliX = await import(pathToFileURL(path.join(REPO, 'src/core/cliX.ts')).href);

cli(['plugin', 'bundled']);

// ① out 四格式
{
  const y = cli(['run', 'quick', 'ts2date', '--ts', '1760000000', '--out', 'yaml']);
  ok(y.status === 0 && y.stdout.includes('本地时间:'), 'yaml 输出');
  const t = cli(['run', 'quick', 'ts2date', '--ts', '1760000000', '--out', 'table']);
  ok(t.status === 0 && t.stdout.includes('-----'), 'table 输出（分隔线）');
  const c = cli(['run', 'sysinfo', 'overview', '--out', 'csv']);
  ok(c.status === 0 && c.stdout.split('\n')[0].split(',').length >= 5, 'csv 首行列头');
  const j = cli(['run', 'quick', 'ts2date', '--ts', '1760000000', '--json']);
  ok(j.status === 0 && JSON.parse(j.stdout).ok === true, 'json 输出');
}

// ② quiet：单行 JSON
{
  const q = cli(['run', 'quick', 'ts2date', '--ts', '1760000000', '--quiet']);
  const lines = q.stdout.trim().split('\n');
  ok(q.status === 0 && lines.length === 1 && JSON.parse(lines[0]).data !== undefined, 'quiet 单行 JSON');
}

// ③ 控制旗标不污染参数解析：--out table 不会被当成动作参数
{
  const r = cli(['run', 'quick', 'color', '--hex', '5aa9ff', '--out', 'table']);
  ok(r.status === 0 && r.stdout.includes('HEX'), '控制旗标剥离（--out 不进 parseArgv）');
}

// ④⑤ history/last
{
  cli(['run', 'quick', 'ts2date', '--ts', '1760000000', '--yes']);
  cli(['run', 'quick', 'color', '--hex', '5aa9ff', '--yes']);
  const h = cli(['history', '5']);
  ok(h.status === 0 && h.stdout.includes('quick color') && h.stdout.includes('quick ts2date'), 'history 列出两条');
  const show = cli(['last', '--show']);
  ok(show.status === 0 && show.stdout.includes('quick color'), 'last --show 只看不跑');
  const rerun = cli(['history', '--rerun', '1']);
  ok(rerun.status === 0 && rerun.stdout.includes('HEX'), 'history --rerun 1 重跑成功');
  const lastBad = cli(['history', '--rerun', '99']);
  ok(lastBad.status === 1, 'history --rerun 越界报错');
  // 历史文件存在且是合法 JSON 数组
  const hist = JSON.parse(fs.readFileSync(path.join(HOME, 'history.json'), 'utf8'));
  ok(Array.isArray(hist) && hist.length >= 2, 'history.json 落盘');
  // 控制旗标不进历史 argv
  const lastEntry = hist.at(-1);
  ok(!lastEntry.argv.includes('--out') && !lastEntry.argv.includes('--yes'), '历史 argv 剥控制旗标');
}

// ⑥ last 空历史（新 HOME）
{
  const H2 = fs.mkdtempSync(path.join(os.tmpdir(), 'zk-cli45b-'));
  const r = spawnSync(process.execPath, [path.join(REPO, 'src/cli.ts'), 'last'], {
    encoding: 'utf8', env: { ...process.env, ZEROKIT_HOME: H2 },
  });
  ok(r.status === 1 && r.stderr.includes('还没有'), 'last 空历史提示');
  fs.rmSync(H2, { recursive: true, force: true });
}

// ⑦ --health
{
  const h = cli(['list', '--health']);
  ok(h.status !== undefined && h.stdout.includes('插件健康'), 'list --health 渲染');
  const j = cli(['list', '--health', '--json']);
  const rows = JSON.parse(j.stdout);
  ok(Array.isArray(rows) && rows.some((r) => r.id === 'quick' && r.health === 'ok'), 'list --health --json 机读');
  ok(rows.some((r) => r.health !== 'ok'), 'demosettings 标缺设置');
}

// ⑧ 纯函数直测
{
  // renderTable 宽字符
  const t = cliX.renderTable([{ 名字: '内存', 值: '8 GB' }]);
  ok(t.includes('名字') && t.includes('----'), 'renderTable 结构');
  // renderCsv 引号转义
  const csvOut = cliX.renderCsv([{ a: 'x,y', b: '"' }]);
  ok(csvOut.includes('"x,y"') && csvOut.includes('""""'), 'renderCsv 转义');
  // renderYaml 冒号值加引号
  ok(cliX.renderYaml({ k: 'a:b' }).includes('"a:b"'), 'renderYaml 特殊值');
  // diffTopLevel
  ok(cliX.diffTopLevel({ a: 1 }, { a: 2 })[0].includes('a: 1 → 2'), 'diffTopLevel 变化');
  ok(cliX.diffTopLevel({ a: 1 }, { a: 1 })[0].includes('无变化'), 'diffTopLevel 无变化');
  ok(cliX.diffTopLevel(undefined, {})[0].includes('首轮'), 'diffTopLevel 首轮');
  // normalizeWatchSec
  ok(cliX.normalizeWatchSec('abc') === 10 && cliX.normalizeWatchSec('999') === 300 && cliX.normalizeWatchSec('3') === 5, 'normalizeWatchSec 三态');
  // stripControlFlags
  const stripped = cliX.stripControlFlags(['--ts', '123', '--out', 'table', '--quiet', '--yes', '--watch', '5']);
  ok(JSON.stringify(stripped) === JSON.stringify(['--ts', '123']), 'stripControlFlags');
  // menuKeyHandler
  let picked = -1; let cancelled = false;
  const h = cliX.menuKeyHandler(['a', 'b', 'c'], (i) => { picked = i; }, () => { cancelled = true; });
  h('\x1b[B'); h('\r');
  ok(picked === 1 && !cancelled, 'menu ↓+回车');
  let picked2 = -1;
  const h2 = cliX.menuKeyHandler(['sysinfo', 'quick'], (i) => { picked2 = i; }, () => {});
  h2('/'); h2('s'); h2('y'); h2('\r');
  ok(picked2 === 0, 'menu 过滤后回车选首项');
  let cancelled3 = false;
  cliX.menuKeyHandler(['a'], () => {}, () => { cancelled3 = true; })('q');
  ok(cancelled3, 'menu q 退出');
  // promptPlan
  const plan = cliX.promptPlan([{ name: 'ts', title: '时间戳', required: true }, { name: 't', title: '令牌', secret: true, default: 'x' }]);
  ok(plan[0].label.includes('必填') && plan[1].isSecret && plan[1].fallback === 'x', 'promptPlan 标注');
  // toRows
  ok(cliX.toRows([{ a: 1 }, { b: 2 }]).length === 2 && cliX.toRows({ x: 1 }).length === 1 && cliX.toRows('str').length === 0, 'toRows 三态');
  // historyToArgv
  ok(JSON.stringify(cliX.historyToArgv({ ts: '', plugin: 'p', action: 'a', argv: ['--k', 'v'], exitCode: 0 }))
    === JSON.stringify(['run', 'p', 'a', '--k', 'v']), 'historyToArgv');
}

// ⑨ 交互模式非 TTY 拒绝
{
  const r = cli(['im']);
  ok(r.status === 2 && r.stderr.includes('TTY'), 'im 非 TTY 拒绝（CI 里安全）');
}

// ⑩ --copy 降级路径（CI 无 pbclip 时提示；macOS 本地有 pbcopy 但环境隔离后验证语义）
{
  const r = cli(['run', 'quick', 'ts2date', '--ts', '1760000000', '--copy', '--yes']);
  ok(r.status === 0 && (r.stdout.includes('已复制') || r.stdout.includes('复制失败')), '--copy 语义出口');
}

console.log(`通过 ${pass} / ${pass + fail}`);
fs.rmSync(HOME, { recursive: true, force: true });
process.exit(fail > 0 ? 1 : 0);
