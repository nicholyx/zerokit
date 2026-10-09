import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { type LoadResult, loadPlugin } from './manifest.ts';
import { HOME, ensureDirs } from './paths.ts';
import { type AddResult, addFromDir } from './registry.ts';

/**
 * 插件集市：一个集市就是一个 git 仓库 + 根目录一个 market.json 索引。
 * 没有中心服务、没有账号、没有审核——成本极低，谁都能开一个。
 *
 * 安全前提：**插件清单在装第三方插件时属于不可信输入**。
 * tool poisoning（描述里藏指令）、rug pull（装完后偷改描述）都是真实风险，
 * 所以安装流程把「动作清单 + 真实命令 + 风险等级」摊开给人看，
 * 并且把安装时的清单快照存下来，之后被改动能发现。
 */

export interface MarketSource {
  name: string;
  url: string;
  /** 本地缓存目录 */
  path: string;
  addedAt: string;
}

export interface MarketEntry {
  id: string;
  name: string;
  summary?: string;
  version?: string;
  tags?: string[];
  /** path:<集市仓库内相对路径> 或 git:<仓库地址>[#子目录] */
  source: string;
}

export interface MarketIndex {
  name: string;
  description?: string;
  plugins: MarketEntry[];
}

const MARKETS_FILE = path.join(HOME, 'marketplaces.json');
const CACHE_DIR = path.join(HOME, 'cache', 'market');

function marketsFile(): string {
  return MARKETS_FILE;
}

export function loadMarkets(): MarketSource[] {
  try {
    const raw = JSON.parse(fs.readFileSync(marketsFile(), 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveMarkets(list: MarketSource[]): void {
  ensureDirs();
  fs.writeFileSync(marketsFile(), JSON.stringify(list, null, 2));
}

function cachePathFor(name: string): string {
  return path.join(CACHE_DIR, name.replace(/[^\w.-]+/g, '_'));
}

export function readIndex(name: string): MarketIndex | undefined {
  const market = loadMarkets().find((m) => m.name === name);
  if (!market) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(market.path, 'market.json'), 'utf8'));
    if (!Array.isArray(raw?.plugins)) return undefined;
    return raw as MarketIndex;
  } catch {
    return undefined;
  }
}

function gitClone(url: string, dest: string): { ok: boolean; message: string } {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const out = spawnSync('git', ['clone', '--depth', '1', url, dest], {
    encoding: 'utf8', windowsHide: true, timeout: 180000,
  });
  if (out.status !== 0) {
    return { ok: false, message: (out.stderr || out.stdout || '未知错误').trim().slice(0, 300) };
  }
  return { ok: true, message: '' };
}

/** 归一化集市地址：支持 owner/repo 简写 */
export function normalizeMarketUrl(source: string): string {
  if (/^[\w.-]+\/[\w.-]+$/.test(source) && !source.includes('://')) {
    return `https://github.com/${source}.git`;
  }
  return source;
}

export function addMarket(source: string): { ok: boolean; name?: string; message: string } {
  ensureDirs();
  const url = normalizeMarketUrl(source);

  // 本地目录直接当集市用（开发时最方便）
  const isLocal = !/^(https?:\/\/|git@|ssh:\/\/)/.test(url);
  const localDir = isLocal ? path.resolve(source) : '';

  let indexPath: string;
  let cacheDir: string;
  if (isLocal) {
    if (!fs.existsSync(path.join(localDir, 'market.json'))) {
      return { ok: false, message: `${localDir} 下没有 market.json，不是个集市` };
    }
    indexPath = localDir;
    cacheDir = localDir;
  } else {
    const guess = url.replace(/\.git$/, '').split('/').pop() ?? 'market';
    cacheDir = cachePathFor(guess);
    const cloned = gitClone(url, cacheDir);
    if (!cloned.ok) return { ok: false, message: `克隆失败：${cloned.message}` };
    if (!fs.existsSync(path.join(cacheDir, 'market.json'))) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      return { ok: false, message: '这个仓库根目录没有 market.json，不是个集市' };
    }
    indexPath = cacheDir;
  }

  let index: MarketIndex;
  try {
    index = JSON.parse(fs.readFileSync(path.join(indexPath, 'market.json'), 'utf8'));
  } catch (e) {
    return { ok: false, message: `market.json 读不了：${(e as Error).message}` };
  }
  const name = String(index.name || path.basename(cacheDir));
  if (!name) return { ok: false, message: 'market.json 里缺少 name' };

  const list = loadMarkets().filter((m) => m.name !== name);
  list.push({ name, url, path: cacheDir, addedAt: new Date().toISOString() });
  saveMarkets(list);
  return {
    ok: true,
    name,
    message: `已添加集市「${name}」，共 ${index.plugins?.length ?? 0} 个插件`,
  };
}

export function removeMarket(name: string): boolean {
  const list = loadMarkets();
  const target = list.find((m) => m.name === name);
  if (!target) return false;
  saveMarkets(list.filter((m) => m.name !== name));
  return true;
}

export function refreshMarket(name: string): { ok: boolean; message: string } {
  const list = loadMarkets();
  const market = list.find((m) => m.name === name);
  if (!market) return { ok: false, message: `没有这个集市：${name}` };
  if (!/^(https?:\/\/|git@|ssh:\/\/)/.test(market.url)) {
    return { ok: true, message: '本地集市，无需刷新' };
  }
  const cloned = gitClone(market.url, market.path);
  return cloned.ok
    ? { ok: true, message: `已刷新「${name}」` }
    : { ok: false, message: `刷新失败：${cloned.message}` };
}

export interface SearchHit {
  market: string;
  entry: MarketEntry;
}

export function searchMarkets(query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  const hits: SearchHit[] = [];
  for (const market of loadMarkets()) {
    const index = readIndex(market.name);
    if (!index) continue;
    for (const entry of index.plugins ?? []) {
      if (!q) {
        hits.push({ market: market.name, entry });
        continue;
      }
      const hay = [entry.id, entry.name, entry.summary ?? '', ...(entry.tags ?? [])]
        .join(' ').toLowerCase();
      if (hay.includes(q)) hits.push({ market: market.name, entry });
    }
  }
  return hits;
}

export function findEntry(pluginId: string, marketName?: string): SearchHit | undefined {
  return searchMarkets('').find(
    (h) => h.entry.id === pluginId && (!marketName || h.market === marketName),
  );
}

/** 把集市条目解析成一个本地目录，供安装使用 */
function resolveSource(hit: SearchHit): { ok: boolean; dir?: string; message: string } {
  const src = hit.entry.source ?? '';
  const market = loadMarkets().find((m) => m.name === hit.market);
  if (!market) return { ok: false, message: `集市不存在：${hit.market}` };

  if (src.startsWith('path:')) {
    const rel = src.slice(5).replace(/^[/\\]+/, '');
    const dir = path.resolve(market.path, rel);
    // 防目录穿越：集市里的相对路径不允许跳出集市仓库
    if (!dir.startsWith(path.resolve(market.path) + path.sep)) {
      return { ok: false, message: `条目里的路径 "${rel}" 非法，已拒绝` };
    }
    if (!fs.existsSync(path.join(dir, 'plugin.toml'))) {
      return { ok: false, message: `集市里找不到 ${rel}/plugin.toml` };
    }
    return { ok: true, dir, message: '' };
  }

  if (src.startsWith('git:')) {
    const spec = src.slice(4);
    const hash = spec.indexOf('#');
    const repoUrl = hash >= 0 ? spec.slice(0, hash) : spec;
    const sub = hash >= 0 ? spec.slice(hash + 1).replace(/^[/\\]+/, '') : '';
    const tmp = path.join(CACHE_DIR, `.tmp-${Date.now()}`);
    const cloned = gitClone(normalizeMarketUrl(repoUrl), tmp);
    if (!cloned.ok) return { ok: false, message: `克隆失败：${cloned.message}` };
    const dir = sub ? path.join(tmp, sub) : tmp;
    if (!fs.existsSync(path.join(dir, 'plugin.toml'))) {
      fs.rmSync(tmp, { recursive: true, force: true });
      return { ok: false, message: `仓库里找不到 ${sub || ''}/plugin.toml` };
    }
    return { ok: true, dir, message: '' };
  }

  return { ok: false, message: `不认识的 source："${src}"（应以 path: 或 git: 开头）` };
}

export interface InstallPreview {
  entry: MarketEntry;
  market: string;
  load: LoadResult;
  dir?: string;
}

/** 安装前的预演：把清单解析出来，供人审查（不落地） */
export function previewInstall(pluginId: string, marketName?: string): InstallPreview | undefined {
  const hit = findEntry(pluginId, marketName);
  if (!hit) return undefined;
  const resolved = resolveSource(hit);
  if (!resolved.ok || !resolved.dir) {
    return {
      entry: hit.entry,
      market: hit.market,
      load: { errors: [resolved.message], warnings: [] },
    };
  }
  return {
    entry: hit.entry,
    market: hit.market,
    load: loadPlugin(resolved.dir),
    dir: resolved.dir,
  };
}

export function installFromMarket(pluginId: string, marketName?: string, opts: { replace?: boolean } = {}): AddResult {
  const preview = previewInstall(pluginId, marketName);
  if (!preview) return { ok: false, message: `所有集市里都没有插件 "${pluginId}"`, warnings: [] };
  if (!preview.load.plugin || !preview.dir) {
    return {
      ok: false,
      message: `插件清单没通过校验：\n  - ${preview.load.errors.join('\n  - ')}`,
      warnings: preview.load.warnings,
    };
  }
  // 记下来源（哪个集市）：以后 plugin update 就是「refresh 后按集市索引重装」
  const result = addFromDir(preview.dir, {
    replace: opts.replace,
    source: {
      type: 'market',
      market: preview.market,
      installedAt: new Date().toISOString(),
      installedVersion: preview.load.plugin.version,
    },
  });
  if (result.ok && result.id) {
    // 存一份安装时的清单快照，之后被改动可以发现（对应 rug pull 风险）
    try {
      ensureDirs();
      const snapDir = path.join(HOME, 'installed');
      fs.mkdirSync(snapDir, { recursive: true });
      fs.writeFileSync(
        path.join(snapDir, `${result.id}.json`),
        JSON.stringify({
          installedAt: new Date().toISOString(),
          market: preview.market,
          source: preview.entry.source,
          manifest: fs.readFileSync(path.join(result.dir!, 'plugin.toml'), 'utf8'),
        }, null, 2),
      );
    } catch {
      /* 快照失败不影响安装 */
    }
  }
  return result;
}

/** 从目录生成集市索引，方便任何人把自己的插件目录变成一个集市 */
export function buildIndex(dir: string, name?: string, description?: string): MarketIndex {
  const plugins: MarketEntry[] = [];
  const pluginsDir = path.join(dir, 'plugins');
  const scanRoot = fs.existsSync(pluginsDir) ? pluginsDir : dir;
  for (const entry of fs.readdirSync(scanRoot).sort()) {
    const full = path.join(scanRoot, entry);
    if (!fs.statSync(full).isDirectory()) continue;
    const result = loadPlugin(full);
    if (!result.plugin) continue;
    const p = result.plugin;
    const rel = path.relative(dir, full).split(path.sep).join('/');
    plugins.push({
      id: p.id,
      name: p.name,
      summary: p.summary,
      version: p.version,
      tags: p.keywords,
      source: `path:${rel}`,
    });
  }
  const fallbackName = path.basename(path.resolve(dir));
  return {
    name: name || fallbackName,
    description: description || '',
    plugins,
  };
}