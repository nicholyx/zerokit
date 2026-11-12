/**
 * 第二百七十三轮①②⑤：watch 采样窗口聚合——结果数据分析方向起步（272 轮对账 S 第一条）。
 * 纯函数：samples 形如 [{ ts, ok, data, err }]（浏览器写 watch.json 的真实形态）。
 * 数值提取：data 是对象时取其第一个数值型字段；直接数值直接用；其余跳过。
 */

export interface WatchSample {
  ts?: number;
  ok?: boolean;
  data?: unknown;
  err?: string;
}

export interface WindowStat {
  window: string;
  count: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  first: number | null;
  last: number | null;
}

/** 从一个样本的 data 提取数值（对象取第一个数值字段；数值直接用；其余 null） */
export function numericOf(sample: WatchSample): number | null {
  if (!sample.ok) return null;
  const d = sample.data;
  if (typeof d === 'number' && Number.isFinite(d)) return d;
  if (d && typeof d === 'object') {
    for (const v of Object.values(d as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
  }
  return null;
}

/** ① aggregateWindow：窗口内数值样本的 min/max/avg/count/first/last；无有效样本全 null（不抛） */
export function aggregateWindow(samples: WatchSample[], windowMs: number, now = Date.now()): Omit<WindowStat, 'window'> {
  const cut = now - windowMs;
  const vals: Array<{ ts: number; v: number }> = [];
  for (const s of samples) {
    const ts = typeof s.ts === 'number' ? s.ts : 0;
    if (ts < cut) continue;
    const v = numericOf(s);
    if (v === null) continue;
    vals.push({ ts, v });
  }
  if (vals.length === 0) return { count: 0, min: null, max: null, avg: null, first: null, last: null };
  const nums = vals.map((x) => x.v);
  return {
    count: vals.length,
    min: Math.min(...nums),
    max: Math.max(...nums),
    avg: nums.reduce((a, b) => a + b, 0) / nums.length,
    first: vals[0]?.v ?? null,
    last: vals.at(-1)?.v ?? null,
  };
}

/** ② windowStats：多窗口分组（如 [['5m', 300_000], ['1h', 3_600_000], ['24h', 86_400_000]]） */
export function windowStats(samples: WatchSample[], windows: ReadonlyArray<readonly [string, number]>, now = Date.now()): WindowStat[] {
  return windows.map(([label, ms]) => ({ window: label, ...aggregateWindow(samples, ms, now) }));
}

/** ③③③ CLI 三窗口常量 */
export const DEFAULT_WINDOWS: ReadonlyArray<readonly [string, number]> = [
  ['5m', 5 * 60_000],
  ['1h', 60 * 60_000],
  ['24h', 24 * 60 * 60_000],
];
