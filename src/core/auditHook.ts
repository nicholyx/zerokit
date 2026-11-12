/**
 * 第二百七十五轮：审计外部投递（webhook）——272 对账「S 先清」第三条。
 * config.toml [audit] webhook = "URL" 声明后，每条 audit() 异步 POST 出去：
 * fire-and-forget（2s 超时，失败不抛不重试、不阻断主流程），
 * 失败进内存环形缓冲（最近 20 条，zkit audit failures 查看）。
 * 无配置 = 零行为变化（默认关）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { HOME, LOG_DIR } from './paths.ts';

export interface AuditDeliveryFailure {
  ts: string;
  url: string;
  status: number | string;
  message: string;
}

/** 环形缓冲（模块级，进程内可查） */
const failures: AuditDeliveryFailure[] = [];
const MAX_FAILURES = 20;

/** 读取 [audit] webhook 配置（config.toml）——无/坏配置返回 null（投递关） */
export function auditWebhookConfig(): { url: string; headers?: Record<string, string> } | null {
  interface ConfigAudit { webhook?: unknown; headers?: unknown }
  interface ConfigShape { audit?: ConfigAudit }
  try {
    // config.toml 是 TOML——内核零依赖，用已有 toml 解析器
    // 简化：只在文件存在且能整文件过 config 解析时读（坏配置静默关）
    const raw = fs.readFileSync(path.join(HOME, 'config.toml'), 'utf8');
    // 复用清单同款 TOML 解析（manifest.ts 的 parseToml 不导出——本地最小解析 [audit] 节）
    const section = extractTomlSection(raw, 'audit');
    if (!section) return null;
    const webhook = tomlStringValue(section, 'webhook');
    if (!webhook || !/^https?:\/\//.test(webhook)) return null;
    const headers: Record<string, string> = {};
    const headersRaw = extractTomlInlineTable(section, 'headers');
    if (headersRaw) {
      for (const m of headersRaw.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) {
        headers[m[1] as string] = m[2] as string;
      }
    }
    return { url: webhook, headers: Object.keys(headers).length > 0 ? headers : undefined };
  } catch {
    return null;
  }
}

function extractTomlSection(toml: string, name: string): string | null {
  const re = new RegExp(`^\\[${name}\\]\\s*\\n([\\s\\S]*?)(?=^\\[|$(?![\\s\\S]))`, 'm');
  const m = re.exec(toml);
  return m?.[1] ?? null;
}

function tomlStringValue(section: string, key: string): string | undefined {
  const m = new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm').exec(section);
  return m?.[1];
}

function extractTomlInlineTable(section: string, key: string): string | null {
  const m = new RegExp(`^${key}\\s*=\\s*\\{([\\s\\S]*?)\\}`, 'm').exec(section);
  return m?.[1] ?? null;
}

const pending = new Set<Promise<unknown>>();

/** 投递一条审计（fire-and-forget；失败进环形缓冲）。pending 记账供 drain。 */
export function deliverAudit(record: unknown): void {
  const cfg = auditWebhookConfig();
  if (!cfg) return;
  const body = JSON.stringify(record);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  const p = fetch(cfg.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cfg.headers ?? {}) },
    body,
    signal: controller.signal,
  }).then((res) => {
    clearTimeout(timer);
    if (!res.ok) noteFailure(cfg.url, res.status, `HTTP ${res.status}`);
  }).catch((err: unknown) => {
    clearTimeout(timer);
    noteFailure(cfg.url, 'network', err instanceof Error ? err.message : String(err));
  }).finally(() => { pending.delete(p); });
  pending.add(p);
}

/** CLI 短命进程退出前排空在途投递（上限 2.5s——fire-and-forget 的退出兜底） */
export async function auditDrain(): Promise<void> {
  if (pending.size === 0) return;
  await Promise.race([Promise.allSettled([...pending]), new Promise((r) => setTimeout(r, 2500))]);
}

function noteFailure(url: string, status: number | string, message: string): void {
  failures.push({ ts: new Date().toISOString(), url, status, message });
  if (failures.length > MAX_FAILURES) failures.splice(0, failures.length - MAX_FAILURES);
}

/** 最近失败（环形缓冲快照） */
export function auditDeliveryFailures(): AuditDeliveryFailure[] {
  return [...failures];
}
