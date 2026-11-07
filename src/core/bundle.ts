// 第一百七十轮：命令集 bundle——书签打包流通。
// 复用 bookmarks 的 Bookmark 结构与 share 的指纹口径，纯函数层。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { release } from 'node:os';
import { HOME } from './paths.ts';
import type { Bookmark } from './bookmarks.ts';

export interface BundlePack {
  app: 'zerokit';
  bundleVersion: 1;
  name: string;            // 命令集名（创建时给，apply 后不落本机）
  items: Bookmark[];       // 打包的书签条目
  createdAt: string;       // ISO
  env: { os: string; node: string; appVersion: string }; // 制作环境指纹
}

export const BUNDLE_EXT = '.zbundle';

/** ①从本机书签挑条目打包。 */
export function buildBundlePack(name: string, items: Bookmark[], appVersion: string): BundlePack {
  return {
    app: 'zerokit', bundleVersion: 1, name, items,
    createdAt: new Date().toISOString(),
    env: { os: `${process.platform} ${osRelease()}`, node: process.version, appVersion },
  };
}
function osRelease(): string { return release(); }

/** ⑤指纹：与 .zshare 同口径（SHA-256 前 16 hex 四组）。 */
export function bundleFingerprint(pack: BundlePack): string {
  const canon = JSON.stringify({ app: pack.app, bundleVersion: pack.bundleVersion, name: pack.name, items: pack.items });
  return (createHash('sha256').update(canon).digest('hex').slice(0, 16).match(/.{4}/g) ?? []).join(' ');
}

/** ⑥校验：文案风格与 .zshare 一致。 */
export function validateBundlePack(raw: unknown): { ok: true; pack: BundlePack } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: '命令集不是 JSON 对象' };
  const r = raw as Record<string, unknown>;
  if (r.app !== 'zerokit') return { ok: false, error: '这不是 zerokit 的命令集（app 字段不符）——可能传错了文件' };
  if (r.bundleVersion !== 1) return { ok: false, error: `命令集版本 ${String(r.bundleVersion)} 不认识——只认 1，可能来自更新版本的 zerokit` };
  for (const k of ['name', 'items', 'createdAt', 'env'] as const) {
    if (!(k in r)) return { ok: false, error: `命令集缺字段 ${k}——文件可能被截断` };
  }
  if (typeof r.name !== 'string' || !r.name) return { ok: false, error: '命令集名字为空' };
  if (!Array.isArray(r.items)) return { ok: false, error: '命令集的 items 不是数组——文件可能被截断' };
  for (const it of r.items) {
    const b = it as Partial<Bookmark>;
    if (typeof b.name !== 'string' || !Array.isArray(b.argv) || !b.argv.length) {
      return { ok: false, error: `条目「${String(b.name ?? '?')}」不完整（缺 name 或 argv）` };
    }
  }
  return { ok: true, pack: raw as BundlePack };
}

/** ②apply 重名解析：与已有名冲突时加 -2/-3 后缀（不覆盖）。 */
export function resolveApplyNames(pack: BundlePack, existing: Bookmark[]): Bookmark[] {
  const taken = new Set(existing.map((b) => b.name));
  return pack.items.map((it) => {
    let name = it.name;
    if (!taken.has(name)) { taken.add(name); return { ...it, name }; }
    let n = 2;
    while (taken.has(`${name}-${n}`)) n++;
    name = `${name}-${n}`;
    taken.add(name);
    return { ...it, name };
  });
}

/** ④diff：三桶（新增/相同/本机独有）。相同=名字与 argv 全等。 */
export function bundleDiff(pack: BundlePack, local: Bookmark[]): { adds: Bookmark[]; same: Bookmark[]; localOnly: Bookmark[] } {
  const key = (b: Bookmark) => `${b.name}|${b.argv.join(' ')}`;
  const localKeys = new Map(local.map((b) => [key(b), b]));
  const packKeys = new Set(pack.items.map(key));
  const adds: Bookmark[] = [], same: Bookmark[] = [];
  for (const it of pack.items) { (localKeys.has(key(it)) ? same : adds).push(it); }
  const localOnly = local.filter((b) => !packKeys.has(key(b)));
  return { adds, same, localOnly };
}

/** 落盘（命令集目录 ~/.zerokit/bundles/）。 */
export function writeBundlePack(pack: BundlePack, outPath?: string): string {
  const dir = path.join(HOME, 'bundles');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-').slice(0, 16);
  const file = outPath ?? path.join(dir, `bundle-${pack.name.replace(/[^\w.-]+/g, '_')}-${stamp}${BUNDLE_EXT}`);
  fs.writeFileSync(file, JSON.stringify(pack, null, 2) + '\n', { mode: 0o600 });
  return file;
}
