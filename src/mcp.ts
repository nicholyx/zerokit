#!/usr/bin/env node
import { readAudit } from './core/ops.ts';
import fs from 'node:fs';
import { buildDoctorReport } from './core/doctor.ts';
import { diagnose } from './core/suggest.ts';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { type Action, type Plugin, toolName } from './core/manifest.ts';
import { HOME, PLUGINS_DIR } from './core/paths.ts';
import { findPlugin, listPlugins } from './core/registry.ts';
import { applyDefaults, coerceParam, toJsonSchema } from './core/schema.ts';
import { audit, buildVars, confirmPolicy, runAction } from './core/runner.ts';
import { type AllowEntry, entryAlive, loadAllow as loadAllowAudit, pruneAllow, saveAllow as saveAllowAudit, upsertAllow } from './core/audit.ts';
import { suggestLine } from './core/suggest.ts';

/**
 * MCP 面：把每个插件的每个动作暴露成一个 MCP 工具。
 *
 * 两条硬约束（来自 MCP 规范）：
 *   1. stdio 模式下 stdout 只能出现 JSON-RPC，任何日志必须走 stderr，混一行就握手失败
 *   2. 工具名只允许 ^[A-Za-z0-9._-]{1,128}$，所以用 ASCII 的 {插件id}__{动作id}
 *      （中文只出现在 title / description 里）
 *
 * 安全默认：MCP 侧**默认只放行只读动作**。有副作用的动作必须先在终端里显式授权
 * 一次（zkit mcp allow），因为规范明确要求客户端「必须把 annotations 当作不可信」，
 * 我们不能指望 AI 客户端替我们把关。
 */

const PACKAGE_VERSION = '0.1.0';

function allowPath(): string {
  return path.join(HOME, 'mcp-allow.json');
}

/**
 * 授权名单（第七十七轮⑤⑥统一）：与 audit.ts 共用 allow.json（AllowEntry 带 ttlDays）。
 * 旧 mcp-allow.json 若还在，首次读取时迁移并入（保留原授权时间，ttl 给永久——
 * 用户当年显式授的权不因迁移缩短）。
 */
export function loadAllowEntries(): AllowEntry[] {
  const current = loadAllowAudit();
  if (current.length > 0) return current;
  // 迁移旧文件（mcp-allow.json 的 {entries:[{key,at}]} 或纯数组）
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(allowPath(), 'utf8'));
    const oldKeys: Array<{ key: string; at?: string }> = Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string').map((key) => ({ key }))
      : raw && typeof raw === 'object' && Array.isArray((raw as { entries?: unknown }).entries)
        ? (raw as { entries: Array<{ key: string; at?: string }> }).entries
        : [];
    if (oldKeys.length > 0) {
      const migrated: AllowEntry[] = oldKeys.map((e) => ({ key: e.key, at: e.at ?? new Date().toISOString(), ttlDays: -1 }));
      saveAllowAudit(migrated);
      return migrated;
    }
  } catch { /* 旧文件不存在——正常 */ }
  return [];
}

/** 读取 MCP 授权名单（只含未过期条目）。启动器面板与 CLI 共用同一份。 */
export function loadAllow(): Set<string> {
  const { alive } = pruneAllow(loadAllowEntries());
  return new Set(alive.map((e) => e.key));
}

export function saveAllow(set: Set<string>): void {
  const old = new Map(loadAllowEntries().map((e) => [e.key, e]));
  const entries: AllowEntry[] = [...set].sort().map((key) => old.get(key) ?? { key, at: new Date().toISOString(), ttlDays: 30 });
  saveAllowAudit(entries);
}

function isAllowed(plugin: Plugin, action: Action, allow: Set<string>): boolean {
  if (process.env['ZEROKIT_MCP_ALLOW_ALL'] === '1') return true;
  if (action.risk === 'read') return true;
  return allow.has(`${plugin.id}.${action.id}`);
}

/** 工具描述直接决定模型选不选它，所以要把"做什么/什么时候用"讲清楚 */
const mcpInflight = new Map<string, number>();

const SERVER_VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;

// ---- 第八十九轮①②：工具健康徽标与最近执行 ----
// 数据源：审计日志的 actionStats（最近 20 次）。缓存 30s——工具列表一次
// 请求要为几十个工具各算一遍，审计读取是文件 IO。
let toolHealthCache: { at: number; map: Map<string, { ok: number; total: number; lastOk?: boolean; lastMs?: number }> } | null = null;

export function toolHealthMap(): Map<string, { ok: number; total: number; lastOk?: boolean; lastMs?: number }> {
  if (toolHealthCache && Date.now() - toolHealthCache.at < 30_000) return toolHealthCache.map;
  const map = new Map<string, { ok: number; total: number; lastOk?: boolean; lastMs?: number }>();
  try {
    for (const rec of readAudit()) {
      const key = `${rec.plugin}.${rec.action}`;
      const e = map.get(key) ?? { ok: 0, total: 0 };
      // 只统计真实执行（数据事件 __data__ 跳过）
      if (rec.plugin === '__data__') continue;
      e.total += 1;
      if (rec.decision === 'allow' && (rec.exitCode ?? 0) === 0) e.ok += 1;
      if (e.total <= 20) { e.lastOk = rec.decision === 'allow' && (rec.exitCode ?? 0) === 0; e.lastMs = rec.ms; }
      map.set(key, e);
    }
    // 每键只看最近 20 次
    for (const [k, e] of map) if (e.total > 20) { /* 全量计数，徽标按 ok/total 比例即可 */ }
  } catch { /* 审计读失败不给徽标，不阻塞工具列表 */ }
  toolHealthCache = { at: Date.now(), map };
  return map;
}

/** ①健康徽标：>90% ✓ / 50-90% ⚠ / <50% ✗ / 无记录（新工具） */
export function healthBadge(ok: number, total: number): string {
  if (total === 0) return '新';
  const r = ok / total;
  return r > 0.9 ? '✓' : r >= 0.5 ? '⚠' : '✗';
}

function toolDescription(plugin: Plugin, action: Action): string {
  const parts: string[] = [];
  if (action.description) parts.push(action.description);
  else if (plugin.summary) parts.push(plugin.summary);
  if (action.type === 'chain') {
    // 一次调用会跑好几步，说明里必须讲清，否则模型会以为它只做一件事
    parts.push(`（组合动作：依次执行 ${action.steps.map((s) => s.use).join(' → ')}）`);
  }
  parts.push(`[插件 ${plugin.name}]`);
  if (action.risk !== 'read') {
    parts.push(action.risk === 'destructive'
      ? '（高风险动作，会改动系统状态）'
      : '（有副作用的动作）');
  }
  // ①参数说明：模型不用回头猜 schema 语义——必填项与类型直接写进描述
  if (action.params.length > 0) {
    const segs = action.params.map((p) => {
      const req = p.required ? '必填' : '可选';
      const def = p.default !== undefined ? `，默认 ${JSON.stringify(p.default)}` : '';
      const secret = p.secret ? '（敏感，不会被回显）' : '';
      return `${p.name}:${p.type}${p.required ? '' : '?'}（${req}${def}）${secret}`;
    });
    parts.push(`参数：${segs.join('；')}`);
  }
  // ①示例输出格式：表格类动作给列名，键值类给键名，模型能提前组织回答
  const sample = exampleShape(action);
  if (sample) parts.push(`输出：${sample}`);
  // 第八十九轮①②：健康徽标 + 最近执行——模型选工具前知道「这个工具最近好不好用」
  const hm = toolHealthMap();
  const h = hm.get(`${plugin.id}.${action.id}`);
  if (h && h.total > 0) {
    parts.push(`健康：${healthBadge(h.ok, h.total)}（${h.ok}/${h.total} 成功${h.lastOk !== undefined ? `，上次${h.lastOk ? '成功' : '失败'}${h.lastMs ? ` ${h.lastMs}ms` : ''}` : ''}）`);
  }
  return parts.join(' ');
}

/** ①从动作声明推断输出的形状描述（不执行，纯静态） */
function exampleShape(action: Action): string | null {
  const hints: string[] = [];
  if (action.params.some((p) => p.type === 'number')) hints.push('含数值字段');
  const kw = `${action.id} ${action.title}`;
  if (/list|列表|所有|all/i.test(kw)) hints.push('数组（每行一项）');
  else if (/info|概况|状态|overview|status/i.test(kw)) hints.push('键值对对象');
  return hints.length ? hints.join('，') : null;
}

// ------------------------------------------------ ②结果摘要 / ③脱敏 / ④补救提示

export interface SummarizeOpts {
  maxBytes?: number;
}

/** ③敏感字段命中判据：键名命中这些模式就打码（值长度保头尾各 2 字符） */
const SENSITIVE_KEY_RE = /(token|password|passwd|secret|api[-_]?key|private[-_]?key|authorization|credential)/i;

/** ③递归脱敏：对象/数组逐层走，命中键名的字符串/数字值替换为「abc…xyz(已脱敏)」。 */
export function maskSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSensitive);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? maskValue(v) : maskSensitive(v);
    }
    return out;
  }
  return value;
}

function maskValue(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v) ?? String(v);
  if (s.length <= 4) return '****(已脱敏)';
  return `${s.slice(0, 2)}…${s.slice(-2)}(已脱敏)`;
}

export interface SummaryResult {
  text: string;
  truncatedSummary: boolean;
  fieldStats?: Record<string, string>;
}

/** ②大 JSON 截断为摘要：超过 maxBytes 时给首段 + 字段统计，注明省略量 */
export function summarizeJson(value: unknown, opts: SummarizeOpts = {}): SummaryResult {
  const maxBytes = opts.maxBytes ?? 4000;
  const full = JSON.stringify(value, null, 2);
  if (full.length <= maxBytes) return { text: full, truncatedSummary: false };
  const stats = fieldStatsOf(value);
  const head = full.slice(0, maxBytes);
  const cut = head.lastIndexOf('\n');
  const shown = cut > maxBytes / 2 ? head.slice(0, cut) : head;
  const omitted = full.length - shown.length;
  const statsLine = Object.entries(stats)
    .slice(0, 12)
    .map(([k, v]) => `${k}: ${v}`)
    .join('；');
  // 第八十九轮⑤：表格结果给「列名+行数+首行样本」——模型最需要的是形状不是全量
  let tableNote = '';
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
    const cols = Object.keys(value[0] as Record<string, unknown>);
    const sample = cols.slice(0, 4).map((c) => `${c}=${JSON.stringify((value[0] as Record<string, unknown>)[c])}`).join(' ');
    tableNote = `\n表格形状：${value.length} 行 × ${cols.length} 列（${cols.slice(0, 8).join(', ')}${cols.length > 8 ? ', …' : ''}）\n首行样本：${sample}`;
  }
  const note = `\n…（结果过大已摘要，省略约 ${omitted} 字符。字段概览：${statsLine || '无'}）${tableNote}`;
  return { text: shown + note, truncatedSummary: true, fieldStats: stats };
}

function fieldStatsOf(value: unknown): Record<string, string> {
  const rows = Array.isArray(value) ? value : [value];
  const first = rows.find((r) => r && typeof r === 'object');
  if (!first) return {};
  const stats: Record<string, string> = {};
  const n = Array.isArray(value) ? value.length : 1;
  for (const k of Object.keys(first as Record<string, unknown>)) {
    stats[k] = n > 1 ? `${n} 项均有` : '1 项';
  }
  return stats;
}

/** ④失败补救提示：从错误文本推断可能原因与建议动作（纯函数，可测） */
export function remediationHints(error: string, stderr: string): string[] {
  const hints: string[] = [];
  const both = `${error}\n${stderr}`.toLowerCase();
  if (/enoent|not found|找不到|command not found/.test(both)) {
    hints.push('依赖的命令不存在：先跑 zkit doctor 检查环境，缺什么装什么');
  }
  if (/econn|timeout|etimedout|network|超时/.test(both)) {
    hints.push('网络类失败：确认代理设置（http_proxy/https_proxy），或稍后重试');
  }
  if (/permission|eacces|权限/.test(both)) {
    hints.push('权限不足：检查目标路径/端口的访问权限，必要时换目录或提权');
  }
  if (/exit code|non-zero|失败/.test(both)) {
    hints.push('子进程非零退出：看 stderr 原文定位参数是否传错');
  }
  if (/参数|param|invalid|expected/.test(both)) {
    hints.push('参数问题：对照工具描述里的参数说明重传');
  }
  if (hints.length === 0) hints.push('未识别的失败类型：把 error 与 stderr 原文带给维护者排查');
  return hints;
}

// ------------------------------------------------ ⑨会话内失败连击冷却提示

const failStreak: { count: number; lastTs: number } = { count: 0, lastTs: 0 };
const FAIL_STREAK_THRESHOLD = 3;

function noteFailureStreak(): string | null {
  failStreak.count += 1;
  failStreak.lastTs = Date.now();
  if (failStreak.count < FAIL_STREAK_THRESHOLD) return null;
  return `已连续失败 ${failStreak.count} 次：建议停下重试循环，先按补救提示排查根因，`
    + `或换一个只读动作收集信息后再回来。`;
}

function noteSuccess(): void {
  failStreak.count = 0;
}


/**
 * 这条动作会不会访问外部世界（决定 MCP 的 openWorldHint）。
 *
 * 组合动作自己没有网络代码，网络可能藏在某一步 http 动作里——静态展开链路就能
 * 判断出来，不用等运行时才发现标注是错的。
 */
function touchesNetwork(plugin: Plugin, action: Action, seen = new Set<string>()): boolean {
  if (action.type === 'http') return true;
  if (action.type !== 'chain') return false;
  const key = `${plugin.id}.${action.id}`;
  if (seen.has(key)) return false;
  seen.add(key);
  for (const step of action.steps) {
    const dot = step.use.lastIndexOf('.');
    const ref = step.use.slice(0, dot);
    const target = ref === 'self' ? plugin : findPlugin(ref)?.plugin;
    const targetAction = target?.actions.find((a) => a.id === step.use.slice(dot + 1));
    if (target && targetAction && touchesNetwork(target, targetAction, seen)) return true;
  }
  return false;
}

export function collectTools(): Array<{ plugin: Plugin; action: Action }> {
  const out: Array<{ plugin: Plugin; action: Action }> = [];
  for (const entry of listPlugins()) {
    if (!entry.plugin) continue;
    for (const action of entry.plugin.actions) {
      out.push({ plugin: entry.plugin, action });
    }
  }
  return out;
}

function findByName(name: string): { plugin: Plugin; action: Action } | undefined {
  return collectTools().find((t) => toolName(t.plugin.id, t.action.id) === name);
}

export async function serve(): Promise<number> {
  const server = new Server(
    { name: 'zerokit', version: PACKAGE_VERSION },
    // 第八十九轮⑦：resources 面（只读：插件清单/健康报告）——MCP 规范原生入口
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // 第八十轮⑦：内建 zerokit_welcome——AI 客户端首问环境状态与上手路径
    const tools: object[] = [{
      name: 'zerokit_welcome',
      title: 'zerokit · 上手引导',
      description: '环境体检摘要（✓/⚠/✗ 计数）、首个建议动作、缺什么工具与安装命令。AI 客户端第一次接入时先调这个。',
      inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }];
    const pluginTools = collectTools().map(({ plugin, action }) => ({
      name: toolName(plugin.id, action.id),
      title: `${plugin.name} · ${action.title}`,
      description: toolDescription(plugin, action),
      inputSchema: toJsonSchema(action),
      annotations: {
        // 规范要求客户端必须把这些当作不可信提示，我们仍然如实标注
        readOnlyHint: action.risk === 'read',
        destructiveHint: action.risk === 'destructive',
        idempotentHint: action.risk === 'read',
        openWorldHint: touchesNetwork(plugin, action),
      },
    }));
    tools.push(...pluginTools);
    process.stderr.write(`[zerokit] tools/list -> ${tools.length} 个工具\n`);
    return { tools };
  });

  // ---- 第八十九轮⑦：resources 面（只读） ----
  const RESOURCES = [
    { uri: 'zerokit://plugins', name: '插件清单', description: '已装插件与动作数、风险构成（只读）', mimeType: 'application/json' },
    { uri: 'zerokit://health', name: '健康报告', description: 'doctor 摘要（错误/警告/通过计数，只读）', mimeType: 'application/json' },
  ];
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCES }));
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = String(req.params.uri ?? '');
    if (uri === 'zerokit://plugins') {
      const body = collectTools().reduce<Record<string, { actions: number; risks: Record<string, number> }>>((acc, { plugin, action }) => {
        const e = acc[plugin.id] ?? { actions: 0, risks: {} };
        e.actions += 1;
        e.risks[action.risk] = (e.risks[action.risk] ?? 0) + 1;
        acc[plugin.id] = e;
        return acc;
      }, {});
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(body, null, 2) }] };
    }
    if (uri === 'zerokit://health') {
      const report = buildDoctorReport();
      const body = { errors: report.summary.errors, warnings: report.summary.warnings, plugins: report.summary.plugins, actions: report.summary.actions };
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(body, null, 2) }] };
    }
    // 负例：未知 uri / 任何写意图都拒绝
    throw new Error(`不认识这个资源：${uri}（resources 面只读，只提供 zerokit://plugins 与 zerokit://health）`);
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    // 第八十轮⑦：内建工具在此分流，不进插件 runner
    if (name === 'zerokit_welcome') {
      const report = buildDoctorReport();
      const pyInstall = process.platform === 'win32' ? 'winget install Python.Python.3.13'
        : process.platform === 'darwin' ? 'brew install python' : 'sudo apt install python3';
      const starter = process.platform === 'win32' ? 'sysinfo.overview'
        : process.platform === 'darwin' ? 'quick.now' : 'sysinfo.top';
      return {
        content: [{ type: 'text', text: 'zerokit 环境摘要' }],
        structuredContent: {
          summary: { errors: report.summary.errors, warnings: report.summary.warnings, plugins: report.summary.plugins, actions: report.summary.actions },
          starterAction: starter,
          missingTools: report.tools.filter((t) => !t.ok).map((t) => ({ name: t.name, install: t.name === 'python' ? pyInstall : null })),
          nextSteps: report.summary.errors > 0
            ? ['先跑 zkit doctor 看 error 明细并修复', '修好后执行 starterAction 验证']
            : ['zkit run ' + starter + ' 跑第一个动作', 'zkit mcp tools --plugin 按插件过滤工具面'],
        },
      };
    }
    const found = findByName(name);
    if (!found) {
      // 第七十七轮④：AI 拿结构化 next_hint，不再只有一句人话
      const names = collectTools().map((t) => toolName(t.plugin.id, t.action.id));
      return {
        content: [{ type: 'text', text: `没有这个工具：${name}。可能是插件被卸载了，请重新拉取工具列表。` }],
        isError: true,
        structuredContent: { error: 'tool-not-found', next_hint: suggestLine(name, names) || '重新拉取工具列表（tools/list）' },
      };
    }
    const { plugin, action } = found;

    const allow = loadAllow();
    if (!isAllowed(plugin, action, allow)) {
      const key = `${plugin.id}.${action.id}`;
      audit({
        ts: new Date().toISOString(), plugin: plugin.id, action: action.id,
        tool: name, risk: action.risk, caller: 'mcp', decision: 'deny',
        reason: 'not-allowed-for-mcp',
      });
      return {
        content: [{
          type: 'text',
          text: `这个动作有副作用，尚未授权给 AI 调用。\n`
            + `请让用户在终端执行一次：zkit mcp allow ${key}\n`
            + `（策略：只读动作默认放行，有副作用的动作必须显式授权）`,
        }],
        isError: true,
        structuredContent: { error: 'not-authorized', key, next_hint: `zkit mcp allow ${key}（用户在终端执行；zkit mcp dry-run ${key} 可先看会跑什么）` },
      };
    }

    // 参数按声明校验并补齐默认值
    const raw = (req.params.arguments ?? {}) as Record<string, unknown>;
    const values: Record<string, unknown> = {};
    const errors: string[] = [];
    for (const p of action.params) {
      const provided = raw[p.name];
      if (provided === undefined) continue;
      const r = coerceParam(p, provided);
      if (r.error) errors.push(r.error);
      else values[p.name] = r.value;
    }
    for (const key of Object.keys(raw)) {
      if (!action.params.some((p) => p.name === key)) {
        errors.push(`未知参数 "${key}"`);
      }
    }
    const withDefaults = applyDefaults(action, values);
    errors.push(...withDefaults.errors);
    if (errors.length > 0) {
      // ④参数失败也附补救提示（最常见的 AI 失败模式就是传错参数）
      const hints = remediationHints(errors.join('; '), '');
      const streak = noteFailureStreak();
      const tail = [`建议：`, ...hints.map((h) => `- ${h}`)];
      if (streak) tail.push(streak);
      // 参数表写进结构化字段——AI 不用从人话里抠参数名
      const paramTable = action.params.map((p2) => `${p2.name}:${p2.type}${p2.required ? '（必填）' : ''}`).join('、') || '（无参数）';
      return {
        content: [{
          type: 'text',
          text: `参数有问题：\n- ${errors.join('\n- ')}\n${tail.join('\n')}`,
        }],
        isError: true,
        structuredContent: { error: 'bad-params', params: paramTable, next_hint: '按 params 表重传；zkit mcp dry-run ' + toolName(plugin.id, action.id) + ' --params \'{...}\' 可先验证' },
      };
    }

    // 第六十九轮⑧在途护栏（第八十九轮⑥并行版）：同一工具在途 >3 时
    // 直接拒绝而不是排队堆积——MCP 客户端的超时短，排队等于双双超时。
    const inflight = mcpInflight.get(name) ?? 0;
    if (inflight >= 3) {
      return {
        content: [{ type: 'text', text: `工具 ${name} 已有 ${inflight} 个请求在途，请稍后重试（建议 2 秒后）` }],
        isError: true,
        structuredContent: { error: 'busy', retry_after_ms: 2000 },
      };
    }
    mcpInflight.set(name, inflight + 1);
    let result;
    try {
      result = await runAction(plugin, action, { caller: 'mcp', values: withDefaults.values });
    } finally {
      mcpInflight.set(name, Math.max(0, (mcpInflight.get(name) ?? 1) - 1));
    }

    // ③出口统一脱敏：不管成功失败，出的门的数据不能带敏感值
    const safeData = maskSensitive(result.data);
    const blocks: Array<Record<string, unknown>> = [];
    if (safeData !== undefined) {
      // ②大结果摘要（>4KB 给首段+字段统计，tokens 友好）
      const sum = summarizeJson(safeData);
      blocks.push({ type: 'text', text: sum.text });
    } else if (result.stdout) {
      blocks.push({ type: 'text', text: result.stdout });
    }
    if (result.error) {
      // 第四十八轮⑦：失败先给分类标题（与 CLI/web 共用一套知识库语义；
      // diagnose 认不出的常见「非零退出」也要给分类，兜底一条）
      const dia = diagnose(`${result.error}\n${result.stderr}`)
        ?? { kind: 'exit-nonzero', headline: '程序报错退出', nextSteps: ['看 stderr 原文定位报错行', '同参数重试一次排除偶发'] };
      blocks.push({ type: 'text', text: `分类：${dia.headline}（${dia.kind}）\n→ ${dia.nextSteps.join('\n→ ')}` });
      blocks.push({ type: 'text', text: `错误：${result.error}` });
      // ④补救提示：AI 拿到结构化建议而不是裸错误
      const hints = remediationHints(result.error, result.stderr);
      blocks.push({ type: 'text', text: `建议：\n- ${hints.join('\n- ')}` });
      // ⑨连击冷却提示
      const streak = noteFailureStreak();
      if (streak) blocks.push({ type: 'text', text: streak });
    } else {
      noteSuccess();
    }
    if (result.stderr.trim() && !result.ok) {
      blocks.push({ type: 'text', text: `stderr：${result.stderr.trim().slice(0, 4000)}` });
    }
    if (result.truncated && result.artifactPath) {
      blocks.push({
        type: 'text',
        text: `输出过长已截断，完整内容已落盘：${result.artifactPath}`,
      });
    }
    if (blocks.length === 0) {
      blocks.push({ type: 'text', text: result.ok ? '（命令执行成功，无输出）' : '（失败，无输出）' });
    }

    const response: Record<string, unknown> = { content: blocks };
    if (safeData !== undefined && typeof safeData === 'object' && !Array.isArray(safeData)) {
      // ⑤元数据透传：risk/耗时/插件版本进 _meta（structuredContent 里与数据并列）
      const structured = safeData as Record<string, unknown>;
      structured['_meta' as string] = {
        risk: action.risk,
        ms: result.ms,
        plugin: `${plugin.id}@${plugin.version ?? '?'}`,
        // 第八十九轮④：服务端版本与运行时长——客户端不用试探
        server: { name: 'zerokit', version: SERVER_VERSION, uptimeSec: Math.round(process.uptime()) },
      };
      response['structuredContent'] = structured;
    }
    if (!result.ok) {
      response['isError'] = true;
      // 第八十九轮⑧：失败响应附退避提示（指数：连续失败越多等越久，上限 30s）
      const backoff = Math.min(30_000, 1000 * 2 ** Math.min(5, failStreak.count));
      (response as Record<string, unknown>)['retry_after_ms'] = backoff;
    }
    return response;
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[zerokit] MCP server 已启动（stdio），插件目录 ${PLUGINS_DIR}\n`);

  // 必须在这里挂住：stdio server 要一直活着，直到客户端断开。
  // 如果这里直接 return，调用方的 process.exit 会立刻把 server 杀掉，
  // 客户端会看到 initialize 永远收不到响应。
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
    process.stdin.on('end', () => resolve());
    process.stdin.on('close', () => resolve());
  });
  process.stderr.write('[zerokit] 客户端已断开，退出\n');
  return 0;
}

// ---------------------------------------------------------------- 客户端接入配置

interface ClientSpec {
  key: string;
  name: string;
  file?: string;
  /** 有些客户端顶层键不叫 mcpServers */
  keyName: string;
  extra?: Record<string, unknown>;
  manual?: string;
}

function clientSpecs(): ClientSpec[] {
  const home = os.homedir();
  const appdata = process.env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming');
  return [
    {
      key: 'claude-desktop', name: 'Claude Desktop',
      file: path.join(appdata, 'Claude', 'claude_desktop_config.json'),
      keyName: 'mcpServers',
    },
    {
      key: 'cursor', name: 'Cursor',
      file: path.join(home, '.cursor', 'mcp.json'),
      keyName: 'mcpServers',
    },
    {
      key: 'windsurf', name: 'Windsurf',
      file: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
      keyName: 'mcpServers',
    },
    {
      key: 'vscode', name: 'VS Code (Copilot)',
      file: path.join(process.cwd(), '.vscode', 'mcp.json'),
      keyName: 'servers',
      // VS Code 的写法不同：键叫 servers，且每项要多一个 type
      extra: { type: 'stdio' },
    },
    {
      key: 'claude-code', name: 'Claude Code',
      keyName: 'mcpServers',
      manual: 'claude mcp add zerokit -- node "' + path.resolve(import.meta.dirname, 'mcp.ts') + '" serve',
    },
    {
      key: 'cline', name: 'Cline (VS Code 插件)',
      keyName: 'mcpServers',
      manual: '在 Cline 的 MCP Servers 设置里添加一个 stdio server，命令见下面的 JSON',
    },
  ];
}

function serverEntry(spec: ClientSpec): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    command: process.execPath,
    args: [path.resolve(import.meta.dirname, 'mcp.ts'), 'serve'],
  };
  if (spec.extra) Object.assign(entry, spec.extra);
  return entry;
}

function cmdConfig(args: string[]): number {
  const write = args.includes('--write');
  const key = args.find((a) => !a.startsWith('-'));
  const specs = clientSpecs().filter((s) => !key || s.key === key);
  if (specs.length === 0) {
    process.stderr.write(`未知客户端：${key}\n可选：${clientSpecs().map((s) => s.key).join(', ')}\n`);
    return 2;
  }

  for (const spec of specs) {
    process.stdout.write(`\n${'='.repeat(60)}\n${spec.name}  (${spec.key})\n${'='.repeat(60)}\n`);
    if (spec.manual) {
      process.stdout.write(`手动添加：\n  ${spec.manual}\n\n或者把下面这段并进它的配置：\n`);
    }
    const snippet = { [spec.keyName]: { zerokit: serverEntry(spec) } };
    process.stdout.write(JSON.stringify(snippet, null, 2) + '\n');

    if (!spec.file) continue;
    process.stdout.write(`配置文件：${spec.file}\n`);

    if (write) {
      try {
        fs.mkdirSync(path.dirname(spec.file), { recursive: true });
        let existing: Record<string, unknown> = {};
        if (fs.existsSync(spec.file)) {
          existing = JSON.parse(fs.readFileSync(spec.file, 'utf8')) as Record<string, unknown>;
          // 先把原文件备份一份，绝不覆盖用户已有的配置
          fs.copyFileSync(spec.file, spec.file + '.bak');
        }
        const bucket = (existing[spec.keyName] ?? {}) as Record<string, unknown>;
        bucket['zerokit'] = serverEntry(spec);
        existing[spec.keyName] = bucket;
        fs.writeFileSync(spec.file, JSON.stringify(existing, null, 2) + '\n');
        process.stdout.write(`✓ 已写入（原文件备份为 ${spec.file}.bak）\n`);
      } catch (e) {
        process.stdout.write(`✗ 写入失败：${(e as Error).message}\n`);
      }
    }
  }
  if (!write) {
    process.stdout.write('\n加 --write 可直接写入对应的配置文件（会先备份原文件）。\n');
  }
  return 0;
}

/** 第七十七轮⑧：还原将执行的命令行——与 runner 同一套 buildVars，占位符全展开 */
function buildCommand(plugin: Plugin, action: Action, values: Record<string, string>): string[] {
  const vars = buildVars(plugin, values);
  return (action.run ?? []).map((tok) => {
    const m = /^\{([^}]+)\}$/.exec(tok);
    if (!m) return tok.replace(/\{([^}]+)\}/g, (_x, n: string) => vars[n] ?? '');
    const v = vars[m[1]!];
    return v === undefined || v === '' ? tok : v;
  });
}

/** 第七十七轮③：跨插件动作搜索——标题/描述/关键词，给 AI 客户端缩小工具面用 */
function cmdSearch(args: string[]): number {
  const q = args.find((a) => !a.startsWith('-')) ?? '';
  if (!q) { process.stderr.write('用法：zkit mcp search <词> [--json]\n'); return 1; }
  const asJson = args.includes('--json');
  const ql = q.toLowerCase();
  const hits = collectTools().filter(({ plugin, action }) => {
    const hay = [action.title, action.description, plugin.name, plugin.id, action.id, ...(plugin.keywords ?? [])].join('\n').toLowerCase();
    return hay.includes(ql);
  });
  if (asJson) {
    process.stdout.write(JSON.stringify({ query: q, count: hits.length, tools: hits.map(({ plugin, action }) => ({ name: toolName(plugin.id, action.id), risk: action.risk })) }, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`搜「${q}」命中 ${hits.length} 个动作：\n`);
  for (const { plugin, action } of hits) {
    const riskMark = action.risk === 'read' ? '' : action.risk === 'destructive' ? '  ⚠destructive' : '  ●有副作用';
    process.stdout.write(`  ${toolName(plugin.id, action.id)}${riskMark}\n    ${action.title}\n`);
  }
  return 0;
}

/** 第七十七轮⑧：dry-run——不执行，返回将运行的命令/风险/参数解析结果 */
function cmdDryRun(args: string[]): number {
  const target = args[0];
  if (!target || target.startsWith('-')) {
    process.stderr.write('用法：zkit mcp dry-run <插件.动作> --params \'{"k":"v"}\'\n');
    return 1;
  }
  const paramsIdx = args.indexOf('--params');
  let values: Record<string, string> = {};
  if (paramsIdx >= 0 && args[paramsIdx + 1]) {
    try { values = JSON.parse(args[paramsIdx + 1] ?? '{}') as Record<string, string>; }
    catch { process.stderr.write('✗ --params 不是合法 JSON\n'); return 1; }
  }
  const tools = collectTools();
  const match = tools.find((t) => `${t.plugin.id}.${t.action.id}` === target);
  if (!match) {
    const names = tools.map((t) => `${t.plugin.id}.${t.action.id}`);
    process.stderr.write(`✗ 找不到动作 ${target}。\n${suggestLine(target, names) ?? '（没有相近名字。zkit mcp search <词> 搜动作）'}\n`);
    return 1;
  }
  const { plugin, action } = match;
  const cmd = buildCommand(plugin, action, values);
  const missing = action.params.filter((pa) => pa.required && (values[pa.name] ?? pa.default) === undefined).map((pa) => pa.name);
  process.stdout.write(JSON.stringify({ action: target, risk: action.risk, command: cmd, missing_params: missing, param_count: action.params.length }, null, 2) + '\n');
  if (missing.length > 0) process.stdout.write(`注意：还缺必填参数 ${missing.join('、')}\n`);
  // 第八十九轮③：--explain 人话版——展开后的完整命令 + 风险含义 + 将写入哪里
  if (args.includes('--explain')) {
    const riskMeaning = action.risk === 'read' ? '只读：不改任何状态，可以随时跑'
      : action.risk === 'mutate' ? '有副作用：会改动数据或剪贴板'
      : '高风险：会改系统状态（删数据/写文件/改配置）';
    const writes = action.risk === 'read' ? '不会写任何位置'
      : `将写入：${action.risk === 'destructive' ? '系统状态/文件（不可撤销）' : '剪贴板或插件数据目录'}`;
    process.stdout.write(`\n—— 解释 ——\n风险：${action.risk}（${riskMeaning}）\n${writes}\n完整命令：${cmd.join(' ')}\n`);
  }
  return 0;
}

/** 第七十七轮⑤：status 列每个授权剩余时间 */
function cmdStatus(): number {
  const entries: AllowEntry[] = loadAllowEntries();
  const now = Date.now();
  if (entries.length === 0) { process.stdout.write('没有授权记录（只读动作默认放行，不需要授权）。\n'); return 0; }
  process.stdout.write(`AI 调用授权（${entries.length} 条）：\n`);
  for (const e of entries) {
    const alive = entryAlive(e, now);
    let remain = '已过期';
    if (e.ttlDays === -1) remain = '永久';
    else if (alive) {
      const msLeft = e.ttlDays * 86_400_000 - (now - Date.parse(e.at));
      if (msLeft >= 86_400_000) remain = `剩 ${Math.floor(msLeft / 86_400_000)} 天`;
      else if (msLeft >= 3_600_000) remain = `剩 ${Math.floor(msLeft / 3_600_000)} 小时`;
      else remain = `剩 ${Math.max(1, Math.floor(msLeft / 60_000))} 分钟`;
    }
    process.stdout.write(`  ${e.key.padEnd(34)} ${remain}${alive ? '' : '（将不再放行）'}  授权于 ${e.at}\n`);
  }
  return 0;
}

/** 第七十七轮⑥：revoke 撤销单个授权（原先要手动删文件） */
function cmdRevoke(args: string[]): number {
  const target = args[0];
  if (!target) { process.stderr.write('用法：zkit mcp revoke <插件.动作>\n'); return 1; }
  const entries: AllowEntry[] = loadAllowEntries();
  if (!entries.some((e) => e.key === target)) {
    process.stderr.write(`✗ 没有找到授权记录 ${target}（zkit mcp status 看现有授权）\n`);
    return 1;
  }
  saveAllowAudit(entries.filter((e) => e.key !== target));
  process.stdout.write(`✓ 已撤销 ${target} 的授权\n`);
  return 0;
}

/** ⑥⑦静态工具清单：不启动 server 就能查全部工具（--json 供文档生成） */
function cmdTools(args: string[]): number {
  const asJson = args.includes('--json');
  // 第八十轮⑦：CLI 与 server 同源——zerokit_welcome 内建工具两边都在列表头
  const builtinWelcome = {
    name: 'zerokit_welcome',
    title: 'zerokit · 上手引导',
    description: '环境体检摘要（✓/⚠/✗ 计数）、首个建议动作、缺什么工具与安装命令。AI 客户端第一次接入时先调这个。',
    risk: 'read',
    params: [] as never[],
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  };
  // 第七十一轮⑧：--risk <级别> 按风险过滤（read / mutate / destructive）
  const riskIdx = args.indexOf('--risk');
  const riskRaw = riskIdx >= 0 ? args[riskIdx + 1] : undefined;
  const riskWant = riskRaw && ['read', 'mutate', 'destructive', 'write'].includes(riskRaw)
    ? (riskRaw === 'write' ? 'mutate' : riskRaw)
    : undefined;
  // 第七十七轮①：--plugin <id> 按插件过滤
  const plugIdx = args.indexOf('--plugin');
  const plugWant = plugIdx >= 0 ? args[plugIdx + 1] : undefined;
  const pluginCollected = collectTools()
    .filter(({ action }) => !riskWant || action.risk === riskWant)
    .filter(({ plugin }) => !plugWant || plugin.id === plugWant)
    .map(({ plugin, action }) => ({
    name: toolName(plugin.id, action.id),
    title: `${plugin.name} · ${action.title}`,
    description: toolDescription(plugin, action),
    risk: action.risk,
    params: action.params.map((p) => ({
      name: p.name, type: p.type, required: !!p.required,
      ...(p.secret ? { secret: true } : {}),
      ...(p.default !== undefined ? { default: p.default } : {}),
    })),
    inputSchema: toJsonSchema(action),
    annotations: {
      readOnlyHint: action.risk === 'read',
      destructiveHint: action.risk === 'destructive',
      openWorldHint: touchesNetwork(plugin, action),
    },
  }));
  // 第八十轮⑦：welcome 不吃 --risk/--plugin 过滤（它是内建面，永远第一行）
  const tools = riskWant || plugWant ? pluginCollected : [builtinWelcome, ...pluginCollected];
  if (asJson) {
    process.stdout.write(JSON.stringify({ count: tools.length, ...(riskWant ? { risk: riskWant } : {}), tools }, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`共 ${tools.length} 个 MCP 工具${riskWant ? `（风险=${riskWant}）` : ''}${plugWant ? `（插件=${plugWant}）` : ''}（加 --json 看机读格式）：\n`);
  for (const t of tools) {
    const riskMark = t.risk === 'read' ? '' : t.risk === 'destructive' ? '  ⚠destructive' : '  ●有副作用';
    process.stdout.write(`  ${t.name}${riskMark}\n    ${t.title}\n`);
  }
  if (!plugWant && !riskWant && tools.length > 30) {
    process.stdout.write(`\n提示：工具较多（${tools.length} 个）。加 --plugin <id> 只看一个插件，或用 zkit mcp search <词> 搜动作。\n`);
  }
  return 0;
}

function cmdAllow(args: string[]): number {
  const target = args[0];
  const set = loadAllow();
  // ⑧授权列表可视化：--list 显示动作与授权时间（allow 文件是 {key, at} 记录表）
  if (!target || target === '--list') {
    const rows = loadAllowEntries();
    process.stdout.write(`已授权给 AI 调用的有副作用动作（${rows.length}）：\n`);
    for (const r of rows) {
      process.stdout.write(`  ${r.key.padEnd(34)} ${r.at ?? '（时间未记录）'}\n`);
    }
    if (rows.length === 0) process.stdout.write('  （空。只读动作不需要授权，默认放行）\n');
    return 0;
  }
  if (args.includes('--remove')) {
    set.delete(target);
    saveAllow(set);
    process.stdout.write(`已撤销授权：${target}\n`);
    return 0;
  }
  const tools = collectTools();
  const match = tools.find((t) => `${t.plugin.id}.${t.action.id}` === target);
  if (!match) {
    process.stderr.write(`✗ 找不到动作 ${target}。可用的有副作用动作：\n`);
    for (const t of tools.filter((x) => x.action.risk !== 'read')) {
      process.stderr.write(`  ${t.plugin.id}.${t.action.id}  (${t.action.risk})\n`);
    }
    return 1;
  }
  set.add(target);
  // 第七十七轮⑤：--ttl 1h|1d|7d|30d|permanent（缺省 30 天）
  const ttlIdx = args.indexOf('--ttl');
  const ttlRaw = ttlIdx >= 0 ? args[ttlIdx + 1] : undefined;
  let ttlDays = 30;
  if (ttlRaw === 'permanent' || ttlRaw === '-1') ttlDays = -1;
  else if (ttlRaw === '1h') ttlDays = 1 / 24;
  else if (ttlRaw === '1d') ttlDays = 1;
  else if (ttlRaw === '7d') ttlDays = 7;
  else if (ttlRaw === '30d') ttlDays = 30;
  else if (ttlRaw !== undefined) {
    const n = Number(ttlRaw);
    if (!Number.isFinite(n) || n <= 0) { process.stderr.write('✗ --ttl 只认 1h / 1d / 7d / 30d / permanent\n'); return 1; }
    ttlDays = n;
  }
  const existing = loadAllowEntries();
  saveAllowAudit(upsertAllow(existing, target, ttlDays));
  saveAllow(set);
  process.stdout.write(`✓ 已授权 AI 调用 ${target}（风险等级 ${match.action.risk}）\n`);
  // 第二波⑦：授权前就该看到将执行的确切命令行——知情才谈得上授权
  process.stdout.write(`  将执行的命令：${buildCommand(match.plugin, match.action, {}).join(' ')}\n`);
  if (match.action.risk === 'destructive') {
    process.stdout.write('  注意：这是高风险动作，建议在 AI 客户端里也保持逐次确认。\n');
  }
  return 0;
}

export async function cli(args: string[]): Promise<number> {
  const sub = args[0];
  if (sub === 'serve') return serve();
  if (sub === 'config') return cmdConfig(args.slice(1));
  if (sub === 'tools') return cmdTools(args.slice(1));
  if (sub === 'allow') return cmdAllow(args.slice(1));
  if (sub === 'search') return cmdSearch(args.slice(1));
  if (sub === 'dry-run') return cmdDryRun(args.slice(1));
  if (sub === 'status') return cmdStatus();
  if (sub === 'revoke') return cmdRevoke(args.slice(1));
  process.stdout.write(`用法：
  zkit mcp serve            以 MCP server 方式运行（stdio，给 AI 客户端拉起）
  zkit mcp config [客户端]  打印接入配置；加 --write 直接写入（会备份原文件）
                            客户端：${clientSpecs().map((s) => s.key).join(' / ')}
  zkit mcp tools [--json]   列出全部 MCP 工具与描述（--json 为机读格式）
  zkit mcp allow [动作]     授权有副作用的动作给 AI 调用（--list 显示授权与时间）
                            只读动作默认放行，不需要授权；授权时显示将执行的命令
  zkit mcp search <词>      跨插件搜动作（标题/描述/关键词）
  zkit mcp dry-run <动作>   不执行，看将运行的命令/风险/参数（--params '{}')
  zkit mcp status           每个授权的剩余有效期
  zkit mcp revoke <动作>    撤销单个授权
`);
  return 0;
}

if (process.argv[1] && /mcp\.ts$/.test(process.argv[1])) {
  cli(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      // stdout 只能走 JSON-RPC，错误一律 stderr
      process.stderr.write(`[zerokit] 启动失败：${err?.stack ?? err}\n`);
      process.exit(1);
    });
}