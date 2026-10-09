import fs from 'node:fs';
import { CONFIG_PATH, ensureDirs } from './paths.ts';

/**
 * zerokit 自身的设置（不是插件的），放在 ~/.zerokit/config.toml。
 *
 * 只从文件读、不读环境变量：密钥不落进 shell 历史和环境快照，
 * 而整个 ~/.zerokit 目录本来就可以整体拷走。
 *
 *   [ai]
 *   provider = "anthropic"          # anthropic | openai | mock
 *   model    = "claude-opus-5-5"
 *   api_key  = "sk-ant-..."
 *   base_url = ""                   # provider = openai 时填，例如 https://api.deepseek.com/v1
 *   effort   = "high"               # low | medium | high | xhigh | max
 *   max_tokens = 64000
 */

export type ProviderId = 'anthropic' | 'openai' | 'mock';

export interface AiSettings {
  provider: ProviderId;
  model: string;
  apiKey: string;
  baseUrl: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens: number;
}

export interface Settings {
  ai: AiSettings;
  exists: boolean;
}

const DEFAULT_AI: AiSettings = {
  provider: 'mock',
  model: 'claude-opus-5-5',
  apiKey: '',
  baseUrl: '',
  effort: 'high',
  maxTokens: 64000,
};

const SAMPLE = `# zerokit 设置

[ai]
# provider 可选：anthropic（官方 SDK）| openai（任何 OpenAI 兼容端点）| mock（不联网，用于自测）
provider = "anthropic"
model = "claude-opus-5-5"
# 密钥只放在这个文件里，不读环境变量
api_key = ""
# provider = "openai" 时填这里，例如：
#   https://api.deepseek.com/v1
#   http://127.0.0.1:11434/v1     （本地 Ollama）
base_url = ""
effort = "high"
max_tokens = 64000
`;

/** 极简 TOML 读取：本文件的结构很简单，只支持 [section] 与 key = value */
function parseSimpleToml(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let section = '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const sec = /^\[([^\]]+)\]$/.exec(line);
    if (sec) {
      section = sec[1]!.trim();
      out[section] ??= {};
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // 去掉行尾注释（不考虑引号内的 #，本文件用不到）
    const hash = value.indexOf(' #');
    if (hash >= 0 && !/^["']/.test(value)) value = value.slice(0, hash).trim();
    value = value.replace(/^["']|["']$/g, '');
    out[section] ??= {};
    out[section]![key] = value;
  }
  return out;
}

let cached: Settings | undefined;

export function loadSettings(force = false): Settings {
  if (cached && !force) return cached;

  if (!fs.existsSync(CONFIG_PATH)) {
    try {
      ensureDirs();
      fs.writeFileSync(CONFIG_PATH, SAMPLE);
    } catch {
      /* 写不了就只读默认值 */
    }
    cached = { ai: { ...DEFAULT_AI }, exists: false };
    return cached;
  }

  let table: Record<string, Record<string, string>> = {};
  try {
    table = parseSimpleToml(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    table = {};
  }
  const ai = table['ai'] ?? {};

  const providerRaw = (ai['provider'] ?? '').toLowerCase();
  const provider: ProviderId =
    providerRaw === 'anthropic' || providerRaw === 'openai' || providerRaw === 'mock'
      ? providerRaw
      : DEFAULT_AI.provider;

  const effortRaw = (ai['effort'] ?? '').toLowerCase();
  const effort = (['low', 'medium', 'high', 'xhigh', 'max'] as const)
    .find((e) => e === effortRaw) ?? DEFAULT_AI.effort;

  const maxTokens = Number(ai['max_tokens']);
  const model = ai['model']?.trim() || DEFAULT_AI.model;

  cached = {
    exists: true,
    ai: {
      provider,
      model,
      apiKey: ai['api_key'] ?? '',
      baseUrl: (ai['base_url'] ?? '').replace(/\/+$/, ''),
      effort,
      maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : DEFAULT_AI.maxTokens,
    },
  };
  return cached;
}

export interface AiReadiness {
  ready: boolean;
  reason?: string;
  hint?: string;
}

/** 检查 AI 是否配置到能用的程度；不能用时给出可操作的指引 */
export function checkAiReady(s: Settings = loadSettings()): AiReadiness {
  const { provider, apiKey, baseUrl } = s.ai;
  if (provider === 'mock') return { ready: true };
  if (!apiKey) {
    return {
      ready: false,
      reason: '没有配置 API 密钥',
      hint: `在 ${CONFIG_PATH} 的 [ai] 段里填上 api_key = "..."`,
    };
  }
  if (provider === 'openai' && !baseUrl) {
    return {
      ready: false,
      reason: 'provider = "openai" 但没填 base_url',
      hint: `在 ${CONFIG_PATH} 的 [ai] 段里填上 base_url，例如 https://api.deepseek.com/v1`,
    };
  }
  return { ready: true };
}

export function resetSettingsCache(): void {
  cached = undefined;
}