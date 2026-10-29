// 第八十二轮：配置迁移与多机同步——快照打包/恢复/对比，secret 脱敏导出。
// 可迁移面：settings/<id>.json + allow.json + timers.json + watch.json。
// 不进快照：audit/logs（本机流水，跨机无意义且可能敏感）、plugins/（有集市）、history。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { zipFiles, unzipFiles } from './distro.ts';
// HOME 惰性取值：paths.ts 的 HOME 在模块加载时固化 ZEROKIT_HOME，
// 同进程内切目录（测试/恢复到别的 HOME）会写错地方。这里每次调用现读。
const homeNow = () => process.env.ZEROKIT_HOME
  ? path.resolve(process.env.ZEROKIT_HOME)
  : path.join(os.homedir(), '.zerokit');
const settingsDirNow = () => path.join(homeNow(), 'settings');
import { listPlugins } from './registry.ts';
import { type Plugin } from './manifest.ts';

export const SNAPSHOT_VERSION = 1;
const SECRET_PLACEHOLDER = '__ZK_SNAPSHOT_SECRET_REMOVED__';

export interface SnapFile { rel: string; data: Buffer }

export interface SnapshotMeta {
  app: 'zerokit';
  snapshotVersion: number;
  createdAt: string;
  host: string;
  /** 脱敏导出的设置项数（提示用户哪些要重填） */
  secretsRemoved: number;
}

const HEADER = 'snapshot.json';
const DATA_FILES = ['allow.json', 'timers.json', 'watch.json'] as const;

/** 从已装插件的清单拿「插件 id → secret 设置名列表」——真源头是 plugin.toml，不是猜 */
function secretNamesByPlugin(): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const e of listPlugins()) {
    if (!e.plugin) continue;
    const p = e.plugin as Plugin;
    if (!p.settings?.length) continue;
    for (const s of p.settings) {
      if (s.secret) {
        if (!m.has(p.id)) m.set(p.id, new Set());
        m.get(p.id)!.add(s.name);
      }
    }
  }
  return m;
}

/** 收集可迁移文件；非 withSecrets 时把 secret 值换成占位符 */
function collectFiles(withSecrets: boolean): { files: SnapFile[]; secretsRemoved: number } {
  const files: SnapFile[] = [];
  let secretsRemoved = 0;
  const secrets = withSecrets ? new Map<string, Set<string>>() : secretNamesByPlugin();
  if (fs.existsSync(settingsDirNow())) {
    for (const f of fs.readdirSync(settingsDirNow()).sort()) {
      if (!f.endsWith('.json')) continue;
      const pluginId = f.replace(/\.json$/, '');
      const names = secrets.get(pluginId);
      let data = fs.readFileSync(path.join(settingsDirNow(), f));
      if (names && names.size > 0) {
        try {
          const obj = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
          let changed = false;
          for (const name of names) {
            if (typeof obj[name] === 'string' && obj[name] !== SECRET_PLACEHOLDER) {
              obj[name] = SECRET_PLACEHOLDER;
              secretsRemoved++;
              changed = true;
            }
          }
          if (changed) data = Buffer.from(JSON.stringify(obj, null, 2), 'utf8');
        } catch { /* 非 JSON 原样带（不会发生——写入侧保证 JSON，防御而已） */ }
      }
      files.push({ rel: `settings/${f}`, data });
    }
  }
  for (const rel of DATA_FILES) {
    const p = path.join(homeNow(), rel);
    if (fs.existsSync(p)) files.push({ rel, data: fs.readFileSync(p) });
  }
  return { files, secretsRemoved };
}

/** ①打包：.zksnap = zip（snapshot.json 头 + 数据文件），写到 outDir 返回绝对路径 */
export function makeSnapshot(outDir: string, opts: { withSecrets?: boolean } = {}): { ok: boolean; file?: string; meta?: SnapshotMeta; error?: string } {
  const { files, secretsRemoved } = collectFiles(opts.withSecrets === true);
  const meta: SnapshotMeta = {
    app: 'zerokit', snapshotVersion: SNAPSHOT_VERSION,
    createdAt: new Date().toISOString(), host: os.hostname(),
    secretsRemoved: opts.withSecrets ? 0 : secretsRemoved,
  };
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 17);
  const zip = zipFiles([
    { name: HEADER, data: Buffer.from(JSON.stringify(meta, null, 2)) },
    ...files.map((f) => ({ name: f.rel, data: f.data })),
  ]);
  const file = path.join(outDir, `zerokit-snapshot-${stamp}.zksnap`);
  fs.writeFileSync(file, zip);
  return { ok: true, file, meta };
}

export interface ParsedSnapshot { meta: SnapshotMeta; files: SnapFile[] }

/** 解析快照（list/restore/diff 共用）；坏文件返回 error 不抛 */
export function parseSnapshot(buf: Buffer): { ok: true; snap: ParsedSnapshot } | { ok: false; error: string } {
  let entries;
  try {
    entries = unzipFiles(buf);
  } catch {
    return { ok: false, error: '不是有效的快照文件（解不开 zip 容器）' };
  }
  const head = entries.find((e) => e.name === HEADER);
  if (!head) return { ok: false, error: '快照缺 snapshot.json 头——不是 zkit data snapshot 产出的文件' };
  let meta: SnapshotMeta;
  try {
    const m = JSON.parse(head.data.toString('utf8')) as Partial<SnapshotMeta>;
    if (m.app !== 'zerokit') return { ok: false, error: 'snapshot.json 头的 app 不是 zerokit' };
    meta = { app: 'zerokit', snapshotVersion: Number(m.snapshotVersion) || 0, createdAt: String(m.createdAt), host: String(m.host), secretsRemoved: Number(m.secretsRemoved) || 0 };
  } catch {
    return { ok: false, error: 'snapshot.json 头解析失败（文件可能被截断）' };
  }
  if (meta.snapshotVersion > SNAPSHOT_VERSION) {
    return { ok: false, error: `快照版本 ${meta.snapshotVersion} 比当前支持（${SNAPSHOT_VERSION}）新——请升级 zkit` };
  }
  return { ok: true, snap: { meta, files: entries.filter((e) => e.name !== HEADER).map((e) => ({ rel: e.name, data: e.data })) } };
}

export interface RestoreResult {
  ok: boolean;
  applied: string[];
  skipped: string[];
  secretsToRefill: number;
  error?: string;
}

/** ②恢复：默认跳过已存在同名文件；overwrite 才覆盖。路径钉死在 HOME 内（防穿越）。 */
export function restoreSnapshot(snap: ParsedSnapshot, opts: { overwrite?: boolean } = {}): RestoreResult {
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const f of snap.files) {
    if (f.rel.includes('..') || path.isAbsolute(f.rel)) continue;
    const dest = path.join(homeNow(), f.rel);
    const H = homeNow();
    if (!dest.startsWith(H + path.sep)) continue;
    if (fs.existsSync(dest) && !opts.overwrite) { skipped.push(f.rel); continue; }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.data);
    applied.push(f.rel);
  }
  return { ok: true, applied, skipped, secretsToRefill: snap.meta.secretsRemoved };
}

export interface DiffEntry { rel: string; kind: 'only-in-snapshot' | 'only-in-here' | 'changed' }

/** ⑥对比：快照 vs 当前目录（同一张可迁移清单） */
export function diffSnapshot(snap: ParsedSnapshot): DiffEntry[] {
  const out: DiffEntry[] = [];
  for (const f of snap.files) {
    const p = path.join(homeNow(), f.rel);
    if (!fs.existsSync(p)) { out.push({ rel: f.rel, kind: 'only-in-snapshot' }); continue; }
    if (!fs.readFileSync(p).equals(f.data)) out.push({ rel: f.rel, kind: 'changed' });
  }
  const snapRels = new Set(snap.files.map((f) => f.rel));
  const check = (rel: string) => {
    if (!snapRels.has(rel) && fs.existsSync(path.join(homeNow(), rel))) out.push({ rel, kind: 'only-in-here' });
  };
  if (fs.existsSync(settingsDirNow())) {
    for (const f of fs.readdirSync(settingsDirNow())) check(`settings/${f}`);
  }
  for (const rel of DATA_FILES) check(rel);
  return out;
}
