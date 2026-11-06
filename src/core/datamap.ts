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

// ---- 第一百六十轮：数据健康与存储体检 ----

export interface DirUsage {
  /** 相对 HOME 的名字：plugins / logs / settings / data / snapshots / 其它 */
  name: string;
  bytes: number;
  files: number;
}

function dirUsage(p: string): { bytes: number; files: number } {
  let bytes = 0, files = 0;
  let stack: string[] = [];
  try { stack = fs.readdirSync(p).map((f) => path.join(p, f)); } catch { return { bytes: 0, files: 0 }; }
  while (stack.length) {
    const cur = stack.pop() as string;
    let st: fs.Stats;
    try { st = fs.lstatSync(cur); } catch { continue; }
    if (st.isDirectory()) { try { stack.push(...fs.readdirSync(cur).map((f) => path.join(cur, f))); } catch { /* 权限 */ } }
    else { bytes += st.size; files++; }
  }
  return { bytes, files };
}

/** 数据目录分项容量：plugins/logs/settings/data/snapshots 与顶层散文件（config.json 等） */
export function usageByArea(): { areas: DirUsage[]; looseBytes: number; totalBytes: number } {
  const h = HOME;
  const known = ['plugins', 'logs', 'settings', 'data', 'snapshots'];
  const areas: DirUsage[] = [];
  let looseBytes = 0;
  let seenDirs = new Set<string>();
  try {
    for (const name of fs.readdirSync(h)) {
      const p = path.join(h, name);
      let st: fs.Stats;
      try { st = fs.lstatSync(p); } catch { continue; }
      if (st.isDirectory()) {
        if (!known.includes(name)) continue; // 非已知目录归「其它」不列（避免噪音）
        seenDirs.add(name);
        const u = dirUsage(p);
        areas.push({ name, bytes: u.bytes, files: u.files });
      } else {
        looseBytes += st.size;
      }
    }
  } catch { /* HOME 不存在 */ }
  areas.sort((a, b) => b.bytes - a.bytes);
  const totalBytes = areas.reduce((s, a) => s + a.bytes, 0) + looseBytes;
  return { areas, looseBytes, totalBytes };
}

export interface JunkItem {
  kind: 'tmp-dir' | 'bak-file' | 'orphan-plugin' | 'old-snapshot';
  path: string;
  /** 人话说明 */
  what: string;
  bytes: number;
}

/** 垃圾识别：.tmp-* 残留目录、.bak 备份文件、孤儿插件目录（无清单且非 _vendor）、超保留数快照 */
export function findJunk(keepSnapshots = 10): JunkItem[] {
  const h = HOME;
  const out: JunkItem[] = [];
  // 插件目录里的垃圾
  const pluginsDir = path.join(h, 'plugins');
  try {
    for (const name of fs.readdirSync(pluginsDir)) {
      const p = path.join(pluginsDir, name);
      let st: fs.Stats;
      try { st = fs.lstatSync(p); } catch { continue; }
      if (name.startsWith('.tmp-') && st.isDirectory()) {
        const u = dirUsage(p);
        out.push({ kind: 'tmp-dir', path: p, what: '安装中断的临时目录', bytes: u.bytes });
        continue;
      }
      if (name.startsWith('_')) continue; // 共享代码层
      if (st.isDirectory()) {
        const hasManifest = fs.existsSync(path.join(p, 'plugin.toml')) || fs.existsSync(path.join(p, 'plugin.json'));
        // 失联目录（有来源记录无清单）不算孤儿垃圾——有自己的面（doctor-lost）
        const hasSource = fs.existsSync(path.join(p, '.zerokit-source.json'));
        if (!hasManifest && !hasSource) {
          const u = dirUsage(p);
          out.push({ kind: 'orphan-plugin', path: p, what: '无清单也无来源记录的孤儿目录', bytes: u.bytes });
        }
      }
    }
  } catch { /* 无 plugins 目录 */ }
  // logs 下的 .bak（audit-<日期>.bak 是 --keep 的刻意备份——只在数量多时提示，不算自动删项）
  const bakFiles: JunkItem[] = [];
  const logDir = path.join(h, 'logs');
  try {
    for (const f of fs.readdirSync(logDir)) {
      if (f.endsWith('.bak')) {
        const p = path.join(logDir, f);
        bakFiles.push({ kind: 'bak-file', path: p, what: '审计保留备份（logs --keep 产生）', bytes: fileBytes(p) });
      }
    } bakFiles.sort((a, b) => a.bytes - b.bytes);
    out.push(...bakFiles);
  } catch { /* 无 logs */ }
  // 快照超保留数：最旧的算垃圾
  const snapDir = path.join(h, 'snapshots');
  try {
    const snaps = fs.readdirSync(snapDir)
      .map((f) => ({ f, p: path.join(snapDir, f as string), mtime: fs.statSync(path.join(snapDir, f as string)).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime);
    for (let i = 0; i < Math.max(0, snaps.length - keepSnapshots); i++) {
      const sn = snaps[i];
      if (!sn) continue;
      out.push({ kind: 'old-snapshot', path: sn.p, what: `快照（保留最近 ${keepSnapshots} 份，这份最旧）`, bytes: fileBytes(sn.p) });
    }
  } catch { /* 无 snapshots */ }
  return out;
}

/** 真删垃圾项；返回删掉的路径与释放字节数。bak-file 不自动删（用户刻意留的备份）——只列。 */
export function cleanJunk(items: JunkItem[]): { removed: string[]; freedBytes: number } {
  const removed: string[] = [];
  let freedBytes = 0;
  for (const it of items) {
    if (it.kind === 'bak-file') continue; // 刻意保留的备份不自动删
    try {
      fs.rmSync(it.path, { recursive: true, force: true });
      removed.push(it.path);
      freedBytes += it.bytes;
    } catch { /* 删不掉的跳过（占用中？），幂等 */ }
  }
  return { removed, freedBytes };
}
