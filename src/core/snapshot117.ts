// snapshot117.ts：第一百一十七轮——装时快照统一写路径
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const SNAPSHOT_FILE = '.zk-integrity.json';

/** 快照条目：安装时刻录的目录文件指纹（sha256）。verify/doctor 靠它复验供应链。 */
export interface InstallSnapshot {
  at: string;
  zerokit: string;
  files: Record<string, string>;
}

const SKIP = new Set([SNAPSHOT_FILE, '.zerokit-source.json', '.DS_Store']);

/** 目录 → 文件指纹表（dev 链接目录不快照——源目录才是本体；node_modules 不进快照） */
export function dirFingerprints(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (rel: string) => {
    const abs = path.join(dir, rel);
    let stat: fs.Stats;
    try { stat = fs.statSync(abs); } catch { return; }
    if (stat.isSymbolicLink()) return; // 链接不追
    if (stat.isDirectory()) {
      if (rel === 'node_modules') return;
      for (const c of fs.readdirSync(abs)) walk(rel ? path.join(rel, c) : c);
      return;
    }
    if (SKIP.has(rel.split(path.sep).join('/'))) return;
    files[rel.split(path.sep).join('/')] = createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  };
  walk('');
  return files;
}

/** 写装时快照（安装/升级成功后调用；失败不影响安装结果） */
export function writeInstallSnapshot(pluginsDir: string, id: string, zerokitVersion: string): void {
  try {
    const dir = path.join(pluginsDir, id);
    const snap: InstallSnapshot = { at: new Date().toISOString(), zerokit: zerokitVersion, files: dirFingerprints(dir) };
    fs.writeFileSync(path.join(dir, SNAPSHOT_FILE), JSON.stringify(snap, null, 2));
  } catch { /* 快照失败不影响安装 */ }
}
