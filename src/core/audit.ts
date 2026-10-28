/**
 * 第四十一轮：审计聚合与授权 TTL 的纯函数层。
 * 读侧聚合在 ops.ts 已有（actionStats）；这里补：
 *  - CLI allow 列表（与 approvals.json 分开的显式授权，带 TTL）
 *  - denied 记录读取
 *  - 自然语言时间过滤
 * 写入侧仍由 CLI 接线完成；本文件保持可单测的纯逻辑。
 */
import fs from 'node:fs';
import path from 'node:path';
import { HOME } from './paths.ts';

/** CLI 显式授权条目（allow.json）。at 是 ISO 时间；ttlDays 过期即失效。 */
export interface AllowEntry {
  key: string;        // plugin.action
  at: string;         // 授权时间 ISO
  ttlDays: number;    // 默认 30；-1 = 永久
}

function allowPath(): string {
  return path.join(HOME, 'allow.json');
}

export const DEFAULT_TTL_DAYS = 30;

export function loadAllow(): AllowEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(allowPath(), 'utf8'));
    return Array.isArray(raw)
      ? raw.filter((x): x is AllowEntry => typeof x?.key === 'string' && typeof x?.at === 'string')
      : [];
  } catch {
    return [];
  }
}

export function saveAllow(entries: AllowEntry[]): void {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(allowPath(), JSON.stringify(entries, null, 2));
}

/** 条目是否仍有效（永久或未过期）。now 可注入便于测试。 */
export function entryAlive(e: AllowEntry, now = Date.now()): boolean {
  if (e.ttlDays === -1) return true;
  return now - Date.parse(e.at) < e.ttlDays * 86_400_000;
}

/** 过滤掉过期条目；返回 {alive, expired} 便于调用方提示。 */
export function pruneAllow(entries: AllowEntry[], now = Date.now()): { alive: AllowEntry[]; expired: AllowEntry[] } {
  const alive: AllowEntry[] = []; const expired: AllowEntry[] = [];
  for (const e of entries) (entryAlive(e, now) ? alive : expired).push(e);
  return { alive, expired };
}

export function upsertAllow(entries: AllowEntry[], key: string, ttlDays = DEFAULT_TTL_DAYS, now = Date.now()): AllowEntry[] {
  const rest = entries.filter((e) => e.key !== key);
  rest.push({ key, at: new Date(now).toISOString(), ttlDays });
  return rest.sort((a, b) => a.key.localeCompare(b.key));
}

/** 删一个插件级授权（key 无动作部分）时，受影响的动作级条目数。 */
export function affectedByRemove(entries: AllowEntry[], pluginId: string): AllowEntry[] {
  return entries.filter((e) => e.key === pluginId || e.key.startsWith(`${pluginId}.`));
}

/** ⑥自然语言时间过滤：1h / 3d / 2w / 30m / 45s / 裸数字按秒。 */
export function parseSince(s: string): number | null {
  const m = /^(\d+)\s*([smhdw]?)$/i.exec(s.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] || 's').toLowerCase();
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  return n * (mult[unit] ?? 0) * 1000;
}

/** denied.log 读取（坏行跳过）。 */
export interface DeniedRecord { ts: string; key: string; reason: string }

export function readDenied(): { records: DeniedRecord[]; badLines: number } {
  const p = path.join(path.dirname(allowPath()), 'logs', 'denied.log');
  if (!fs.existsSync(p)) return { records: [], badLines: 0 };
  const records: DeniedRecord[] = []; let badLines = 0;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      records.push({ ts: String(o.ts ?? ''), key: String(o.key ?? o.action ?? ''), reason: String(o.reason ?? '') });
    } catch { badLines += 1; }
  }
  return { records, badLines };
}

/** ⑤某动作上次执行时间（从审计记录倒查）。records 按时间升序更稳，这里做防御性 max。 */
export function lastRunOf(records: { ts: string; key: string }[], key: string): string | null {
  let best: string | null = null;
  for (const r of records) {
    if (r.key !== key) continue;
    if (best === null || Date.parse(r.ts) > Date.parse(best)) best = r.ts;
  }
  return best;
}

/** 距上次执行的时长是否值得警示（高危动作久未用再跑，先让人清醒）。 */
export function isLongGap(lastTs: string | null, now = Date.now(), days = 7): boolean {
  if (!lastTs) return false; // 从没跑过：首次执行，警示交给正常的确认流程
  return now - Date.parse(lastTs) > days * 86_400_000;
}
