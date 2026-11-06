// 第六十五轮：分享导出（服务端侧）。
// 纯逻辑实现在 web/extras.js（UI 与 CLI 共用一份语义）；TS 侧不能直接
// import .js（allowJs 关着），这里签名重声明 + 运行时转发。
import { createRequire } from 'node:module';
import { HOME } from './paths.ts';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const extras = require('../../web/extras.js') as Record<string, (...a: unknown[]) => unknown>;
const fn = (name: string) => extras[name] as (...a: unknown[]) => string;

export interface ShareMeta {
  plugin?: string;
  action?: string;
  at?: number;
  ms?: number;
  ok?: boolean;
  params?: Record<string, unknown>;
}

export function shareMetaHeader(meta: ShareMeta): string {
  return fn('shareMetaHeader')(meta) as string;
}
export function toShareMarkdown(result: unknown, meta: ShareMeta, opts?: { full?: boolean }): string {
  return fn('toShareMarkdown')(result, meta, opts) as string;
}
export function toShareHtml(result: unknown, meta: ShareMeta, opts?: { full?: boolean }): string {
  return fn('toShareHtml')(result, meta, opts) as string;
}

// ==================== 第一百六十八轮：分享包（.zshare）与重放 ====================
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface SharePack {
  app: 'zerokit';
  shareVersion: 1;
  createdAt: string;
  action: string;            // 插件.动作
  risk: 'read' | 'mutate' | 'destructive';
  argv: string[];            // 重放命令行（zkit run ... 形态）
  params?: Record<string, string>;
  result?: unknown;          // 只读动作才带
  env: { os: string; node: string; appVersion: string };
  note?: string;
}

export const SHARE_EXT = '.zshare';

/** 把结果+上下文打成分享包对象 */
export function buildSharePack(opts: {
  action: string; risk: string; argv: string[];
  params?: Record<string, string>; result?: unknown; note?: string;
  appVersion: string;
}): SharePack {
  return {
    app: 'zerokit', shareVersion: 1, createdAt: new Date().toISOString(),
    action: opts.action,
    risk: (['read', 'mutate', 'destructive'].includes(opts.risk) ? opts.risk : 'read') as SharePack['risk'],
    argv: opts.argv, params: opts.params, result: opts.result,
    env: { os: `${os.platform()} ${os.release()}`, node: process.version, appVersion: opts.appVersion },
    note: opts.note,
  };
}

/** 校验分享包：伪造/缺字段/版本不符都拒绝并说人话 */
export function validateSharePack(raw: unknown): { ok: true; pack: SharePack } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: '分享包不是 JSON 对象' };
  const p = raw as Record<string, unknown>;
  if (p.app !== 'zerokit') return { ok: false, error: '这不是 zerokit 的分享包（app 字段不符）' };
  if (p.shareVersion !== 1) return { ok: false, error: `分享包版本 ${String(p.shareVersion)} 不认识——本机只认 1，可能来自更新的 zerokit` };
  for (const k of ['createdAt', 'action', 'risk', 'argv', 'env'] as const) {
    if (!(k in p)) return { ok: false, error: `分享包缺字段 ${k}——文件可能被截断` };
  }
  if (!Array.isArray(p.argv) || !p.argv.length) return { ok: false, error: '分享包的 argv 不是非空数组' };
  if (!['read', 'mutate', 'destructive'].includes(String(p.risk))) return { ok: false, error: `风险等级 ${String(p.risk)} 不认识` };
  return { ok: true, pack: raw as SharePack };
}

/** 重放判定：destructive 拒绝 */
export function replayPolicy(pack: SharePack): { allowed: boolean; reason?: string } {
  if (pack.risk === 'destructive') {
    return { allowed: false, reason: `分享包的动作是 destructive（${pack.action}）——重放会有不可逆副作用，拒绝。需要的话看分享包里的结果，或手工确认后自己跑` };
  }
  return { allowed: true };
}

/** 分享包指纹：SHA-256 前 16 hex（每 4 位一块），用于人工比对身份 */
export async function shareFingerprint(pack: SharePack): Promise<string> {
  const { createHash } = await import('node:crypto');
  const h = createHash('sha256').update(JSON.stringify(pack)).digest('hex').slice(0, 16);
  return (h.match(/.{4}/g) ?? []).join(' ');
}

/** 指纹的终端块状展示（█/·）——16 hex → 64 bit 两行 */
export function fingerprintBlocks(fp: string): string {
  const bits = fp.replace(/ /g, '').split('').map((c) => parseInt(c, 16).toString(2).padStart(4, '0')).join('');
  const rows: string[] = [];
  for (let i = 0; i < bits.length; i += 32) rows.push(bits.slice(i, i + 32));
  return rows.map((r) => r.replace(/(.{4})/g, '$1 ').replace(/1/g, '█').replace(/0/g, '·')).join('\n');
}

/** 写分享包到文件（用户指定路径或 ~/.zerokit/shares/） */
export function writeSharePack(pack: SharePack, outPath?: string): string {
  const dir = path.join(HOME, 'shares');
  fs.mkdirSync(dir, { recursive: true });
  const defaultName = `share-${pack.action.replace(/[^\w.-]/g, '_')}-${pack.createdAt.replace(/[:T]/g, '-').slice(0, 17)}${SHARE_EXT}`;
  const target = outPath ?? path.join(dir, defaultName);
  fs.writeFileSync(target, JSON.stringify(pack, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  return target;
}

/** 读分享包文件并校验 */
export function readSharePack(file: string): { ok: true; pack: SharePack } | { ok: false; error: string } {
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { ok: false, error: `读不了 ${file}——文件不存在或没权限` }; }
  try { return validateSharePack(JSON.parse(text)); }
  catch { return { ok: false, error: '分享包不是合法 JSON——文件可能损坏或传错了个普通文件' }; }
}
