/**
 * 插件生命周期与健康（第一百二十五轮）。
 *
 * 单插件健康卡、失联插件隔离、事件审计 —— 全部是纯读取/显式写入，
 * 与 doctor（全局一把尺）互补：这里的每个函数只回答一个插件的问题。
 */
import fs from 'node:fs';
import path from 'node:path';
import { type AuditRecord } from './runner.ts';

// install history 的真实落点是 logs/installed-history.json（install115.ts historyFile）——
// 事件审计复用同一存储，读侧统一
const HISTORY = path.join('logs', 'installed-history.json');

/** 失联判定：目录还在但 plugin.toml 没了（源被删/被移动），或目录整个消失但来源记录还在。 */
export interface LostPlugin { dir: string; id: string; sourceText: string; reason: string }

/** 从来源记录里恢复插件 id（market 安装时 .zerokit-source.json 落在插件目录里）。 */
function sourceOf(dir: string): string {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dir, '.zerokit-source.json'), 'utf8')) as { market?: string; url?: string; type?: string };
    if (s.type === 'market' && s.market) return `集市 ${s.market}${s.url ? `（${s.url}）` : ''}`;
    if (s.url) return String(s.url);
    return s.type ?? '未知来源';
  } catch { return '来源记录缺失'; }
}

/** 找失联插件：plugins/ 下有无 plugin.toml 的目录（装到一半被杀/源被拔）。 */
export function findLostPlugins(pluginsDir: string): LostPlugin[] {
  const out: LostPlugin[] = [];
  if (!fs.existsSync(pluginsDir)) return out;
  for (const name of fs.readdirSync(pluginsDir).sort()) {
    if (name.startsWith('.') || name.startsWith('_')) continue;
    const dir = path.join(pluginsDir, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const hasToml = fs.existsSync(path.join(dir, 'plugin.toml'));
    // uTools 插件没有 plugin.toml 但有 plugin.json —— 不算失联
    const hasJson = fs.existsSync(path.join(dir, 'plugin.json'));
    if (hasToml || hasJson) continue;
    out.push({ dir, id: name, sourceText: sourceOf(dir), reason: '目录里没有 plugin.toml/plugin.json' });
  }
  return out;
}

export type HealthLevel = 'good' | 'warn' | 'bad';

/** 单插件健康卡：加载态 + 依赖 + 动作风险分布 + 最近执行成功率（审计）。 */
export interface PluginHealthCard {
  id: string;
  level: HealthLevel;
  loadErrors: string[];
  loadWarnings: string[];
  riskMix: { read: number; mutate: number; destructive: number };
  depIssues: string[];
  /** 最近 50 次执行：{ok, total, lastError?} —— 没跑过是 null 不是 100% */
  runs: { ok: number; total: number; lastError?: string } | null;
}

export function pluginHealthCard(
  entry: { plugin?: { id: string; actions: { risk: string }[]; pluginDeps?: string[] }; errors: string[]; warnings: string[] },
  installedIds: string[],
  audit: AuditRecord[],
): PluginHealthCard {
  const p = entry.plugin;
  const loadErrors = [...entry.errors];
  const loadWarnings = [...entry.warnings];
  const riskMix = { read: 0, mutate: 0, destructive: 0 };
  if (p) for (const a of p.actions) {
    if (a.risk === 'mutate') riskMix.mutate++;
    else if (a.risk === 'destructive') riskMix.destructive++;
    else riskMix.read++;
  }
  const depIssues = (p?.pluginDeps ?? []).filter((d) => !installedIds.includes(d)).map((d) => `依赖 ${d} 未安装`);
  // 该插件最近 50 次执行
  const mine = audit.filter((r) => r.plugin === p?.id).slice(0, 50);
  let runs: PluginHealthCard['runs'] = null;
  if (mine.length > 0) {
    const ok = mine.filter((r) => r.decision === 'allow' && !r.error).length;
    const lastFail = mine.find((r) => r.decision === 'deny' || Boolean(r.error));
    runs = { ok, total: mine.length, ...(lastFail?.error ? { lastError: String(lastFail.error).slice(0, 120) } : {}) };
  }
  let level: HealthLevel = 'good';
  if (loadErrors.length > 0 || !p) level = 'bad';
  else if (loadWarnings.length > 0 || depIssues.length > 0 || (runs && runs.ok / runs.total < 0.6)) level = 'warn';
  return { id: p?.id ?? '?', level, loadErrors, loadWarnings, riskMix, depIssues, runs };
}

/** --purge 清点：这个插件在数据目录里留下了哪些持久痕迹。 */
export function purgePreview(home: string, pluginId: string): { settings?: string; settingsFiles: string[] } {
  const settingsDir = path.join(home, 'settings');
  const settingsFiles: string[] = [];
  if (fs.existsSync(settingsDir)) {
    for (const f of fs.readdirSync(settingsDir)) {
      // settings/<id>.json（第三轮的约定）或 settings/<id>.*.json（secret 分件）
      if (f === `${pluginId}.json` || f.startsWith(`${pluginId}.`)) settingsFiles.push(path.join(settingsDir, f));
    }
  }
  return { settings: settingsFiles.length > 0 ? `${settingsFiles.length} 个配置文件` : undefined, settingsFiles };
}

/** 审计里记插件级生命周期事件（install/update/remove/lost/health-degraded）。 */
export function appendPluginEvent(home: string, ev: { ts: string; plugin: string; kind: string; detail?: string }): void {
  const file = path.join(home, HISTORY);
  let list: unknown[] = [];
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown[]; } catch { /* 首条 */ }
  list.push(ev);
  while (list.length > 200) list.shift();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
}
