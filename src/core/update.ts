import fs from 'node:fs';
import path from 'node:path';
import { loadPlugin } from './manifest.ts';
import { BUNDLED_PLUGINS_DIR, PLUGINS_DIR } from './paths.ts';
import { type AddResult, addFromDir, clonePluginRepo, findPlugin, findTmpRoot } from './registry.ts';
import { findEntry, installFromMarket } from './market.ts';
import { type PluginSource, describeSource, readSource } from './sources.ts';

/**
 * 插件更新：检查「装的版本」和「来源处的版本」是否一致，不一致就替换。
 *
 * 「从哪装的就从哪更新」——git 来源重新 clone、集市来源按集市索引重装、
 * 自带示例按仓库里的副本覆盖。手工拷贝的目录没有来源记录，如实说
 * 「不知道从哪来的」，绝不瞎猜一个来源去拉代码。
 *
 * 版本判断用「不同即有更新」而不是「更大才有」：集市和仓库都可能回滚版本，
 * 用户该看到的是「它变了」，而不是我们替用户判断「变新了才算」。
 */

export interface UpdateCheck {
  id: string;
  name: string;
  /** 当前装着的版本 */
  current: string;
  /** 来源处的最新版本；null = 检查不到（reason 说明原因） */
  latest: string | null;
  available: boolean;
  source: PluginSource | null;
  sourceText: string;
  /** 新版本里动作的增删（能拿到新清单时才有） */
  addedActions: string[];
  removedActions: string[];
  reason?: string;
}

/** 简单的语义化版本比较：a > b 返回 1，相等 0，否则 -1。解析不了就按字符串比。 */
export function compareVersion(a: string, b: string): number {
  const pa = /^v?(\d+(?:\.\d+)*)/.exec(a.trim());
  const pb = /^v?(\d+(?:\.\d+)*)/.exec(b.trim());
  if (pa && pb) {
    const xs = pa[1]!.split('.').map(Number);
    const ys = pb[1]!.split('.').map(Number);
    for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
      const d = (xs[i] ?? 0) - (ys[i] ?? 0);
      if (d !== 0) return d > 0 ? 1 : -1;
    }
    return 0;
  }
  return a === b ? 0 : a > b ? 1 : -1;
}

/** 拿到「来源处的插件目录」（git 要 clone，bundled 直接是本地路径；market 走 market.ts 自己的解析） */
function fetchLatestDir(id: string, source: PluginSource): { ok: boolean; dir?: string; version?: string; message?: string } {
  if (source.type === 'git') {
    const cloned = clonePluginRepo(source.url ?? '', source.ref);
    if (!cloned.ok || !cloned.dir) return { ok: false, message: cloned.message };
    const version = loadPlugin(cloned.dir).plugin?.version;
    return { ok: true, dir: cloned.dir, version };
  }
  const dir = path.join(BUNDLED_PLUGINS_DIR, id);
  if (!fs.existsSync(path.join(dir, 'plugin.toml'))) {
    return { ok: false, message: `仓库里没有自带的 ${id}（这个 zerokit 版本不带它了？）` };
  }
  return { ok: true, dir, version: loadPlugin(dir).plugin?.version };
}

export function checkUpdate(id: string): UpdateCheck {
  const entry = findPlugin(id);
  const plugin = entry?.plugin;
  const base: UpdateCheck = {
    id,
    name: plugin?.name ?? id,
    current: plugin?.version ?? '?',
    latest: null,
    available: false,
    source: null,
    sourceText: '',
    addedActions: [],
    removedActions: [],
  };
  if (!entry || !plugin) {
    return { ...base, reason: `插件 ${id} 不存在或清单没通过校验` };
  }
  const source = readSource(entry.dir);
  const sourceText = describeSource(source);
  if (!source || source.type === 'dir') {
    return {
      ...base, source, sourceText,
      reason: source?.type === 'dir'
        ? '本地目录安装的插件，去源目录改完重新 zkit plugin add 即可'
        : '没有安装来源记录（手工拷贝的目录？），无法自动更新',
    };
  }

  if (source.type === 'market') {
    // 集市：版本以本地索引为准（要先 market refresh 才是真正的新）
    const hit = findEntry(id, source.market);
    if (!hit) {
      return { ...base, source, sourceText, reason: `集市 ${source.market ?? '?'} 里没有 ${id}（被下架了？）` };
    }
    const latest = hit.entry.version ?? '';
    return {
      ...base, source, sourceText, latest: latest || null,
      available: latest !== '' && latest !== base.current,
      reason: latest === base.current ? '已是集市里的最新版本' : undefined,
    };
  }

  const fetched = fetchLatestDir(id, source);
  if (!fetched.ok || !fetched.dir) {
    return { ...base, source, sourceText, reason: fetched.message };
  }
  const latest = fetched.version ?? '';
  // 顺带算动作增删：用户该在更新前看到「这次更新会多出/少掉什么能力」
  const next = loadPlugin(fetched.dir).plugin;
  const addedActions: string[] = [];
  const removedActions: string[] = [];
  if (next) {
    const oldIds = new Set(plugin.actions.map((a) => a.id));
    const newIds = new Set(next.actions.map((a) => a.id));
    for (const a of next.actions) if (!oldIds.has(a.id)) addedActions.push(a.id);
    for (const a of plugin.actions) if (!newIds.has(a.id)) removedActions.push(a.id);
  }
  return {
    ...base, source, sourceText, latest: latest || null,
    available: latest !== '' && latest !== base.current,
    addedActions, removedActions,
    reason: latest === base.current ? '已是最新版本' : undefined,
  };
}

/** 列出全部插件的更新状态（不联网——联网来源的 latest 要 clone 才知道，这里只列本地能判断的） */
export function listUpdateStates(): UpdateCheck[] {
  return listPluginIds().map((id) => checkUpdateShallow(id));
}

function listPluginIds(): string[] {
  const out: string[] = [];
  if (!fs.existsSync(PLUGINS_DIR)) return out;
  for (const name of fs.readdirSync(PLUGINS_DIR).sort()) {
    if (name.startsWith('.')) continue;
    const dir = path.join(PLUGINS_DIR, name);
    if (fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'plugin.toml'))) {
      out.push(loadPlugin(dir).plugin?.id ?? name);
    }
  }
  return out;
}

/** 不 clone、不解析远端的轻量检查：只看来源和本地版本（真检查用 checkUpdate） */
function checkUpdateShallow(id: string): UpdateCheck {
  const entry = findPlugin(id);
  const plugin = entry?.plugin;
  const source = entry ? readSource(entry.dir) : null;
  const base: UpdateCheck = {
    id,
    name: plugin?.name ?? id,
    current: plugin?.version ?? '?',
    latest: null,
    available: false,
    source, sourceText: describeSource(source),
    addedActions: [], removedActions: [],
  };
  if (source?.type === 'git') {
    return { ...base, reason: 'git 来源，拉取仓库才能比较（zkit plugin update <id> 会做）' };
  }
  if (source?.type === 'bundled') {
    const latest = loadPlugin(path.join(BUNDLED_PLUGINS_DIR, id)).plugin?.version ?? '';
    return { ...base, latest: latest || null, available: latest !== '' && latest !== base.current };
  }
  if (source?.type === 'market') return checkUpdate(id);
  if (!source || source.type === 'dir') {
    return {
      ...base, available: false,
      reason: source?.type === 'dir' ? '本地目录安装，重新 add 即可' : '没有来源记录，无法自动更新',
    };
  }
  return { ...base, reason: 'git 来源，需要拉取仓库才能比较（zkit plugin update <id> 会做）' };
}

/** 执行更新：替换插件目录（备份式，失败回滚），保留 {data_dir} 里的插件数据 */
export function applyUpdate(id: string): AddResult {
  const entry = findPlugin(id);
  if (!entry?.plugin) return { ok: false, message: `插件 ${id} 不存在`, warnings: [] };
  const source = readSource(entry.dir);
  if (!source || source.type === 'dir') {
    return {
      ok: false,
      message: !source
        ? `${id} 没有安装来源记录（手工拷贝的目录？），没法自动更新`
        : `${id} 是本地目录安装的，源目录改完后重新 zkit plugin add <目录> 即可`,
      warnings: [],
    };
  }

  if (source.type === 'market') {
    return installFromMarket(id, source.market, { replace: true });
  }

  if (source.type === 'bundled') {
    return addFromDir(path.join(BUNDLED_PLUGINS_DIR, id), {
      replace: true,
      source: { ...source, installedAt: new Date().toISOString(), installedVersion: '' },
    });
  }

  // git：重新 clone 替换
  const cloned = clonePluginRepo(source.url ?? '', source.ref);
  if (!cloned.ok || !cloned.dir) {
    return { ok: false, message: `更新失败：${cloned.message}`, warnings: [] };
  }
  try {
    return addFromDir(cloned.dir, {
      replace: true,
      source: { ...source, installedAt: new Date().toISOString(), installedVersion: '' },
    });
  } finally {
    // clone 出来的仓库装完就删（findTmpRoot 处理「清单在子目录」的情况）
    fs.rmSync(findTmpRoot(cloned.dir), { recursive: true, force: true });
  }
}
