#!/usr/bin/env node
/**
 * snap 插件：系统自带工具截图，跨三平台零依赖。
 * 平台层分流：macOS screencapture / Windows PowerShell / Linux 桌面工具探测。
 * 输出协议来自 _vendor（ok/err/humanBytes）。
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ok, err, humanBytes } from '../_vendor/zkutil.mjs';

const [,, cmd, ...args] = process.argv;

function resolveDir(d) {
  const raw = (d ?? '~/Desktop').replace(/^~(?=\/|$)/, os.homedir());
  const abs = path.resolve(raw);
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

function shot(file, interactive) {
  const plat = process.platform;
  if (plat === 'darwin') {
    // -x 关快门声；窗口模式加 -o（无阴影）没有活跃窗口概念时退化为全屏
    const r = spawnSync('screencapture', interactive ? ['-xwo', file] : ['-x', file], { encoding: 'utf8' });
    if (r.status !== 0) {
      // headless / 无屏幕会话（SSH、CI、未授权的辅助进程）会走到这里——
      // 报错时把补救路径说出来，而不是只甩一句"失败"。
      throw new Error(`screencapture 失败：${(r.stderr ?? '').trim()
        || '无法从显示器取图'}——如果是 SSH/无屏幕环境，截图需要连着真实显示器；`
        + 'macOS 首次使用需在「系统设置 → 隐私与安全 → 屏幕录制」授权给终端。');
    }
  } else if (plat === 'win32') {
    const ps = `Add-Type -AssemblyName System.Windows.Forms;`
      + `[System.Windows.Forms.Screen]::AllScreens | Out-Null;`
      + `Add-Type -AssemblyName System.Drawing;`
      + `$b = New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width, [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height);`
      + `$g = [System.Drawing.Graphics]::FromImage($b);`
      + `$g.CopyFromScreen(0,0,0,0,$b.Size); $b.Save('${file.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png);`;
    const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(`PowerShell 截图失败：${(r.stderr ?? '').slice(0, 200)}`);
  } else {
    // Linux：按可用性探测（gnome-screenshot > scrot > import）
    for (const [bin, flags] of [['gnome-screenshot', ['-f', file]], ['scrot', [file]], ['import', ['-window', 'root', file]]]) {
      const r = spawnSync(bin, flags, { encoding: 'utf8' });
      if (r.status === 0) return;
      if (r.error?.code !== 'ENOENT') throw new Error(`${bin} 失败：${r.stderr}`);
    }
    throw new Error('没有可用的截图工具（试过 gnome-screenshot / scrot / import），装其一再试');
  }
}

try {
  switch (cmd) {
    case 'full':
    case 'window': {
      const dir = resolveDir(args[0]);
      const name = (args[1] ?? 'snap').replace(/[\\/:*?"<>|]/g, '-');
      const file = path.join(dir, `${name}.png`);
      shot(file, cmd === 'window');
      const st = fs.statSync(file);
      ok({ file, bytes: st.size, human: humanBytes(st.size), mode: cmd });
      break;
    }
    case 'list': {
      const dir = resolveDir(args[0]);
      const rows = fs.readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.png'))
        .map((f) => { const st = fs.statSync(path.join(dir, f)); return { file: f, bytes: st.size, human: humanBytes(st.size), mtime: st.mtime.toISOString() }; })
        .sort((a, b) => b.mtime.localeCompare(a.mtime))
        .slice(0, 10);
      ok({ dir, rows });
      break;
    }
    default: err(`未知子命令：${cmd}`); process.exitCode = 1;
  }
} catch (e) {
  err(e?.message ?? e);
  process.exitCode = 1;
}
