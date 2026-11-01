// install115.ts：第一百一十五轮——插件安装/卸载/升级体验纯函数层
import path from 'node:path';
import fs from 'node:fs';
import type { Plugin } from './manifest.ts';
import { depStates } from './deps.ts';

/** ① 安装成功后的「你刚装了什么」摘要：动作按风险分档，人一眼看出轻重 */
export interface InstallSummary {
  id: string;
  name: string;
  version: string;
  counts: { read: number; mutate: number; destructive: number };
  risky: string[]; // 非 read 动作 id 列表
}
export function installSummary(p: Plugin): InstallSummary {
  const counts = { read: 0, mutate: 0, destructive: 0 };
  const risky: string[] = [];
  for (const a of p.actions) {
    counts[a.risk] = (counts[a.risk] ?? 0) + 1;
    if (a.risk !== 'read') risky.push(a.id);
  }
  return { id: p.id, name: p.name, version: p.version, counts, risky };
}

/** ② 安装前置检查聚合：把分散在三处的检查合成一张表（供 CLI/界面共用） */
export interface PrecheckItem {
  kind: 'dep' | 'require' | 'platform';
  label: string;
  ok: boolean;
  hint?: string;
}
export function prechecks(p: Plugin, requires: { name: string; ok: boolean; hint?: string }[]): PrecheckItem[] {
  const items: PrecheckItem[] = [];
  for (const d of depStates(p)) {
    items.push({ kind: 'dep', label: `插件依赖 ${d.id}`, ok: d.installed, hint: d.installed ? undefined : 'zkit plugin install ' + d.id });
  }
  for (const r of requires) {
    items.push({ kind: 'require', label: r.name, ok: r.ok, hint: r.ok ? undefined : r.hint });
  }
  return items;
}

/** ③ 卸载预览：反向依赖 + 将失去的动作数 */
export interface UninstallPreview {
  dependents: string[];
  losing: number; // 动作数
  dataKept: true; // 数据目录不受影响（固定语义，写死防止文案漂移）
}
export function uninstallPreview(p: Plugin, dependentIds: string[]): UninstallPreview {
  return { dependents: dependentIds, losing: p.actions.length, dataKept: true };
}

/** ④ 升级 diff 摘要：动作/参数两维（参数变化 = 同名动作的参数集增删） */
export interface UpgradeDiff {
  added: string[];
  removed: string[];
  paramChanged: { action: string; addedParams: string[]; removedParams: string[] }[];
}
export function upgradeDiff(cur: Plugin, next: Plugin): UpgradeDiff {
  const curIds = new Set(cur.actions.map((a) => a.id));
  const nextIds = new Set(next.actions.map((a) => a.id));
  const added = [...nextIds].filter((x) => !curIds.has(x));
  const removed = [...curIds].filter((x) => !nextIds.has(x));
  const paramChanged: UpgradeDiff['paramChanged'] = [];
  for (const id of [...nextIds].filter((x) => curIds.has(x))) {
    const a1 = cur.actions.find((a) => a.id === id)!;
    const a2 = next.actions.find((a) => a.id === id)!;
    const p1 = new Set(a1.params.map((x) => x.name));
    const p2 = new Set(a2.params.map((x) => x.name));
    const pa = [...p2].filter((x) => !p1.has(x));
    const pr = [...p1].filter((x) => !p2.has(x));
    if (pa.length + pr.length > 0) paramChanged.push({ action: id, addedParams: pa, removedParams: pr });
  }
  return { added, removed, paramChanged };
}

/** ⑤ 市场卡片版本差 */
export function versionGap(current: string | undefined, latest: string | undefined): '' | 'new' | 'upgradable' {
  if (!latest) return '';
  if (!current) return 'new';
  return current === latest ? '' : 'upgradable';
}

/** ⑥ 安装历史：installed-history.json（独立于 installed/<id>.json 的整体流水，卸载也留痕） */
export interface InstallEvent { ts: string; plugin: string; kind: 'install' | 'update' | 'remove'; version?: string; detail?: string }
export function historyFile(home: string): string { return path.join(home, 'logs', 'installed-history.json'); }
export function readInstallHistory(home: string): InstallEvent[] {
  try {
    const raw = JSON.parse(fs.readFileSync(historyFile(home), 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}
export function appendInstallHistory(home: string, ev: InstallEvent, cap = 200): InstallEvent[] {
  const list = [...readInstallHistory(home), ev];
  const trimmed = list.length > cap ? list.slice(list.length - cap) : list;
  try {
    fs.mkdirSync(path.dirname(historyFile(home)), { recursive: true });
    fs.writeFileSync(historyFile(home), JSON.stringify(trimmed, null, 2));
  } catch { /* 流水失败不影响主流程 */ }
  return trimmed;
}
