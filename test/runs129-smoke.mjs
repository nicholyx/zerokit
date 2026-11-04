// runs129-smoke：第一百二十九轮——执行历史消费面
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- runs129`); } };
const home = mkdtempSync(path.join(tmpdir(), 'r129-'));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home } });
console.log(`runs129-smoke（${home}）`);
run(['plugin', 'bundled']);
run(['run', 'quick', 'b64', '--text', 'hello']);
run(['run', 'sysinfo', 'overview']);

// ① list：默认 10、序号 1=最新
{
  const r = run(['runs', 'list']);
  const out = r.stdout ?? '';
  check('① list 两行', out.includes('最近 2 次执行') && out.includes('sysinfo.overview') && out.includes('quick.b64'));
  check('① 1=最新（sysinfo 在前）', out.indexOf('sysinfo.overview') < out.indexOf('quick.b64'));
  const r2 = run(['runs', 'list', '--limit', '1']);
  check('① --limit 1 只一行', (r2.stdout ?? '').includes('最近 1 次'));
}

// ①⑤ --json 机读
{
  const r = run(['runs', 'list', '--json']);
  const j = JSON.parse((r.stdout ?? '').trim());
  check('⑤ list --json 结构', Array.isArray(j.runs) && j.runs[0].idx === 1 && j.runs[0].plugin === 'sysinfo' && typeof j.runs[0].exitCode === 'number');
}

// ② show：单条完整 + --json + 负例
{
  const r = run(['runs', 'show', '2']);
  const out = r.stdout ?? '';
  check('② show 2 是 quick.b64', out.includes('quick.b64') && out.includes('重放命令') && out.includes('--text hello'));
  const rj = run(['runs', 'show', '1', '--json']);
  const j = JSON.parse((rj.stdout ?? '').trim());
  check('② show --json', j.plugin === 'sysinfo' && Array.isArray(j.argv) && j.exitCode === 0);
  const bad = run(['runs', 'show', '99']);
  check('② 越界退出 1', bad.status === 1 && (bad.stderr ?? '').includes('没有第 99'));
}

// ② --replay 走完整链路
{
  const r = run(['runs', 'show', '2', '--replay']);
  const out = r.stdout ?? '';
  check('② --replay 真执行（b64 结果在）', out.includes('aGVsbG8=') || out.includes('长度'));
}

// ③ export JSONL 行数对账
{
  // --replay 会真执行并再记一条：先取当前清单条数，export 行数必须与 list --json 对账
  const jl = JSON.parse((run(['runs', 'list', '--limit', '0', '--json']).stdout ?? '').trim());
  const r = run(['runs', 'export']);
  const lines = (r.stdout ?? '').trim().split('\n').filter(Boolean);
  check('③ export 行数=条目数', lines.length === jl.runs.length && lines.length >= 3);
  check('③ 行是合法 JSON', lines.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }));
  check('③ 时间正序（尾行=最新一条 b64 重放）', JSON.parse(lines[lines.length - 1]).plugin === 'quick' && JSON.parse(lines[0]).plugin === 'quick');
  check('③ 中间行是 sysinfo', JSON.parse(lines[1]).plugin === 'sysinfo');
}

// ④ gc：dry-run 不落盘、--yes 幂等
{
  const before = JSON.parse(readFileSync(path.join(home, 'history.json'), 'utf8')).length;
  const dry = run(['runs', 'gc', '--days', '30']);
  check('④ gc 干跑提示', (dry.stdout ?? '').includes('加 --yes'));
  const after = JSON.parse(readFileSync(path.join(home, 'history.json'), 'utf8'));
  check('④ 干跑不落盘', after.length === before);
  const yes = run(['runs', 'gc', '--days', '30', '--yes']);
  check('④ --yes 清 0 条全保留', (yes.stdout ?? '').includes(`保留 ${before}`));
  const yes2 = run(['runs', 'gc', '--days', '30', '--yes']);
  check('④ 幂等（再跑同结果）', (yes2.stdout ?? '').includes('已清除 0'));
  // 种最老一条 40 天前再 gc
  const old = JSON.parse(readFileSync(path.join(home, 'history.json'), 'utf8'));
  old[0].ts = new Date(Date.now() - 40 * 86400_000).toISOString();
  writeFileSync(path.join(home, 'history.json'), JSON.stringify(old));
  const yes3 = run(['runs', 'gc', '--days', '30', '--yes']);
  check('④ 40 天前被清', (yes3.stdout ?? '').includes('已清除 1'));
  const list = run(['runs', 'list']);
  check('④ 清后少一条', (list.stdout ?? '').includes(`最近 ${before - 1} 次`));
}

// ⑦ doctor historyStore
{
  const r = run(['doctor', '--json']);
  const j = JSON.parse((r.stdout ?? '').trim());
  check('⑦ doctor historyStore', j.historyStore.entries >= 1 && j.historyStore.bytes > 0 && typeof j.historyStore.oldest === 'string');
}

// ⑥⑧ 静态接线
{
  const app = readFileSync(path.join(PKG_ROOT, 'web/app.js'), 'utf8');
  const css = readFileSync(path.join(PKG_ROOT, 'web/style.css'), 'utf8');
  check('⑥ 日志详情 CLI 重放行', app.includes('log-replay') && css.includes('.log-replay'));
  check('⑧ Ctrl+R 重放接线', app.includes("e.key === 'r' && (e.ctrlKey || e.metaKey)") && app.includes('重放最近一次执行'));
}

// 用法负例
{
  const r = run(['runs', 'bogus']);
  check('用法负例退出 1', r.status === 1 && (r.stderr ?? '').includes('用法：zkit runs'));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
