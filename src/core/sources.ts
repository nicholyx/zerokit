import fs from 'node:fs';
import path from 'node:path';

/**
 * 插件安装来源的记录与读取。
 *
 * 「装了之后能不能更新」取决于「当初从哪装的」：git 仓库装的重新拉、集市装的
 * 看集市索引、随 zerokit 自带的看仓库里的副本。这个事实只在安装那一刻存在，
 * 所以装的时候把它落在插件目录里（`.zerokit-source.json`），更新时读回来。
 *
 * dev 来源（plugin dev 的开发链接）是唯一「装的不是副本」的形态：插件目录里
 * 放的是指向开发目录的链接，所以来源记录写在**源目录**里——链接跟着源走，
 * 源目录才是本体。它是安装类来源里唯一不需要 update 的：改源码即生效。
 *
 * 文件很小、纯事实，不放任何敏感信息。手工拷贝来的插件目录没有它——
 * 那种插件的更新就是「再拷一次」，我们如实说「不知道从哪来的」而不是瞎猜。
 */

export type SourceType = 'git' | 'market' | 'bundled' | 'dir' | 'dev';

export interface PluginSource {
  type: SourceType;
  /** git 来源的仓库地址 */
  url?: string;
  /** git 来源的分支 / tag */
  ref?: string;
  /** 集市来源的集市名 */
  market?: string;
  /** dev 来源的开发目录（链接指向的地方） */
  path?: string;
  /** 安装时间（ISO） */
  installedAt: string;
  /** 安装时的插件版本，用于展示「装的时候是几，现在是几」 */
  installedVersion: string;
}

const FILE = '.zerokit-source.json';

export function sourcePath(pluginDir: string): string {
  return path.join(pluginDir, FILE);
}

export function writeSource(pluginDir: string, source: PluginSource): void {
  fs.writeFileSync(sourcePath(pluginDir), JSON.stringify(source, null, 2) + '\n', 'utf8');
}

export function readSource(pluginDir: string): PluginSource | null {
  try {
    const raw = JSON.parse(fs.readFileSync(sourcePath(pluginDir), 'utf8')) as Record<string, unknown>;
    const type = raw['type'];
    if (type !== 'git' && type !== 'market' && type !== 'bundled' && type !== 'dir' && type !== 'dev') return null;
    const s: PluginSource = {
      type,
      installedAt: typeof raw['installedAt'] === 'string' ? raw['installedAt'] : '',
      installedVersion: typeof raw['installedVersion'] === 'string' ? raw['installedVersion'] : '',
    };
    if (typeof raw['url'] === 'string') s.url = raw['url'];
    if (typeof raw['ref'] === 'string') s.ref = raw['ref'];
    if (typeof raw['market'] === 'string') s.market = raw['market'];
    if (typeof raw['path'] === 'string') s.path = raw['path'];
    return s;
  } catch {
    return null;
  }
}

/** 展示用：把来源说成一句话 */
export function describeSource(s: PluginSource | null): string {
  if (!s) return '未知来源（手工拷贝的目录？）';
  switch (s.type) {
    case 'git':
      return `git ${s.url ?? '?'}${s.ref ? `（分支 ${s.ref}）` : ''}`;
    case 'market':
      return `集市 ${s.market ?? '?'}`;
    case 'bundled':
      return 'zerokit 自带示例';
    case 'dir':
      return '本地目录';
    case 'dev':
      return `开发模式（链接到 ${s.path ?? '?'}）`;
  }
}
