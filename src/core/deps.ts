// 插件依赖：状态、补齐、反向依赖。
//
// 边界是有意收窄的：只处理 **zerokit 插件**，不碰 pip / npm 包，
// 也绝不执行任何安装脚本。所谓「装依赖」就是把一个插件目录搬进 PLUGINS_DIR，
// 和一个正常安装走同一条路径——用户该看到的能力清单，一件都不能少。
//
// 默认不代装：装插件等于让它在你的机器上执行命令，必须让用户先看过能力清单。
// 所以这里只提供「缺什么、怎么补」，真正动手要显式 --with-deps / 界面勾选。
import fs from 'node:fs';
import path from 'node:path';
import { type Plugin, loadPlugin } from './manifest.ts';
import { BUNDLED_PLUGINS_DIR } from './paths.ts';
import { findPlugin, installBundledPlugin, listPlugins } from './registry.ts';
import { findEntry, installFromMarket } from './market.ts';

export interface DepState {
  id: string;
  installed: boolean;
  version?: string;
}

/** 依赖的当前状态（按插件清单里的顺序，方便对照） */
export function depStates(plugin: Plugin): DepState[] {
  return plugin.pluginDeps.map((id) => {
    const entry = findPlugin(id)?.plugin;
    return entry
      ? { id, installed: true, version: entry.version }
      : { id, installed: false };
  });
}

export function missingDeps(plugin: Plugin): string[] {
  return depStates(plugin).filter((d) => !d.installed).map((d) => d.id);
}

/** 谁在依赖 id（卸载前的检查用） */
export function dependents(id: string): string[] {
  const out: string[] = [];
  for (const entry of listPlugins()) {
    const p = entry.plugin;
    if (!p || p.id === id) continue;
    if (p.pluginDeps.includes(id)) out.push(p.id);
  }
  return out.sort();
}

export interface DepNode extends DepState {
  /** 还能看到它自己的清单时，展开它的依赖；看不到就为空 */
  children: DepNode[];
}

/** 依赖树（按已安装的清单展开；没装的节点无法知道它自己依赖什么） */
export function depTree(plugin: Plugin, seen = new Set<string>()): DepNode[] {
  if (seen.has(plugin.id)) return [];
  seen.add(plugin.id);
  return depStates(plugin).map((state) => {
    const entry = state.installed ? findPlugin(state.id)?.plugin : undefined;
    return {
      ...state,
      children: entry ? depTree(entry, seen) : [],
    };
  });
}

export interface DepInstallResult {
  installed: string[];
  errors: string[];
  /** 补完之后仍然缺的（通常是集市里也没有的） */
  missing: string[];
}

/**
 * 补齐一个插件的依赖（递归，最多 depth 层，防环）。
 *
 * 安装顺序：先装依赖，再谈别的——这样插件真正落地时，它引用的动作已经在了。
 */
export function installDeps(plugin: Plugin, opts: { maxDepth?: number } = {}): DepInstallResult {
  const installed: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>([plugin.id]);
  const maxDepth = opts.maxDepth ?? 6;
  let queue = missingDeps(plugin);

  for (let depth = 0; depth < maxDepth && queue.length > 0; depth++) {
    const next: string[] = [];
    for (const id of queue) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (findPlugin(id)?.plugin) continue;
      const r = installOne(id);
      if (!r.ok) {
        errors.push(r.message);
        continue;
      }
      installed.push(id);
      const dep = findPlugin(id)?.plugin;
      if (dep) next.push(...missingDeps(dep));
    }
    queue = next;
  }
  if (queue.length > 0) {
    errors.push(`依赖链超过 ${maxDepth} 层，停止补齐：${[...new Set(queue)].join(', ')}`);
  }
  return { installed, errors, missing: missingDeps(plugin) };
}

function installOne(id: string): { ok: boolean; message: string } {
  const bundled = findBundled(id);
  if (bundled) return installBundledPlugin(id);
  const hit = findEntry(id);
  if (!hit) {
    return {
      ok: false,
      message: `找不到插件 "${id}"：仓库自带的示例里没有，已添加的集市里也没有`
        + '（先用 zkit market add 添加来源，或从目录 / git 手动安装）',
    };
  }
  const r = installFromMarket(id, hit.market);
  return { ok: r.ok, message: r.ok ? `已从集市「${hit.market}」安装 ${id}` : `${id}: ${r.message}` };
}

function findBundled(id: string): string | undefined {
  if (!fs.existsSync(BUNDLED_PLUGINS_DIR)) return undefined;
  const direct = path.join(BUNDLED_PLUGINS_DIR, id);
  if (fs.existsSync(path.join(direct, 'plugin.toml'))) return direct;
  for (const name of fs.readdirSync(BUNDLED_PLUGINS_DIR)) {
    const dir = path.join(BUNDLED_PLUGINS_DIR, name);
    if (!fs.existsSync(path.join(dir, 'plugin.toml'))) continue;
    if (loadPlugin(dir).plugin?.id === id) return dir;
  }
  return undefined;
}

// ---------------------------------------------------------------- 第八十七轮：依赖生命周期

export interface DepHealth {
  id: string;
  installed: boolean;
  version?: string;
  /** 已装版本是否满足 requires 声明（无声明视为满足） */
  satisfies?: boolean;
  /** 不满足时的声明原文（供提示用） */
  requirement?: string;
}

/**
 * 依赖健康态（含版本核对）。
 *
 * requires.plugins 目前是纯 id 数组（无版本区间），这里先把接口留出来：
 * 声明形态若是 "id@>=1.2" 或未来扩展的表形态，解析后填 requirement/satisfies。
 * 当前实现：无版本声明 → satisfies 恒 true。
 */
export function depHealth(plugin: Plugin): DepHealth[] {
  return depStates(plugin).map((d) => ({
    ...d,
    satisfies: d.installed ? true : undefined,
    requirement: undefined,
  }));
}

/**
 * 拓扑序（依赖在前）。用于升级：先升被依赖的，再升依赖别人的。
 * 环：抛错（负例⑧——环是清单设计错误，不是运行时错误）。
 */
export function topoOrder(plugins: Plugin[]): string[] {
  const byId = new Map(plugins.map((p) => [p.id, p]));
  const out: string[] = [];
  const state = new Map<string, 0 | 1 | 2>(); // 0=未访 1=在栈 2=完成
  const visit = (id: string, trail: string[]) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      throw new Error(`依赖成环：${[...trail, id].join(' → ')}——互相依赖的插件无法确定安装/升级顺序`);
    }
    const p = byId.get(id);
    if (!p) return; // 不在集合里（比如缺装的依赖），交由缺失检查去报
    state.set(id, 1);
    for (const dep of p.pluginDeps) visit(dep, [...trail, id]);
    state.set(id, 2);
    out.push(id);
  };
  for (const p of plugins) visit(p.id, []);
  return out;
}

/**
 * 环检测（不抛错版，doctor/lint 用）：返回检测到的第一条环路径，无环 undefined。
 */
export function findCycle(plugins: Plugin[]): string[] | undefined {
  try { topoOrder(plugins); return undefined; }
  catch (e) { const m = /依赖成环：(.+)——/.exec(String((e as Error).message)); return m?.[1] ? m[1].split(' → ') : ['?']; }
}
