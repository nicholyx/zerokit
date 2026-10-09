import type { Action, ActionParam } from './manifest.ts';

/**
 * 参数投影：同一份 [action.params] 声明，投影成四种形态。
 *
 *   toJsonSchema  → MCP 的 inputSchema（JSON Schema 2020-12，根必须是 object）
 *   toCliFlags    → CLI 的 --flag / -f
 *   parseArgv     → 从 CLI 参数解析出值
 *   toFormFields  → 启动器/Web 的表单字段
 *
 * 这是"一份清单，四个面"的核心：加一个参数，四个面同时多出来，不用各处改。
 */

export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
}

function jsonTypeOf(p: ActionParam): Record<string, unknown> {
  switch (p.type) {
    case 'integer': return { type: 'integer' };
    case 'number': return { type: 'number' };
    case 'boolean': return { type: 'boolean' };
    case 'enum': return { type: 'string', enum: p.enum ?? [] };
    case 'path': return { type: 'string' };
    default: return { type: 'string' };
  }
}

export function toJsonSchema(action: Action): JsonSchemaObject {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of action.params) {
    const schema: Record<string, unknown> = { ...jsonTypeOf(p) };
    // description 会直接进 MCP，是模型判断该传什么的依据
    const hint = p.type === 'path' && !/路径/.test(p.description)
      ? `${p.description}（文件或目录路径）`.trim()
      : p.description;
    if (hint) schema['description'] = hint;
    if (p.default !== undefined) schema['default'] = p.default;
    properties[p.name] = schema;
    if (p.required) required.push(p.name);
  }
  const out: JsonSchemaObject = { type: 'object', properties, additionalProperties: false };
  if (required.length > 0) out.required = required;
  return out;
}

export interface CliFlag {
  name: string;
  short?: string;
  takesValue: boolean;
  description: string;
  required: boolean;
  default?: unknown;
}

export function toCliFlags(action: Action): CliFlag[] {
  return action.params.map((p) => {
    const flag: CliFlag = {
      name: p.name,
      takesValue: p.type !== 'boolean',
      description: p.description,
      required: p.required,
    };
    if (p.short) flag.short = p.short;
    if (p.default !== undefined) flag.default = p.default;
    return flag;
  });
}

export type FormFieldType = 'text' | 'number' | 'checkbox' | 'select' | 'path';

export interface FormField {
  name: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  help: string;
  default?: unknown;
  options?: string[];
}

export function toFormFields(action: Action): FormField[] {
  return action.params.map((p) => {
    const type: FormFieldType =
      p.type === 'boolean' ? 'checkbox'
        : p.type === 'enum' ? 'select'
          : p.type === 'integer' || p.type === 'number' ? 'number'
            : p.type === 'path' ? 'path'
              : 'text';
    const field: FormField = {
      name: p.name,
      label: p.name,
      type,
      required: p.required,
      help: p.description,
    };
    if (p.default !== undefined) field.default = p.default;
    if (p.enum) field.options = p.enum;
    return field;
  });
}

/** 把外部来的原始值（CLI 字符串 / 表单字符串 / JSON）转成参数声明的类型 */
export function coerceParam(p: ActionParam, raw: unknown): { value?: unknown; error?: string } {
  const text = typeof raw === 'string' ? raw.trim() : raw;
  switch (p.type) {
    case 'boolean': {
      if (typeof text === 'boolean') return { value: text };
      if (text === '' || text === undefined || text === null) return { value: true };
      const s = String(text).toLowerCase();
      if (['1', 'true', 'yes', 'y', 'on', '是'].includes(s)) return { value: true };
      if (['0', 'false', 'no', 'n', 'off', '否'].includes(s)) return { value: false };
      return { error: `参数 ${p.name} 需要布尔值，收到 "${text}"` };
    }
    case 'integer': {
      const n = Number(text);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        return { error: `参数 ${p.name} 需要整数，收到 "${text}"` };
      }
      return { value: n };
    }
    case 'number': {
      const n = Number(text);
      if (!Number.isFinite(n)) return { error: `参数 ${p.name} 需要数字，收到 "${text}"` };
      return { value: n };
    }
    case 'enum': {
      const s = String(text);
      if (p.enum && !p.enum.includes(s)) {
        return { error: `参数 ${p.name} 只能是：${p.enum.join(' / ')}，收到 "${s}"` };
      }
      return { value: s };
    }
    default: {
      if (text === undefined || text === null) return { value: undefined };
      return { value: String(text) };
    }
  }
}

export interface ArgvParseResult {
  values: Record<string, unknown>;
  errors: string[];
  help: boolean;
}

/** 解析 CLI 参数：`zkit run <plugin> <action> --days 7 --force` */
export function parseArgv(action: Action, argv: string[]): ArgvParseResult {
  const values: Record<string, unknown> = {};
  const errors: string[] = [];
  let help = false;

  const byFlag = new Map<string, ActionParam>();
  for (const p of action.params) {
    byFlag.set(`--${p.name}`, p);
    if (p.short) byFlag.set(`-${p.short}`, p);
  }

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === '--help' || token === '-h') {
      help = true;
      continue;
    }
    if (!token.startsWith('-')) {
      errors.push(`多余的参数 "${token}"`);
      continue;
    }
    let flag = token;
    let inlineValue: string | undefined;
    const eq = token.indexOf('=');
    if (eq > 0) {
      flag = token.slice(0, eq);
      inlineValue = token.slice(eq + 1);
    }
    const param = byFlag.get(flag);
    if (!param) {
      errors.push(`未知参数 "${flag}"`);
      continue;
    }
    let raw: unknown = inlineValue;
    if (raw === undefined) {
      if (param.type === 'boolean') {
        raw = true;
      } else {
        const next = argv[i + 1];
        if (next === undefined) {
          errors.push(`参数 ${flag} 缺少值`);
          continue;
        }
        raw = next;
        i++;
      }
    }
    const coerced = coerceParam(param, raw);
    if (coerced.error) errors.push(coerced.error);
    else values[param.name] = coerced.value;
  }

  return { values, errors, help };
}

/** 校验必填项、补齐默认值 */
export function applyDefaults(action: Action, values: Record<string, unknown>): {
  values: Record<string, unknown>;
  errors: string[];
} {
  const out: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const p of action.params) {
    const provided = values[p.name];
    if (provided === undefined) {
      if (p.default !== undefined) out[p.name] = p.default;
      else if (p.required) errors.push(`缺少必填参数 --${p.name}（${p.description || '无说明'}）`);
      continue;
    }
    const coerced = coerceParam(p, provided);
    if (coerced.error) errors.push(coerced.error);
    else out[p.name] = coerced.value;
  }
  return { values: out, errors };
}