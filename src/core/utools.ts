import fs from 'node:fs';
import path from 'node:path';
import {
  type Action,
  type ActionMatch,
  type ActionParam,
  type Plugin,
  ID_RE,
  type LoadResult,
} from './manifest.ts';

/**
 * uTools 插件兼容层（适配 + 运行时）。
 *
 * 为什么做这个：uTools 有存量插件生态，而它的**清单结构设计得很干净**——
 * `plugin.json` 的 `features[].cmds` 用六个类型描述"这个插件被什么输入唤起"
 * （字符串关键字自动支持拼音首字母、`regex:`、`over` 划词、`img`、`files`、`window`）。
 * 我们不需要发明新格式，只需要把它**翻译成 zerokit 的清单**，存量插件就直接
 * 多出四个面：启动器能搜到、CLI 能跑、MCP 能当工具调、Web 工作台能看。
 *
 * 说清楚边界，不吹：
 *   - 我们复刻的是 **`utools.*` 里无界面可完成的那部分**（读参数、算、输出结果、读写存储）。
 *   - uTools 真正的护城河不在 API，而在 OS 级能力（读活动窗口、模拟键鼠、
 *     粘贴进任意前台窗口）和 Electron 渲染进程，那部分这里**没有**，也不假装有。
 *   - 所以一个纯靠 DOM 画界面的 uTools 插件，在这里跑不出结果——这种情况会
 *     明确告诉用户"它依赖图形界面"，而不是静默失败。
 *
 * 这里是**零改动接入**：把一个 uTools 插件目录丢进插件目录即可，不需要先转格式。
 */

/** uTools json 里 cmds 的一条。字符串是关键字（`regex:` 开头是正则），对象是五种特殊类型 */
type Cmd = string | { type?: string; label?: string; exclude?: string; fileType?: string };

interface UtoolsFeature {
  code?: string;
  explain?: string;
  cmds?: Cmd[];
}

interface UtoolsJson {
  pluginName?: string;
  description?: string;
  author?: string;
  homepage?: string;
  version?: string;
  logo?: string;
  main?: string;
  preload?: string;
  features?: UtoolsFeature[];
}

/** 随内核分发的运行时垫片。插件代码里的 `utools.*` 由它提供 */
export const UTOOLS_RUNTIME = 'src/core/utools-runtime.mjs';

export function utoolsJsonPath(dir: string): string {
  return path.join(dir, 'plugin.json');
}

/**
 * 这看起来是不是一个 uTools 插件。
 *
 * 判据是**结构**而不是文件名：必须有 plugin.json，且里面带 uTools 标志性的
 * `pluginName` 或 `features`。只看文件名的话，任何恰好叫 plugin.json 的
 * 无关目录都会被误判成插件。
 */
export function looksLikeUtoolsPlugin(dir: string): boolean {
  const file = utoolsJsonPath(dir);
  if (!fs.existsSync(file)) return false;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as UtoolsJson;
    return Boolean(raw && (raw.pluginName || Array.isArray(raw.features)));
  } catch {
    return false;
  }
}

/**
 * 目录名 → 合法插件 id。
 *
 * 插件目录名往往是中文或带空格（"我的工具 2.0"），而 id 要同时当目录名、
 * CLI 名和 MCP 工具名前缀，只能是小写 ASCII。所以做一次规范化：
 * 非法字符折叠成连字符、去掉首尾连字符、截到 64 位。
 * 全中文的目录名会规范成空串，那就退回一个稳定前缀加序号（靠 dir 的哈希）。
 */
function toPluginId(dirName: string): string {
  const ascii = dirName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9]+$/, '')
    .slice(0, 64);
  if (ID_RE.test(ascii)) return ascii;
  // 退化情况：让同一目录永远得到同一个 id（不能用随机数，否则每次加载都换名字）
  let h = 0;
  for (const ch of dirName) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return `utools-${h.toString(36)}`;
}

function toActionId(code: string | undefined, index: number, taken: Set<string>): string {
  const base = (code ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9]+$/, '')
    .slice(0, 64);
  let id = ID_RE.test(base) ? base : `feature-${index + 1}`;
  // uTools 的 code 不保证唯一（甚至可以不写），去重后再用
  let n = 2;
  while (taken.has(id)) id = `${ID_RE.test(base) ? base : `feature-${index + 1}`}-${n++}`;
  taken.add(id);
  return id;
}

/** uTools 的 fileType 取值 → 扩展名白名单。'file' / undefined 表示不限 */
const FILE_TYPES: Record<string, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'],
  video: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'],
  pdf: ['pdf'],
  directory: [],
};

interface CmdMapping {
  match?: ActionMatch;
  /** 关键字：进 keywords 供搜索（含拼音首字母） */
  keywords: string[];
  warnings: string[];
}

/**
 * 把 uTools 的 `cmds` 翻译成 zerokit 的 match + 关键字。
 *
 * 只能落一个 match（我们的 schema 一个动作一个 match），所以按"信息量"取第一个
 * 能翻译的；剩下的降级成关键字，并如实警告有东西没翻过去。
 */
function mapCmds(cmds: Cmd[], explain: string | undefined): CmdMapping {
  const out: CmdMapping = { keywords: [], warnings: [] };
  const label = explain ?? undefined;

  for (const cmd of cmds) {
    if (typeof cmd === 'string') {
      const m = /^regex:(.*)$/.exec(cmd);
      if (m) {
        const pattern = m[1]!;
        try {
          new RegExp(pattern);
          if (!out.match) {
            out.match = { type: 'regex', pattern, fills: 'text', label: label ?? '正则匹配' };
          } else {
            out.warnings.push('这个功能声明了多条可用正则，只保留了第一条');
          }
        } catch {
          out.warnings.push(`正则 ${pattern} 不是合法正则，已忽略`);
        }
        continue;
      }
      out.keywords.push(cmd);
      continue;
    }

    const type = (cmd.type ?? '').toLowerCase();
    if (type === 'over') {
      out.match ??= { type: 'text', fills: 'text', label: cmd.label ?? '选中文本' };
    } else if (type === 'files') {
      const exts = FILE_TYPES[(cmd.fileType ?? 'file').toLowerCase()];
      const match: ActionMatch = { type: 'files', fills: 'text', label: cmd.label ?? '文件' };
      if (exts && exts.length > 0) match.extensions = exts;
      out.match ??= match;
    } else if (type === 'img') {
      out.warnings.push('这个功能在 uTools 里靠"选中图片"唤起，zerokit 没有图片输入，已只保留关键字');
    } else if (type === 'window') {
      out.warnings.push('这个功能靠"活动窗口"唤起（uTools 的 OS 级能力），zerokit 无法复刻，已跳过');
    } else {
      out.warnings.push(`不认识的 cmds 类型 "${cmd.type ?? ''}"，已跳过`);
    }
  }
  return out;
}

/** uTools 插件的入口脚本：优先 preload（Node 环境），其次 main（如果它本身就是 js） */
function pickEntry(raw: UtoolsJson, dir: string): { entry?: string; reason?: string } {
  for (const field of ['preload', 'main'] as const) {
    const value = raw[field];
    if (typeof value !== 'string' || !value) continue;
    if (!/\.(js|cjs|mjs)$/i.test(value)) continue;   // main 通常是 index.html
    const abs = path.resolve(dir, value);
    // 防目录穿越：清单里写的入口不能跑到插件目录外面去
    if (!abs.startsWith(path.resolve(dir) + path.sep)) continue;
    if (!fs.existsSync(abs)) continue;
    return { entry: value };
  }
  return {
    reason: raw.main
      ? `这个插件的入口是图形界面（main = ${raw.main}），没有可无界面执行的脚本`
      : '这个插件没有 preload / main 脚本，只有资源文件',
  };
}

/**
 * 把一个 uTools 插件目录翻译成 zerokit 的 Plugin。
 *
 * 翻译是**纯函数式**的：不写文件、不改原目录，所以随时可以反悔（删掉目录即可）。
 */
export function adaptUtoolsPlugin(dir: string): LoadResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const file = utoolsJsonPath(dir);

  let raw: UtoolsJson;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8')) as UtoolsJson;
  } catch (e) {
    return { errors: [`读不了 ${file}：${(e as Error).message}`], warnings };
  }

  const id = toPluginId(path.basename(dir));
  const name = typeof raw.pluginName === 'string' && raw.pluginName.trim()
    ? raw.pluginName.trim()
    : path.basename(dir);

  const features = Array.isArray(raw.features) ? raw.features : [];
  const { entry, reason } = pickEntry(raw, dir);

  if (!entry) {
    // 入口不可无界面执行：明确报错，而不是产出一个跑起来必然失败的动作
    return {
      errors: [`${name}：${reason}。zerokit 的 uTools 兼容层只能跑无界面的命令型插件。`],
      warnings,
    };
  }

  const actions: Action[] = [];
  const taken = new Set<string>();
  const keywords = new Set<string>([name]);

  features.forEach((f, i) => {
    const cmds = Array.isArray(f.cmds) ? f.cmds : [];
    const mapped = mapCmds(cmds, f.explain);
    for (const w of mapped.warnings) warnings.push(`${name} / ${f.explain ?? f.code ?? i}: ${w}`);
    for (const k of mapped.keywords) keywords.add(k);

    const actionId = toActionId(f.code, i, taken);
    const title = (f.explain && f.explain.trim()) || mapped.keywords[0] || actionId;

    // 统一的输入参数。uTools 的 payload 就是"唤起时选中的东西"，
    // 在 zerokit 里它可以是划词内容、拖进来的文件路径，或用户直接敲的一串字。
    const param: ActionParam = {
      name: 'text',
      type: 'string',
      required: false,
      description: '要处理的内容。从剪贴板/划词唤起时会自动填好；也可以直接在这里输入',
    };
    if (mapped.match) param.description = mapped.match.label
      ? `${mapped.match.label}内容，唤起时会自动填好；也可以直接输入`
      : param.description;

    const run = [
      '{node}',
      `{kit}/${UTOOLS_RUNTIME}`,
      `{plugin_dir}/${entry}`,
      '--zkit-code', f.code ?? actionId,
      '--zkit-data', '{data_dir}',
      '--zkit-plugin', id,
      '--zkit-payload={text}',
    ];

    const action: Action = {
      id: actionId,
      title,
      description: [
        f.explain?.trim() || `运行 uTools 插件「${name}」的功能 ${actionId}`,
        '',
        `（来自 uTools 插件的兼容运行，入口 ${entry}。行为由第三方插件决定，请自行判断风险。）`,
      ].join('\n'),
      type: 'exec',
      run,
      shell: false,
      background: false,
      method: 'GET',
      headers: {},
      output: 'text',
      render: 'text',
      // 跑的是第三方插件的任意代码，风险等级不能乐观：默认"首次执行需确认"
      risk: 'mutate',
      params: [param],
      timeout: 60,
      encoding: 'utf8',
      env: {},
    };
    if (mapped.match) action.match = mapped.match;
    actions.push(action);
  });

  if (actions.length === 0) {
    return {
      errors: [`${name}：plugin.json 里没有任何 feature，翻译不出可执行的动作`],
      warnings,
    };
  }

  const plugin: Plugin = {
    id,
    name,
    version: typeof raw.version === 'string' ? raw.version : '0.0.0',
    summary: typeof raw.description === 'string' ? raw.description.slice(0, 100) : `uTools 插件：${name}`,
    keywords: [...keywords],
    requires: { node: '>=20' },
    dir,
    manifestPath: file,
    // spawn 而非 worker：入口脚本多半是 CommonJS，且要靠进程级的垫片提供 utools 全局
    runtime: 'spawn',
    actions,
    services: [],
  };
  if (typeof raw.description === 'string') plugin.description = raw.description;
  if (typeof raw.author === 'string') plugin.author = raw.author;
  if (typeof raw.homepage === 'string') plugin.homepage = raw.homepage;

  return { plugin, errors, warnings };
}