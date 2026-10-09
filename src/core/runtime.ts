import { spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { HOME, ensureDirs } from './paths.ts';

/**
 * 「运行中」的托管进程。
 *
 * 声明了 background = true 的动作不会阻塞等待退出，它拉起的进程被登记下来，
 * 于是能在「运行中」里看到、并能结束掉——这是启动器和「一堆快捷方式」的分界线。
 *
 * **登记表是落盘的**，不是只放在内存里。原因是一个很容易踩的坑：
 * 从界面（内核进程）启动的后台进程，如果只记在内核的内存里，那么在终端里
 * 敲 `zkit ps` 是看不见的（那是另一个进程）。落盘之后，谁都能看见、都能结束，
 * 内核重启也不会丢。
 *
 * 判活走系统事实（tasklist），而不是信任文件里写的 pid 一定还在。
 */

export interface ManagedProcess {
  id: string;
  pluginId: string;
  pluginName: string;
  actionId: string;
  title: string;
  command: string;
  pid: number;
  startedAt: number;
}

export interface ProcessView extends ManagedProcess {
  running: boolean;
  /** 只有本进程亲自拉起的才有实时输出 */
  tail: string[];
  /**
   * 退出码。只有**本进程亲自拉起**的才拿得到——别的会话登记的进程退出时，
   * 没有任何人会收到通知，所以那一类只能显示"已退出"，编不出一个码来。
   * 刻意不做成"取不到就给 0"：那会把崩溃显示成正常退出。
   */
  exitCode?: number;
}

const FILE = () => path.join(HOME, 'running.json');

/** 本进程亲自拉起的子进程，用来取实时输出、以及优先用句柄结束 */
const owned = new Map<number, { child: ChildProcess; tail: string[]; exitCode?: number | null }>();
let seq = 0;

function readAll(): ManagedProcess[] {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    return Array.isArray(raw) ? raw.filter((r) => typeof r?.pid === 'number') : [];
  } catch {
    return [];
  }
}

function writeAll(list: ManagedProcess[]): void {
  try {
    ensureDirs();
    fs.writeFileSync(FILE(), JSON.stringify(list, null, 2));
  } catch {
    /* 写不了就退化成"只有本进程看得见"，不该因此让动作失败 */
  }
}

/**
 * 进程还活着吗。
 *
 * 用 `process.kill(pid, 0)` 而不是 tasklist：前者 **0.06ms**，后者单查 229ms、
 * 拉全表 **1208ms**——实测差了三四个数量级。这是「运行中」面板能每两秒刷新的前提。
 */
export function isAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM 表示进程存在、只是我们没权限碰它——那也算活着
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function registerProcess(entry: Omit<ManagedProcess, 'id' | 'startedAt'> & { child: ChildProcess }): ManagedProcess {
  const { child, ...rest } = entry;
  const record: ManagedProcess = { ...rest, id: `p${++seq}`, startedAt: Date.now() };

  const list = readAll().filter((r) => r.pid !== record.pid);
  list.push(record);
  writeAll(list);

  // 留一份内存副本：实时输出只有本进程能提供，结束它也有句柄可用
  const tail: string[] = [];
  const keep = (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim()) tail.push(line.trim());
    }
    if (tail.length > 20) tail.splice(0, tail.length - 20);
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  child.on('exit', (code) => {
    // 先记下退出码：调用方可能正要在"已退出"那一行显示它
    const entry = owned.get(record.pid);
    if (entry) entry.exitCode = code;
    // 进程自己退了，就把登记项摘掉（下次 list 时自然消失）
    writeAll(readAll().filter((r) => r.pid !== record.pid));
  });
  owned.set(record.pid, { child, tail });

  return record;
}

/**
 * 登记一个**不是我们直接拉起**的进程（例如常驻宿主）。
 *
 * 和 registerProcess 的区别：这里**不接管 stdio**。常驻宿主的 stdout 是它和内核
 * 之间的协议通道，挂上监听会把协议数据吃掉。
 */
export function registerExternalProcess(
  entry: Omit<ManagedProcess, 'id' | 'startedAt'>,
): ManagedProcess {
  const record: ManagedProcess = { ...entry, id: `x${++seq}`, startedAt: Date.now() };
  writeAll(readAll().filter((r) => r.pid !== record.pid).concat(record));
  return record;
}

/** 把一个已登记的进程摘掉（常驻宿主自己结束时用） */
export function unregisterProcess(pid: number): void {
  writeAll(readAll().filter((r) => r.pid !== pid));
}

export function listProcesses(includeExited = false): ProcessView[] {
  const records = readAll();
  if (records.length === 0) return [];

  const views: ProcessView[] = records.map((r) => {
    const mine = owned.get(r.pid);
    const view: ProcessView = { ...r, running: isAlive(r.pid), tail: mine ? mine.tail.slice(-6) : [] };
    if (mine?.exitCode !== undefined && mine.exitCode !== null) view.exitCode = mine.exitCode;
    return view;
  });

  // 已经不在了的，顺手从登记表里清掉（除非调用方想看一眼"最近退出"）
  const dead = views.filter((v) => !v.running);
  if (dead.length > 0 && !includeExited) {
    writeAll(records.filter((r) => !dead.some((d) => d.pid === r.pid)));
  }
  return views
    .filter((v) => includeExited || v.running)
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** 结束一个托管进程。本进程拉起的走句柄，别人拉起的走 PID。 */
export function killProcess(id: string): { ok: boolean; message: string } {
  const record = readAll().find((r) => r.id === id);
  if (!record) return { ok: false, message: `没有这个进程：${id}` };

  const mine = owned.get(record.pid);
  if (mine) {
    try { mine.child.kill('SIGTERM'); } catch { /* 可能已经没了 */ }
    setTimeout(() => {
      try { mine.child.kill('SIGKILL'); } catch { /* 忽略 */ }
      owned.delete(record.pid);
    }, 600);
  } else {
    const out = spawnSync('taskkill', ['/PID', String(record.pid), '/T', '/F'], {
      encoding: 'utf8', windowsHide: true, timeout: 15000,
    });
    if (out.status !== 0) {
      const detail = (out.stderr || out.stdout || '').trim().slice(0, 200);
      if (!/not found|不存在|没有找到/i.test(detail)) {
        return { ok: false, message: detail || '结束失败' };
      }
    }
  }

  writeAll(readAll().filter((r) => r.id !== id));
  return { ok: true, message: `已结束 ${record.title}（PID ${record.pid}）` };
}

export function killAllProcesses(): { killed: number; failed: number } {
  let killed = 0;
  let failed = 0;
  for (const p of listProcesses(true)) {
    if (killProcess(p.id).ok) killed++;
    else failed++;
  }
  return { killed, failed };
}

export function runningCount(): number {
  return listProcesses().length;
}