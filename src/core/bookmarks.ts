// 第一百四十九轮：history 过滤增强与书签（bookmark）。
// 纯函数层——CLI 只接线，测试直测。存储对齐 settings 写法：0600 原子写。
import fs from 'node:fs';
import path from 'node:path';
import { HOME } from './paths.ts';
import type { HistoryEntry } from './cliX.ts';

export interface Bookmark {
  name: string;        // 别名（kebab/字母数字，重名拒绝）
  argv: string[];      // 完整 argv（含 run 头）：zkit run p a --k v
  note?: string;       // 可选备注
  createdAt: string;   // ISO
}

/** 书签文件：~/.zerokit/bookmarks.json（{version,items}）。 */
export const BOOKMARKS_FILE = (): string => path.join(HOME, 'bookmarks.json');

/** ①读（坏文件回空表不崩；旧裸数组也认）。 */
export function readBookmarks(): Bookmark[] {
  const p = BOOKMARKS_FILE();
  if (!fs.existsSync(p)) return [];
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8')) as unknown;
    if (Array.isArray(j)) return j.filter((b) => b && typeof (b as Bookmark).name === 'string') as Bookmark[];
    const items = (j as { items?: unknown }).items;
    return Array.isArray(items) ? items.filter((b) => b && typeof (b as Bookmark).name === 'string') as Bookmark[] : [];
  } catch { return []; }
}

/** ②写（0600 原子写：tmp+rename，对齐 pluginConfig）。 */
function writeBookmarks(items: Bookmark[]): void {
  fs.mkdirSync(HOME, { recursive: true });
  const tmp = BOOKMARKS_FILE() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, items }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, BOOKMARKS_FILE());
}

/** ③别名合法性：非空、^[A-Za-z0-9._-]{1,32}$（shell 友好，不含空格/中文——重跑命令行可复制）。 */
export function validBookmarkName(name: string): string | null {
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(name)) return '别名只能用字母/数字/./_/-，长度 1–32（不含空格与中文）';
  return null;
}

/** ④加书签（重名拒绝；返回错误文案或 null=成功）。 */
export function addBookmark(name: string, argv: string[], note?: string): string | null {
  const vbad = validBookmarkName(name);
  if (vbad) return vbad;
  const items = readBookmarks();
  if (items.some((b) => b.name === name)) return `别名 ${name} 已存在（zkit bookmark rm ${name} 先删）`;
  items.push({ name, argv, note, createdAt: new Date().toISOString() });
  writeBookmarks(items);
  return null;
}

/** ⑤删书签（不存在报错文案）。 */
export function removeBookmark(name: string): string | null {
  const items = readBookmarks();
  const next = items.filter((b) => b.name !== name);
  if (next.length === items.length) return `没有别名 ${name}（zkit bookmark list 看现有的）`;
  writeBookmarks(next);
  return null;
}

/** ⑥查书签（找不到 undefined）。 */
export function findBookmark(name: string): Bookmark | undefined {
  return readBookmarks().find((b) => b.name === name);
}

/** ⑦历史过滤（history --grep/--since 增强语义的纯函数形态）：
 * grep=命令行子串（plugin+action+argv 拼接）；sinceMs=毫秒锚下限；失败态=0 成功/1 失败/undefined 不筛。
 * 返回保持原顺序（尾新）。 */
export function filterHistoryEntries(entries: HistoryEntry[], opts: { grep?: string; sinceMs?: number; failed?: boolean }): HistoryEntry[] {
  return entries.filter((e) => {
    if (opts.grep !== undefined && !(`${e.plugin} ${e.action} ${e.argv.join(' ')}`.includes(opts.grep))) return false;
    if (opts.sinceMs !== undefined && Date.parse(e.ts) < opts.sinceMs) return false;
    if (opts.failed === true && e.exitCode === 0) return false;
    return true;
  });
}

/** ⑧--since 解析：today=本地零点；Nd/h=mS/mh；空串与不认识=undefined（不过滤）。 */
export function parseSinceArg(arg: string | undefined, now = Date.now()): number | undefined {
  if (!arg) return undefined;
  if (arg === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); }
  const m = /^(\d+)([dh])$/.exec(arg);
  if (!m) return undefined;
  const n = Number(m[1]);
  return now - n * (m[2] === 'd' ? 86_400_000 : 3_600_000);
}
