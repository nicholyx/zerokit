// 第六十五轮：分享导出（服务端侧）。
// 纯逻辑实现在 web/extras.js（UI 与 CLI 共用一份语义）；TS 侧不能直接
// import .js（allowJs 关着），这里签名重声明 + 运行时转发。
import { createRequire } from 'node:module';

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
