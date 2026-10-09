#!/usr/bin/env node
// 示例插件的实现。插件可以是任何语言，只要按清单约定的方式输出即可。
// 约定：成功时 stdout 输出结构化内容，退出码 0；失败非 0，错误写 stderr。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
  // 非 Windows 的 ps 有两个方言：Linux（GNU procps）认 --sort 和 pmem；
  // macOS（BSD ps）只认 -m（按内存排序）和 rss（KB）。两边分开处理。
  if (process.platform === 'darwin') {
    // BSD 的 comm 列被内核限制在 16 字符（/Applications/Or 这种残名），所以取
    // command（完整命令行）：.app 路径提取出应用名，普通程序取 basename。
    const ps = execFileSync('ps', ['-eo', 'pid,rss,command', '-m'], { encoding: 'utf8' });
    return ps.trim().split('\n').slice(1, limit + 1).map((line) => {
      const cols = line.trim().split(/\s+/);
      const cmdline = cols.slice(2).join(' ');
      const app = /^(.*?\.app)\//.exec(cmdline);
      const name = app ? path.basename(app[1]) : path.basename(cmdline.split(/\s+/)[0] ?? '');
      const mb = Number(cols[1]) / 1024;
      return { PID: cols[0], 进程: name, 内存: `${mb.toFixed(1)} MB` };
    });
  }
  const ps = execFileSync('ps', ['-eo', 'pid,comm,pmem,pcpu', '--sort=-pmem'], { encoding: 'utf8' });
  return ps.trim().split('\n').slice(1, limit + 1).map((line) => {
    const cols = line.trim().split(/\s+/);
    return { PID: cols[0], 进程: cols[1], 内存占用: `${cols[2]}%`, CPU占用: `${cols[3]}%` };
  });
}

/** 持续打印，直到被结束——用来演示「运行中」面板里能被看见、能被结束 */
async function watch() {
  const total = os.totalmem();
  let last = os.cpus().map((c) => c.times);
  let lastAt = Date.now();
  for (let i = 1; ; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const now = os.cpus().map((c) => c.times);
    let idle = 0;
    let busy = 0;
    now.forEach((t, idx) => {
      const p = last[idx];
      idle += t.idle - p.idle;
      busy += (t.user + t.system + t.nice) - (p.user + p.system + p.nice);
    });
    last = now;
    const load = busy + idle > 0 ? (busy / (busy + idle)) * 100 : 0;
    const used = total - os.freemem();
    const at = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    process.stdout.write(
      `[${at}] #${i}  内存 ${(used / 1024 ** 3).toFixed(1)}/${(total / 1024 ** 3).toFixed(1)} GB`
      + ` (${((used / total) * 100).toFixed(0)}%)   CPU ${load.toFixed(0)}%`
      + `   [${((Date.now() - lastAt) / 1000).toFixed(0)}s]\n`,
    );
  }
}

if (mode === 'watch') {
  await watch();
} else {
  let result;
  if (mode === 'disk') result = disks();
  else if (mode === 'top') result = top(Number(flag('--limit', 10)) || 10);
  else result = overview();
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}