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
}

const FILE = () => path.join(HOME, 'running.json');

/** 本进程亲自拉起的子进程，用来取实时输出、以及优先用句柄结束 */
const owned = new Map<number, { child: ChildProcess; tail: string[] }>();
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

/** 一次 tasklist 拿到所有活着的 PID，避免逐个进程起一次命令 */
function livePids(): Set<number> {
  const set = new Set<number>();
  try {
    const out = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], {
      encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 16 << 20,
    });
    for (const line of (out.stdout ?? '').split('\n')) {
      const cols = line.split(',');
      if (cols.length < 2) continue;
      const pid = Number(cols[1]?.replace(/"/g, ''));
      if (Number.isFinite(pid)) set.add(pid);
    }
  } catch {
    /* 拿不到就当全都还活着，宁可多列也不误删 */
  }
  return set;
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
  child.on('exit', () => {
    // 进程自己退了，就把登记项摘掉（下次 list 时自然消失）
    writeAll(readAll().filter((r) => r.pid !== record.pid));
  });
  owned.set(record.pid, { child, tail });

  return record;
}

export function listProcesses(includeExited = false): ProcessView[] {
  const records = readAll();
  if (records.length === 0) return [];
  const alive = livePids();

  const views = records.map((r) => {
    const mine = owned.get(r.pid);
    const running = alive.size === 0 ? true : alive.has(r.pid);
    return { ...r, running, tail: mine ? mine.tail.slice(-6) : [] };
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