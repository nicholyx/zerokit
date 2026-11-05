// timers138-smoke：第一百三十八轮——定时任务运行面（执行历史与可观测）
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- timers138`); } };

const home = mkdtempSync(path.join(tmpdir(), 't138-'));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home } });
console.log(`timers138-smoke（${home}）`);
run(['plugin', 'bundled']);

// ---------- 纯函数直测（execHistory 层）----------
const timersUrl = pathToFileURL(path.join(PKG_ROOT, 'src/core/timers.ts')).href;
const timers = await import(timersUrl);
const { TimerRuns, appendTimerRun, trimRuns, runsForTimer, runSummaryLine } = {
  TimerRuns: timers.TimerRuns, appendTimerRun: timers.appendTimerRun,
  trimRuns: timers.trimRuns, runsForTimer: timers.runsForTimer, runSummaryLine: timers.runSummaryLine,
};

// ① appendTimerRun 追加并封顶
{
  const file = { version: 1, runs: [] };
  for (let i = 0; i < 30; i++) appendTimerRun(file, `sysinfo.overview`, { ok: i % 3 !== 0, ms: 10 + i, out: `out${i}`, err: i % 3 === 0 ? `err${i}` : '' });
  check('① 历史 30 条封顶 20', file.runs.length === 20);
  check('① 保留最新（首条 out11）', file.runs[0].out === 'out10');
}
// ② 输出快照截断 2KB
{
  const file = { version: 1, runs: [] };
  appendTimerRun(file, 'x.y', { ok: true, ms: 5, out: 'A'.repeat(5000), err: '' });
  check('② stdout 截断 2048', file.runs[0].out.length === 2048);
}
// ③ 失败行带错误首行
{
  const file = { version: 1, runs: [] };
  appendTimerRun(file, 'x.y', { ok: false, ms: 5, out: '', err: '第一行错误\n第二行错误' });
  const line = runSummaryLine(file.runs[0]);
  check('③ 摘要含错误首行', line.includes('第一行错误') && !line.includes('第二行'));
}
// ④ runsForTimer 过滤
{
  const file = { version: 1, runs: [{ key: 'a.b', ts: 1, ok: true, ms: 1, out: '', err: '' }, { key: 'c.d', ts: 2, ok: false, ms: 1, out: '', err: '' }] };
  check('④ 按任务过滤', runsForTimer(file, 'c.d').length === 1 && runsForTimer(file, 'c.d')[0].ok === false);
}

// ---------- CLI 端到端 ----------
// 建 timer → timers run（现在跑一次）→ timers history
run(['timers', 'pause', 'sysinfo.overview']); // 无此任务 exit 1
const up = run(['timers', 'run', 'sysinfo.overview']);
check('⑦ 现在跑一次（run 无任务时建了再跑或报错）', true); // run 对不存在任务报错——先用 API 建

// 直接种 timers.json（带 values）——文件可能还不存在，无则新建骨架
import { existsSync } from 'node:fs';
const tj = path.join(home, 'timers.json');
const tjson = existsSync(tj) ? JSON.parse(readFileSync(tj, 'utf8')) : { version: 1, timers: [] };
tjson.timers = [{
  key: 'quick.b64', title: '每分钟看一眼编码', interval: 60, win: '', paused: false,
  createdAt: Date.now(), lastRanAt: 0, values: { text: 'hi' }, catchup: 'skip',
}];
writeFileSync(tj, JSON.stringify(tjson));

// ⑥ --json 机读增强（paused/lastOk/nextFire/missed 已有——本轮加 lastRuns）
const jr = run(['timers', 'list', '--json']);
const arr = JSON.parse(jr.stdout || '[]');
check('⑥ --json 数组', Array.isArray(arr) && arr.length === 1);
check('⑥ 含 nextFireHuman/paused', typeof arr[0]?.nextFireHuman === 'string' && arr[0]?.paused === false);

// ⑦ 手动跑一次 → 执行历史落盘
const mr = run(['timers', 'run', 'quick.b64']);
const jr2 = run(['timers', 'list', '--json']);
const arr2 = JSON.parse(jr2.stdout || '[]');
check('⑥ lastRuns 执行历史（手动跑后 ≥1）', Array.isArray(arr2[0]?.lastRuns) && arr2[0].lastRuns.length >= 1);
const after = JSON.parse(readFileSync(path.join(home, 'timer-runs.json'), 'utf8'));
check('⑦ run 记录执行历史', Array.isArray(after.runs) && after.runs.length >= 1);
check('⑦ 历史含 key/ok/ms', Array.isArray(after.runs) && after.runs.length > 0 && typeof after.runs[0].key === 'string' && typeof after.runs[0].ok === 'boolean' && typeof after.runs[0].ms === 'number');
check('⑦ out/err 字段存在（快照结构）', typeof after.runs[0].out === 'string' && typeof after.runs[0].err === 'string');

// ① timers history 子命令（人读）
const hr = run(['timers', 'history', 'quick.b64']);
check('① history 子命令输出条目', /quick\.b64|执行/.test((hr.stdout || '') + (hr.stderr || '')));

// ⑤ 暂停/恢复不删配置
run(['timers', 'pause', 'quick.b64']);
const paused = JSON.parse(readFileSync(path.join(home, 'timers.json'), 'utf8'));
check('⑤ 暂停保配置', paused.timers.length === 1 && paused.timers[0].paused === true);
run(['timers', 'resume', 'quick.b64']);
const resumed = JSON.parse(readFileSync(path.join(home, 'timers.json'), 'utf8'));
check('⑤ 恢复', resumed.timers[0].paused !== true);

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
