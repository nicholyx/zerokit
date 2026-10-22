import fs from 'node:fs';
import path from 'node:path';
import { ensureDirs, SETTINGS_DIR } from './paths.ts';
import { coerceParam } from './schema.ts';
import type { Plugin, PluginSetting } from './manifest.ts';

/**
 * 插件设置项的存储与解析。
 *
 * 设计上的三个硬约束：
 *
 * 1. **值不进清单、不进仓库**。清单只声明「有哪些设置、什么类型、默认值」，
 *    真实值落在 `~/.zerokit/settings/<插件id>.json`。密钥（`secret = true`）
 *    因此天然不会被 `git add` 带进仓库。
 * 2. **密钥在展示层打码，但不加密落盘**。文件权限 0600（目录 0700），
 *    安全边界是操作系统用户账号。不引入系统钥匙串：那会让「拷贝数据目录 =
 *    搬走整套配置」的承诺失效，而本项目没有构建步骤、也不该为密钥存储引入依赖。
 * 3. **坏值不静默降级**。存储里的值类型不对、必填项没填，都算「配置有问题」，
 *    执行前报错并给出可复制的修复命令，而不是悄悄用默认值继续跑。
 */

/** 密钥在 CLI / 界面 / 日志里的统一占位符 */
export const SECRET_MASK = '******';

export type SettingSource = 'stored' | 'default' | 'unset';

export interface SettingState {
  setting: PluginSetting;
  /** 生效值（仅 stored / default 两个来源有） */
  value?: unknown;
  source: SettingSource;
  /** 存储里的值不合法时的原因 */
  error?: string;
}

export interface SettingsView {
  states: SettingState[];
  /** 生效值，键是设置项名字 */
  values: Record<string, unknown>;
  /** 必填但没填的 */
  missing: string[];
  /** 存了但值不合法（类型不对、enum 不在候选里） */
  invalid: Array<{ name: string; error: string }>;
  /** 整个文件读不出来的原因（JSON 损坏 / 权限不足） */
  error?: string;
}

export function settingsPath(pluginId: string): string {
  return path.join(SETTINGS_DIR, `${pluginId}.json`);
}

function coerce(setting: PluginSetting, raw: unknown): { value?: unknown; error?: string } {
  // 设置项与动作参数共用同一套类型与校验规则，避免两处语义漂移
  return coerceParam(
    {
      name: setting.name,
      type: setting.type,
      description: setting.description,
      required: setting.required,
      ...(setting.default !== undefined ? { default: setting.default } : {}),
      ...(setting.enum ? { enum: setting.enum } : {}),
      ...(setting.secret ? { secret: true } : {}),
    },
    raw,
  );
}

/** 读原始存储。文件不存在 = 还没配过；JSON 坏了抛给调用方处理 */
function readStored(pluginId: string): Record<string, unknown> {
  const file = settingsPath(pluginId);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`读取 ${file} 失败：${(e as Error).message}`);
  }
  if (!text.trim()) return {};
  const raw = JSON.parse(text) as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${file} 的内容不是 JSON 对象`);
  }
  return raw as Record<string, unknown>;
}

/** 把存储内容与声明合并成「这次执行真正会用到的设置」 */
export function resolveSettings(plugin: Plugin): SettingsView {
  const view: SettingsView = { states: [], values: {}, missing: [], invalid: [] };
  if (plugin.settings.length === 0) return view;

  let stored: Record<string, unknown>;
  try {
    stored = readStored(plugin.id);
  } catch (e) {
    view.error = (e as Error).message;
    // 读不出来时宁可整份不可用，也不要拿默认值假装正常
    for (const setting of plugin.settings) {
      view.states.push({ setting, source: 'unset' });
    }
    view.missing = plugin.settings.filter((s) => s.required).map((s) => s.name);
    return view;
  }

  for (const setting of plugin.settings) {
    if (Object.prototype.hasOwnProperty.call(stored, setting.name)) {
      const r = coerce(setting, stored[setting.name]);
      if (r.error) {
        view.states.push({ setting, source: 'stored', error: r.error });
        view.invalid.push({ name: setting.name, error: r.error });
        continue;
      }
      view.states.push({ setting, value: r.value, source: 'stored' });
      view.values[setting.name] = r.value;
      continue;
    }
    if (setting.default !== undefined) {
      view.states.push({ setting, value: setting.default, source: 'default' });
      view.values[setting.name] = setting.default;
      continue;
    }
    view.states.push({ setting, source: 'unset' });
    if (setting.required) view.missing.push(setting.name);
  }
  return view;
}

/** 占位符变量：`{setting.endpoint}` */
export function settingsVars(view: SettingsView): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(view.values)) {
    vars[`setting.${name}`] = value === undefined || value === null ? '' : String(value);
  }
  return vars;
}

/** 环境变量：`ZEROKIT_SETTING_ENDPOINT`。脚本插件不改清单也能读到设置 */
export function settingsEnv(view: SettingsView): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(view.values)) {
    if (value === undefined || value === null) continue;
    env[`ZEROKIT_SETTING_${name.toUpperCase()}`] = String(value);
  }
  return env;
}

/** 界面上展示的形态：密钥永远不回显真实值 */
export interface PublicSetting {
  name: string;
  title: string;
  description: string;
  type: PluginSetting['type'];
  required: boolean;
  secret: boolean;
  enum?: string[];
  source: SettingSource;
  /** 非密钥项的真实值；密钥项不返回（避免任何一次 API 回显明文） */
  value?: unknown;
  /** 密钥项已设置时给前端看的掩码 */
  masked?: string;
  missing: boolean;
  error?: string;
}

export function publicSettings(plugin: Plugin): PublicSetting[] {
  const view = resolveSettings(plugin);
  return view.states.map((st) => {
    const s = st.setting;
    const out: PublicSetting = {
      name: s.name,
      title: s.title,
      description: s.description,
      type: s.type,
      required: s.required,
      secret: s.secret === true,
      source: st.source,
      missing: s.required && st.source === 'unset',
    };
    if (s.enum) out.enum = s.enum;
    if (st.error) out.error = st.error;
    if (st.source !== 'unset' && st.value !== undefined) {
      if (s.secret) out.masked = SECRET_MASK;
      else out.value = st.value;
    }
    return out;
  });
}

export interface WriteResult {
  ok: boolean;
  error?: string;
  /** 写入后重新解析的结果（供调用方直接回显） */
  view?: SettingsView;
}

/**
 * 写入一批设置：`null` 表示清除该项。
 *
 * 原子写（临时文件 + rename）：写到一半断电/被杀，不会留下半个 JSON，
 * 也就不会出现「配置看着在、其实解析不了」的状态。
 */
export function writeSettings(plugin: Plugin, patch: Record<string, unknown>): WriteResult {
  let stored: Record<string, unknown>;
  try {
    stored = readStored(plugin.id);
  } catch (e) {
    return { ok: false, error: `${(e as Error).message}（不覆盖坏文件，先修好或删掉它）` };
  }

  const byName = new Map(plugin.settings.map((s) => [s.name, s]));
  for (const [name, raw] of Object.entries(patch)) {
    const setting = byName.get(name);
    if (!setting) {
      return {
        ok: false,
        error: `插件 ${plugin.id} 没有声明设置项 "${name}"`
          + (plugin.settings.length > 0
            ? `。可用的是：${plugin.settings.map((s) => s.name).join(' / ')}`
            : '。这个插件不需要配置'),
      };
    }
    if (raw === null) {
      delete stored[name];
      continue;
    }
    const r = coerce(setting, raw);
    if (r.error) return { ok: false, error: r.error };
    if (r.value === undefined) {
      delete stored[name];
      continue;
    }
    stored[name] = r.value;
  }

  // 只保留仍然声明的键：插件升级删掉一个设置项后，老值不该继续躺在文件里
  const cleaned: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(stored)) {
    if (byName.has(name)) cleaned[name] = value;
  }

  try {
    ensureDirs();
    const file = settingsPath(plugin.id);
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(cleaned, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
    try { fs.chmodSync(file, 0o600); } catch { /* Windows 上 chmod 不生效，忽略 */ }
  } catch (e) {
    return { ok: false, error: `写入 ${settingsPath(plugin.id)} 失败：${(e as Error).message}` };
  }
  return { ok: true, view: resolveSettings(plugin) };
}

/** 缺失必填设置时给使用者的命令提示（CLI / 错误信息共用同一份措辞） */
export function settingsHints(plugin: Plugin, view: SettingsView): string[] {
  const byName = new Map(view.states.map((st) => [st.setting.name, st.setting]));
  return view.missing.map((name) => {
    const setting = byName.get(name);
    const hint = setting?.secret
      ? `zkit config ${plugin.id} set ${name} --stdin`
      : `zkit config ${plugin.id} set ${name} <值>`;
    return setting?.secret
      ? `${name}（密钥，用 --stdin 从标准输入读，别写进 shell 历史）：${hint}`
      : `${name}：${hint}`;
  });
}
