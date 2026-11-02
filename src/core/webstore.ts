// webstore：web 插件页面的 KV 存储（第一百二十一轮②）
// 每插件一个 JSON 文件（~/.zerokit/webstore/<id>.json），配额 64KB。
// sandbox iframe 里没有 localStorage——宿主代存是唯一出路；配额防失控。
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { HOME } from './paths.ts';

export const WEBSTORE_DIR: string = path.join(HOME, 'webstore');
export const WEBSTORE_QUOTA: number = 64 * 1024;

const KEY_RE = /^[\w.-]{1,64}$/;

function storeFile(pluginId: string): string {
  return path.join(WEBSTORE_DIR, `${pluginId}.json`);
}

function load(pluginId: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(storeFile(pluginId), 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

function save(pluginId: string, obj: Record<string, unknown>): void {
  fs.mkdirSync(WEBSTORE_DIR, { recursive: true });
  const file = storeFile(pluginId);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
  fs.renameSync(tmp, file);
}

/** 校验 key：防路径穿越与垃圾键。合法返回 null，非法返回错误消息 */
export function checkKey(key: unknown): string | null {
  if (typeof key !== 'string') return 'key 必须是字符串';
  if (!KEY_RE.test(key)) return 'key 只允许字母数字._- 且 1-64 字符';
  return null;
}

export type StoreResult = { ok: true; value?: unknown; keys?: string[]; bytes?: number } | { ok: false; error: string };

export function storeGet(pluginId: string, key: string): StoreResult {
  const err = checkKey(key);
  if (err) return { ok: false, error: err };
  const v = load(pluginId)[key];
  return { ok: true, value: v === undefined ? null : v };
}

export function storeSet(pluginId: string, key: string, value: unknown): StoreResult {
  const err = checkKey(key);
  if (err) return { ok: false, error: err };
  const obj = load(pluginId);
  obj[key] = value === undefined ? null : value;
  const bytes = Buffer.byteLength(JSON.stringify(obj), 'utf8');
  if (bytes > WEBSTORE_QUOTA) {
    return { ok: false, error: `超出存储配额（${WEBSTORE_QUOTA} 字节，当前需要 ${bytes}）` };
  }
  save(pluginId, obj);
  return { ok: true, bytes };
}

export function storeRemove(pluginId: string, key: string): StoreResult {
  const err = checkKey(key);
  if (err) return { ok: false, error: err };
  const obj = load(pluginId);
  const had = key in obj;
  delete obj[key];
  save(pluginId, obj);
  return { ok: true, value: had };
}

export function storeKeys(pluginId: string): StoreResult {
  const obj = load(pluginId);
  return { ok: true, keys: Object.keys(obj).sort(), bytes: Buffer.byteLength(JSON.stringify(obj), 'utf8') };
}
