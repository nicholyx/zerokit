#!/usr/bin/env node
// 示例插件的实现。插件可以是任何语言，只要按清单约定的方式输出即可。
// 约定：成功时 stdout 输出结构化内容，退出码 0；失败非 0，错误写 stderr。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const args = process.argv.slice(2);
const mode = args[0] ?? 'overview';
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const gb = (n) => `${(n / 1024 ** 3).toFixed(1)} GB`;
const pct = (x) => `${(x * 100).toFixed(1)}%`;

function uptimeText(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d} 天 ${h} 小时 ${m} 分`;
}

function overview() {
  const cpus = os.cpus();
  const total = os.totalmem();
  const free = os.freemem();
  return {
    系统: `${os.type()} ${os.release()} (${os.arch()})`,
    主机名: os.hostname(),
    当前用户: os.userInfo().username,
    CPU: (cpus[0]?.model ?? '未知').trim(),
    核心数: cpus.length,
    内存总量: gb(total),
    内存已用: gb(total - free),
    内存占用率: pct((total - free) / total),
    已开机: uptimeText(os.uptime()),
    Node: process.version,
  };
}

function disks() {
  const roots = process.platform === 'win32'
    ? 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`).filter((r) => {
      try {
        fs.statfsSync(r);
        return true;
      } catch {
        return false;
      }
    })
    : ['/'];
  const out = [];
  for (const root of roots) {
    try {
      const s = fs.statfsSync(root);
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      out.push({ 盘符: root, 容量: gb(total), 剩余: gb(free), 已用: pct(1 - free / total) });
    } catch {
      /* 无权限的盘直接跳过 */
    }
  }
  return out;
}

function top(limit) {
  if (process.platform === 'win32') {
    const csv = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], {
      encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024,
    });
    return csv.trim().split('\n')
      .map((line) => line.split('","').map((s) => s.replace(/^"|"$/g, '')))
      .map((cols) => ({
        进程: cols[0],
        PID: cols[1],
        _mb: parseFloat(String(cols[4] ?? '').replace(/[^\d.]/g, '')) / 1024 || 0,
      }))
      .sort((a, b) => b._mb - a._mb)
      .slice(0, limit)
      .map((r) => ({ 进程: r.进程, PID: r.PID, 内存: `${r._mb.toFixed(1)} MB` }));
  }
  const ps = execFileSync('ps', ['-eo', 'pid,comm,pmem,pcpu', '--sort=-pmem'], { encoding: 'utf8' });
  return ps.trim().split('\n').slice(1, limit + 1).map((line) => {
    const cols = line.trim().split(/\s+/);
    return { PID: cols[0], 进程: cols[1], 内存占用: `${cols[2]}%`, CPU占用: `${cols[3]}%` };
  });
}

let result;
if (mode === 'disk') result = disks();
else if (mode === 'top') result = top(Number(flag('--limit', 10)) || 10);
else result = overview();

process.stdout.write(JSON.stringify(result, null, 2) + '\n');