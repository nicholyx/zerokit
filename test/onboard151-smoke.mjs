// onboard151-smoke：第一百五十一轮——首次运行引导
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- onboard151 ${extra}`); } };
console.log('onboard151-smoke');

// ---- 纯函数直测 ----
const ob = await import('../src/core/onboard.ts');

// ① 空目录全未完成
{
  const empty = mkdtempSync(path.join(tmpdir(), 'ob-e-'));
  const st = ob.onboardState(empty);
  check('① 空目录三步全 false', st.hasPlugins === false && st.hasRun === false && st.hasUi === false && st.onboarded === false);
  rmSync(empty, { recursive: true, force: true });
}
// ② guideLines 结构
{
  const lines = ob.guideLines({ hasPlugins: false, hasRun: false, hasUi: false, onboarded: false }, 'zkit');
  check('② 三步都在', lines.some((l) => l.includes('1. 装上示例插件')) && lines.some((l) => l.includes('2. 跑第一个动作')) && lines.some((l) => l.includes('3. 起图形界面')));
  check('② 命令可复制', lines.some((l) => l.includes('\n     zkit plugin bundled')) && lines.some((l) => l.includes('\n     zkit run sysinfo overview')));
  check('② 跳过出口提示', lines.some((l) => l.includes('--skip-onboarding')));
  const done1 = ob.guideLines({ hasPlugins: true, hasRun: false, hasUi: false, onboarded: false }, 'zkit');
  check('② 完成步打勾折叠', done1.some((l) => l.includes('✓. 装上示例插件（sysinfo / quick / clipboard …）（已完成）')));
}
// ④ scriptLines
{
  const sl = ob.scriptLines('zkit');
  check('④ 脚本清单三行纯命令', sl.length === 3 && sl.every((l) => l.startsWith('zkit ') && !l.includes('✓')));
}
// ⑥ 标记文件被 onboardState 识别（markOnboarded 的 HOME 依赖进程 env，放 CLI 段验证）
{
  const h = mkdtempSync(path.join(tmpdir(), 'ob-m-'));
  const before = ob.onboardState(h);
  const fsMod = await import('node:fs');
  fsMod.writeFileSync(path.join(h, '.onboarded'), 'x', { mode: 0o600 });
  const after = ob.onboardState(h);
  check('⑥ 标记写入后 onboarded=true', before.onboarded === false && after.onboarded === true);
  // Windows 无 POSIX 权限位（第一百四十九轮教训）：非 win32 才验 0600
  if (process.platform !== 'win32') check('⑥ 标记 0600', (fsMod.statSync(path.join(h, '.onboarded')).mode & 0o777) === 0o600);
  else check('⑥ Windows 标记文件存在', fsMod.existsSync(path.join(h, '.onboarded')));
  rmSync(h, { recursive: true, force: true });
}

// ---- CLI 实跑 ----
const home1 = mkdtempSync(path.join(tmpdir(), 'ob-c1-'));
const env1 = { ...process.env, ZEROKIT_HOME: home1 };
const run1 = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env: env1 });

// ① 空+非TTY → 命令清单
{
  const r = run1([]);
  const lines = (r.stdout ?? '').trim().split('\n');
  check('① 空+非TTY 命令清单', lines.length === 3 && lines[0].endsWith('plugin bundled'), r.stdout?.slice(0, 80));
}
// ③ hello 显示进度
{
  const r = run1(['hello']);
  check('③ hello 进度页', (r.stdout ?? '').includes('欢迎') && (r.stdout ?? '').includes('1. 装上示例插件'));
}
// ⑤ doctor --first-run
{
  const r = run1(['doctor', '--first-run']);
  const out = r.stdout ?? '';
  check('⑤ 三件事体检', out.includes('示例插件未装') && out.includes('还没跑过动作') && out.includes('界面还没起过'));
  check('⑤ 未完成 exit 1', r.status === 1);
  run1(['plugin', 'bundled']);
  run1(['run', 'sysinfo', 'overview']);
  const r2 = run1(['doctor', '--first-run']);
  check('⑤ 完成后 exit 0', r2.status === 0);
}
// ② 已初始化 + skip 后回紧凑帮助（非 TTY）
{
  const r = run1(['--skip-onboarding']);
  check('⑧ skip 输出', (r.stdout ?? '').includes('已跳过引导'));
  const r2 = run1([]);
  check('② skip 后回帮助', (r2.stdout ?? '').includes('zkit') && !(r2.stdout ?? '').includes('欢迎使用 zerokit'));
}
// 引导完成条件（装+跑）后自动写标记：hello 再看
{
  const r = run1(['hello']);
  check('④ 打勾', (r.stdout ?? '').includes('✓. 装上示例插件') && (r.stdout ?? '').includes('✓. 跑第一个动作'));
}

rmSync(home1, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
