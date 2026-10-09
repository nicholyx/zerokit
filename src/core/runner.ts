import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { Worker } from 'node:worker_threads';
import type { Action, Plugin, RiskLevel } from './manifest.ts';
import { toolName } from './manifest.ts';
import { DATA_DIR, HOME, LOG_DIR, ensureDirs, pluginDataDir } from './paths.ts';
import { resolveTool } from './resolve.ts';
import { readTail, registerProcess } from './runtime.ts';
import { hasHostFor, runViaHost } from './host.ts';

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
const BUILTIN_NAMES = ['python', 'node', 'git', 'plugin_dir', 'data_dir', 'home', 'kit'];

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
}

export interface RunOptions {
  caller: Caller;
  /** 已解析、已补齐默认值并校验过的参数 */
  values: Record<string, unknown>;
  cwd?: string;
}

const TOKEN_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
const WHOLE_TOKEN_RE = /^\{([a-zA-Z_][a-zA-Z0-9_]*)\}$/;

function buildVars(plugin: Plugin, values: Record<string, unknown>): Record<string, string> {
  const vars: Record<string, string> = {
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

/** 把清单里的 run 模板展开成真正的 argv */
export function buildArgv(
  plugin: Plugin,
  action: Action,
  values: Record<string, unknown>,
): { argv: string[]; errors: string[] } {
  const vars = buildVars(plugin, values);
  const argv: string[] = [];
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
    for (const name of missing) {
      if (BUILTIN_NAMES.includes(name)) {
        errors.push(`清单里用到 {${name}}，但本机没找到它`);
      }
    }
    argv.push(expanded);
  }
  return { argv, errors };
}

/** 把 fetch 的 "fetch failed" 翻译成人能看懂的原因（原始错误藏在 e.cause 里） */
function describeFetchError(e: unknown): string {
  const err = e as { message?: string; cause?: { code?: string; message?: string } };
  const code = err.cause?.code;
  // 本机设了代理变量而请求又失败时，多半是它：Node 内置 fetch（undici）
  // **不读** http_proxy/https_proxy，直连又被出口网络拦——curl 能通、插件不通，
  // 差别就在这。把这句说清楚，能省一次莫名其妙的排查。
  const proxyHint = (process.env['https_proxy'] || process.env['HTTPS_PROXY']
    || process.env['http_proxy'] || process.env['HTTP_PROXY'])
    && ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
      'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(code ?? '')
    ? '；本机设置了 http(s)_proxy，但 Node 内置 fetch 不走代理环境变量——'
      + '试试 `unset http_proxy https_proxy` 后重试，或换个不需要代理的网络'
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

/** 展示用：把 argv 拼成一行命令，敏感参数打码 */
export function displayCommand(action: Action, argv: string[]): string {
  const secrets = new Set(action.params.filter((p) => p.secret).map((p) => p.name));
  const masked = argv.map((a) => {
    const whole = WHOLE_TOKEN_RE.exec(a);
    if (whole && secrets.has(whole[1]!)) return '******';
    return a;
  });
  return masked.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ');
}

function openAuditLog(file: string): fs.WriteStream | undefined {
  try {
    ensureDirs();
    return fs.createWriteStream(path.join(LOG_DIR, file), { flags: 'a' });
  } catch {
    return undefined;
  }
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

/** 审计：全部调用进 audit.log，被拒/失败的额外进 denied.log（便于快速排查） */
export function audit(record: AuditRecord): void {
  const line = JSON.stringify(record, null, 0) + '\n';
  for (const file of record.decision === 'deny' ? ['audit.log', 'denied.log'] : ['audit.log']) {
    const stream = openAuditLog(file);
    if (stream) {
      stream.write(line);
      stream.end();
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
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; shell: boolean; encoding: string },
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

    let stdout = '';
    let stderr = '';
    let truncated = false;
    let artifactPath: string | undefined;
    let spill: fs.WriteStream | undefined;
    let timedOut = false;

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
      resolve({
        exitCode: null, stdout, stderr: stderr + String(err.message),
        truncated, timedOut: false,
        ...(artifactPath ? { artifactPath } : {}),
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      stdout += outDecoder.end();
      stderr += errDecoder.end();
      spill?.end();
      resolve({
        exitCode: code, stdout, stderr, truncated, timedOut,
        ...(artifactPath ? { artifactPath } : {}),
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

  if (action.type === 'http') {
    return runHttpAction(plugin, action, options, started, base);
  }

  const { argv, errors } = buildArgv(plugin, action, options.values);
  if (errors.length > 0) {
    audit({ ...base, decision: 'deny', reason: 'missing-builtin', error: errors.join('; ') });
    return {
      ok: false, exitCode: null, stdout: '', stderr: '', ms: Date.now() - started,
      truncated: false, error: errors.join('; '), argv, command: displayCommand(action, argv),
    };
  }
  if (argv.length === 0) {
    const msg = '命令为空：检查 run 里的占位符是否都解析出来了';
    audit({ ...base, decision: 'deny', reason: 'empty-argv', error: msg });
    return {
      ok: false, exitCode: null, stdout: '', stderr: '', ms: Date.now() - started,
      truncated: false, error: msg, argv, command: '',
    };
  }

  const cwd = action.cwd ? path.resolve(plugin.dir, action.cwd) : plugin.dir;
  // 给插件的两个环境变量：清单里 {data_dir} 占位符的等价物（脚本不想改 argv 就读它），
  // 以及数据根目录。放在 action.env 之前，插件自己的 env 声明可以覆盖。
  const env = childEnv({
    ...process.env,
    ZEROKIT_PLUGIN_DATA_DIR: pluginDataDir(plugin.id),
    ZEROKIT_HOME: HOME,
    ...action.env,
  }, argv[0]!);
  const command = displayCommand(action, argv);

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
        ms: Date.now() - started, truncated: false, error: reason, argv, command,
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
        ms: Date.now() - started, truncated: false, error: reason, argv, command,
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
        stderr: detail, ms: Date.now() - started, truncated: false, argv, command,
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
      argv,
      command,
      background: { id: managed.id, pid: child.pid ?? -1 },
    };
  }

  // 执行路径按快慢依次尝试：常驻宿主 → worker → 子进程。
  // 每一层出问题都退回下一层，别让"加速"变成"更脆弱"。
  const viaSpawn = () => execArgv(argv[0]!, argv.slice(1), {
    cwd, env, timeout: action.timeout * 1000,
    shell: action.shell, encoding: action.encoding,
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
  let ok = outcome.exitCode === 0 && !outcome.timedOut;
  let error: string | undefined;
  if (outcome.timedOut) error = `执行超时（${action.timeout} 秒）已被强制结束`;
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
    ...(error ? { error, reason: outcome.timedOut ? 'timeout' : 'nonzero-exit' } : {}),
  });

  const result: RunResult = {
    ok,
    exitCode: outcome.exitCode,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    ms,
    truncated: outcome.truncated,
    argv,
    command,
  };
  if (data !== undefined) result.data = data;
  if (outcome.artifactPath) result.artifactPath = outcome.artifactPath;
  if (error) result.error = error;
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
  const url = (action.url ?? '').replace(TOKEN_RE, (_m, name: string) => vars[name] ?? '');
  try {
    const init: RequestInit = { method: action.method, headers: action.headers };
    if (action.body !== undefined) {
      init.body = JSON.stringify(action.body);
      (init.headers as Record<string, string>)['content-type'] ??= 'application/json';
    }
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(action.timeout * 1000) });
    const text = await res.text();
    const ms = Date.now() - started;
    const ok = res.ok;
    let data: unknown;
    if (action.output === 'json') {
      try { data = JSON.parse(text); } catch { /* 原样返回文本 */ }
    }
    const result: RunResult = {
      ok, exitCode: res.status, stdout: text, stderr: '', ms,
      truncated: false, argv: [], command: `${action.method} ${url}`,
    };
    if (data !== undefined) result.data = data;
    if (!ok) result.error = `HTTP ${res.status} ${res.statusText}`;
    audit({
      ...base, decision: ok ? 'allow' : 'deny', command: result.command, ms,
      exitCode: res.status,
      ...(ok ? {} : { reason: 'http-error', error: result.error }),
    });
    return result;
  } catch (e) {
    const ms = Date.now() - started;
    const error = `请求失败：${describeFetchError(e)}`;
    audit({ ...base, decision: 'deny', reason: 'http-error', command: `${action.method} ${url}`, ms, error });
    return {
      ok: false, exitCode: null, stdout: '', stderr: '', ms,
      truncated: false, error, argv: [], command: `${action.method} ${url}`,
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