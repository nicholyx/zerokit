import { orphanTimers } from './timers.ts';
// 环境与插件自检。
//
// 这套检查原本长在 cli.ts 的 cmdDoctor 里，只服务终端一个面。启动器也想显示
// 「哪里不健康」，提示词还要能直接复制修复命令，所以把判定逻辑收进这里，
// 产出一份结构化报告：CLI 负责用颜色打印，HTTP 面负责原样转 JSON。
// 判定规则只有一份，两个面不会各说各话。
import process from 'node:process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { HOME, PLUGINS_DIR } from './paths.ts';
import { checkRequires, resolveTool } from './resolve.ts';
import { findPlugin, listPlugins } from './registry.ts';
import { verifyInstalled } from './distro.ts';
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
  /** 第八十一轮⑦：全量完整性复验——被改过/删过文件/无快照的插件点名。 */
  integrity: {
    checked: number;
    clean: number;
    tampered: string[];   // 内容被改
    missingFiles: string[]; // 文件被删
    noSnapshot: string[]; // 老插件无装时快照
  };
  node: { version: string; execPath: string };
  tools: DoctorTool[];
  dirs: { home: string; plugins: string };
  plugins: DoctorPlugin[];
  /** 第三十二轮⑩：桌面壳（可选组件）的安装状态。没装是 warning 级提示，不是 error。 */
  desktop: { installed: boolean; path?: string; hotkey?: string };
  /** 第六十三轮⑧：孤儿定时任务 key（timers.json 引用的插件已卸载）。 */
  orphanTimerKeys: string[];
  summary: { plugins: number; actions: number; errors: number; warnings: number };
  /** 第八十四轮②：每次全量体检的摘要落 doctor-history.jsonl（保留 50 条）。 */
  history: DoctorHistoryEntry[];
}

/** 第八十四轮②：体检历史一条记录。failed/warned 是问题文本列表，用于跨次比对。 */
export interface DoctorHistoryEntry {
  ts: string;            // ISO 时间
  errors: number;
  warnings: number;
  passed: number;        // 通过项数
  failed: string[];      // error 文本（截断到 120 字符）
  warn: string[];        // warning 文本
}

const HISTORY_LIMIT = 50;

/** 把报告压成一条历史记录。 */
export function toHistoryEntry(report: DoctorReport, passed: number): DoctorHistoryEntry {
  const clip = (t: string) => t.length > 120 ? t.slice(0, 117) + '…' : t;
  const failed = [
    ...report.tools.filter((t) => !t.ok).map((t) => toolFailText(t.name, t.hint)),
    ...report.plugins.flatMap((pl) => pl.problems.filter((pr) => pr.level === 'error').map((pr) => pr.text)),
  ];
  const warn = report.plugins.flatMap((pl) => pl.problems.filter((pr) => pr.level === 'warning').map((pr) => pr.text));
  return {
    ts: new Date().toISOString(),
    errors: report.summary.errors,
    warnings: report.summary.warnings,
    passed,
    failed: failed.map(clip),
    warn: warn.map(clip),
  };
}

/** 收集报告里全部插件/工具问题文本（doctor 的 error 分散在 plugins/tools 上）。 */
/** 工具缺失败文案（DoctorTool 无 problems 数组，失败即 !ok + hint）。 */
function toolFailText(name: string, hint?: string): string {
  return `工具 ${name} 不可用${hint ? '：' + hint : ''}`;
}

/** 体检历史文件路径（惰性取 HOME——第八十二轮 migrate.ts 的教训）。 */
function historyPath(): string {
  // 惰性读环境：paths.ts 的 HOME 在模块加载时固化，同进程切目录会写错地方（第八十二轮教训）
  const h = process.env.ZEROKIT_HOME ?? HOME;
  return h + '/logs/doctor-history.jsonl';
}

/** 读历史（坏行跳过）， Newest 在前。文件不存在返回 []。 */
export function readDoctorHistory(): DoctorHistoryEntry[] {
  try {
    const raw = readFileSync(historyPath(), 'utf-8').trim();
    if (!raw) return [];
    return raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) as DoctorHistoryEntry; } catch { return null; } })
      .filter((x): x is DoctorHistoryEntry => x !== null).reverse();
  } catch { return []; }
}

/** 追加一条并裁剪到 50 条（旧删新留）。 */
export function appendDoctorHistory(entry: DoctorHistoryEntry): void {
  const prev = readDoctorHistory();
  const next = [entry, ...prev].slice(0, HISTORY_LIMIT);
  mkdirSync(dirname(historyPath()), { recursive: true });
  writeFileSync(historyPath(), next.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
}

export interface DoctorDiff {
  added: string[];    // 新增问题
  resolved: string[]; // 已解决
  persist: string[];  // 仍在
}

/** 第八十四轮③⑤：与上一次体检对比 + 持续计数。 */
export function diffDoctorHistory(current: DoctorHistoryEntry, prev: DoctorHistoryEntry | undefined): DoctorDiff {
  if (!prev) return { added: [], resolved: [], persist: [] };
  const cur = new Set([...current.failed, ...current.warn]);
  const old = new Set([...prev.failed, ...prev.warn]);
  const added = [...cur].filter((x) => !old.has(x));
  const resolved = [...old].filter((x) => !cur.has(x));
  const persist = [...cur].filter((x) => old.has(x));
  return { added, resolved, persist };
}

/** 第八十四轮⑤：某问题文本在历史里连续出现的次数（从最新往回数）。 */
export function persistCount(text: string, history: DoctorHistoryEntry[]): number {
  let n = 0;
  for (const e of history) {
    if (e.failed.includes(text) || e.warn.includes(text)) n++;
    else break;
  }
  return n;
}

/** 第八十四轮①：三级汇总行——CLI 与 Web 共用同一句人话。 */
export function doctorSummaryLine(report: DoctorReport, passed: number): string {
  const { errors, warnings } = report.summary;
  return `✗${errors} 项需处理 · ⚠${warnings} 项建议 · ✓${passed} 项通过`;
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
  // 第八十四轮②：先读上一次历史（本次结果稍后才落盘，不能把自己算进去）
  const historyBefore = readDoctorHistory();
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

  // 第八十一轮⑦：全量完整性复验（tampered/missing 进 error 计数，noSnapshot 是 warning）
  const integrity = { checked: 0, clean: 0, tampered: [] as string[], missingFiles: [] as string[], noSnapshot: [] as string[] };
  const seenIds = new Set<string>();
  for (const p of plugins) {
    if (!p.id || seenIds.has(p.id)) continue;  // quick.bak 等重复目录只验一次
    seenIds.add(p.id);
    integrity.checked++;
    const v = verifyInstalled(p.id);
    if (v.noSnapshot) { integrity.noSnapshot.push(p.id); warnings++; continue; }
    if (v.ok) { integrity.clean++; continue; }
    // 一个插件只进一个桶（优先「被改动」）——doctor 打点名行不重复
    if (v.changed.length) { integrity.tampered.push(p.id); errors++; }
    else if (v.missing.length) { integrity.missingFiles.push(p.id); errors++; }
  }

  return {
    integrity,
    node: { version: process.version, execPath: process.execPath },
    tools,
    dirs: { home: HOME, plugins: PLUGINS_DIR },
    desktop: { installed: shell.installed, path: shell.path, hotkey },
    orphanTimerKeys,
    plugins,
    history: historyBefore.slice(0, 5),
    summary: {
      plugins: plugins.length,
      actions: plugins.reduce((n, p) => n + p.actions, 0),
      errors,
      warnings,
    },
  };
}
