// pace177-smoke：第一百七十七轮——执行反馈与进度
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- pace177 ${extra}`); } };
console.log('pace177-smoke');

const E = await import('../web/extras.js');
const app = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
const cli = readFileSync(path.join(PKG_ROOT, 'src', 'cli.ts'), 'utf8');
const css = readFileSync(path.join(PKG_ROOT, 'web', 'style.css'), 'utf8');

// ⑦ fmtElapsed
check('⑦ <1s 显 ms', E.fmtElapsed(340) === '340ms');
check('⑦ ≥1s 一位小数', E.fmtElapsed(1234) === '1.2s' && E.fmtElapsed(12500) === '12.5s');
check('⑦ 负数/NaN 兜底', E.fmtElapsed(-5) === '—' && E.fmtElapsed(NaN) === '—');
// ⑦ paceVerdict
check('⑦ 快 <80% 均值', E.paceVerdict(500, 1000, { samples: 3 }) === 'fast');
check('⑦ 慢 >130% 均值', E.paceVerdict(1400, 1000, { samples: 3 }) === 'slow');
check('⑦ 正常区间', E.paceVerdict(1000, 1000, { samples: 5 }) === 'normal');
check('⑦ 样本 <2 不判', E.paceVerdict(100, 1000, { samples: 1 }) === null);
check('⑦ 失败不判快慢', E.paceVerdict(100, 1000, { samples: 9, ok: false }) === null);
check('⑦ 无均值不判', E.paceVerdict(100, NaN, { samples: 9 }) === null);
// ③ paceReassure
check('③ <2s 无提示', E.paceReassure(1500) === null);
check('③ >2s 重活提示', E.paceReassure(3000)?.includes('重活'));
check('③ >8s 卡住提示', E.paceReassure(9000)?.includes('8 秒'));

// 接线
check('① 执行中计时器', app.includes("id = 'runElapsed'") && app.includes('setInterval(tickPace, 200)'));
check('① 计时定格后退场', app.includes('fmtElapsed(Date.now() - t0)') && app.includes("getElementById('runElapsed')?.remove()"));
check('② 耗时徽标', app.includes('msBadge') && app.includes('⏱ ${esc(ms)}'));
check('② 快慢徽标', app.includes('pace-fast') && app.includes('pace-slow') && app.includes('paceVerdict(res.ms, avg'));
check('③ 安抚行', app.includes('paceNote') && app.includes('paceReassure'));
check('④ 失败也显示耗时徽标', app.includes('const msBadge = ms ?') && !app.includes('res.ok === true ? msBadge'));
check('⑤ 批量单项计时', app.includes('oneT0') && app.includes("states[i] === 'running' && oneT0.has(i)"));
check('⑥ 监控点悬停耗时', app.includes('耗时 ${fmtElapsed(sm.ms)}'));
check('⑧ CLI ⏱ 尾行', cli.includes('⏱ ${result.ms < 1000'));
check('⑧ quiet/json/pipe 免打', cli.includes('!asJson && !quiet && !pipeCmd && !fmtTpl'));
check('CSS 计时/徽标', css.includes('.run-elapsed') && css.includes('.ms-badge'));

// CLI 实跑
const home = mkdtempSync(path.join(tmpdir(), 'p177-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env });
run(['plugin', 'bundled']);
{
  const r = run(['run', 'quick', 'b64', '--text', 'x']);
  check('⑧ 实跑 stderr ⏱', /⏱ \d+(ms|(\.\d+s))/.test(r.stderr), r.stderr.slice(0, 60));
  const rq = run(['run', 'quick', 'b64', '--text', 'x', '--quiet']);
  check('⑧ --quiet 无 ⏱', !rq.stderr.includes('⏱'));
  const rj = run(['run', 'quick', 'b64', '--text', 'x', '--json']);
  check('⑧ --json 无 ⏱', !rj.stderr.includes('⏱'));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
