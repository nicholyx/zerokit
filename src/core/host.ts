import { type ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import { registerExternalProcess, unregisterProcess } from './runtime.ts';

/**
 * 常驻宿主池：让脚本在**同一个解释器进程里反复执行**，把解释器启动和 import
 * 的成本只付一次。
 *
 * 实测收益最大的地方在这里：`proxy.py status` 每次起进程要 476ms，
 * 放进常驻宿主只要 **22ms（21 倍）**——比 node 的 worker 那条路收益大得多，
 * 因为 python 的 import（ssl / ctypes / subprocess）本身就占大头。
 *
 * 代价是语义变了（模块缓存保留、脚本不能读 stdin），所以**只对显式声明了
 * runtime = "host" 的插件启用**，不偷着替换。
 *
 * 宿主进程按「解释器 + 插件」隔离：不同插件不共用同一个解释器，
 * 免得一个插件的全局副作用影响另一个。
 */

const IDLE_MS = 5 * 60 * 1000;   // 空闲这么久就回收，别白占内存

const PYTHON_HOST = path.join(import.meta.dirname, 'hosts', 'python-host.py');

export interface HostRequest {
  pluginId: string;
  pluginName: string;
  interpreter: string;
  script: string;
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeout: number;
  encoding: string;
}

export interface HostOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** 宿主本身出了问题（不是脚本出错） */
  hostError?: string;
}

interface HostInstance {
  key: string;
  child: ChildProcess;
  pending: Map<string, (resp: HostResponse) => void>;
  buffer: string;
  lastUsed: number;
  dead: boolean;
}

interface HostResponse {
  id: string | null;
  exitCode: number;
  stdout: string;
  stderr: string;
}

const hosts = new Map<string, HostInstance>();
let seq = 0;
let reaper: NodeJS.Timeout | undefined;

function reapIdle(): void {
  const now = Date.now();
  for (const [key, host] of [...hosts]) {
    if (host.pending.size > 0) continue;
    if (now - host.lastUsed < IDLE_MS) continue;
    try { host.child.kill('SIGTERM'); } catch { /* 已经没了 */ }
    hosts.delete(key);
  }
}

function shutdown(key: string, host: HostInstance): void {
  host.dead = true;
  hosts.delete(key);
  try { host.child.kill('SIGKILL'); } catch { /* 忽略 */ }
  unregisterProcess(host.child.pid ?? -1);
  // 还没回话的请求全部按宿主故障收场，别让调用方一直等
  for (const [, resolve] of host.pending) {
    resolve({ id: null, exitCode: null as unknown as number, stdout: '', stderr: '', });
  }
  host.pending.clear();
}

function startHost(req: HostRequest): HostInstance {
  const key = `${req.interpreter}|${req.pluginId}`;

  const child = spawn(req.interpreter, ['-u', PYTHON_HOST], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...req.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });

  const host: HostInstance = {
    key, child, pending: new Map(), buffer: '', lastUsed: Date.now(), dead: false,
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    host.buffer += chunk.toString('utf8');
    let idx: number;
    while ((idx = host.buffer.indexOf('\n')) >= 0) {
      const line = host.buffer.slice(0, idx).trim();
      host.buffer = host.buffer.slice(idx + 1);
      if (!line) continue;
      let resp: HostResponse;
      try {
        resp = JSON.parse(line) as HostResponse;
      } catch {
        continue;   // 协议外的杂音，忽略
      }
      const resolve = resp.id ? host.pending.get(resp.id) : undefined;
      if (resolve && resp.id) {
        host.pending.delete(resp.id);
        resolve(resp);
      }
    }
  });

  child.on('exit', () => shutdown(key, host));
  child.on('error', () => shutdown(key, host));

  // 让它在「运行中」里可见、可结束——常驻进程占着内存，用户有权看见
  registerExternalProcess({
    pluginId: req.pluginId,
    pluginName: req.pluginName,
    actionId: '__host__',
    title: `${req.pluginName} · 常驻宿主（${path.basename(req.interpreter)}）`,
    command: `${req.interpreter} ${PYTHON_HOST}`,
    pid: child.pid ?? -1,
  });

  hosts.set(key, host);
  if (!reaper) reaper = setInterval(reapIdle, 60_000).unref();

  return host;
}

/** 这个解释器有没有对应的宿主实现 */
export function hasHostFor(interpreter: string): boolean {
  const base = path.basename(interpreter).toLowerCase();
  return /^python[w3.0-9]*\.exe$/.test(base) || base === 'python' || base === 'python3';
}

export function runViaHost(req: HostRequest): Promise<HostOutcome> {
  return new Promise((resolve) => {
    const key = `${req.interpreter}|${req.pluginId}`;
    let host = hosts.get(key);
    if (!host || host.dead) host = startHost(req);

    const id = `r${++seq}`;
    host.lastUsed = Date.now();

    const timer = setTimeout(() => {
      // 脚本卡死了：把整个宿主扔掉重来，别让后续请求也一起卡着
      host!.pending.delete(id);
      shutdown(key, host!);
      resolve({
        exitCode: null, stdout: '', stderr: '',
        timedOut: true,
        hostError: `执行超时（${req.timeout / 1000} 秒），常驻宿主已重建`,
      });
    }, req.timeout);

    host.pending.set(id, (resp) => {
      clearTimeout(timer);
      host!.lastUsed = Date.now();
      if (resp.id === null) {
        resolve({
          exitCode: null, stdout: resp.stdout, stderr: resp.stderr,
          timedOut: false, hostError: '常驻宿主意外退出',
        });
        return;
      }
      resolve({
        exitCode: resp.exitCode, stdout: resp.stdout, stderr: resp.stderr, timedOut: false,
      });
    });

    try {
      host.child.stdin!.write(JSON.stringify({
        id,
        script: req.script,
        argv: req.argv,
        cwd: req.cwd,
      }) + '\n');
    } catch (e) {
      clearTimeout(timer);
      host.pending.delete(id);
      resolve({
        exitCode: null, stdout: '', stderr: '',
        timedOut: false, hostError: `写入常驻宿主失败：${(e as Error).message}`,
      });
    }
  });
}

/** 关掉所有常驻宿主（内核退出时用，别留孤儿） */
export function shutdownHosts(): void {
  for (const [key, host] of [...hosts]) shutdown(key, host);
  if (reaper) {
    clearInterval(reaper);
    reaper = undefined;
  }
}

export function hostCount(): number {
  return hosts.size;
}