// 第一百五十一轮：首次运行引导（onboarding）。纯函数层——CLI 只接线。
import fs from 'node:fs';
import path from 'node:path';
import { HOME } from './paths.ts';

/** 引导完成标记：~/.zerokit/.onboarded（存在即「别再引导」）。 */
export const ONBOARDED_FILE = (): string => path.join(HOME, '.onboarded');

/** 三步引导的每步状态。 */
export interface OnboardState {
  hasPlugins: boolean;   // 数据目录里装了至少一个插件
  hasRun: boolean;       // 历史非空（跑过任意动作）
  hasUi: boolean;        // server 日志存在（起过界面）
  onboarded: boolean;    // 用户完成/跳过引导
}

/** ①探测当前状态（坏数据一律按「没做」处理——引导宁可多出现一次）。 */
export function onboardState(dataHome: string): OnboardState {
  let hasPlugins = false;
  let hasRun = false;
  let hasUi = false;
  try {
    const pluginsDir = path.join(dataHome, 'plugins');
    hasPlugins = fs.existsSync(pluginsDir) && fs.readdirSync(pluginsDir).some((d) => {
      const p = path.join(pluginsDir, d);
      return fs.existsSync(path.join(p, 'plugin.toml'));
    });
  } catch { /* 没装 */ }
  try {
    const hist = fs.readFileSync(path.join(dataHome, 'history.json'), 'utf8');
    const arr = JSON.parse(hist) as unknown;
    hasRun = Array.isArray(arr) && arr.length > 0;
  } catch { /* 没跑过 */ }
  try {
    hasUi = fs.statSync(path.join(dataHome, 'logs', 'server.log')).size > 0;
  } catch { /* 没起过 */ }
  const onboarded = fs.existsSync(path.join(dataHome, '.onboarded'));
  return { hasPlugins, hasRun, hasUi, onboarded };
}

/** ②引导页行集（纯函数——测试断言逐行）。cmd=可直接复制的命令前缀（node src/cli.ts 或 zkit）。 */
export function guideLines(state: OnboardState, cmd: string): string[] {
  const step = (n: number, done: boolean, title: string, command: string, hint: string): string =>
    done
      ? `  ✓. ${title}（已完成）`
      : `  ${n}. ${title}\n     ${cmd} ${command}\n     ${hint}`;
  const lines: string[] = [
    '欢迎使用 zerokit —— 三步跑起来：',
    '',
    step(1, state.hasPlugins, '装上示例插件（sysinfo / quick / clipboard …）', 'plugin bundled', '13 个本地插件，装完 zkit plugin list 查看'),
    '',
    step(2, state.hasRun, '跑第一个动作', 'run sysinfo overview', '或 run quick ts2date --ts 1760000000 试时间戳转换'),
    '',
    step(3, state.hasUi, '起图形界面', 'ui --open --log', '浏览器自动打开；Ctrl+C 停止'),
    '',
    `全部完成后随时回来：${cmd} --help 看全部命令。不再想看这页：${cmd} --skip-onboarding`,
  ];
  return lines;
}

/** ③写完成/跳过标记（0600 原子写，对齐 bookmarks）。 */
export function markOnboarded(): void {
  fs.mkdirSync(HOME, { recursive: true });
  const tmp = ONBOARDED_FILE() + '.tmp';
  fs.writeFileSync(tmp, new Date().toISOString(), { mode: 0o600 });
  fs.renameSync(tmp, ONBOARDED_FILE());
}

/** ④非 TTY 的脚本友好输出（每行一条命令，无装饰）。 */
export function scriptLines(cmd: string): string[] {
  return [
    `${cmd} plugin bundled`,
    `${cmd} run sysinfo overview`,
    `${cmd} ui --open`,
  ];
}
