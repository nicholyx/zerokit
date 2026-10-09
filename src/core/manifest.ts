import fs from 'node:fs';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';

/**
 * 插件清单（plugin.toml）的类型与校验。
 *
 * 设计要点：这份清单是**唯一事实来源**，四个面（启动器/CLI/MCP/Web）全部由它派生。
 * 因此这里的字段既是给人看的界面描述，也是给模型看的工具描述。
 */

/** 插件 id / 动作 id 的字符集。必须是 ASCII：MCP 工具名只允许 ^[A-Za-z0-9._-]{1,128}$ */
export const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** 参数名要能同时当 JSON Schema 属性名和 CLI flag */
export const PARAM_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export const PARAM_TYPES = ['string', 'integer', 'number', 'boolean', 'path', 'enum'] as const;
export const RISK_LEVELS = ['read', 'mutate', 'destructive'] as const;

export type ParamType = (typeof PARAM_TYPES)[number];
export type RiskLevel = (typeof RISK_LEVELS)[number];
export type OutputKind = 'text' | 'json' | 'markdown' | 'table' | 'file' | 'html';
export type RenderKind = 'text' | 'table' | 'json' | 'markdown' | 'keyvalue' | 'image' | 'link';
export type ActionType = 'exec' | 'http';

/**
 * 内容智能匹配：输入框里的东西（或剪贴板内容）**像什么**，就自动推荐对应动作。
 *
 * uTools 的「超级面板」就是这个思路——选中一个链接直接出「打开」，选中时间戳
 * 直接出「转成日期」。我们这里做的是同一个东西，只不过内容来自输入框/剪贴板。
 */
export interface ActionMatch {
  /** url=像链接 | files=文件 | regex=自定义正则 | text=任意非空文本 */
  type: 'url' | 'files' | 'regex' | 'text';
  /** 命中后把内容填进哪个参数（必须是本动作声明过的参数） */
  fills: string;
  /** type=regex 时的正则 */
  pattern?: string;
  /** type=files 时的扩展名白名单，例如 ["png","jpg"]，留空表示任意文件 */
  extensions?: string[];
  /** 展示用标签，例如"链接"。不写就按 type 取默认 */
  label?: string;
}

export interface ActionParam {
  name: string;
  type: ParamType;
  /** 写给人和模型看：这个参数填什么。会进 MCP 的 inputSchema.description */
  description: string;
  required: boolean;
  default?: unknown;
  enum?: string[];
  /** CLI 短名，例如 -d。可选 */
  short?: string;
  /** 敏感值（密码/token）。会在审计日志和确认框里打码，UI 上也按密码框渲染 */
  secret?: boolean;
}

export interface Action {
  id: string;
  title: string;
  /** 写给模型看的"什么时候用我"。是模型选工具的唯一信号，必须写清做什么/何时用/返回什么 */
  description: string;
  type: ActionType;
  /** exec：argv 数组。默认不经 shell，参数直接作为数组元素，从根上免掉注入 */
  run: string[];
  /** 显式开启才走 shell；开启后风险等级会被强制提升为 destructive */
  shell: boolean;
  /**
   * 不等待退出：动作用来拉起一个长期运行的进程时开启。
   * 进程由内核托管，会在「运行中」里出现，可以随时结束掉。
   */
  background: boolean;
  /** http 类型：零代码插件 */
  url?: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  output: OutputKind;
  render: RenderKind;
  /** 风险等级。必填：它决定确认策略和 MCP 的 annotations */
  risk: RiskLevel;
  params: ActionParam[];
  /** 内容智能匹配声明（可选） */
  match?: ActionMatch;
  /** 超时秒数 */
  timeout: number;
  /** 子进程输出的字符编码。默认 utf8；非 UTF-8 的输出（比如老工具用 GBK）要在这里声明 */
  encoding: string;
  /** 工作目录，相对插件目录 */
  cwd?: string;
  env: Record<string, string>;
}

/**
 * 插件声明的常驻服务。
 *
 * 有些插件的守护进程会脱离 zerokit 独立运行（甚至是被别的程序启动的），
 * 光看子进程管不着。所以让插件声明「怎么判断它在不在跑」——用端口或 pid 文件——
 * 检测走系统事实，不信任自报，因此手动起的也能看见。
 */
export interface Service {
  id: string;
  title: string;
  description: string;
  /** 用监听端口判断是否在运行 */
  port?: number;
  /** 用 pid 文件判断（相对插件目录） */
  pidFile?: string;
  /** 停止命令（argv 数组）。没有就按检测到的 PID 直接结束 */
  stop?: string[];
  cwd?: string;
  env: Record<string, string>;
}

export interface Plugin {
  id: string;
  /** 显示名，可中文。不参与工具名生成 */
  name: string;
  version: string;
  summary: string;
  description?: string;
  /** 同时供模糊搜索和模型路由 */
  keywords: string[];
  author?: string;
  homepage?: string;
  license?: string;
  /** 依赖声明，例如 { python = ">=3.10" }。缺失时给安装指引 */
  requires: Record<string, string>;
  dir: string;
  manifestPath: string;
  /**
   * 怎么执行 action。默认 `spawn`（起一个子进程，最通用）。
   *
   * `worker` 只对 node 插件有效：用 worker 线程代替子进程，实测启动成本从
   * 116ms 降到 31ms（约 3.7 倍）。代价是 **worker 不能单独设工作目录**
   * （process.chdir 是进程级的），所以脚本里的相对路径不再是插件目录——
   * 请用 `{plugin_dir}` 或 `import.meta.dirname` 来定位自己的文件。
   *
   * `host` 是**常驻解释器**：脚本在同一个解释器进程里反复执行，解释器启动和
   * import 的成本只付一次。实测 `proxy.py status` 476ms → 22ms（21 倍）。
   * 代价更明显，所以更要显式选择：模块缓存会保留、脚本**不能读 stdin**、
   * 不能用 os.write(1, ...) 直接写文件描述符。只适合无状态的一次性任务。
   *
   * 两种加速都不满足条件时自动退回 spawn，不会因此失败。
   */
  runtime: 'spawn' | 'worker' | 'host';
  actions: Action[];
  /** 插件声明的常驻服务（可为空） */
  services: Service[];
}

export interface LoadResult {
  plugin?: Plugin;
  errors: string[];
  warnings: string[];
}

const DEFAULT_TIMEOUT = 60;
const OUTPUTS: OutputKind[] = ['text', 'json', 'markdown', 'table', 'file', 'html'];
const RENDERS: RenderKind[] = ['text', 'table', 'json', 'markdown', 'keyvalue', 'image', 'link'];

const RENDER_FOR_OUTPUT: Record<OutputKind, RenderKind> = {
  text: 'text',
  json: 'json',
  markdown: 'markdown',
  table: 'table',
  file: 'link',
  html: 'text',
};

/** MCP 工具名：{插件id}__{动作id}，双下划线避免和 id 里的下划线混淆 */
export function toolName(pluginId: string, actionId: string): string {
  return `${pluginId}__${actionId}`;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  const s = asString(v);
  return s ? [s] : [];
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function parseParams(raw: unknown, actionId: string, errors: string[]): ActionParam[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: ActionParam[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const p = asRecord(item);
    const name = asString(p['name']);
    if (!name) {
      errors.push(`动作 ${actionId}: 有参数缺少 name`);
      continue;
    }
    if (!PARAM_RE.test(name)) {
      errors.push(`动作 ${actionId}: 参数名 "${name}" 非法，只能是字母/数字/下划线且不以数字开头`);
      continue;
    }
    if (seen.has(name)) {
      errors.push(`动作 ${actionId}: 参数名 "${name}" 重复`);
      continue;
    }
    seen.add(name);

    const type = (asString(p['type']) ?? 'string') as ParamType;
    if (!PARAM_TYPES.includes(type)) {
      errors.push(`动作 ${actionId}: 参数 ${name} 的 type "${type}" 不支持（可选 ${PARAM_TYPES.join(' / ')}）`);
      continue;
    }

    const param: ActionParam = {
      name,
      type,
      description: asString(p['description']) ?? '',
      required: p['required'] === true,
    };
    if (p['default'] !== undefined) param.default = p['default'];
    if (type === 'enum') {
      const opts = asStringArray(p['enum'] ?? p['options']);
      if (opts.length === 0) {
        errors.push(`动作 ${actionId}: 参数 ${name} 类型是 enum，必须给出 enum = [...] 候选值`);
        continue;
      }
      param.enum = opts;
      if (p['default'] !== undefined && !opts.includes(String(p['default']))) {
        errors.push(`动作 ${actionId}: 参数 ${name} 的 default 不在 enum 候选项里`);
      }
    }
    const short = asString(p['short']);
    if (short) param.short = short;
    if (p['secret'] === true) param.secret = true;
    out.push(param);
  }
  return out;
}

function parseServices(raw: unknown, errors: string[]): Service[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: Service[] = [];
  const seen = new Set<string>();

  for (const item of list) {
    const s = asRecord(item);
    const id = asString(s['id']);
    if (!id) {
      errors.push('有个 [[service]] 缺少 id');
      continue;
    }
    if (!ID_RE.test(id)) {
      errors.push(`服务 id "${id}" 非法：只允许小写字母、数字、点、下划线、连字符`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`服务 id "${id}" 重复`);
      continue;
    }
    seen.add(id);

    let port: number | undefined;
    if (s['port'] !== undefined) {
      const n = Number(s['port']);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        errors.push(`服务 ${id}: port 必须是 1-65535 的整数`);
        continue;
      }
      port = n;
    }
    const pidFile = asString(s['pidFile'] ?? s['pid_file']);
    if (port === undefined && !pidFile) {
      errors.push(`服务 ${id}: 至少要给 port 或 pidFile 之一，否则没法判断它在不在运行`);
      continue;
    }

    const service: Service = {
      id,
      title: asString(s['title']) ?? id,
      description: asString(s['description']) ?? '',
      env: Object.fromEntries(
        Object.entries(asRecord(s['env'])).map(([k, v]) => [k, String(v)]),
      ),
    };
    if (port !== undefined) service.port = port;
    if (pidFile) service.pidFile = pidFile;
    const stop = asStringArray(s['stop']);
    if (stop.length > 0) service.stop = stop;
    const cwd = asString(s['cwd']);
    if (cwd) service.cwd = cwd;
    out.push(service);
  }
  return out;
}

function parseAction(raw: unknown, errors: string[], warnings: string[]): Action | undefined {
  const a = asRecord(raw);
  const id = asString(a['id']);
  if (!id) {
    errors.push('有个 [[action]] 缺少 id');
    return undefined;
  }
  if (!ID_RE.test(id)) {
    errors.push(`动作 id "${id}" 非法：只允许小写字母、数字、点、下划线、连字符`);
    return undefined;
  }

  const type = (asString(a['type']) ?? 'exec') as ActionType;
  if (type !== 'exec' && type !== 'http') {
    errors.push(`动作 ${id}: type 只能是 exec 或 http，收到 "${type}"`);
    return undefined;
  }

  const run = asStringArray(a['run']);
  const url = asString(a['url']);
  if (type === 'exec' && run.length === 0) {
    errors.push(`动作 ${id}: exec 类型必须给 run = ["命令", "参数1", ...]`);
    return undefined;
  }
  if (type === 'http' && !url) {
    errors.push(`动作 ${id}: http 类型必须给 url`);
    return undefined;
  }

  // 风险等级必填：它决定确认策略（read 放行 / mutate 首次确认 / destructive 每次确认）
  // 也决定 MCP 的 readOnlyHint / destructiveHint 标注。缺省会让人忘记权衡副作用。
  const riskRaw = asString(a['risk']);
  if (!riskRaw) {
    errors.push(`动作 ${id}: 必须声明 risk（read / mutate / destructive）。`
      + '它决定要不要向用户确认，也决定 AI 客户端看到的工具标注。');
    return undefined;
  }
  let risk = riskRaw as RiskLevel;
  if (!RISK_LEVELS.includes(risk)) {
    errors.push(`动作 ${id}: risk "${riskRaw}" 不支持（可选 ${RISK_LEVELS.join(' / ')}）`);
    return undefined;
  }

  const shell = a['shell'] === true;
  if (shell && risk !== 'destructive') {
    warnings.push(`动作 ${id}: 显式开了 shell（会拼字符串执行），风险等级已从 ${risk} 提升为 destructive`);
    risk = 'destructive';
  }

  const output = (asString(a['output']) ?? 'text') as OutputKind;
  if (!OUTPUTS.includes(output)) {
    errors.push(`动作 ${id}: output "${output}" 不支持（可选 ${OUTPUTS.join(' / ')}）`);
    return undefined;
  }
  const renderRaw = asString(a['render']) as RenderKind | undefined;
  if (renderRaw && !RENDERS.includes(renderRaw)) {
    errors.push(`动作 ${id}: render "${renderRaw}" 不支持（可选 ${RENDERS.join(' / ')}）`);
    return undefined;
  }

  const timeoutRaw = a['timeout'];
  let timeout = DEFAULT_TIMEOUT;
  if (timeoutRaw !== undefined) {
    if (typeof timeoutRaw !== 'number' || timeoutRaw <= 0) {
      errors.push(`动作 ${id}: timeout 必须是正数秒`);
      return undefined;
    }
    timeout = timeoutRaw;
  }

  const encodingRaw = (asString(a['encoding']) ?? 'utf8').toLowerCase();
  let encoding = encodingRaw;
  try {
    // 提前校验，避免运行时才在 StringDecoder 里炸
    Buffer.from('').toString(encodingRaw as BufferEncoding);
  } catch {
    errors.push(`动作 ${id}: encoding "${encodingRaw}" 不被 Node 支持（常用：utf8 / gbk / latin1）`);
    return undefined;
  }
  void encoding;

  const action: Action = {
    id,
    title: asString(a['title']) ?? id,
    description: asString(a['description']) ?? '',
    type,
    run,
    shell,
    background: a['background'] === true,
    method: (asString(a['method']) ?? 'GET').toUpperCase(),
    headers: Object.fromEntries(
      Object.entries(asRecord(a['headers'])).map(([k, v]) => [k, String(v)]),
    ),
    output,
    render: renderRaw ?? RENDER_FOR_OUTPUT[output],
    risk,
    // TOML 里写 [[action.param]] 时键名是 param（单数），写 [[action.params]] 则是 params，两种都收
    params: parseParams(a['params'] ?? a['param'], id, errors),
    timeout,
    encoding,
    env: Object.fromEntries(
      Object.entries(asRecord(a['env'])).map(([k, v]) => [k, String(v)]),
    ),
  };
  const matchRaw = a['match'];
  if (matchRaw !== undefined) {
    const m = asRecord(matchRaw);
    const type = asString(m['type']) as ActionMatch['type'] | undefined;
    const fills = asString(m['fills']);
    const MATCH_TYPES: ActionMatch['type'][] = ['url', 'files', 'regex', 'text'];
    if (!type || !MATCH_TYPES.includes(type)) {
      errors.push(`动作 ${id}: match.type "${type ?? ''}" 不支持（可选 ${MATCH_TYPES.join(' / ')}）`);
      return undefined;
    }
    if (!fills) {
      errors.push(`动作 ${id}: 声明了 match 就必须给 fills（命中后把内容填进哪个参数）`);
      return undefined;
    }
    if (!action.params.some((p) => p.name === fills)) {
      errors.push(`动作 ${id}: match.fills 指向的参数 "${fills}" 不存在，先声明它`);
      return undefined;
    }
    const match: ActionMatch = { type, fills };
    if (type === 'regex') {
      const pattern = asString(m['pattern']);
      if (!pattern) {
        errors.push(`动作 ${id}: match.type = "regex" 时必须给 pattern`);
        return undefined;
      }
      try {
        new RegExp(pattern);
      } catch (e) {
        errors.push(`动作 ${id}: match.pattern 不是合法正则（${(e as Error).message}）`);
        return undefined;
      }
      match.pattern = pattern;
    }
    const exts = asStringArray(m['extensions']);
    if (exts.length > 0) match.extensions = exts.map((e) => e.toLowerCase().replace(/^\./, ''));
    const label = asString(m['label']);
    if (label) match.label = label;
    action.match = match;
  }

  if (url) action.url = url;
  if (a['body'] !== undefined) action.body = a['body'];
  const cwd = asString(a['cwd']);
  if (cwd) action.cwd = cwd;

  if (!action.description) {
    warnings.push(`动作 ${id}: 没写 description。它会被当成 AI 客户端的工具说明，`
      + '是模型判断"什么时候该用这个工具"的唯一依据，强烈建议补上。');
  }
  return action;
}

/** 从 TOML 文本解析插件清单 */
export function parseManifest(text: string, pluginDir: string, manifestPath = '<inline>'): LoadResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let raw: Record<string, unknown>;
  try {
    raw = parseToml(text) as Record<string, unknown>;
  } catch (e) {
    return { errors: [`TOML 解析失败：${(e as Error).message}`], warnings };
  }

  const meta = asRecord(raw['plugin']);
  const id = asString(meta['id']);
  if (!id) {
    errors.push('[plugin] 缺少 id');
  } else if (!ID_RE.test(id)) {
    errors.push(`[plugin] id "${id}" 非法：只允许小写字母、数字、点、下划线、连字符。`
      + '它同时用作目录名、CLI 名和 MCP 工具名前缀，必须是 ASCII；中文请放 name。');
  }

  const name = asString(meta['name']);
  if (!name) errors.push('[plugin] 缺少 name（显示名，可以写中文）');

  const actionsRaw = Array.isArray(raw['action']) ? raw['action'] : [];
  const actions: Action[] = [];
  for (const a of actionsRaw) {
    const parsed = parseAction(a, errors, warnings);
    if (parsed) actions.push(parsed);
  }
  if (actions.length === 0) errors.push('插件至少要有一个 [[action]]');

  const actionIds = new Set<string>();
  for (const a of actions) {
    if (actionIds.has(a.id)) errors.push(`动作 id "${a.id}" 重复`);
    actionIds.add(a.id);
  }

  // 服务声明要在「有错就返回」之前解析，否则它里面的错误会被静默吞掉
  const services = parseServices(raw['service'], errors);

  const runtimeRaw = (asString(meta['runtime']) ?? 'spawn').toLowerCase();
  if (!['spawn', 'worker', 'host'].includes(runtimeRaw)) {
    errors.push(`[plugin] runtime "${runtimeRaw}" 不支持（可选 spawn / worker / host）`);
  }
  const runtime: 'spawn' | 'worker' | 'host' =
    runtimeRaw === 'worker' ? 'worker' : runtimeRaw === 'host' ? 'host' : 'spawn';

  if (errors.length > 0) return { errors, warnings };

  const plugin: Plugin = {
    id: id!,
    name: name!,
    version: asString(meta['version']) ?? '0.0.0',
    summary: asString(meta['summary']) ?? '',
    keywords: asStringArray(meta['keywords']),
    requires: Object.fromEntries(
      Object.entries(asRecord(meta['requires'])).map(([k, v]) => [k, String(v)]),
    ),
    dir: pluginDir,
    manifestPath,
    runtime,
    actions,
    services,
  };
  const description = asString(meta['description']);
  if (description) plugin.description = description;
  const author = asString(meta['author']);
  if (author) plugin.author = author;
  const homepage = asString(meta['homepage']);
  if (homepage) plugin.homepage = homepage;
  const license = asString(meta['license']);
  if (license) plugin.license = license;

  if (!plugin.summary) {
    warnings.push('没写 summary（一句话说明插件干什么，会给搜索和模型路由用）');
  }
  return { plugin, errors, warnings };
}

/** 加载插件目录下的 plugin.toml */
export function loadPlugin(pluginDir: string): LoadResult {
  const manifestPath = path.join(pluginDir, 'plugin.toml');
  if (!fs.existsSync(manifestPath)) {
    return { errors: [`${pluginDir} 下没有 plugin.toml`], warnings: [] };
  }
  let text: string;
  try {
    text = fs.readFileSync(manifestPath, 'utf8');
  } catch (e) {
    return { errors: [`读取 ${manifestPath} 失败：${(e as Error).message}`], warnings: [] };
  }
  return parseManifest(text, pluginDir, manifestPath);
}