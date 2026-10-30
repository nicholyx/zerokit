// 第八十八轮：数据与隐私面——清单/分类清除/分类导出/访问审计
// 纯文件层，无新依赖。路径全部惰性取 HOME（第八十二轮教训）。
import fs from 'node:fs';
import path from 'node:path';
import { readAudit } from './ops.ts';
import { HOME } from './paths.ts';
import { audit } from './runner.ts';
import type { Caller } from './runner.ts';

export type DataScope = 'runs' | 'settings' | 'favorites' | 'timers' | 'cache' | 'audit' | 'all';

export interface DataItem {
  scope: DataScope;
  /** 人话用途 */
  what: string;
  file?: string;
  dir?: string;
  bytes: number;
  /** 条数（文件里记录数；目录为 -1） */
  count: number;
}

export interface DataInventory {
  items: DataItem[];
  totalBytes: number;
}

function fileBytes(p: string): number {
  try { return fs.statSync(p).size; } catch { return 0; }
}

/** 历史条数（JSON 数组；坏文件当 0——清点不该炸） */
function historyCount(p: string): number {
  try { const v = JSON.parse(fs.readFileSync(p, 'utf8')); return Array.isArray(v) ? v.length : 1; }
  catch { return 0; }
}

/** 每类数据一个条目；条目存在才列（没建过的类不出现在清单里） */
export function dataInventory(): DataInventory {
  const h = HOME;
  const items: DataItem[] = [];
  const add = (it: DataItem) => { if (it.bytes > 0 || it.count > 0) items.push(it); };

  const hist = path.join(h, 'history.json');
  add({ scope: 'runs', what: '执行历史（命令、耗时、结果摘要）', file: hist, bytes: fileBytes(hist), count: historyCount(hist) });

  const setDir = path.join(h, 'settings');
  if (fs.existsSync(setDir)) {
    const n = fs.readdirSync(setDir).filter((f) => f.endsWith('.json')).length;
    items.push({ scope: 'settings', what: '插件设置项（含 secret，已加密/掩码存储）', dir: setDir, bytes: fs.readdirSync(setDir).reduce((s, f) => s + fileBytes(path.join(setDir, f)), 0), count: n });
  }

  const tc = path.join(h, 'toolcache.json');
  add({ scope: 'cache', what: '工具探测缓存（python 路径等）', file: tc, bytes: fileBytes(tc), count: fileBytes(tc) > 0 ? 1 : 0 });

  const logDir = path.join(h, 'logs');
  if (fs.existsSync(logDir)) {
    const auditP = path.join(logDir, 'audit.log');
    items.push({ scope: 'audit', what: '审计日志（谁在什么时候跑了什么）', file: auditP, bytes: fileBytes(auditP), count: readAudit().length });
  }

  const timers = path.join(h, 'timers.json');
  add({ scope: 'timers', what: '定时任务（间隔、目标动作）', file: timers, bytes: fileBytes(timers), count: historyCount(timers) });

  return { items, totalBytes: items.reduce((s, i) => s + i.bytes, 0) };
}

export function isDataScope(s: string): s is DataScope {
  return ['runs', 'settings', 'favorites', 'timers', 'cache', 'audit', 'all'].includes(s);
}

/** 分类清除的预览（不动手版）：返回将被删除的文件/目录与条数。 */
export function wipePreview(scope: DataScope): DataItem[] {
  const inv = dataInventory();
  // favorites 是浏览器 localStorage（UI 侧），CLI 只报数量引导去 UI 清
  if (scope === 'favorites') return inv.items.filter((i) => i.scope === 'favorites');
  if (scope === 'all') return inv.items;
  return inv.items.filter((i) => i.scope === scope);
}

/** 执行清除。删 settings 目录内容但保留目录本身（加载器约定目录在）。 */
export function wipeData(scope: DataScope): { removed: string[]; bytes: number } {
  const targets = wipePreview(scope);
  const removed: string[] = [];
  let bytes = 0;
  for (const t of targets) {
    if (t.dir) {
      for (const f of fs.readdirSync(t.dir)) {
        const fp = path.join(t.dir, f);
        bytes += fileBytes(fp);
        fs.rmSync(fp, { force: true });
        removed.push(fp);
      }
    } else if (t.file) {
      bytes += t.bytes;
      fs.rmSync(t.file, { force: true });
      removed.push(t.file);
    }
  }
  return { removed, bytes };
}

/**
 * 数据访问审计事件（data:read / data:write）。
 * 复用执行审计管道（audit.log 同一行 JSON），plugin/action 字段借位表达事件名——
 * reader 侧用 plugin==='__data__' 识别数据事件。
 */
export function auditDataEvent(kind: 'data:read' | 'data:write', caller: Caller, detail: string): void {
  audit({
    ts: new Date().toISOString(),
    plugin: '__data__',
    action: kind,
    tool: 'zkit-data',
    risk: 'mutate',
    caller,
    decision: 'allow',
    reason: detail,
  });
}

/** 数据面统计：条数 + 最老记录时间。 */
export function dataStats(): {
  runs: number; settings: number; timers: number; auditBytes: number; oldestRunTs?: number;
} {
  const inv = dataInventory();
  const by = (s: DataScope) => inv.items.find((i) => i.scope === s);
  let oldestRunTs: number | undefined;
  try {
    const h = JSON.parse(fs.readFileSync(path.join(HOME, 'history.json'), 'utf8'));
    if (Array.isArray(h) && h.length > 0) oldestRunTs = h[0]?.ts;
  } catch { /* 空 */ }
  return {
    runs: by('runs')?.count ?? 0,
    settings: by('settings')?.count ?? 0,
    timers: by('timers')?.count ?? 0,
    auditBytes: by('audit')?.bytes ?? 0,
    oldestRunTs,
  };
}
