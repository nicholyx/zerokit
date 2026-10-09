#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema, ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { type Action, type Plugin, toolName } from './core/manifest.ts';
import { HOME, PLUGINS_DIR } from './core/paths.ts';
import { listPlugins } from './core/registry.ts';
import { applyDefaults, coerceParam, toJsonSchema } from './core/schema.ts';
import { audit, confirmPolicy, runAction } from './core/runner.ts';

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

function loadAllow(): Set<string> {
  try {
    const raw = JSON.parse(fs.readFileSync(allowPath(), 'utf8'));
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function saveAllow(set: Set<string>): void {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(allowPath(), JSON.stringify([...set].sort(), null, 2));
}

function isAllowed(plugin: Plugin, action: Action, allow: Set<string>): boolean {
  if (process.env['ZEROKIT_MCP_ALLOW_ALL'] === '1') return true;
  if (action.risk === 'read') return true;
  return allow.has(`${plugin.id}.${action.id}`);
}

/** 工具描述直接决定模型选不选它，所以要把"做什么/什么时候用"讲清楚 */
function toolDescription(plugin: Plugin, action: Action): string {
  const parts: string[] = [];
  if (action.description) parts.push(action.description);
  else if (plugin.summary) parts.push(plugin.summary);
  parts.push(`[插件 ${plugin.name}]`);
  if (action.risk !== 'read') {
    parts.push(action.risk === 'destructive'
      ? '（高风险动作，会改动系统状态）'
      : '（有副作用的动作）');
  }
  return parts.join(' ');
}

function collectTools(): Array<{ plugin: Plugin; action: Action }> {
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
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = collectTools().map(({ plugin, action }) => ({
      name: toolName(plugin.id, action.id),
      title: `${plugin.name} · ${action.title}`,
      description: toolDescription(plugin, action),
      inputSchema: toJsonSchema(action),
      annotations: {
        // 规范要求客户端必须把这些当作不可信提示，我们仍然如实标注
        readOnlyHint: action.risk === 'read',
        destructiveHint: action.risk === 'destructive',
        idempotentHint: action.risk === 'read',
        openWorldHint: action.type === 'http',
      },
    }));
    process.stderr.write(`[zerokit] tools/list -> ${tools.length} 个工具\n`);
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const found = findByName(name);
    if (!found) {
      return {
        content: [{ type: 'text', text: `没有这个工具：${name}。可能是插件被卸载了，请重新拉取工具列表。` }],
        isError: true,
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
      return {
        content: [{ type: 'text', text: `参数有问题：\n- ${errors.join('\n- ')}` }],
        isError: true,
      };
    }

    const result = await runAction(plugin, action, { caller: 'mcp', values: withDefaults.values });

    const blocks: Array<Record<string, unknown>> = [];
    if (result.data !== undefined) {
      blocks.push({ type: 'text', text: JSON.stringify(result.data, null, 2) });
    } else if (result.stdout) {
      blocks.push({ type: 'text', text: result.stdout });
    }
    if (result.error) blocks.push({ type: 'text', text: `错误：${result.error}` });
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
    if (result.data !== undefined && typeof result.data === 'object') {
      response['structuredContent'] = result.data;
    }
    if (!result.ok) response['isError'] = true;
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

function cmdAllow(args: string[]): number {
  const target = args[0];
  const set = loadAllow();
  if (!target) {
    process.stdout.write(`已授权给 AI 调用的有副作用动作（${set.size}）：\n`);
    for (const k of [...set].sort()) process.stdout.write(`  ${k}\n`);
    if (set.size === 0) process.stdout.write('  （空。只读动作不需要授权，默认放行）\n');
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
  saveAllow(set);
  process.stdout.write(`✓ 已授权 AI 调用 ${target}（风险等级 ${match.action.risk}）\n`);
  if (match.action.risk === 'destructive') {
    process.stdout.write('  注意：这是高风险动作，建议在 AI 客户端里也保持逐次确认。\n');
  }
  return 0;
}

export async function cli(args: string[]): Promise<number> {
  const sub = args[0];
  if (sub === 'serve') return serve();
  if (sub === 'config') return cmdConfig(args.slice(1));
  if (sub === 'allow') return cmdAllow(args.slice(1));
  process.stdout.write(`用法：
  zkit mcp serve            以 MCP server 方式运行（stdio，给 AI 客户端拉起）
  zkit mcp config [客户端]  打印接入配置；加 --write 直接写入（会备份原文件）
                            客户端：${clientSpecs().map((s) => s.key).join(' / ')}
  zkit mcp allow [动作]     授权有副作用的动作给 AI 调用（不加参数则列出已授权）
                            只读动作默认放行，不需要授权
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