import type { AiSettings } from '../core/settings.ts';
import {
  type AgentSession, type AssistantTurn, type Provider,
  type StreamHandlers, type ToolCall, type ToolOutcome,
} from './types.ts';

/**
 * 不联网的假模型，用于自测 agent 循环。
 *
 * 行为是确定的：
 *   第一轮 → 挑一个工具调用（按关键词或第一个），把入参从用户句子里能抠出来的值填上
 *   收到工具结果后 → 用结果写一段总结，结束
 * 这样不用花一分钱、不需要密钥，也能把「工具调用 → 审批 → 执行 → 回填 → 收尾」
 * 整条链路和 UI 的每个状态都跑通。
 */

export function createMockProvider(_ai: AiSettings): Provider {
  return {
    id: 'mock',
    model: 'mock-1',

    createSession({ tools }): AgentSession {
      let pendingUser = '';
      let sawToolResult = false;
      const history: string[] = [];

      function pickTool(userText: string): { name: string; input: Record<string, unknown> } | null {
        if (tools.length === 0) return null;
        const text = userText.toLowerCase();
        // 关键词命中优先，否则用第一个工具
        const named = tools.find((t) => text.includes(t.name.toLowerCase()))
          ?? tools.find((t) => text.includes(t.name.split('__')[0]!.toLowerCase()));

        const chosen = named ?? tools[0]!;
        const input: Record<string, unknown> = {};
        const props = (chosen.inputSchema['properties'] ?? {}) as Record<string, Record<string, unknown>>;
        for (const [key, schema] of Object.entries(props)) {
          const type = schema['type'];
          // 从中文句子里抠一个像值的片段：优先引号内，其次英文/数字串
          const quoted = /["'“”「」]([^"'“”「」]+)["'“”「」]/.exec(userText);
          const bare = /[A-Za-z0-9][\w.\-:/]{1,60}/.exec(userText);
          const candidate = quoted?.[1] ?? bare?.[0] ?? '';
          if (type === 'integer' || type === 'number') {
            const num = /\d+/.exec(userText);
            input[key] = num ? Number(num[0]) : 1;
          } else if (type === 'boolean') {
            input[key] = true;
          } else {
            input[key] = candidate || 'example';
          }
        }
        return { name: chosen.name, input };
      }

      async function run(handlers: StreamHandlers): Promise<AssistantTurn> {
        const steps = sawToolResult
          ? [`已拿到工具返回结果。`, '根据结果，任务完成。']
          : [
            `收到：「${pendingUser}」`,
            tools.length > 0 ? '我先调用一个工具来获取需要的信息。' : '当前没有可用工具，只能直接回答。',
          ];

        let text = '';
        for (const step of steps) {
          for (const ch of step) {
            text += ch;
            handlers.onText?.(ch);
            await new Promise((r) => setTimeout(r, 3)); // 模拟流式打字
          }
          text += '\n';
          handlers.onText?.('\n');
        }

        const toolCalls: ToolCall[] = [];
        if (!sawToolResult) {
          const picked = pickTool(pendingUser);
          if (picked) {
            toolCalls.push({ id: `mock_${Date.now()}`, name: picked.name, input: picked.input });
            handlers.onToolCalls?.(toolCalls);
          }
        }

        sawToolResult = false;
        return {
          text,
          thinking: '',
          toolCalls,
          stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
          rawStopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
        };
      }

      return {
        send(text: string) {
          pendingUser = text;
          history.push(text);
        },
        addToolResults(results: ToolOutcome[]) {
          sawToolResult = results.length > 0;
          history.push(...results.map((r) => r.content.slice(0, 200)));
        },
        next: run,
      };
    },
  };
}