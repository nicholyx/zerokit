import { orphanTimers } from './timers.ts';
// 环境与插件自检。
//
// 这套检查原本长在 cli.ts 的 cmdDoctor 里，只服务终端一个面。启动器也想显示
// 「哪里不健康」，提示词还要能直接复制修复命令，所以把判定逻辑收进这里，
// 产出一份结构化报告：CLI 负责用颜色打印，HTTP 面负责原样转 JSON。
// 判定规则只有一份，两个面不会各说各话。
import process from 'node:process';
import { existsSync, readFileSync } from 'node:fs';
import { HOME, PLUGINS_DIR } from './paths.ts';
import { checkRequires, resolveTool } from './resolve.ts';
import { findPlugin, listPlugins } from './registry.ts';
import { missingDeps } from './deps.ts';
import { resolveSettings, settingsHints } from './pluginConfig.ts';

export interface DoctorProblem {
  /** error 会让 `zkit doctor` 退出码非零；warning 只提示。 */
  level: 'error' | 'warning';
  text: string;
  /** 可以直接复制的修复命令或建议。 */
  hint?: string;
}

export interface DoctorPlugin {
  id: string;
  /** 插件目录名；清单坏掉时 id 可能为空，至少还能定位到目录。 */
  dir: string;
  name: string;
  ok: boolean;
  actions: number;
  problems: DoctorProblem[];
}

export interface DoctorTool {
  name: string;
  ok: boolean;
  version?: string;
  path?: string;
  hint?: string;
}

export interface DoctorReport {
  node: { version: string; execPath: string };
  tools: DoctorTool[];
  dirs: { home: string; plugins: string };
  plugins: DoctorPlugin[];
  /** 第三十二轮⑩：桌面壳（可选组件）的安装状态。没装是 warning 级提示，不是 error。 */
  desktop: { installed: boolean; path?: string; hotkey?: string };
  /** 第六十三轮⑧：孤儿定时任务 key（timers.json 引用的插件已卸载）。 */
  orphanTimerKeys: string[];
  summary: { plugins: number; actions: number; errors: number; warnings: number };
}

/** 第三十二轮⑩：找桌面壳可执行文件（仓库本地构建 / ~/.zerokit/bin）。 */
function findDesktopShell(): { installed: boolean; path?: string } {
  const exeName = process.platform === 'win32' ? 'zerokit-desktop.exe' : 'zerokit-desktop';
  const repoTarget = new URL('../..', import.meta.url).pathname
    + `apps/desktop/src-tauri/target/release/${exeName}`;
  const candidates = [
    repoTarget,
    HOME + '/bin/' + exeName,
  ];
  const hit = candidates.find((p) => { try { return existsSync(p); } catch { return false; } });
  return hit ? { installed: true, path: hit } : { installed: false };
}

/** 第六十七轮⑦：从清单原文判断动作是否显式写了 timeout（绕开默认值注入）。 */
function declaredTimeout(pluginId: string, actionId: string): boolean {
  try {
    const dir = listPlugins().find((e) => e.plugin?.id === pluginId)?.dir;
    if (!dir) return false;
    const text = readFileSync(dir + '/plugin.toml', 'utf8');
    const blocks = text.split('[[action]]');
    return blocks.some((b) => {
      const id = b.match(/^\s*id\s*=\s*"([^"]+)"/m);
      return id?.[1] === actionId && /^\s*timeout\s*=/m.test(b);
    });
  } catch { return false; }
}

/** 检查一个插件的命令依赖、插件依赖、设置项、链路引用与清单警告。 */
function checkPlugin(entry: ReturnType<typeof listPlugins>[number]): DoctorPlugin {
  const problems: DoctorProblem[] = [];
  if (!entry.plugin) {
    for (const e of entry.errors) problems.push({ level: 'error', text: e });
    if (entry.errors.length === 0) problems.push({ level: 'error', text: '清单读不出来' });
    return { id: '', dir: entry.dir.split(/[\\/]/).pop() ?? entry.dir, name: '', ok: false, actions: 0, problems };
  }

  const p = entry.plugin;
  for (const w of entry.warnings) problems.push({ level: 'warning', text: w });

  // 第六十一轮⑥：带 UI 的插件若还有 http 动作，提示「界面需要联网」——
  // 离线场景（飞机/内网）用户会看到界面壳子但数据出不来，提前说白
  const uiActions = p.actions.filter((a) => a.ui === true);
  const httpActions = p.actions.filter((a) => a.type === 'http');
  if (uiActions.length > 0 && httpActions.length > 0) {
    problems.push({
      level: 'warning',
      text: `带界面的插件含 ${httpActions.length} 个 http 动作——界面需要联网才能出数据`,
      hint: '离线环境下界面会显示但数据加载失败，属预期行为',
    });
  }

  for (const r of checkRequires(p.requires).filter((x) => !x.ok)) {
    problems.push({
      level: 'error',
      text: `缺少命令依赖：${r.name}`,
      hint: r.hint,
    });
  }

  // 命令依赖检查不到位的替代品：插件依赖在这一层报，并给出真正能跑的命令
  const deps = missingDeps(p);
  if (deps.length > 0) {
    problems.push({
      level: 'error',
      text: `缺少插件依赖：${deps.join(', ')}`,
      hint: deps.map((d) => `zkit plugin install ${d}`).join('\n'),
    });
  }

  const view = resolveSettings(p);
  if (view.error) {
    problems.push({ level: 'error', text: `设置项读不出来：${view.error}` });
  }
  for (const bad of view.invalid) {
    problems.push({ level: 'error', text: `设置项 ${bad.name} 的值不合法：${bad.error}` });
  }
  if (view.missing.length > 0) {
    problems.push({
      level: 'warning',
      text: `缺少必填设置项：${view.missing.join(' / ')}`,
      hint: settingsHints(p, view).join('\n'),
    });
  }

  // 第六十七轮⑦：无显式 timeout 声明的动作清单——默认 60s 对慢动作（大目录
  // 搜索/大文件处理）不够用，超时被杀后用户只看到「执行超时」不知道能调。
  // 这里不判对错，只把「吃默认值」的动作点名，让人有机会在清单里写 timeout。
  const defaultTimed = p.actions.filter((a) => (a.timeout ?? 0) === 60 && !declaredTimeout(p.id, a.id));
  if (defaultTimed.length > 0) {
    problems.push({
      level: 'warning',
      text: `${defaultTimed.length} 个动作未声明 timeout（吃默认 60 秒）`,
      hint: '慢动作在 plugin.toml 的 [[action]] 里写 timeout = 秒数，超时会被强制结束',
    });
  }

  // 第七十六轮⑥：沙箱摘要——哪些动作声明了哪层限制，一眼可核对。
  const sbx = p.actions.filter((a) => a.sandbox === true);
  const capped = p.actions.filter((a) => a.max_output_bytes !== undefined);
  const passed = p.actions.filter((a) => (a.env_pass ?? []).length > 0);
  if (sbx.length + capped.length + passed.length > 0) {
    problems.push({
      level: 'warning',
      text: `沙箱声明：${sbx.length} 个动作目录钉死、${capped.length} 个限输出、${passed.length} 个限环境变量`,
      hint: 'sandbox = true 钉死工作目录；max_output 限输出字节；env_pass 白名单环境变量——见 docs/reference/plugin-spec.md 沙箱节',
    });
  }

  // 组合动作的步骤跨插件引用：缺插件由插件依赖统一报，这里只报「插件在、动作没了」。
  for (const a of p.actions) {
    if (a.type !== 'chain') continue;
    for (const [index, step] of a.steps.entries()) {
      const dot = step.use.lastIndexOf('.');
      const ref = step.use.slice(0, dot);
      if (ref === 'self') continue;
      const target = findPlugin(ref)?.plugin;
      if (!target) continue;
      if (!target.actions.some((x) => x.id === step.use.slice(dot + 1))) {
        problems.push({
          level: 'warning',
          text: `组合动作 ${a.id} 第 ${index + 1} 步引用的动作 ${step.use} 不存在`,
        });
      }
    }
  }

  return {
    id: p.id,
    dir: entry.dir.split(/[\\/]/).pop() ?? entry.dir,
    name: p.name,
    ok: !problems.some((x) => x.level === 'error'),
    actions: p.actions.length,
    problems,
  };
}

export function buildDoctorReport(): DoctorReport {
  const tools: DoctorTool[] = [{ name: 'node', ok: true, version: process.version, path: process.execPath }];
  for (const tool of ['python', 'git']) {
    const found = resolveTool(tool);
    tools.push(found
      ? { name: tool, ok: true, version: found.version, path: found.path }
      : { name: tool, ok: false, hint: '没找到；用到它的插件无法执行' });
  }

  const plugins = listPlugins().map(checkPlugin);
  let errors = 0;
  let warnings = 0;
  for (const p of plugins) {
    for (const problem of p.problems) {
      if (problem.level === 'error') errors++;
      else warnings++;
    }
  }

  // 第三十二轮⑩：桌面壳状态进报告（与 zkit desktop 同一套判定）
  const shell = findDesktopShell();
  let hotkey: string | undefined;
  try {
    const cfg = JSON.parse(readFileSync(HOME + '/desktop.json', 'utf8')) as { hotkey?: string };
    hotkey = cfg.hotkey;
  } catch { /* 没配过热键 */ }

  // 第六十三轮⑧：孤儿定时任务——timers.json 里引用的插件已卸载
  const orphanTimerKeys = orphanTimers(plugins.map((p) => p.id));

  return {
    node: { version: process.version, execPath: process.execPath },
    tools,
    dirs: { home: HOME, plugins: PLUGINS_DIR },
    desktop: { installed: shell.installed, path: shell.path, hotkey },
    orphanTimerKeys,
    plugins,
    summary: {
      plugins: plugins.length,
      actions: plugins.reduce((n, p) => n + p.actions, 0),
      errors,
      warnings,
    },
  };
}
