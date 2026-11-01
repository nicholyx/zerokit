/**
 * 应用自更新：检查 zerokit 本体是否有新版本（GitHub Releases / npm registry），
 * 以及下载对应平台的安装包。
 *
 * 这是「应用本体」的更新，与 core/update.ts（插件更新）互补：
 * - 插件更新走「从哪装的就从哪更新」；
 * - 本体更新只认发布渠道（Releases tag / npm dist-tag），检查与下载分离，
 *   绝不静默替换——安装器的运行（dmg/exe）交还用户。
 *
 * 检查失败一律静默降级（返回 latest: null + reason）：断网、接口变更、
 * 限流都不该打扰用户，日志里记一行就够。
 */

/** 一次应用版本检查的结果 */
export interface AppUpdateCheck {
  /** 当前版本（package.json） */
  current: string;
  /** 渠道最新版本；null = 检查不到（reason 说明原因） */
  latest: string | null;
  /** latest 语义化大于 current */
  available: boolean;
  /** 最新版安装包下载地址（available 时才有） */
  downloadUrl: string | null;
  /** 本机平台对应的资产文件名后缀 */
  assetName: string | null;
  /** 检查失败原因（latest 为 null 时有值） */
  reason?: string;
}

/** npm dist-tags 的最小形态 */
export interface NpmDistTags { [tag: string]: string }

/** Releases/latest 接口的最小形态 */
export interface ReleaseLike {
  tag_name?: string;
  prerelease?: boolean;
  draft?: boolean;
  assets?: { name: string; browser_download_url: string }[];
}

/** 平台 → 安装包资产名（与 release.yml 的命名一致） */
export function assetForPlatform(release: ReleaseLike | null, platform: NodeJS.Platform, arch: string): string | null {
  if (!release?.assets?.length) return null;
  const os = platform === 'win32' ? 'x64-setup.exe' : platform === 'darwin' ? (arch === 'arm64' ? 'aarch64.dmg' : 'x64.dmg') : null;
  if (!os) return null; // Linux 暂无安装包资产
  return release.assets.find((a) => a.name.endsWith(os))?.name ?? null;
}

/**
 * 从「检查渠道拿到的原始数据」算出 AppUpdateCheck——纯函数，测试不联网。
 * channel: 'github' 拿 ReleaseLike；'npm' 拿 NpmDistTags（npm 只有版本号，无资产）。
 */
export function evalAppUpdate(
  current: string,
  channel: 'github' | 'npm',
  raw: ReleaseLike | NpmDistTags | null,
  platform: NodeJS.Platform,
  arch: string,
): AppUpdateCheck {
  if (!raw) return { current, latest: null, available: false, downloadUrl: null, assetName: null, reason: '渠道数据为空' };
  if (channel === 'npm') {
    const tags = raw as NpmDistTags;
    const latest = tags.latest ?? null;
    if (!latest) return { current, latest: null, available: false, downloadUrl: null, assetName: null, reason: 'npm 无 latest 标签' };
    return { current, latest, available: compareAppVersion(latest, current) > 0, downloadUrl: null, assetName: null };
  }
  const rel = raw as ReleaseLike;
  if (rel.draft || rel.prerelease) {
    return { current, latest: null, available: false, downloadUrl: null, assetName: null, reason: '最新发布是草稿或预发布' };
  }
  const latest = rel.tag_name?.replace(/^v/, '') ?? null;
  if (!latest) return { current, latest: null, available: false, downloadUrl: null, assetName: null, reason: 'release 无 tag' };
  const available = compareAppVersion(latest, current) > 0;
  if (!available) return { current, latest, available: false, downloadUrl: null, assetName: null };
  const assetName = assetForPlatform(rel, platform, arch);
  const downloadUrl = assetName ? (rel.assets ?? []).find((a) => a.name === assetName)?.browser_download_url ?? null : null;
  return { current, latest, available, downloadUrl, assetName, reason: assetName ? undefined : '本平台暂无安装包资产' };
}

/** 语义化比较：a > b 返回 1。只认 x.y.z（前缀 v 可选），解析不了按字符串比。 */
export function compareAppVersion(a: string, b: string): number {
  const pa = /^v?(\d+)\.(\d+)\.(\d+)/.exec(a.trim());
  const pb = /^v?(\d+)\.(\d+)\.(\d+)/.exec(b.trim());
  if (pa && pb) {
    for (let i = 1; i <= 3; i++) {
      const d = Number(pa[i]) - Number(pb[i]);
      if (d !== 0) return d > 0 ? 1 : -1;
    }
    return 0;
  }
  return a === b ? 0 : a > b ? 1 : -1;
}

/** 桌面壳的检查节流：距上次检查不足 24h 就跳过。 */
export function shouldCheckUpdate(lastCheckMs: number | null, now = Date.now()): boolean {
  if (lastCheckMs == null) return true;
  return now - lastCheckMs >= 24 * 60 * 60 * 1000;
}

/** 用户点「下次提醒」：3 天后再查。 */
export function remindDelayMs(): number {
  return 3 * 24 * 60 * 60 * 1000;
}

/** 请求 GitHub releases/latest（带超时，失败静默）。 */
export async function fetchLatestRelease(repo = 'nicholyx/zerokit'): Promise<ReleaseLike | null> {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8000);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'zerokit-update-check' },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.json()) as ReleaseLike;
  } catch {
    return null;
  }
}

import fs from 'node:fs';

/** 读当前版本：package.json 的 version 字段（cwd 由调用方传入）。 */
export function readCurrentVersion(pkgJsonPath: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
