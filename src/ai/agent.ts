import { type Plugin, type RiskLevel, toolName } from '../core/manifest.ts';
import { listPlugins } from '../core/registry.ts';
import { hasApproval, rememberApproval } from '../core/approvals.ts';
import { applyDefaults, coerceParam, toJsonSchema } from '../core/schema.ts';
import { type RunResult, buildArgv, displayCommand, runAction } from '../core/runner.ts';
import type { Provider, ToolCall, ToolDef, ToolOutcome } from './types.ts';

/**
 * 工作台：把插件动作当成模型的工具，跑「模型 → 工具 → 模型」的循环。
 *
 * 两个设计要点：
 *   1. 它和 MCP 面用的是**同一份插件清单**，所以工作台里能用的工具，
 *      和 Claude Code / Cursor 里能用的完全一致——吃自己的狗粮。
 *   2. 有副作用的动作在**执行前会挂起**，等界面上的用户点确认；
 *      确认框里给的是解析后的完整命令，看到什么就是跑什么。
 */

const MAX_STEPS = 8;
const TOOL_OUTPUT_LIMIT = 8000;
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

export interface ToolCallView {
  id: string;
  tool: string;
  pluginId: string;
  pluginName: string;
  actionId: string;
  actionTitle: string;
  risk: RiskLevel;
  /** 解析后的完整命令——给用户看的，看到什么就是跑什么 */
  command: string;
}

export interface ToolResultView {
  id: string;
  tool: string;
  ok: boolean;
  ms: number;
  summary: string;
  stdout: string;
  error?: string;
  /** 因为用户没批准而没执行 */
  declined?: boolean;
}

export interface AgentHandlers {
  onText?(delta: string): void;
  onThinking?(delta: string): void;
  /** 需要用户确认才能执行 */
  onToolPending?(call: ToolCallView): void;
  /** 开始执行 */
  onToolStart?(call: ToolCallView): void;
  onToolResult?(result: ToolResultView): void;
  onDone?(info: { text: string; steps: number }): void;
  onError?(message: string): void;
}

interface Target {
  plugin: Plugin;
  action: Plugin['actions'][number];
}

function toolIndex(): Map<string, Target> {
  const map = new Map<string, Target>();
  for (const entry of listPlugins()) {
    if (!entry.plugin) continue;
    for (const action of entry.plugin.actions) {
      map.set(toolName(entry.plugin.id, action.id), { plugin: entry.plugin, action });
    }
  }
  return map;
}

export function collectToolDefs(): ToolDef[] {
  const defs: ToolDef[] = [];
  for (const entry of listPlugins()) {
    if (!entry.plugin) continue;
    for (const action of entry.plugin.actions) {
      defs.push({
        name: toolName(entry.plugin.id, action.id),
        // 工具描述直接决定模型选不选它，所以带上插件上下文和风险提示
        description: [
          action.description || entry.plugin.summary,
          `[插件 ${entry.plugin.name}]`,
          action.risk === 'read' ? '' : `（有副作用的动作，风险等级 ${action.risk}）`,
        ].filter(Boolean).join(' '),
        inputSchema: toJsonSchema(action) as unknown as Record<string, unknown>,
      });
    }
  }
  return defs;
}

export function buildSystemPrompt(): string {
  const plugins = listPlugins().filter((e) => e.plugin);
  const lines = [
    '你是 zerokit 工作台。你可以调用用户本机上已经安装的插件动作来完成请求。',
    '',
    '规则：',
    '- 需要真实数据时优先调用工具，不要凭记忆编造。',
    '- 有副作用的动作执行前会弹给用户确认，用户可能拒绝——被拒绝就换一种方式或如实说明。',
    '- 工具返回的是本机真实输出，可能包含中文，请按原文理解。',
    '- 用用户使用的语言回答。',
    '- 调用工具前先用一句话说明你要做什么。',
    '',
    `当前可用插件 ${plugins.length} 个：`,
  ];
  for (const entry of plugins) {
    const p = entry.plugin!;
    lines.push(`- ${p.name}（${p.id}）：${p.summary || '无说明'}`);
  }
  return lines.join('\n');
}

function summarize(result: RunResult, limit = TOOL_OUTPUT_LIMIT): string {
  const body = result.data !== undefined
    ? JSON.stringify(result.data, null, 2)
    : result.stdout;
  if (!body) return result.ok ? '（执行成功，无输出）' : (result.error ?? '（失败，无输出）');
  if (body.length <= limit) return body;
  return `${body.slice(0, limit)}\n…（输出过长已截断，完整内容：${result.artifactPath ?? '见日志'}）`;
}

export class Workbench {
  private readonly session: ReturnType<Provider['createSession']>;
  private readonly index = new Map<string, Target>();
  private readonly waiting = new Map<string, (allow: boolean) => void>();

  constructor(provider: Provider) {
    this.index = toolIndex();
    this.session = provider.createSession({
      system: buildSystemPrompt(),
      tools: collectToolDefs(),
    });
  }

  /** 界面上用户点了「允许 / 拒绝」后调这里，唤醒挂起的那次调用 */
  resolveApproval(callId: string, allow: boolean): boolean {
    const resolve = this.waiting.get(callId);
    if (!resolve) return false;
    this.waiting.delete(callId);
    resolve(allow);
    return true;
  }

  private waitApproval(callId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.waiting.delete(callId)) resolve(false);
      }, APPROVAL_TIMEOUT_MS);
      this.waiting.set(callId, (allow) => {
        clearTimeout(timer);
        resolve(allow);
      });
    });
  }

  private describe(call: ToolCall, target: Target): ToolCallView {
    let command = '';
    try {
      const parsed = this.parseInput(target, call.input);
      if (!parsed.errors.length) {
        const { argv } = buildArgv(target.plugin, target.action, parsed.values);
        command = displayCommand(target.action, argv);
      }
    } catch {
      command = '（无法解析出命令）';
    }
    return {
      id: call.id,
      tool: call.name,
      pluginId: target.plugin.id,
      pluginName: target.plugin.name,
      actionId: target.action.id,
      actionTitle: target.action.title,
      risk: target.action.risk,
      command,
    };
  }

  /** 模型给的入参是不可信输入：按清单声明逐个校验，并拒绝未知字段 */
  private parseInput(target: Target, raw: unknown): { values: Record<string, unknown>; errors: string[] } {
    const errors: string[] = [];
    const values: Record<string, unknown> = {};
    const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    if ((input as Record<string, unknown>)['__parseError']) {
      return { values, errors: ['模型给出的工具入参不是合法 JSON'] };
    }
    for (const p of target.action.params) {
      if (input[p.name] === undefined) continue;
      const r = coerceParam(p, input[p.name]);
      if (r.error) errors.push(r.error);
      else values[p.name] = r.value;
    }
    for (const key of Object.keys(input)) {
      if (!target.action.params.some((p) => p.name === key)) errors.push(`未知参数 "${key}"`);
    }
    const withDefaults = applyDefaults(target.action, values);
    errors.push(...withDefaults.errors);
    return { values: withDefaults.values, errors };
  }

  private async execute(call: ToolCall, target: Target, handlers: AgentHandlers): Promise<ToolResultView> {
    const view = this.describe(call, target);
    handlers.onToolStart?.(view);

    const parsed = this.parseInput(target, call.input);
    if (parsed.errors.length > 0) {
      const message = `入参不合法：${parsed.errors.join('；')}`;
      const result: ToolResultView = {
        id: call.id, tool: call.name, ok: false, ms: 0,
        summary: message, stdout: '', error: message,
      };
      handlers.onToolResult?.(result);
      return result;
    }

    const result = await runAction(target.plugin, target.action, {
      caller: 'ui',
      values: parsed.values,
    });
    const view2: ToolResultView = {
      id: call.id,
      tool: call.name,
      ok: result.ok,
      ms: result.ms,
      summary: summarize(result),
      stdout: result.stdout,
      ...(result.error ? { error: result.error } : {}),
    };
    handlers.onToolResult?.(view2);
    return view2;
  }

  /** 跑一轮：从用户消息开始，直到模型不再要求调用工具 */
  async chat(userText: string, handlers: AgentHandlers): Promise<void> {
    this.session.send(userText);
    let steps = 0;

    try {
      while (steps < MAX_STEPS) {
        steps++;
        const turn = await this.session.next({
          onText: (d) => handlers.onText?.(d),
          onThinking: (d) => handlers.onThinking?.(d),
        });

        if (turn.stopReason === 'refusal') {
          handlers.onError?.('模型拒绝了这个请求（安全策略）。可以换个说法，或改用其他模型。');
          return;
        }
        if (turn.toolCalls.length === 0) {
          handlers.onDone?.({ text: turn.text, steps });
          return;
        }

        const outcomes: ToolOutcome[] = [];
        for (const call of turn.toolCalls) {
          const target = this.index.get(call.name);
          if (!target) {
            outcomes.push({
              id: call.id, ok: false,
              content: `没有这个工具：${call.name}。可能插件被卸载了，请让用户重新加载。`,
            });
            continue;
          }

          // 有副作用的动作：先挂起等用户确认（只读动作直接跑）
          const preApproved = hasApproval(target.plugin.id, target.action.id);
          const needAsk = target.action.risk !== 'read' && !preApproved;
          if (needAsk) {
            const view = this.describe(call, target);
            handlers.onToolPending?.(view);
            const allow = await this.waitApproval(call.id);
            if (!allow) {
              const declined: ToolResultView = {
                id: call.id, tool: call.name, ok: false, ms: 0,
                summary: '用户拒绝了这次调用', stdout: '', declined: true,
              };
              handlers.onToolResult?.(declined);
              outcomes.push({
                id: call.id, ok: false,
                content: '用户拒绝执行这个工具调用。不要重试，改用其他办法或如实告诉用户。',
              });
              continue;
            }
            rememberApproval(target.plugin.id, target.action.id);
          }

          const view = await this.execute(call, target, handlers);
          outcomes.push({
            id: call.id,
            ok: view.ok,
            content: view.ok
              ? view.summary
              : `${view.error ?? '执行失败'}\n${view.summary}`.trim(),
          });
        }

        this.session.addToolResults(outcomes);
      }
      handlers.onError?.(`达到单轮最大步数（${MAX_STEPS}），已停止。可以再发一条消息继续。`);
    } catch (e) {
      handlers.onError?.((e as Error).message ?? String(e));
    }
  }
}