import type { AiSettings } from '../core/settings.ts';
import {
  type AgentSession, type AssistantTurn, type Provider, ProviderError,
  type StreamHandlers, type ToolCall, type ToolDef, type ToolOutcome,
  normalizeStop,
} from './types.ts';

/**
 * 任何 OpenAI 兼容端点（DeepSeek / 通义 / Kimi / 本地 Ollama / vLLM …）。
 *
 * 这里用原始 HTTP 而不是 OpenAI 官方 SDK：目标端点五花八门，
 * 只要它们兼容 /chat/completions 就够了，多引一个 SDK 不划算。
 *
 * 流式里工具调用是**碎片化**到达的：delta.tool_calls[] 会按 index 分多次给
 * id / name / arguments 片段，必须按 index 累积后再 JSON.parse。
 */

interface Accumulated {
  id: string;
  name: string;
  args: string;
}

export function createOpenAiProvider(ai: AiSettings): Provider {
  if (!ai.apiKey) {
    throw new ProviderError(
      '没有配置 API 密钥',
      '在 ~/.zerokit/config.toml 的 [ai] 段里填 api_key',
    );
  }
  if (!ai.baseUrl) {
    throw new ProviderError(
      'provider = "openai" 但没有配 base_url',
      '例如 base_url = "https://api.deepseek.com/v1" 或 "http://127.0.0.1:11434/v1"',
    );
  }
  const endpoint = `${ai.baseUrl}/chat/completions`;

  return {
    id: 'openai',
    model: ai.model,

    createSession({ system, tools }): AgentSession {
      const messages: Array<Record<string, unknown>> = [];
      if (system) messages.push({ role: 'system', content: system });

      const toolDefs = tools.map((t: ToolDef) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description || t.name,
          parameters: t.inputSchema,
        },
      }));

      async function run(handlers: StreamHandlers): Promise<AssistantTurn> {
        const body: Record<string, unknown> = {
          model: ai.model,
          messages,
          stream: true,
          max_tokens: ai.maxTokens,
        };
        if (toolDefs.length > 0) {
          body['tools'] = toolDefs;
          body['tool_choice'] = 'auto';
        }

        let res: Response;
        try {
          res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${ai.apiKey}`,
            },
            body: JSON.stringify(body),
          });
        } catch (e) {
          throw new ProviderError(
            `连不上 ${endpoint}：${(e as Error).message}`,
            '检查 base_url 与网络；本机对部分域名有出口限制',
          );
        }

        if (!res.ok || !res.body) {
          const detail = await res.text().catch(() => '');
          const hint = res.status === 401 || res.status === 403
            ? '检查 config.toml 里的 api_key'
            : res.status === 404
              ? '检查 base_url 是否带对了 /v1 这类路径前缀'
              : undefined;
          throw new ProviderError(
            `模型接口返回 ${res.status}：${detail.slice(0, 400) || res.statusText}`,
            hint,
          );
        }

        let text = '';
        let finish = '';
        const calls = new Map<number, Accumulated>();

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        const handlePayload = (payload: string) => {
          if (payload === '[DONE]') return;
          let json: Record<string, unknown>;
          try {
            json = JSON.parse(payload) as Record<string, unknown>;
          } catch {
            return; // 忽略不完整/心跳行
          }
          const choices = json['choices'] as Array<Record<string, unknown>> | undefined;
          const choice = choices?.[0];
          if (!choice) return;
          const delta = (choice['delta'] ?? {}) as Record<string, unknown>;
          const piece = delta['content'];
          if (typeof piece === 'string' && piece) {
            text += piece;
            handlers.onText?.(piece);
          }
          const reasoning = delta['reasoning_content'] ?? delta['reasoning'];
          if (typeof reasoning === 'string' && reasoning) handlers.onThinking?.(reasoning);

          const tc = delta['tool_calls'] as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(tc)) {
            for (const item of tc) {
              const index = Number(item['index'] ?? 0);
              const cur = calls.get(index) ?? { id: '', name: '', args: '' };
              if (typeof item['id'] === 'string') cur.id = item['id'];
              const fn = item['function'] as Record<string, unknown> | undefined;
              if (fn) {
                if (typeof fn['name'] === 'string') cur.name = fn['name'];
                if (typeof fn['arguments'] === 'string') cur.args += fn['arguments'];
              }
              calls.set(index, cur);
            }
          }
          if (typeof choice['finish_reason'] === 'string') finish = choice['finish_reason'];
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (line.startsWith('data:')) handlePayload(line.slice(5).trim());
          }
        }
        if (buf.trim().startsWith('data:')) handlePayload(buf.trim().slice(5).trim());

        const toolCalls: ToolCall[] = [];
        for (const [index, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
          let input: unknown = {};
          if (c.args.trim()) {
            try {
              input = JSON.parse(c.args);
            } catch {
              input = { __raw: c.args, __parseError: true };
            }
          }
          toolCalls.push({ id: c.id || `call_${index}`, name: c.name, input });
        }

        // 回填助手消息（OpenAI 协议要求带 tool_calls 才能对应到后面的 tool 结果）
        messages.push({
          role: 'assistant',
          content: text || null,
          ...(toolCalls.length > 0
            ? {
              tool_calls: toolCalls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
              })),
            }
            : {}),
        });
        if (toolCalls.length > 0) handlers.onToolCalls?.(toolCalls);

        return {
          text,
          thinking: '',
          toolCalls,
          stopReason: normalizeStop(finish),
          rawStopReason: finish,
        };
      }

      return {
        send(text: string) {
          messages.push({ role: 'user', content: text });
        },
        addToolResults(results: ToolOutcome[]) {
          // OpenAI 协议里每个工具结果是一条独立的 tool 消息，按 tool_call_id 对应
          for (const r of results) {
            messages.push({
              role: 'tool',
              tool_call_id: r.id,
              content: r.ok ? r.content : `错误：${r.content}`,
            });
          }
        },
        next: run,
      };
    },
  };
}