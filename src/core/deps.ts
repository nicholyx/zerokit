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
