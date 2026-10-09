import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin, Service } from './manifest.ts';
import { HOME } from './paths.ts';
import { listPlugins } from './registry.ts';
import { resolveTool } from './resolve.ts';
import { isAlive } from './runtime.ts';
import { buildArgv, runAction } from './runner.ts';

/**
 * 插件声明的常驻服务。
 *
 * 像「白名单代理」这类插件会自己拉起一个守护进程（甚至脱离 zerokit 独立运行），
 * 光靠托管子进程看不见它。所以让插件在清单里**声明**：用什么端口或 pid 文件
 * 能判断它在不在跑、用什么命令能停掉它。
 *
 * 检测走的是系统事实（谁在监听这个端口），而不是信任插件自报，
 * 所以即使有人手动启动了它，这里也看得见。
 */

export interface ServiceStatus {
  pluginId: string;
  pluginName: string;
  id: string;
  title: string;
  description: string;
  running: boolean;
  /** 检测到在跑时的进程号 */
  pid?: number;
  port?: number;
  /** 进程的启动时间（能拿到才填） */
  startedAt?: number;
  /** 停止命令（展示用） */
  stopCommand?: string;
  /** 是否能用 stop 命令停（否则只能按 PID 杀） */
  canStop: boolean;
}

/**
 * 把命令模板里的占位符解析成真实路径，用于**展示**。
 * 给用户看的应该是"到底会跑什么"，而不是 `{python} proxy.py stop` 这种模板。
 */
function previewCommand(plugin: Plugin, argv: string[]): string {
  const vars: Record<string, string> = {
    plugin_dir: plugin.dir,
    home: HOME,
    node: process.execPath,
  };
  const python = resolveTool('python');
  if (python) vars['python'] = python.path;
  const git = resolveTool('git');
  if (git) vars['git'] = git.path;
  const resolved = argv.map((a) => a.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (m, n: string) => vars[n] ?? m));
  return resolved.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ');
}

/**
 * 「谁在监听哪些端口」的整表，带几秒缓存。
 *
 * 为什么缓存：一次 netstat 要 ~470ms（Windows 上它会枚举全部连接），而
 * 「运行中」面板开着的时候每 2 秒就要问一次。不缓存的话光看面板就白烧 CPU。
 * 缓存时间刻意比轮询间隔长一点，让相邻两次轮询共用一份结果。
 */
const LISTEN_TABLE_TTL = 4000;
let listenTable: { at: number; ports: Map<number, number> } | undefined;

function readListenTable(): Map<number, number> {
  const now = Date.now();
  if (listenTable && now - listenTable.at < LISTEN_TABLE_TTL) return listenTable.ports;

  const ports = new Map<number, number>();
  try {
    const out = spawnSync('netstat', ['-ano', '-p', 'TCP'], {
      encoding: 'utf8', windowsHide: true, timeout: 8000, maxBuffer: 8 << 20,
    });
    for (const line of (out.stdout ?? '').split('\n')) {
      const cols = line.trim().split(/\s+/);
      // 形如：TCP  127.0.0.1:28888  0.0.0.0:0  LISTENING  1234
      if (cols.length < 5 || cols[3] !== 'LISTENING') continue;
      const local = cols[1] ?? '';
      const idx = local.lastIndexOf(':');
      if (idx < 0) continue;
      const port = Number(local.slice(idx + 1));
      const pid = Number(cols[4]);
      if (Number.isFinite(port) && Number.isFinite(pid) && pid > 0) ports.set(port, pid);
    }
  } catch {
    /* netstat 不可用就退化为"检测不到" */
  }
  listenTable = { at: now, ports };
  return ports;
}

/** 谁在监听这个端口。用 netstat 而不是 PowerShell——后者光启动就要 400ms。 */
function pidListeningOn(port: number): number | undefined {
  return readListenTable().get(port);
}

function readPidFile(file: string): number | undefined {
  try {
    const text = fs.readFileSync(file, 'utf8').trim();
    const pid = Number(text);
    if (Number.isFinite(pid) && pid > 0) return pid;
  } catch {
    /* 没有就没有 */
  }
  return undefined;
}

function pidAlive(pid: number): boolean {
  return isAlive(pid);   // 0.06ms，比 tasklist 的 229ms 快三个数量级
}


function serviceOf(plugin: Plugin, s: Service): ServiceStatus {
  const status: ServiceStatus = {
    pluginId: plugin.id,
    pluginName: plugin.name,
    id: s.id,
    title: s.title,
    description: s.description,
    running: false,
    canStop: Boolean(s.stop && s.stop.length > 0) || Boolean(s.pidFile),
  };

  if (s.port !== undefined) status.port = s.port;
  const stopAction = s.stop && s.stop.length > 0;
  if (stopAction) {
    status.stopCommand = previewCommand(plugin, s.stop!);
  }

  let pid: number | undefined;
  if (s.port !== undefined) {
    pid = pidListeningOn(s.port);
  } else if (s.pidFile) {
    const file = path.resolve(plugin.dir, s.pidFile);
    status.stopCommand ??= `按 pid 文件结束：${file}`;
    const fromFile = readPidFile(file);
    if (fromFile && pidAlive(fromFile)) pid = fromFile;
  }

  if (pid !== undefined) {
    status.running = true;
    status.pid = pid;
    // 注：「跑了多久」对**外部启动的**服务拿不到（tasklist 不给启动时刻，
    // 而拉一次 tasklist 要 230~470ms，不值当）。托管进程的启动时间我们是知道的，
    // 那一类会显示时长。
  }
  return status;
}

/** 列出所有插件声明的服务及其真实状态 */
export function listServices(): ServiceStatus[] {
  const out: ServiceStatus[] = [];
  for (const entry of listPlugins()) {
    if (!entry.plugin) continue;
    for (const s of entry.plugin.services) {
      out.push(serviceOf(entry.plugin, s));
    }
  }
  return out;
}

export function findService(pluginId: string, serviceId: string): ServiceStatus | undefined {
  return listServices().find((s) => s.pluginId === pluginId && s.id === serviceId);
}

export interface StopOutcome {
  ok: boolean;
  message: string;
}

/**
 * 停掉一个服务。优先用插件自己声明的 stop 命令（它知道怎么优雅退出）；
 * 没有就按检测到的 PID 杀掉。
 */
export async function stopService(pluginId: string, serviceId: string): Promise<StopOutcome> {
  const entry = listPlugins().find((e) => e.plugin?.id === pluginId);
  const plugin = entry?.plugin;
  if (!plugin) return { ok: false, message: `没有插件 ${pluginId}` };
  const service = plugin.services.find((s) => s.id === serviceId);
  if (!service) return { ok: false, message: `插件 ${pluginId} 没有声明服务 ${serviceId}` };

  const status = serviceOf(plugin, service);
  const stopAction = service.stop && service.stop.length > 0 ? service.stop : undefined;

  if (stopAction && status.running) {
    // 用清单里声明的 Python/Node 模板去跑停止命令，走和其它动作完全一样的收口
    const argv: string[] = [];
    const fakeAction = {
      ...plugin.actions[0]!,
      id: `stop:${service.id}`,
      title: `停止 ${service.title}`,
      type: 'exec' as const,
      run: stopAction,
      shell: false,
      // **必须显式关掉 background**：这个模板是从 plugin.actions[0] 抄来的，
      // 而清单里"第一个动作"完全可能是后台动作（比如剪贴板监听的清单里
      // 第一个动作就有 background = true）。抄过来的话停止命令会被当后台任务
      // 拉起来——立刻返回、登记进「运行中」、其实什么都没停，而且看起来还是
      // 「成功」。插件作者只能靠"记得把非后台动作排第一"来绕开，那是个陷阱。
      background: false,
      params: [],
      output: 'text' as const,
      render: 'text' as const,
      risk: 'mutate' as const,
      timeout: 30,
      encoding: 'utf8',
      env: service.env ?? {},
      ...(service.cwd ? { cwd: service.cwd } : {}),
    };
    const built = buildArgv(plugin, fakeAction, {});
    if (built.errors.length === 0 && built.argv.length > 0) {
      argv.push(...built.argv);
    }
    if (argv.length > 0) {
      const result = await runAction(plugin, fakeAction, { caller: 'cli', values: {} });
      if (result.ok) return { ok: true, message: `已停止 ${status.title}` };
      // 停不掉就退回按 PID 杀，别让用户卡在"停不了"
    }
  }

  if (status.pid) {
    const out = spawnSync('taskkill', ['/PID', String(status.pid), '/T', '/F'], {
      encoding: 'utf8', windowsHide: true, timeout: 15000,
    });
    if (out.status === 0) return { ok: true, message: `已结束 PID ${status.pid}` };
    return { ok: false, message: (out.stderr || out.stdout || '结束失败').trim().slice(0, 200) };
  }

  return status.running
    ? { ok: false, message: `${status.title} 在运行，但拿不到它的 PID` }
    : { ok: true, message: `${status.title} 本来就没在运行` };
}

