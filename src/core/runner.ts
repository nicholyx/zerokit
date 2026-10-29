import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { Worker } from 'node:worker_threads';
import type { Action, ChainStep, Plugin, RiskLevel } from './manifest.ts';
import { BUILTIN_VARS, toolName } from './manifest.ts';
import { DATA_DIR, HOME, LOG_DIR, ensureDirs, pluginDataDir } from './paths.ts';
import { isSlow } from './ops.ts';
import { proxyFetch, proxyFor } from './proxy.ts';
import { findPlugin } from './registry.ts';
import { resolveTool } from './resolve.ts';
import { readTail, registerProcess } from './runtime.ts';
import { hasHostFor, runViaHost } from './host.ts';
import { applyDefaults } from './schema.ts';
import {
  SECRET_MASK, resolveSettings, settingsEnv, settingsHints, settingsVars,
} from './pluginConfig.ts';
import type { SettingsView } from './pluginConfig.ts';

/**
 * 执行器：整个系统**唯一的执行收口**。
 *
 * 所有面（CLI / MCP / 启动器 / Web）都经这里执行动作，因此安全策略只需要
 * 在这一处实现、一处审计。要点：
 *   1. 默认不经 shell，参数作为 argv 元素直接传入 —— 从根上消除参数注入
 *   2. 超时 + 输出上限，避免插件把宿主拖死或把上下文撑爆
 *   3. 所有调用落审计；被拒/失败单独落一份，便于快速排查
 */

export type Caller = 'cli' | 'mcp' | 'ui' | 'api';

const MAX_OUTPUT = 1 << 20; // 1 MiB，超出部分落盘
const BUILTIN_NAMES: readonly string[] = BUILTIN_VARS;

/** 风险等级的高低：组合动作的风险必须兜得住链路里每一步（低等级不能包住高等级） */
const RISK_RANK: Record<RiskLevel, number> = { read: 0, mutate: 1, destructive: 2 };
/** 组合动作里的参数/模板引用：`{名字}` 或 `{名字.a.b.0}`（字段名可以是中文，不能有空格和点） */
const REF_TOKEN_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*(?:\.[^{}\s.]+)*)\}/g;
const WHOLE_REF_RE = /^\{([a-zA-Z_][a-zA-Z0-9_]*(?:\.[^{}\s.]+)*)\}$/;

/** zerokit 自己的安装根目录。适配层（如 uTools 兼容）要用它定位随内核分发的辅助脚本 */
export const KIT_ROOT = path.resolve(import.meta.dirname, '..', '..');

export interface RunResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  ms: number;
  /** output = json 且解析成功时的结构化结果 */
  data?: unknown;
  /** 输出被截断时，完整输出落盘的路径 */
  artifactPath?: string;
  truncated: boolean;
  error?: string;
  /** 实际执行的 argv（敏感参数已打码），用于在确认框里给用户看"到底要跑什么" */
  argv: string[];
  /** 人类可读的完整命令，仅用于展示 */
  command: string;
  /** background 动作：被托管起来的进程信息，可在「运行中」里查看和结束 */
  background?: { id: string; pid: number };
  /** 第六十七轮①：被外部中断（停止按钮 / Ctrl+.）——不是失败，是用户主动停 */
  stopped?: boolean;
}

export interface RunOptions {
  caller: Caller;
  /** 第六十七轮①⑧：外部中断（UI 停止按钮 / Ctrl+.）。触发即杀子进程，结果标 stopped。 */
  signal?: AbortSignal;
  /** 已解析、已补齐默认值并校验过的参数 */
  values: Record<string, unknown>;
  cwd?: string;
  /**
   * 已知的密钥字面量：展示与审计时额外抹掉。
   * 用于组合动作把密钥设置项传给下游步骤、而下游参数没声明 secret 的兜底。
   */
  secretValues?: string[];
}

const TOKEN_RE = /\{([a-zA-Z_][a-zA-Z0-9_.]*)\}/g;
const WHOLE_TOKEN_RE = /^\{([a-zA-Z_][a-zA-Z0-9_.]*)\}$/;

export function buildVars(plugin: Plugin, values: Record<string, unknown>): Record<string, string> {
  const settings = resolveSettings(plugin);
  const vars: Record<string, string> = {
    ...settingsVars(settings),
    plugin_dir: plugin.dir,
    data_dir: pluginDataDir(plugin.id),
    home: HOME,
    node: process.execPath,
    kit: KIT_ROOT,
  };
  const python = resolveTool('python');
  if (python) vars['python'] = python.path;
  const git = resolveTool('git');
  if (git) vars['git'] = git.path;
  for (const [k, v] of Object.entries(values)) {
    vars[k] = v === undefined || v === null ? '' : String(v);
  }
  return vars;
}

/** 展开字符串里的 {名字}；可选重定向某些名字（用于把密钥替换成掩码） */
function expandVars(
  text: string,
  vars: Record<string, string>,
  pick?: (name: string) => string | undefined,
): string {
  return text.replace(TOKEN_RE, (_m, name: string) => pick?.(name) ?? vars[name] ?? '');
}

/** 递归展开 JSON 结构里的字符串（http 的 body 可以是任意嵌套结构） */
function expandDeep(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === 'string') return expandVars(value, vars);
  if (Array.isArray(value)) return value.map((v) => expandDeep(v, vars));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, expandDeep(v, vars)]),
    );
  }
  return value;
}

/** 哪些变量来自密钥（动作参数 + 设置项）：展示与审计时必须打码 */
function secretVarNames(plugin: Plugin, action: Action): Set<string> {
  const names = new Set<string>();
  for (const p of action.params) if (p.secret) names.add(p.name);
  for (const s of plugin.settings) if (s.secret) names.add(`setting.${s.name}`);
  return names;
}

/**
 * 把清单里的 run 模板展开成真正的 argv。
 *
 * 同时产出 `redacted`：与 argv 一一对应、但把密钥来源的片段换成 `******`。
 * 分开产出的原因：**先展开再猜哪一段是密钥**是不可靠的（值里可能包含空格、
 * 或者和别的参数拼在同一个元素里）；在这里展开时我们本来就知道来源。
 */
export function buildArgv(
  plugin: Plugin,
  action: Action,
  values: Record<string, unknown>,
  extraSecretValues: string[] = [],
): { argv: string[]; redacted: string[]; errors: string[] } {
  const vars = buildVars(plugin, values);
  const secrets = secretVarNames(plugin, action);
  const argv: string[] = [];
  const redacted: string[] = [];
  const errors: string[] = [];

  for (const element of action.run) {
    const whole = WHOLE_TOKEN_RE.exec(element);
    if (whole) {
      const name = whole[1]!;
      const value = vars[name];
      if (value === undefined) {
        if (BUILTIN_NAMES.includes(name)) {
          errors.push(`清单里用到 {${name}}，但本机没找到它`
            + (name === 'python' ? '（装一个：winget install Python.Python.3.13）' : ''));
        }
        continue; // 可选参数没给值：整个元素丢掉，不传空串
      }
      if (value === '') continue;
      argv.push(value);
      redacted.push(secrets.has(name) ? SECRET_MASK : value);
      continue;
    }
    const missing: string[] = [];
    const expanded = element.replace(TOKEN_RE, (_m, name: string) => {
      const value = vars[name];
      if (value === undefined) {
        missing.push(name);
        return '';
      }
      return value;
    });
    const masked = element.replace(TOKEN_RE, (_m, name: string) => {
      const value = vars[name];
      if (value === undefined) return '';
      return secrets.has(name) ? SECRET_MASK : value;
    });
    for (const name of missing) {
      if (BUILTIN_NAMES.includes(name)) {
        errors.push(`清单里用到 {${name}}，但本机没找到它`);
      }
    }
    argv.push(expanded);
    redacted.push(masked);
  }
  return { argv, redacted: redacted.map((a) => maskSecrets(a, extraSecretValues)), errors };
}

/** 把已知密钥值从展示字符串里抹掉。用于"值被传给下游、但下游没声明 secret"的兜底。 */
function maskSecrets(text: string, secretValues: string[]): string {
  let out = text;
  for (const value of secretValues) {
    if (!value) continue;
    out = out.split(value).join(SECRET_MASK);
  }
  return out;
}

/** 这个动作带出去的密钥字面量：自己声明的 secret 参数 + 插件的 secret 设置项 */
function secretValuesOf(
  plugin: Plugin, action: Action, values: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  for (const p of action.params) {
    if (!p.secret) continue;
    const v = values[p.name];
    if (v !== undefined && v !== null && String(v) !== '') out.push(String(v));
  }
  const view = resolveSettings(plugin);
  for (const setting of plugin.settings) {
    if (!setting.secret) continue;
    const v = view.values[setting.name];
    if (v !== undefined && v !== null && String(v) !== '') out.push(String(v));
  }
  return out;
}

/** 把 fetch 的 "fetch failed" 翻译成人能看懂的原因（原始错误藏在 e.cause 里） */
function describeFetchError(e: unknown): string {
  const err = e as { message?: string; cause?: { code?: string; message?: string } };
  const code = err.cause?.code;
  // 本机设了代理变量而请求又失败时，多半是它。注意这句**曾经**说 Node 内置 fetch
  // 不读代理环境变量——那是事实，但从内核支持代理起（见 src/core/proxy.ts），
  // 代理就真的会走上去了；所以这里改成"检查代理本身通不通"，而不是让人 unset。
  const proxyHint = (process.env['https_proxy'] || process.env['HTTPS_PROXY']
    || process.env['http_proxy'] || process.env['HTTP_PROXY'])
    && ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
      'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(code ?? '')
    ? '；本机设置了 http(s)_proxy，请求已经走代理——检查代理本身是否在运行、'
      + '以及它能不能到达目标站；确实不需要代理就 `unset http_proxy https_proxy` 重试'
    : '';
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `域名解析失败（${code}）—— 检查网络或 DNS${proxyHint}`;
    case 'ECONNREFUSED':
      return `连接被拒绝 —— 目标端口没有服务在监听${proxyHint}`;
    case 'ECONNRESET':
      return `连接被重置（ECONNRESET）—— 大概被出口网络策略拦了${proxyHint}`;
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
    case 'UND_ERR_HEADERS_TIMEOUT':
      return `连接超时（${code}）—— 网络不可达，或被出口策略拦截${proxyHint}`;
    case 'CERT_HAS_EXPIRED':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
      return `证书校验失败（${code}）`;
    default:
      return code
        ? `${err.cause?.message ?? '请求失败'}（${code}）`
        : (err.message ?? String(e));
  }
}

/** 展示用：把（已经打过码的）argv 拼成一行命令 */
export function displayCommand(argv: string[]): string {
  return argv.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ');
}

/** 组合动作的展示文本：把链路按顺序摊开，确认框里能一眼看出会跑什么 */
export function chainDisplay(action: Action): string {
  return '组合：' + action.steps.map((s) => s.use).join(' → ');
}

export interface AuditRecord {
  ts: string;
  plugin: string;
  action: string;
  tool: string;
  risk: RiskLevel;
  caller: Caller;
  decision: 'allow' | 'deny';
  reason?: string;
  command?: string;
  exitCode?: number | null;
  ms?: number;
  outBytes?: number;
  truncated?: boolean;
  error?: string;
}

/** 审计：全部调用进 audit.log，被拒/失败的额外进 denied.log（便于快速排查）。
 *
 * 用同步追加而不是 WriteStream：CLI 路径 audit 后立刻 process.exit，
 * 流式写入还没落盘就被带走——实测 CLI 执行从来没进过审计（第三十三轮
 * 做 stats 时发现）。审计是低频单行写，同步的代价可以忽略。
 */
export function audit(record: AuditRecord): void {
  const line = JSON.stringify(record, null, 0) + '\n';
  const files = record.decision === 'deny' ? ['audit.log', 'denied.log'] : ['audit.log'];
  for (const file of files) {
    try {
      ensureDirs();
      fs.appendFileSync(path.join(LOG_DIR, file), line);
    } catch {
      // 写审计失败不能把主进程带走：用户可能在运行期间重置 ~/.zerokit。
      // 审计是旁路，不是主流程。
    }
  }
}

interface ExecOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  artifactPath?: string;
  timedOut: boolean;
  /** 第六十七轮①：外部中断 */
  stopped?: boolean;
  /** 第七十六轮②：输出超过 max_output 声明被杀 */
  outputOverflow?: boolean;
}

/**
 * 能不能用 worker 线程代替子进程跑这个动作。
 *
 * 实测：起一个 worker 31ms，起一个子进程 116ms（约 3.7 倍差距），
 * 因为省掉了整个进程创建。只对"用本机 node 跑一个 js 文件"这种形态成立。
 *
 * **只认插件的显式声明**（runtime = "worker"），不偷着替换：worker 不能单独
 * 设工作目录（process.chdir 是进程级的），依赖相对路径的脚本会因此出错。
 */
function workerTarget(
  plugin: Plugin,
  argv: string[],
  cwd: string,
): { script: string; args: string[] } | null {
  if (plugin.runtime !== 'worker') return null;
  if (argv.length < 2) return null;
  if (path.resolve(argv[0]!) !== path.resolve(process.execPath)) return null;
  const scriptArg = argv[1]!;
  if (!/\.(mjs|js|cjs)$/i.test(scriptArg)) return null;
  const script = path.isAbsolute(scriptArg) ? scriptArg : path.resolve(cwd, scriptArg);
  if (!fs.existsSync(script)) return null;
  return { script, args: argv.slice(2) };
}

function runInWorker(
  script: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; timeout: number; encoding: string },
): Promise<ExecOutcome> {
  return new Promise((resolve) => {
    const decoder = new StringDecoder(opts.encoding as BufferEncoding);
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let outputOverflow = false;

    const worker = new Worker(script, {
      argv: args,
      stdout: true,
      stderr: true,
      env: opts.env,
      execArgv: [],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      void worker.terminate();
    }, opts.timeout);

    worker.stdout.on('data', (chunk: Buffer) => {
      const text = decoder.write(chunk);
      if (stdout.length + text.length > MAX_OUTPUT) {
        truncated = true;
        stdout = stdout.slice(0, MAX_OUTPUT);
      } else {
        stdout += text;
      }
    });
    worker.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + decoder.write(chunk)).slice(-65536);
    });

    worker.on('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr: stderr + String(err.message), truncated, timedOut: false });
    });
    worker.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, truncated, timedOut });
    });
  });
}

/**
 * 为子进程准备环境变量。
 *
 * 关键的一条：Python 在 Windows 上往管道写时默认用系统 ANSI 代码页（中文机器是 GBK），
 * 我们按 UTF-8 解码就会得到乱码。所以凡是 python 解释器，强制它输出 UTF-8。
 * 其它语言写的插件如果输出不是 UTF-8，在清单里声明 encoding 即可。
 */
function childEnv(base: NodeJS.ProcessEnv, argv0: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  const exe = path.basename(argv0).toLowerCase();
  if (/^python[w3.0-9]*\.exe$/.test(exe) || exe === 'python' || exe === 'python3') {
    env['PYTHONIOENCODING'] = 'utf-8';
    env['PYTHONUTF8'] = '1';
  }
  return env;
}

function execArgv(
  file: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; shell: boolean; encoding: string; signal?: AbortSignal; maxBytes?: number },
): Promise<ExecOutcome> {
  return new Promise((resolve) => {
    const encoding = opts.encoding as BufferEncoding;
    const child = spawn(file, args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: opts.shell,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // 第六十七轮①⑧：外部中断——与超时同路（杀进程），但结局标 stopped 不标 timedOut
    let stopped = false;
    const onAbort = () => {
      stopped = true;
      child.kill('SIGKILL');
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    let stdout = '';
    let stderr = '';
    let truncated = false;
    let artifactPath: string | undefined;
    let spill: fs.WriteStream | undefined;
let timedOut = false;
    let outputOverflow = false;

    // 用 StringDecoder 而不是 chunk.toString()：多字节字符可能被切成两个数据块，
    // 直接按块解码会把它解坏。
    const outDecoder = new StringDecoder(encoding);
    const errDecoder = new StringDecoder(encoding);

    const spillPath = () => {
      if (!artifactPath) {
        fs.mkdirSync(path.join(DATA_DIR, 'artifacts'), { recursive: true });
        artifactPath = path.join(
          DATA_DIR, 'artifacts',
          `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.out`,
        );
        spill = fs.createWriteStream(artifactPath);
        // 已读到的部分按插件原本的编码写回，保证落盘文件编码一致
        if (stdout) spill.write(Buffer.from(stdout, encoding));
      }
      return spill;
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeout);

    child.stdout.on('data', (chunk: Buffer) => {
      const text = outDecoder.write(chunk);
      if (truncated) {
        spillPath()?.write(Buffer.from(text, encoding));
        return;
      }
      // 第七十六轮②：动作声明了 max_output 时按声明的字节数杀（默认硬顶 MAX_OUTPUT 只溢出不杀）
      if (opts.maxBytes !== undefined && Buffer.byteLength(stdout, encoding) + chunk.length > opts.maxBytes) {
        truncated = true;
        outputOverflow = true;
        child.kill('SIGKILL');
        return;
      }
      if (stdout.length + text.length > MAX_OUTPUT) {
        truncated = true;
        stdout = stdout.slice(0, MAX_OUTPUT);
        spillPath()?.write(Buffer.from(text, encoding));
        return;
      }
      stdout += text;
    });

    child.stderr.on('data', (chunk: Buffer) => {
      // stderr 只保留尾部，避免报错刷屏把内存吃光
      stderr = (stderr + errDecoder.write(chunk)).slice(-65536);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      stdout += outDecoder.end();
      stderr += errDecoder.end();
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({
        exitCode: null, stdout, stderr: stderr + String(err.message),
        truncated, timedOut: false,
        ...(artifactPath ? { artifactPath } : {}), ...(stopped ? { stopped } : {}),
        ...(outputOverflow ? { outputOverflow } : {}),
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      stdout += outDecoder.end();
      stderr += errDecoder.end();
      spill?.end();
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({
        exitCode: code, stdout, stderr, truncated, timedOut,
        ...(artifactPath ? { artifactPath } : {}), ...(stopped ? { stopped } : {}),
        ...(outputOverflow ? { outputOverflow } : {}),
      });
    });
  });
}

/**
 * 后台动作的启动观察窗。
 *
 * 不是"等它跑完"——那会毁掉后台动作的意义。只是给一个窗口，把"当场就死了"
 * 和"正常跑起来了"分开。守护进程本来就该一直活着，所以窗口内最正常的信号
 * 就是"什么都没有"。
 *
 * 800ms 是量出来的，不是拍的。插件"拒绝启动"的耗时 =
 *   解释器冷启动（本机 node 实测 202/191/218ms）+ 加载插件自己的模块 +
 *   走到那个判断 —— clipboard 的拒绝路径实测 507/532/493ms。
 * 最初设 150ms 时 node 写的拒绝完全抓不住（测试里露出来的），500ms 仍会偶发
 * 漏掉（正好卡在边界上，实测有一次 599ms 就漏了）。
 *
 * 代价是每次启动后台动作要多等 0.8 秒，这是**刻意**的：比起"告诉你启动成功了、
 * 其实它早就死了"，这 0.8 秒值得。而且漏掉的后果是可控的——进程死了之后
 * registerProcess 的退出回调会把登记项摘掉，「运行中」会自己纠正，只有命令行
 * 那句回执会不准。后台动作本来就是罕见且用户主动发起的操作，
 * 不在"打开插件要快"的那个热路径上。
 */
const EARLY_START_MS = 800;

interface EarlyDeath {
  code: number | null;
  /** 窗口内插件写下的最后几行（它通常会在这里说明为什么启动不了） */
  stderr: string;
  /** 'error' 事件的消息（命令不存在、没有执行权限等） */
  error?: string;
}

/**
 * @param logPath 子进程的输出文件。现在后台进程的 stdio 是**文件**不是管道，
 *                所以失败原因要从这个文件里读，而不是监听 stderr。
 */
function observeBackgroundStart(
  child: ChildProcess,
  ms: number,
  logPath: string,
): Promise<EarlyDeath | null> {
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout;
    const finish = (death: EarlyDeath | null) => {
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('error', onError);
      resolve(death);
    };
    // 读文件这一下要等子进程真的把内容写进去，所以放在 finish 里同步读一次
    const onExit = (code: number | null) => finish({ code, stderr: readTail(logPath, 8).join('\n') });
    const onError = (e: Error) =>
      finish({ code: null, stderr: readTail(logPath, 8).join('\n'), error: e.message });
    timer = setTimeout(() => finish(null), ms);

    child.on('exit', onExit);
    child.on('error', onError);
  });
}

/** 设置项有问题时返回一句可直接照做的说明；没问题返回 undefined */
function describeSettingsProblem(plugin: Plugin, view: SettingsView): string | undefined {
  if (view.error) {
    return `设置项文件读不出来：${view.error}`;
  }
  if (view.invalid.length > 0) {
    return '设置项的值不合法：'
      + view.invalid.map((i) => `${i.name}（${i.error}）`).join('；')
      + `。用 zkit config ${plugin.id} set <项> <值> 重新设置`;
  }
  if (view.missing.length === 0) return undefined;
  return `缺少必填设置项：${view.missing.join(' / ')}。先设置：\n  `
    + settingsHints(plugin, view).join('\n  ');
}

/** 执行一个动作。这是唯一的执行入口。 */
export async function runAction(
  plugin: Plugin,
  action: Action,
  options: RunOptions,
): Promise<RunResult> {
  const started = Date.now();
  const base = {
    ts: new Date().toISOString(),
    plugin: plugin.id,
    action: action.id,
    tool: toolName(plugin.id, action.id),
    risk: action.risk,
    caller: options.caller,
  };

  // 设置项没配好就不执行：让错误停在"配置"这一层，而不是等插件拿空 token 去请求、
  // 最后报一个和根因隔着两跳的认证失败。
  const settings = resolveSettings(plugin);
  const settingsProblem = describeSettingsProblem(plugin, settings);
  if (settingsProblem) {
    audit({ ...base, decision: 'deny', reason: 'settings-incomplete', error: settingsProblem });
    return {
      ok: false, exitCode: null, stdout: '', stderr: '', ms: Date.now() - started,
      truncated: false, error: settingsProblem, argv: [], command: '',
    };
  }

  if (action.type === 'http') {
    return runHttpAction(plugin, action, options, started, base);
  }
  if (action.type === 'chain') {
    return runChainAction(plugin, action, options, started, base);
  }

  const { argv, redacted, errors } = buildArgv(
    plugin, action, options.values, options.secretValues ?? [],
  );
  if (errors.length > 0) {
    audit({ ...base, decision: 'deny', reason: 'missing-builtin', error: errors.join('; ') });
    return {
      ok: false, exitCode: null, stdout: '', stderr: '', ms: Date.now() - started,
      truncated: false, error: errors.join('; '), argv: redacted, command: displayCommand(redacted),
    };
  }
  if (argv.length === 0) {
    const msg = '命令为空：检查 run 里的占位符是否都解析出来了';
    audit({ ...base, decision: 'deny', reason: 'empty-argv', error: msg });
    return {
      ok: false, exitCode: null, stdout: '', stderr: '', ms: Date.now() - started,
      truncated: false, error: msg, argv: redacted, command: '',
    };
  }

  // 第七十六轮①：sandbox 动作的工作目录钉死在插件目录——cwd 声明失效（限制优先于便利）
  const cwd = action.sandbox ? plugin.dir : (action.cwd ? path.resolve(plugin.dir, action.cwd) : plugin.dir);
  // 给插件的两个环境变量：清单里 {data_dir} 占位符的等价物（脚本不想改 argv 就读它），
  // 以及数据根目录。放在 action.env 之前，插件自己的 env 声明可以覆盖。
  // 第七十六轮④：env_pass 白名单。声明了的动作只看到安全基线 + ZEROKIT_* + 清单 env——
  // process.env 的其余变量（API key、代理串、token）一概不给。
  const safeEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '',
    TMPDIR: process.env.TMPDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    LANG: process.env.LANG,
    HOME: process.env.HOME,
    ...(action.env_pass ?? []).reduce<Record<string, string | undefined>>((acc, k) => {
      if (process.env[k] !== undefined) acc[k] = process.env[k];
      return acc;
    }, {}),
  };
  const baseEnv = action.env_pass ? safeEnv : process.env;
  const env = childEnv({
    ...baseEnv,
    ZEROKIT_PLUGIN_DATA_DIR: pluginDataDir(plugin.id),
    ZEROKIT_HOME: HOME,
    // 设置项也作为环境变量给脚本：插件不改 argv 就能读到（ZEROKIT_SETTING_<NAME>）。
    // 放在 action.env 之前：清单里显式写的环境变量优先级更高。
    ...settingsEnv(settings),
    ...action.env,
  }, argv[0]!);
  const command = displayCommand(redacted);

  // background 动作：拉起长期运行的进程，不等它退出，交给内核托管，
  // 于是它会在「运行中」里出现、能随时结束——不用这样，启动器就只是快捷方式。
  if (action.background) {
    // 后台进程必须 **detached，且输出进文件而不是管道**。
    //
    // 踩过的坑：不 detach 的子进程会在**启动它的进程退出时一起死**——实测
    // `zkit run clipboard watch-start` 报告"已在后台启动"，命令一返回监听就没了，
    // 心跳文件一行都没写成。这直接击穿了"后台托管"的承诺。
    //
    // 为什么用文件不用管道：detached 之后父进程随时可能先走，管道一断，插件往
    // stdout 写一行就是 EPIPE 崩溃。落文件两头都占：进程活得下来，输出也留得住，
    // 而且路径落盘之后，别的会话（另一个终端的 zkit ps）也读得到输出尾巴。
    const logPath = path.join(LOG_DIR, `bg.${plugin.id}.${action.id}.log`);
    let child;
    let logFd: number | undefined;
    try {
      ensureDirs();
      // 用 'w' 截断而不是 'a' 追加：每次启动都是**新的一次运行**，把上次的输出
      // 混进来会让"这次为什么没起来"这句话里夹着上一次的成功记录，越看越糊涂。
      logFd = fs.openSync(logPath, 'w');
      child = spawn(argv[0]!, argv.slice(1), {
        cwd, env, shell: action.shell, windowsHide: true,
        stdio: ['ignore', logFd, logFd],
        detached: true,
      });
      // 别让这个句柄拖住父进程：后台动作的语义就是"我不管了"
      child.unref();
    } catch (e) {
      const msg = `启动失败：${(e as Error).message}`;
      audit({ ...base, decision: 'deny', reason: 'spawn-failed', command, error: msg });
      return {
        ok: false, exitCode: null, stdout: '', stderr: '', ms: Date.now() - started,
        truncated: false, error: msg, argv, command,
      };
    } finally {
      // 句柄已经复制给子进程了，父进程这份要还回去，否则每启动一次就漏一个
      if (logFd !== undefined) {
        try { fs.closeSync(logFd); } catch { /* 已经关了就算了 */ }
      }
    }
    // 看一眼"是不是当场就死了"。
    //
    // 后台动作的语义是"不等它结束"，代价是**启动失败也看不见**：spawn 对
    // 命令不存在（ENOENT）不抛错，而是异步发 'error' 事件；插件自己发现
    // "已经有一个在跑了"然后 exit 1，同样没人接。结果是返回值永远 ok=true、
    // PID 可能是 -1，失败只留在 stderr 和「运行中」的 tail 里——调用方（CLI、
    // 启动器、AI 客户端）从返回值上完全看不出来。
    //
    // 所以给一个很短的观察窗，专门抓"立刻死掉"这一类。窗口内的正常表现是
    // "什么都没发生"（守护进程本来就该一直活着），此时按老路托管。
    const early = await observeBackgroundStart(child, EARLY_START_MS, logPath);
    const detail = early ? (early.stderr.trim() || early.error || '') : '';

    // 命令不存在 / 没有执行权限：spawn 的 'error' 事件
    if (early?.error) {
      const reason = `启动失败：${early.error}`;
      audit({ ...base, decision: 'deny', reason: 'spawn-failed', command, error: reason });
      return {
        ok: false, exitCode: null, stdout: '', stderr: detail,
        ms: Date.now() - started, truncated: false, error: reason, argv: redacted, command,
      };
    }

    // 起来了又立刻非 0 退出：插件用这个表达"我拒绝启动"（比如"已经有一个在跑了"）
    if (early && early.code !== 0) {
      // error 只放短摘要，细节留在 stderr：CLI/界面是"红色摘要 + 灰色细节"两段渲染的，
      // 把细节也塞进 error 会让同一句话打两遍。
      const reason = `启动后立刻退出（码 ${early.code}）`;
      audit({ ...base, decision: 'deny', reason: 'background-died', command, error: reason });
      return {
        ok: false, exitCode: early.code, stdout: '', stderr: detail,
        ms: Date.now() - started, truncated: false, error: reason, argv: redacted, command,
      };
    }

    // 退出码 0：这是"自己把守护进程 detach 出去、然后自己正常退出"的写法，合法，
    // 不能当失败。但也没有进程可以托管了——如实说，别给一个已经不存在的 PID
    // 让用户去 kill。
    if (early) {
      audit({ ...base, decision: 'allow', reason: 'background-detached', command });
      return {
        ok: true, exitCode: 0,
        stdout: '命令已执行并自行退出（退出码 0），没有留下需要托管的进程。'
          + '如果它本意是常驻，请确认守护进程是不是被 detach 出去了。',
        stderr: detail, ms: Date.now() - started, truncated: false, argv: redacted, command,
      };
    }

    const managed = registerProcess({
      pluginId: plugin.id,
      pluginName: plugin.name,
      actionId: action.id,
      title: `${plugin.name} · ${action.title}`,
      command,
      pid: child.pid ?? -1,
      logPath,
      child,
    });
    const ms = Date.now() - started;
    audit({ ...base, decision: 'allow', reason: 'background-start', command, ms });
    return {
      ok: true,
      exitCode: null,
      stdout: `已在后台启动，PID ${child.pid}。要结束它：zkit kill ${managed.id}（或在界面「运行中」里点结束）`,
      stderr: '',
      ms,
      truncated: false,
      argv: redacted,
      command,
      background: { id: managed.id, pid: child.pid ?? -1 },
    };
  }

  // 执行路径按快慢依次尝试：常驻宿主 → worker → 子进程。
  // 每一层出问题都退回下一层，别让"加速"变成"更脆弱"。
  const viaSpawn = () => execArgv(argv[0]!, argv.slice(1), {
    cwd, env, timeout: action.timeout * 1000,
    shell: action.shell, encoding: action.encoding,
    signal: options.signal,
    ...(action.max_output_bytes !== undefined ? { maxBytes: action.max_output_bytes } : {}),
  });

  let outcome: ExecOutcome | undefined;

  // 1) 常驻解释器：同一个进程里反复执行，解释器启动与 import 只付一次。
  //
  // **一次性命令行调用不走这条路**：宿主冷启动要起解释器并预热 import
  // （实测约 1.6 秒），而 `zkit run` 每次都是新进程、宿主随之上一次就没了，
  // 所以单次调用反而比直接起进程（约 0.5 秒）更慢——这是实测踩出来的回归。
  // 常驻宿主只在长生命周期的地方划算：启动器、MCP 服务端。
  const worthHosting = options.caller !== 'cli';
  if (worthHosting && plugin.runtime === 'host'
    && !action.background && !action.shell && argv.length >= 2) {
    const interpreter = argv[0]!;
    const scriptArg = argv[1]!;
    if (hasHostFor(interpreter)) {
      const script = path.isAbsolute(scriptArg) ? scriptArg : path.resolve(cwd, scriptArg);
      if (fs.existsSync(script)) {
        const hosted = await runViaHost({
          pluginId: plugin.id,
          pluginName: plugin.name,
          interpreter,
          script,
          argv: argv.slice(2),
          cwd,
          env,
          timeout: action.timeout * 1000,
          encoding: action.encoding,
        });
        if (!hosted.hostError) {
          outcome = {
            exitCode: hosted.exitCode,
            stdout: hosted.stdout,
            stderr: hosted.stderr,
            truncated: false,
            timedOut: hosted.timedOut,
          };
        } else {
          // 加速路径不可用不该让动作失败，但要留个痕迹（不静默降级）
          process.stderr.write(`[zerokit] 常驻宿主不可用，已退回子进程：${hosted.hostError}\n`);
        }
      }
    }
  }

  // 2) worker 线程：省掉整个进程创建
  if (!outcome) {
    const inWorker = workerTarget(plugin, argv, cwd);
    if (inWorker) {
      try {
        outcome = await runInWorker(inWorker.script, inWorker.args, {
          env, timeout: action.timeout * 1000, encoding: action.encoding,
        });
      } catch {
        outcome = undefined;
      }
    }
  }

  // 3) 子进程：最通用，也是其它两条路的兜底
  outcome ??= await viaSpawn();

  const ms = Date.now() - started;
  let ok = outcome.exitCode === 0 && !outcome.timedOut && !outcome.stopped;
  let error: string | undefined;
  if (outcome.stopped) error = '已被用户停止';
  else if (outcome.outputOverflow) error = `输出超过 max_output 上限（${action.max_output_bytes} 字节）已被强制结束`;
  else if (outcome.timedOut) error = `执行超时（${action.timeout} 秒）已被强制结束`;
  else if (outcome.exitCode !== 0) error = `退出码 ${outcome.exitCode}`;

  let data: unknown;
  if (action.output === 'json' && outcome.stdout.trim() !== '') {
    try {
      data = JSON.parse(outcome.stdout);
    } catch (e) {
      if (ok) {
        ok = false;
        error = `output = "json" 但输出不是合法 JSON：${(e as Error).message}`;
      }
    }
  }

  audit({
    ...base,
    decision: ok ? 'allow' : 'deny',
    command,
    exitCode: outcome.exitCode,
    ms,
    outBytes: outcome.stdout.length,
    truncated: outcome.truncated,
    // ⑦慢动作水位线：超 3s 打标，stats/audit 输出靠它快速定位拖后腿的动作
    ...(isSlow(ms) ? { slow: true } : {}),
    ...(error ? { error, reason: outcome.stopped ? 'stopped' : outcome.timedOut ? 'timeout' : 'nonzero-exit' } : {}),
  });

  const result: RunResult = {
    ok,
    exitCode: outcome.exitCode,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    ms,
    truncated: outcome.truncated,
    argv: redacted,
    command,
  };
  if (data !== undefined) result.data = data;
  if (outcome.artifactPath) result.artifactPath = outcome.artifactPath;
  if (error) result.error = error;
  if (outcome.stopped) result.stopped = true;
  return result;
}

/**
 * 组合动作的引用上下文。
 *
 * 三种来源按固定顺序解析，任何一种取不到都**报错而不是给空串**：
 * 空串会让下一步拿着一个看起来合法的参数继续跑，最后错在最不相关的地方。
 */
interface ChainContext {
  /** 组合动作自己的参数（已经过 CLI/UI/MCP 的解析与校验） */
  values: Record<string, unknown>;
  /** 内置占位符：{plugin_dir} / {data_dir} / {home} / {node} / {kit} / {python} / {git} */
  builtins: Record<string, string>;
  /** 已跑完的步骤，按引用名索引 */
  results: Map<string, RunResult>;
  /** 上一步的结果 */
  prev?: RunResult;
}

/** 解析一个引用表达式（不带花括号）：`名字` 或 `名字.data.a.b.0`（`data.` 可省略） */
function resolveRef(expr: string, ctx: ChainContext): { value?: unknown; error?: string } {
  const parts = expr.split('.');
  const head = parts[0]!;
  let rest = parts.slice(1);

  let root: unknown;
  if (head === 'prev') {
    if (!ctx.prev) return { error: '第一步没有「上一步」，{prev} 用不了' };
    root = ctx.prev;
  } else if (ctx.results.has(head)) {
    root = ctx.results.get(head);
  } else if (Object.prototype.hasOwnProperty.call(ctx.builtins, head)) {
    root = ctx.builtins[head];
    if (root === '') return { error: `{${head}} 在本机取不到值` };
  } else if (Object.prototype.hasOwnProperty.call(ctx.values, head)) {
    root = ctx.values[head];
  } else {
    const available = [...ctx.results.keys(), 'prev', ...Object.keys(ctx.values), ...Object.keys(ctx.builtins)];
    return {
      error: `没有可用的引用 "${head}"。可用的是：${available.join(' / ')}`,
    };
  }

  const isResult = Boolean(root && typeof root === 'object' && 'stdout' in (root as Record<string, unknown>));

  // 不带路径：步骤给 stdout（人最常想拼进模板的就是它），参数与内置给原值
  if (rest.length === 0) {
    return { value: isResult ? (root as RunResult).stdout : root };
  }

  if (isResult) {
    const r = root as RunResult;
    // `{src.data.ip}` 与 `{src.ip}` 等价：data 只是"结构化结果"的显式前缀
    if (rest[0] === 'data') rest = rest.slice(1);
    if (rest.length === 0) {
      if (r.data === undefined) {
        return { error: `步骤 "${head}" 没有结构化输出（它没有声明 output = "json"）` };
      }
      return { value: r.data };
    }
    if (r.data === undefined) {
      return {
        error: `步骤 "${head}" 没有结构化输出（它没有声明 output = "json"），`
          + `取不了 {${expr}}；想用原文就写 {${head}}`,
      };
    }
    root = r.data;
  }

  let current = root;
  for (const seg of rest) {
    if (current === null || current === undefined) {
      return { error: `引用 {${expr}} 取不到值：上一级是空值` };
    }
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(seg)) {
        return { error: `引用 {${expr}} 取不到值：上一层是数组，要用数字下标（如 .0）` };
      }
      current = current[Number(seg)];
    } else if (typeof current === 'object') {
      const obj = current as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(obj, seg)) {
        return { error: `引用 {${expr}} 取不到值：没有字段 "${seg}"` };
      }
      current = obj[seg];
    } else {
      return { error: `引用 {${expr}} 取不到值："${seg}" 之前已经是普通值` };
    }
  }
  if (current === undefined) return { error: `引用 {${expr}} 取不到值` };
  return { value: current };
}

/** 引用值转文本：对象给紧凑 JSON，别把 [object Object] 拼进输出 */
function refText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * 把字符串里的 `{...}` 换成真实值。
 *
 * 整串就是一个引用时**保留原类型**（数组/对象/数字原样传给参数），
 * 否则按字符串拼接——这样 `params = { limit = "{n}" }` 和
 * `params = { rows = "{found.data}" }` 两种写法都是自然的。
 */
function interpolate(text: string, ctx: ChainContext): { value?: unknown; error?: string } {
  const whole = WHOLE_REF_RE.exec(text);
  if (whole) return resolveRef(whole[1]!, ctx);

  const failures: string[] = [];
  const out = text.replace(REF_TOKEN_RE, (raw, expr: string) => {
    const r = resolveRef(expr, ctx);
    if (r.error !== undefined) {
      failures.push(r.error);
      return raw;
    }
    return refText(r.value);
  });
  if (failures.length > 0) return { error: failures.join('；') };
  return { value: out };
}

/**
 * 组合动作：先**静态**校验整条链路（目标存在、不嵌套、不后台、风险兜得住），
 * 然后按顺序执行。
 *
 * 为什么要先校验再执行：链路本身写错（漏装插件、风险等级不够）时应该立刻失败，
 * 而不是先跑完前两步、产生了副作用，才在第三步发现目标不存在。
 */
async function runChainAction(
  plugin: Plugin,
  action: Action,
  options: RunOptions,
  started: number,
  base: Omit<AuditRecord, 'decision'>,
): Promise<RunResult> {
  const command = chainDisplay(action);
  const fail = (reason: string, error: string): RunResult => {
    audit({ ...base, decision: 'deny', reason, command, error });
    return {
      ok: false, exitCode: null, stdout: '', stderr: '', ms: Date.now() - started,
      truncated: false, error, argv: [], command,
    };
  };

  // ---- 1. 静态校验 ----
  const plan: { step: ChainStep; plugin: Plugin; action: Action }[] = [];
  for (const [index, step] of action.steps.entries()) {
    const label = `第 ${index + 1} 步（${step.use}）`;
    const dot = step.use.lastIndexOf('.');
    const pluginRef = step.use.slice(0, dot);
    const actionRef = step.use.slice(dot + 1);

    let targetPlugin: Plugin | undefined;
    if (pluginRef === 'self') {
      targetPlugin = plugin;
    } else {
      const entry = findPlugin(pluginRef);
      if (!entry) {
        return fail('chain-missing-plugin',
          `${label} 引用的插件 "${pluginRef}" 没装。先安装它：zkit plugin install ${pluginRef}`);
      }
      if (!entry.plugin) {
        return fail('chain-broken-plugin',
          `${label} 引用的插件 "${pluginRef}" 清单有问题：${entry.errors.join('；')}`);
      }
      targetPlugin = entry.plugin;
    }

    const targetAction = targetPlugin.actions.find((a) => a.id === actionRef);
    if (!targetAction) {
      const available = targetPlugin.actions.map((a) => a.id).join(' / ') || '（没有动作）';
      return fail('chain-missing-action', `${label} 找不到动作 "${actionRef}"。${targetPlugin.id} 里可用的是：${available}`);
    }
    if (targetAction.type === 'chain') {
      return fail('chain-nested',
        `${label} 指向的也是组合动作——组合动作不支持嵌套。把它的步骤拆开写进这条链路`);
    }
    if (targetAction.background) {
      return fail('chain-background',
        `${label} 是后台动作（不等结果），没法把结果传给下一步`);
    }
    if (RISK_RANK[targetAction.risk] > RISK_RANK[action.risk]) {
      return fail('chain-risk',
        `${label} 的风险是 ${targetAction.risk}，高于组合动作声明的 ${action.risk}`
        + `——把这条链路的 risk 提升到 ${targetAction.risk} 或更高，否则确认闸门会被绕过`);
    }
    plan.push({ step, plugin: targetPlugin, action: targetAction });
  }

  // ---- 2. 顺序执行 ----
  // 组合动作自己的参数也要走默认值：CLI / MCP / 界面都会先补，但 runAction 是
  // 唯一的执行收口，别让直接调它的场景（测试、未来的 API）拿不到默认值
  const own = applyDefaults(action, options.values);
  if (own.errors.length > 0) return fail('chain-missing-param', own.errors.join('；'));
  const ctxValues = own.values;
  const builtins = buildVars(plugin, ctxValues);
  const results = new Map<string, RunResult>();
  const outputs: { alias: string; result: RunResult }[] = [];
  const budgetMs = action.timeout * 1000;
  let prev: RunResult | undefined;
  let truncated = false;

  for (const [index, item] of plan.entries()) {
    const label = `第 ${index + 1} 步（${item.step.use}）`;
    const remaining = budgetMs - (Date.now() - started);
    if (remaining <= 0) {
      return fail('chain-timeout', `${label} 之前，整条链路 ${action.timeout} 秒的总预算已经用完`);
    }

    const ctx: ChainContext = { values: ctxValues, builtins, results, ...(prev ? { prev } : {}) };
    const substituted: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(item.step.params)) {
      const declared = item.action.params.find((p) => p.name === key);
      if (!declared) {
        const known = item.action.params.map((p) => p.name).join(' / ') || '（没有参数）';
        return fail('chain-unknown-param',
          `${label} 给动作 "${item.action.id}" 传了未知参数 "${key}"。它认的是：${known}`);
      }
      if (typeof raw !== 'string') {
        substituted[key] = raw;
        continue;
      }
      const r = interpolate(raw, ctx);
      if (r.error !== undefined) {
        return fail('chain-bad-ref', `${label} 的参数 "${key}"：${r.error}`);
      }
      // 结构化结果要进标量参数时，用紧凑 JSON 表达——比 "[object Object]" 有用得多
      if (r.value !== null && typeof r.value === 'object'
        && (declared.type === 'string' || declared.type === 'path' || declared.type === 'enum')) {
        substituted[key] = JSON.stringify(r.value);
      } else {
        substituted[key] = r.value;
      }
    }

    const applied = applyDefaults(item.action, substituted);
    if (applied.errors.length > 0) {
      return fail('chain-missing-param', `${label}：${applied.errors.join('；')}`);
    }

    // timeout 是整条链路的总预算：每一步只拿剩下的时间，不能让单步超时把链路拖过线
    const stepAction: Action = {
      ...item.action,
      timeout: Math.max(1, Math.min(item.action.timeout, Math.round(remaining / 1000))),
    };
    const result = await runAction(item.plugin, stepAction, {
      caller: options.caller,
      values: applied.values,
      ...(options.cwd ? { cwd: options.cwd } : {}),
      // 链路自己的密钥设置项 / 加密参数，在下游同样必须打码
      secretValues: [...secretValuesOf(plugin, action, ctxValues), ...(options.secretValues ?? [])],
    });
    results.set(item.step.as, result);
    outputs.push({ alias: item.step.as, result });
    prev = result;
    truncated ||= result.truncated;

    if (!result.ok) {
      // 第八十三轮⑤：断点位置带步骤序号与总步数，前面成功几步也讲清
      const error = `${label}失败（整条链 ${plan.length} 步，断在第 ${index + 1} 步）：${result.error ?? `退出码 ${result.exitCode}`}`;
      audit({
        ...base, decision: 'deny', reason: 'chain-step-failed', command,
        exitCode: result.exitCode, ms: Date.now() - started, error,
      });
      return {
        ok: false,
        exitCode: result.exitCode,
        stdout: outputs.map((o) => o.result.stdout.trim()).filter(Boolean).join('\n\n'),
        stderr: result.stderr,
        ms: Date.now() - started,
        truncated,
        error,
        argv: [],
        command,
      };
    }
  }

  // ---- 3. 合成输出 ----
  const data: Record<string, unknown> = {};
  for (const o of outputs) {
    data[o.alias] = o.result.data !== undefined ? o.result.data : o.result.stdout.trim();
  }

  let stdout: string;
  if (action.template !== undefined) {
    const ctx: ChainContext = { values: ctxValues, builtins, results, ...(prev ? { prev } : {}) };
    const r = interpolate(action.template, ctx);
    if (r.error !== undefined) {
      return fail('chain-bad-template', `输出模板（template）里的引用取不到：${r.error}`);
    }
    stdout = refText(r.value);
  } else if (action.output === 'json') {
    stdout = JSON.stringify(data, null, 2);
  } else {
    stdout = outputs.map((o) => o.result.stdout.trim()).filter(Boolean).join('\n\n');
  }

  const ms = Date.now() - started;
  audit({
    ...base, decision: 'allow', command, exitCode: 0, ms,
    outBytes: stdout.length, truncated,
  });
  const result: RunResult = {
    ok: true, exitCode: 0, stdout, stderr: '', ms, truncated, argv: [], command,
  };
  if (action.output === 'json') result.data = data;
  return result;
}

async function runHttpAction(
  plugin: Plugin,
  action: Action,
  options: RunOptions,
  started: number,
  base: Omit<AuditRecord, 'decision'>,
): Promise<RunResult> {
  const vars = buildVars(plugin, options.values);
  const secrets = [...secretValuesOf(plugin, action, options.values), ...(options.secretValues ?? [])];
  const url = expandVars(action.url ?? '', vars);
  const shownUrl = maskSecrets(expandVars(action.url ?? '', vars, (name) => {
    const setting = plugin.settings.find((x) => `setting.${x.name}` === name);
    return setting?.secret === true ? SECRET_MASK : undefined;
  }), secrets);
  try {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(action.headers)) headers[k] = expandVars(v, vars);
    const init: RequestInit = { method: action.method, headers };
    if (action.body !== undefined) {
      init.body = JSON.stringify(expandDeep(action.body, vars));
      headers['content-type'] ??= 'application/json';
    }
    // ⑧ 外部中断与超时组合：任一触发即断（AbortSignal.any 是 Node 20+ 标准 API）
    const timeoutSignal = AbortSignal.timeout(action.timeout * 1000);
    const signal = options.signal ? AbortSignal.any([timeoutSignal, options.signal]) : timeoutSignal;
    // 配了代理就自己走代理。**不能依赖 fetch 的 proxy 选项**：Node 22 上它是
    // 被静默丢弃的（详见 src/core/proxy.ts 顶部注释），设了代理却直连出去，
    // 使用者根本看不出来。没配代理时这里与改动前完全一致。
    const proxy = proxyFor(new URL(url));
    const res = proxy
      ? await proxyFetch(url, { ...init, signal }, proxy)
      : await fetch(url, { ...init, signal });
    const text = await res.text();
    const ms = Date.now() - started;
    const ok = res.ok;
    let data: unknown;
    if (action.output === 'json') {
      try { data = JSON.parse(text); } catch { /* 原样返回文本 */ }
    }
    const result: RunResult = {
      ok, exitCode: res.status, stdout: text, stderr: '', ms,
      truncated: false, argv: [], command: `${action.method} ${shownUrl}`,
    };
    if (data !== undefined) result.data = data;
    if (!ok) result.error = `HTTP ${res.status} ${res.statusText}`;
    if (options.signal?.aborted) { result.stopped = true; result.error = '已被用户停止'; result.ok = false; }
    audit({
      ...base, decision: ok ? 'allow' : 'deny', command: result.command, ms,
      exitCode: res.status,
      ...(ok ? {} : { reason: 'http-error', error: result.error }),
    });
    return result;
  } catch (e) {
    const ms = Date.now() - started;
    const error = `请求失败：${describeFetchError(e)}`;
    audit({ ...base, decision: 'deny', reason: 'http-error', command: `${action.method} ${shownUrl}`, ms, error });
    return {
      ok: false, exitCode: null, stdout: '', stderr: '', ms,
      truncated: false, error, argv: [], command: `${action.method} ${shownUrl}`,
    };
  }
}

/** 风险等级 → 确认策略。是 UI 和 CLI 共用的唯一判定，避免两处不一致。 */
export type ConfirmPolicy = 'never' | 'first-time' | 'always';

export function confirmPolicy(risk: RiskLevel): ConfirmPolicy {
  switch (risk) {
    case 'read': return 'never';
    case 'mutate': return 'first-time';
    default: return 'always';
  }
}