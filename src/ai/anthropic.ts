import Anthropic from '@anthropic-ai/sdk';
import type { AiSettings } from '../core/settings.ts';
import {
  type AgentSession, type AssistantTurn, type Provider, ProviderError,
  type StreamHandlers, type ToolCall, type ToolDef, type ToolOutcome,
  normalizeStop,
} from './types.ts';

/**
 * Claude 走官方 SDK（不用任何 OpenAI 兼容层）。
 *
 * 几个 Opus 5.5 上的硬约束，写错会直接 400：
 *   - 不能强制 tool_choice（any / tool 都是 400）→ 用 auto + 提示词引导 + strict: true
 *   - thinking 不能禁用 → 用 adaptive，深度用 output_config.effort 控
 *   - 没有 assistant 预填充
 * 另外 tool_result 必须放在同一条 user 消息里一起回传。
 */

const FALLBACK_BETA = 'server-side-fallback-2026-06-01';
const FALLBACK_MODEL = 'claude-opus-4-8';

/** strict 模式要求 additionalProperties:false 且必须有 required 数组 */
function strictify(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ...schema,
    additionalProperties: false,
  };
  if (!Array.isArray(out['required'])) out['required'] = [];
  return out;
}

export function createAnthropicProvider(ai: AiSettings): Provider {
  if (!ai.apiKey) {
    throw new ProviderError(
      '没有配置 Anthropic API 密钥',
      '在 ~/.zerokit/config.toml 的 [ai] 段里填 api_key，或用 provider = "openai" 接别的模型',
    );
  }
  const client = new Anthropic({ apiKey: ai.apiKey });
  // 如果服务端不接受 fallbacks（老账号/平台差异），第一次失败后就不要再带
  let useFallbacks = true;

  return {
    id: 'anthropic',
    model: ai.model,

    createSession({ system, tools }): AgentSession {
      const messages: Anthropic.Beta.BetaMessageParam[] = [];

      const toolDefs = tools.map((t) => ({
        name: t.name,
        description: t.description || t.name,
        input_schema: strictify(t.inputSchema),
        strict: true,
        // 让大段工具入参边生成边流式到达；相应地客户端必须自己校验
        eager_input_streaming: true,
      }));

      async function run(handlers: StreamHandlers): Promise<AssistantTurn> {
        const base = {
          model: ai.model,
          max_tokens: ai.maxTokens,
          system,
          tools: toolDefs,
          messages,
          thinking: { type: 'adaptive' as const, display: 'summarized' as const },
          output_config: { effort: ai.effort },
        };

        const attempt = async (withFallback: boolean) => {
          const params: Record<string, unknown> = { ...base };
          if (withFallback) {
            params['betas'] = [FALLBACK_BETA];
            params['fallbacks'] = [{ model: FALLBACK_MODEL }];
          }
          const stream = client.beta.messages.stream(params as never);
          stream.on('text', (delta: string) => handlers.onText?.(delta));
          stream.on('thinking', (delta: string) => handlers.onThinking?.(delta));
          return stream.finalMessage();
        };

        let message: Anthropic.Beta.BetaMessage;
        try {
          message = await attempt(useFallbacks);
        } catch (e) {
          // fallbacks 是较新的参数，服务端不认时降级重试一次，而不是让整个会话失败
          if (
            useFallbacks
            && e instanceof Anthropic.BadRequestError
            && /fallback|beta/i.test(e.message)
          ) {
            useFallbacks = false;
            message = await attempt(false);
          } else {
            throw wrapError(e);
          }
        }

        const text = message.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');
        const thinking = message.content
          .filter((b): b is Anthropic.Beta.BetaThinkingBlock => b.type === 'thinking')
          .map((b) => b.thinking)
          .join('');

        const toolCalls: ToolCall[] = message.content
          .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
          .map((b) => ({ id: b.id, name: b.name, input: b.input }));

        // 原样把整轮 content 回填（含 thinking 块），这是规范要求的
        messages.push({ role: 'assistant', content: message.content });
        if (toolCalls.length > 0) handlers.onToolCalls?.(toolCalls);

        return {
          text,
          thinking,
          toolCalls,
          stopReason: normalizeStop(message.stop_reason),
          rawStopReason: String(message.stop_reason ?? ''),
          usage: {
            inputTokens: message.usage?.input_tokens,
            outputTokens: message.usage?.output_tokens,
          },
        };
      }

      return {
        send(text: string) {
          messages.push({ role: 'user', content: text });
        },
        addToolResults(results: ToolOutcome[]) {
          // 一轮里所有工具结果必须放在同一条 user 消息里，拆开会让模型不再并行调用工具
          messages.push({
            role: 'user',
            content: results.map((r) => ({
              type: 'tool_result' as const,
              tool_use_id: r.id,
              content: r.content,
              ...(r.ok ? {} : { is_error: true }),
            })),
          });
        },
        next: run,
      };
    },
  };
}

function wrapError(e: unknown): Error {
  if (e instanceof Anthropic.AuthenticationError) {
    return new ProviderError('Anthropic API 密钥无效或被拒绝', '检查 config.toml 里的 api_key');
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new ProviderError('被限流了（429）', '稍后重试，或换用 provider = "openai" 接别的模型');
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new ProviderError(
      `连不上 Anthropic API：${e.message}`,
      '检查网络或代理设置（本机对不少域名有出口限制）',
    );
  }
  if (e instanceof Anthropic.APIError) {
    return new ProviderError(`Anthropic API 报错（${e.status ?? '?'}）：${e.message}`);
  }
  return e instanceof Error ? e : new Error(String(e));
}