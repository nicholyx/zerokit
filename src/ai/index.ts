import { type AiSettings, loadSettings } from '../core/settings.ts';
import type { Provider } from './types.ts';

/**
 * provider 工厂。
 *
 * **每个 provider 都是延迟加载的**，这不是洁癖而是实测出来的：
 * `@anthropic-ai/sdk` 光 import 就要 240 ms，而启动器绝大多数时候根本用不上它
 * （用户可能没配模型、或者用的是 OpenAI 兼容端点）。顶层静态导入会让每一次
 * 启动都白付这笔钱，所以改成用到哪个才加载哪个。
 */
export async function createProvider(ai: AiSettings = loadSettings().ai): Promise<Provider> {
  switch (ai.provider) {
    case 'anthropic': {
      const { createAnthropicProvider } = await import('./anthropic.ts');
      return createAnthropicProvider(ai);
    }
    case 'openai': {
      const { createOpenAiProvider } = await import('./openai.ts');
      return createOpenAiProvider(ai);
    }
    default: {
      const { createMockProvider } = await import('./mock.ts');
      return createMockProvider(ai);
    }
  }
}

export type * from './types.ts';
export { Workbench, collectToolDefs, buildSystemPrompt } from './agent.ts';