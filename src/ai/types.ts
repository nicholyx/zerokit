/**
 * 模型层的统一抽象。
 *
 * 工作台的 agent 循环只依赖这里的类型，不依赖任何具体厂商；
 * 各家 SDK 的差异（消息格式、工具结果怎么回传、流事件长什么样）
 * 全部封装在各自的 Provider 实现里。
 */

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema 2020-12，根必须是 object */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolOutcome {
  id: string;
  ok: boolean;
  content: string;
}

export interface AssistantTurn {
  text: string;
  /** 模型本轮的思考摘要（部分模型才有） */
  thinking: string;
  toolCalls: ToolCall[];
  /** 归一化后的结束原因：end_turn / tool_use / max_tokens / refusal / other */
  stopReason: string;
  /** 原始结束原因，便于排查 */
  rawStopReason: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface StreamHandlers {
  onText?(delta: string): void;
  onThinking?(delta: string): void;
  /** 拿到完整的工具调用（在流结束后统一触发，便于先给用户看再执行） */
  onToolCalls?(calls: ToolCall[]): void;
}

export interface AgentSession {
  /** 追加一条用户消息 */
  send(text: string): void;
  /** 把工具执行结果交回模型（同一轮里所有结果必须一起回传） */
  addToolResults(results: ToolOutcome[]): void;
  /** 跑出下一轮助手消息，期间通过 handlers 流式推送 */
  next(handlers: StreamHandlers): Promise<AssistantTurn>;
}

export interface Provider {
  readonly id: string;
  readonly model: string;
  createSession(opts: { system: string; tools: ToolDef[] }): AgentSession;
}

export class ProviderError extends Error {
  readonly hint: string | undefined;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'ProviderError';
    this.hint = hint;
  }
}

/** 把各家的 stop_reason 归一化 */
export function normalizeStop(raw: string | null | undefined): string {
  switch (raw) {
    case 'end_turn':
    case 'stop':
    case 'stop_sequence':
      return 'end_turn';
    case 'tool_use':
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'max_tokens':
    case 'length':
      return 'max_tokens';
    case 'refusal':
    case 'content_filter':
      return 'refusal';
    default:
      return raw ? 'other' : 'end_turn';
  }
}