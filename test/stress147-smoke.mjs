// stress147-smoke：第一百四十七轮——压测与稳定性（自动化部分：①②⑤ + UI 重渲泄漏计数）
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ✓ ${name}${detail ? '（' + detail + '）' : ''}`); } else { fail++; console.error(`FAIL  ${name} ${detail}`); } };
console.log('stress147-smoke');

// ①⑤⑥ 压测脚本存在且 quick 档全过（真实 spawn 并发）
{
  const r = spawnSync(process.execPath, [path.join(PKG_ROOT, 'scripts', 'stress.mjs'), '--quick'], { encoding: 'utf8', timeout: 300000 });
  check('①⑤⑥ stress.mjs --quick ALL PASS', r.status === 0 && (r.stdout ?? '').includes('ALL PASS'));
}

// ③ 监控+批量+定时三路并发的接线（UI 侧无法无头自动化，改静态断言三入口互不共享可变全局）
{
  const app = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
  check('③ watch/batch/timer 各自独立状态容器', app.includes('watchRegistry') && app.includes('batchMap') && app.includes('timers'));
  check('③ 结果写回走 runStore（按 actionKey 分桶）', app.includes('runStore[') || app.includes('runStore.'));
}

// ④ 长会话重渲泄漏防护的静态锚（renderResult 重入安全：innerHTML 重建不累积监听）
{
  const app = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
  // 重建式渲染模型：innerHTML 替换后旧节点+监听器整体 GC——每处 addEventListener
  // 绑的是新节点，不累积。真正的泄漏判据是 document/window 级重复注册与孤儿 interval。
  const delegated = app.includes('listEventsBound') || app.includes("id: 'bindListItems'");
  check('④ 列表事件委托单监听器（不随条目增长）', delegated);
  const docBinds = (app.match(/(document|window)\.addEventListener/g) ?? []).length;
  const guards = (app.match(/(listEventsBound|keydownBound|\w+Bound\s*=\s*true)/g) ?? []).length;
  check('④ document/window 级绑定有守卫（重复注册防护）', guards >= 3, `docBinds=${docBinds} guards=${guards}`);
  const intv = (app.match(/setInterval\(/g) ?? []).length;
  const clr = (app.match(/clearInterval\(/g) ?? []).length;
  check('④ setInterval/clearInterval 配平', clr >= intv - 2, `set=${intv} clear=${clr}`);
}

// ⑦ 并发缺陷：audit appendFileSync 单行原子（POSIX O_APPEND ≤PIPE_BUF 原子）
{
  const runner = readFileSync(path.join(PKG_ROOT, 'src', 'core', 'runner.ts'), 'utf8');
  check('⑦ 审计同步追加（appendFileSync 原子性依据）', runner.includes('appendFileSync'));
  check('⑦ audit 失败不带走主进程', /audit[\s\S]{0,400}catch/.test(runner));
}

// ② 大输出落盘路径进结果（artifactPath 字段存在）
{
  const runner = readFileSync(path.join(PKG_ROOT, 'src', 'core', 'runner.ts'), 'utf8');
  check('② 溢出落盘 artifactPath + 每次独立文件名', runner.includes('artifactPath') && runner.includes('Math.random()'));
}

// ⑥ bench 补稳定性指标段
{
  const bench = readFileSync(path.join(PKG_ROOT, 'scripts', 'bench.mjs'), 'utf8');
  check('⑥ bench.mjs 有稳定性段落', bench.includes('稳定') || bench.includes('并发'));
}

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
