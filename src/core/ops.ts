// 运维面：审计/日志数据的读取与统计（纯读取，不动写入侧）。
// audit.log 是 JSONL（每行一条 AuditRecord）——这里只负责读、聚合、
// 按行 tail，给 CLI 的 stats/audit/logs/gc 四个命令共用。
import fs from 'node:fs';
import path from 'node:path';
import { HOME, LOG_DIR } from './paths.ts';
import type { AuditRecord } from './runner.ts';

export const AUDIT_LOG = () => path.join(LOG_DIR, 'audit.log');
export const DENIED_LOG = () => path.join(LOG_DIR, 'denied.log');

/** 读全部审计记录（文件不存在返回空数组；坏行跳过并计数的场景用 readAuditDetailed）。 */
export function readAudit(): AuditRecord[] {
  return readAuditDetailed().records;
}

export function readAuditDetailed(): { records: AuditRecord[]; badLines: number } {
  const p = AUDIT_LOG();
  if (!fs.existsSync(p)) return { records: [], badLines: 0 };
  const records: AuditRecord[] = [];
  let badLines = 0;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      records.push(JSON.parse(t) as AuditRecord);
    } catch {
      badLines += 1; // 半截行（进程被杀时正在写）——跳过不致命
    }
  }
  return { records, badLines };
}

/** ①动作级耗时统计：P50/P95 用最近邻秩（样本少时不插值，给诚实数字）。 */
export interface ActionStat {
  key: string;            // plugin.action
  plugin: string;
  action: string;
  count: number;
  failCount: number;
  p50Ms: number | undefined;
  p95Ms: number | undefined;
  maxMs: number | undefined;
  lastTs: string | undefined;
}

export function percentileNearestRank(sorted: number[], pct: number): number | undefined {
  if (sorted.length === 0) return undefined;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function actionStats(records: AuditRecord[]): ActionStat[] {
  const by = new Map<string, ActionStat>();
  for (const r of records) {
    const key = `${r.plugin}.${r.action}`;
    let s = by.get(key);
    if (!s) {
      const fresh: ActionStat = { key, plugin: r.plugin, action: r.action, count: 0, failCount: 0, p50Ms: undefined, p95Ms: undefined, maxMs: undefined, lastTs: undefined };
      by.set(key, fresh);
      s = fresh;
    }
    s.count += 1;
    if (r.decision === 'deny' || (typeof r.exitCode === 'number' && r.exitCode !== 0)) s.failCount += 1;
    if (!s.lastTs || r.ts > s.lastTs) s.lastTs = r.ts as string | undefined;
  }
  // 耗时分位数二次遍历（避免每条记录都排序）
  const times = new Map<string, number[]>();
  for (const r of records) {
    if (typeof r.ms === 'number' && r.decision === 'allow') {
      const key = `${r.plugin}.${r.action}`;
      let arr = times.get(key);
      if (!arr) { arr = []; times.set(key, arr); }
      arr.push(r.ms);
    }
  }
  for (const [key, arr] of times) {
    const s = by.get(key);
    if (!s) continue;
    arr.sort((a, b) => a - b);
    s.p50Ms = percentileNearestRank(arr, 50);
    s.p95Ms = percentileNearestRank(arr, 95);
    s.maxMs = arr[arr.length - 1];
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

/** ⑦慢动作水位线判断（与 runner 写入侧同一份逻辑）。 */
export const SLOW_MS = 3000;
export function isSlow(ms: number | undefined | null): boolean {
  return typeof ms === 'number' && ms >= SLOW_MS;
}

/** ⑧gc 预览/执行：按 ts 早于 cutoffDays 前删行。返回删了多少行、剩多少行。 */
export function gcAudit(cutoffDays: number, dryRun: boolean): { removed: number; kept: number } {
  const { records } = readAuditDetailed();
  const cutoff = Date.now() - cutoffDays * 86400_000;
  const keep = records.filter((r) => new Date(r.ts).getTime() >= cutoff);
  const removed = records.length - keep.length;
  if (!dryRun && removed > 0) {
    const p = AUDIT_LOG();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, keep.map((r) => JSON.stringify(r)).join('\n') + (keep.length ? '\n' : ''));
  }
  return { removed, kept: keep.length };
}

/** ③日志 tail（文本行，不解析）——follow 模式由 CLI 侧循环实现。 */
export function tailText(file: string, n: number): string[] {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-n);
}

/** ⑨最近错误：decision=deny 或 exitCode!==0 的最后 N 条。 */
export function recentErrors(records: AuditRecord[], n: number): AuditRecord[] {
  return records
    .filter((r) => r.decision === 'deny' || (typeof r.exitCode === 'number' && r.exitCode !== 0))
    .slice(-n);
}

export { HOME, LOG_DIR };
