// 第六十三轮：定时任务持久化——读写 ~/.zerokit/timers.json、下次触发推算、孤儿检测。
// 纯逻辑层：不 import 运行器（CLI timers run 在 cli.ts 里走 runner），
// UI 侧通过 /api/timers 由 server.ts 转发到这里。
import fs from 'node:fs';
import path from 'node:path';
import { HOME, ensureDirs } from './paths.ts';

export interface TimerEntry {
  /** actionKey：插件id.动作id */
  key: string;
  title: string;
  interval: number;        // 秒
  /** HH:MM-HH:MM 或空串=全天 */
  win?: string;
  /** 暂停 */
  paused?: boolean;
  createdAt: number;
  lastRanAt?: number;
  /** 补跑策略：catchup（缺省，最多补一次）/ skip */
  catchup?: 'catchup' | 'skip';
  /** 上次执行结果摘要（UI 显示用；CLI 不依赖） */
  lastOk?: boolean | null;
  /** 执行参数快照（UI 创建时存的 values；CLI timers run 用它复现） */
  values?: Record<string, string>;
  /**
   * 第七十八轮①：日期档。缺省 = 每天；'workdays' = 周一~周五；
   * 数字数组 = 每周指定星期几（0=周日 … 6=周六，如 [1,4] = 每周一、周四）。
   */
  days?: 'workdays' | number[];
  /**
   * 第七十八轮②：错过补偿的幂等标记——当天（YYYY-MM-DD 本地）已补过一次就不再补。
   * 与 catchup 策略配合：catchup 档开机发现错过且未补过 → 提示补跑并记当天。
   */
  lastCatchupDay?: string;
}

export interface TimersFile {
  version: 1;
  timers: TimerEntry[];
}

function timersPath(): string {
  return path.join(HOME, 'timers.json');
}

/** 读取（文件不存在返回空表；坏文件不炸——备份后按空表处理）。 */
export function loadTimers(): TimersFile {
  const p = timersPath();
  if (!fs.existsSync(p)) return { version: 1, timers: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<TimersFile>;
    const timers = Array.isArray(raw.timers)
      ? raw.timers.filter((t) => t && typeof t.key === 'string' && typeof t.interval === 'number' && t.interval > 0)
      : [];
    return { version: 1, timers };
  } catch {
    try { fs.renameSync(p, p + '.bak'); } catch { /* 尽力 */ }
    return { version: 1, timers: [] };
  }
}

/** 原子写（tmp + rename）。 */
export function saveTimers(file: TimersFile): void {
  ensureDirs();
  const p = timersPath();
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, timers: file.timers }, null, 2));
  fs.renameSync(tmp, p);
}

/** upsert 一个任务（按 key 去重）。 */
export function upsertTimer(t: TimerEntry): TimersFile {
  const file = loadTimers();
  const i = file.timers.findIndex((x) => x.key === t.key);
  if (i >= 0) file.timers[i] = { ...file.timers[i], ...t };
  else file.timers.push(t);
  saveTimers(file);
  return file;
}

/** 删除；返回是否真的删了。 */
export function removeTimer(key: string): boolean {
  const file = loadTimers();
  const i = file.timers.findIndex((x) => x.key === key);
  if (i < 0) return false;
  file.timers.splice(i, 1);
  saveTimers(file);
  return true;
}

/** 暂停/恢复。返回新状态；key 不存在返回 null。 */
export function setTimerPaused(key: string, paused: boolean): boolean | null {
  const file = loadTimers();
  const t = file.timers.find((x) => x.key === key);
  if (!t) return null;
  t.paused = paused;
  saveTimers(file);
  return paused;
}

// ---------------- 纯计算（UI 与 CLI 共用语义） ----------------

/** HH:MM-HH:MM 窗口判断（本地时区；支持跨午夜，如 22:00-06:00）。 */
export function inWindowAt(date: Date, win?: string): boolean {
  if (!win || !win.includes('-')) return true;
  const m = win.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!m) return true;
  const mins = date.getHours() * 60 + date.getMinutes();
  const a = Number(m[1]) * 60 + Number(m[2]);
  const b = Number(m[3]) * 60 + Number(m[4]);
  if (a <= b) return mins >= a && mins < b;
  return mins >= a || mins < b;   // 跨午夜
}

/**
 * 下次触发时刻（epoch ms）。暂停返回 null；窗口外把触发点推到窗口开点
 * （不进窗口才触发——简化语义：间隔节奏不变，落在窗口外就顺延到下一个窗口开点）。
 */
export function nextFireTime(t: TimerEntry, now = Date.now()): number | null {
  if (t.paused) return null;
  const intervalMs = t.interval * 1000;
  const last = t.lastRanAt ?? t.createdAt ?? now;
  let next = last + intervalMs;
  if (next <= now) {
    // 错过了整段（页面没开/暂停过）——从 now 起重新对齐节奏，不连环补
    const steps = Math.ceil((now - last) / intervalMs);
    next = last + steps * intervalMs;
  }
  // 第七十八轮①：日期档——next 落在非触发日就逐日推（最多推 7 天，全周禁触发是坏配置）
  if (t.days && !firesOnDay(t, new Date(next))) {
    for (let i = 1; i <= 7; i++) {
      const cand = new Date(next + i * 86400000);
      if (firesOnDay(t, cand)) { next = cand.getTime(); break; }
    }
  }
  // 窗口外：顺延到窗口开点（跨午夜窗口取当天或次日的开点，取不早于 next 的那个）
  if (!inWindowAt(new Date(next), t.win)) {
    const m = (t.win ?? '').match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
    if (m) {
      const d = new Date(next);
      for (let day = 0; day < 2; day++) {
        const cand = new Date(d.getFullYear(), d.getMonth(), d.getDate() + day, Number(m[1]), 0, 0, 0);
        if (cand.getTime() > next) { next = cand.getTime(); break; }
        if (day === 1) next = cand.getTime();
      }
    }
  }
  return next;
}

/**
 * 第七十八轮①：某天该不该触发。缺省每天；workdays=周一~五；数组=列出的星期几。
 */
export function firesOnDay(t: TimerEntry, date: Date): boolean {
  if (!t.days) return true;
  const dow = date.getDay();
  if (t.days === 'workdays') return dow >= 1 && dow <= 5;
  return Array.isArray(t.days) && t.days.includes(dow);
}

/**
 * 第七十八轮②：开机错过检测——距上次执行已跨过 ≥1 个应触发日、且今天还没补过。
 * 返回错过描述（人话）；没错过或已补过返回 null。catchup=skip 或暂停不补。
 */
export function missedRun(t: TimerEntry, now = Date.now()): string | null {
  if (t.paused || t.catchup === 'skip') return null;
  const today = new Date(now);
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (t.lastCatchupDay === todayKey) return null;
  // 上次执行（或创建）那天到今天，中间有没有「应触发却没跑」的完整一天
  const last = new Date(t.lastRanAt ?? t.createdAt ?? now);
  for (let d = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
       d <= new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
       d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    if (firesOnDay(t, d)) {
      return `${d.getMonth() + 1} 月 ${d.getDate()} 日（周${'日一二三四五六'[d.getDay()]}）该跑没跑`;
    }
  }
  return null;
}

/** 第七十八轮②：补跑后记账（同一天只补一次的幂等锚）。 */
export function markCatchupDone(t: TimerEntry, now = Date.now()): void {
  const d = new Date(now);
  t.lastCatchupDay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 第七十八轮⑧：下次触发时间说人话——今天/明天 HH:mm、周X HH:mm、N 天后 HH:mm。
 * 跨周一律退回「M/D HH:mm」绝对日期，不让人心算。
 */
export function humanNextFire(next: number, now = Date.now()): string {
  const n = new Date(next);
  const hm = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
  const today0 = new Date(now); today0.setHours(0, 0, 0, 0);
  const n0 = new Date(next); n0.setHours(0, 0, 0, 0);
  const diffDays = Math.round((n0.getTime() - today0.getTime()) / 86400000);
  if (diffDays === 0) return `今天 ${hm}`;
  if (diffDays === 1) return `明天 ${hm}`;
  if (diffDays >= 2 && diffDays <= 6) return `周${'日一二三四五六'[n.getDay()]} ${hm}`;
  return `${n.getMonth() + 1}/${n.getDate()} ${hm}`;
}

/** 孤儿检测：任务引用的插件已不在已装列表里。返回孤儿 key 列表。 */
export function orphanTimers(installedIds: string[]): string[] {
  const file = loadTimers();
  const ids = new Set(installedIds);
  return file.timers
    .filter((t) => !ids.has(t.key.split('.')[0] ?? ''))
    .map((t) => t.key);
}
