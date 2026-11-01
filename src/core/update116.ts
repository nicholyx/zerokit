// update116.ts：第一百一十六轮——升级完整 diff / rug-pull 检测 / 快照时点
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from './manifest.ts';
import { upgradeDiff, type UpgradeDiff } from './install115.ts';

/** ①② 升级完整对照：在 upgradeDiff（动作/参数）之上补风险变化维度 */
export interface RiskChange { action: string; from: string; to: string }
export interface FullUpgradeDiff extends UpgradeDiff {
  riskChanged: RiskChange[]; // 风险升级（read→mutate、mutate→destructive、read→destructive）
}
export function fullUpgradeDiff(cur: Plugin, next: Plugin): FullUpgradeDiff {
  const base = upgradeDiff(cur, next);
  const riskChanged: RiskChange[] = [];
  const rank: Record<string, number> = { read: 0, mutate: 1, destructive: 2 };
  for (const a2 of next.actions) {
    const a1 = cur.actions.find((a) => a.id === a2.id);
    if (a1 && (rank[a1.risk] ?? 0) < (rank[a2.risk] ?? 0)) {
      riskChanged.push({ action: a2.id, from: a1.risk, to: a2.risk });
    }
  }
  return { ...base, riskChanged };
}

/** ③ rug-pull 检测：同名动作的执行体（run/脚本）在升级后是否被整体替换
 * 策略：逐动作对比 run 数组 JSON；同名动作里 run 全换的占比 ≥60% 判「执行体大换血」。
 * 版本升级本来就会改实现——看的不是「有没有变」而是「变得认不出」：
 * 动作 id 与标题都不变、但每一条命令都换掉，是典型的偷梁换柱形态。 */
export interface RugpullReport {
  suspicious: boolean;
  swapped: string[]; // 执行体全换的同名动作
  ratio: number;
}
export function rugpullCheck(cur: Plugin, next: Plugin, threshold = 0.6): RugpullReport {
  const same = next.actions.filter((a2) => cur.actions.some((a) => a.id === a2.id));
  if (same.length === 0) return { suspicious: false, swapped: [], ratio: 0 };
  const swapped = same.filter((a2) => {
    const a1 = cur.actions.find((a) => a.id === a2.id)!;
    const r1 = JSON.stringify(a1.run ?? []);
    const r2 = JSON.stringify(a2.run ?? []);
    return r1 !== '[]' && r2 !== '[]' && r1 !== r2;
  });
  const ratio = swapped.length / same.length;
  return { suspicious: ratio >= threshold && swapped.length >= 2, swapped: swapped.map((a) => a.id), ratio };
}

/** ⑧ 清单手改检测：当前 plugin.toml 与安装快照对照（纯文本差异即可，不解析语义） */
export function manifestDrift(manifestNow: string, manifestSnapshot: string): boolean {
  return manifestNow.trim() !== manifestSnapshot.trim();
}
