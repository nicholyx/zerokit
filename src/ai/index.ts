import { type AiSettings, loadSettings } from '../core/settings.ts';
import { createAnthropicProvider } from './anthropic.ts';
import { createMockProvider } from './mock.ts';
import { createOpenAiProvider } from './openai.ts';
import type { Provider } from './types.ts';

export function createProvider(ai: AiSettings = loadSettings().ai): Provider {
  switch (ai.provider) {
    case 'anthropic':
      return createAnthropicProvider(ai);
    case 'openai':
      return createOpenAiProvider(ai);
    default:
      return createMockProvider(ai);
  }
}

export * from './types.ts';
export { Workbench } from './agent.ts';