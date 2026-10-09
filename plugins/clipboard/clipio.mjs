// 剪贴板读写的平台层：按平台选出「读一条文本 / 写一条文本」的命令。
//
// Node 没有内置剪贴板 API，只能借系统工具：
//   Windows : PowerShell + System.Windows.Forms（系统自带，零依赖）
//   macOS   : pbpaste / pbcopy（系统自带，零依赖）
//   Linux   : xclip 或 xsel（发行版不一定预装，缺了要给能看懂的安装指引）
//
// clipboard.mjs（动作层）和 watch.mjs（mac/linux 轮询器）共用这一份，
// 平台知识只写一处。
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

/** 沿 PATH 找一个可执行文件（Linux 下判断 xclip/xsel 在不在就用它） */
export function which(exe) {
  const dirs = (process.env['PATH'] ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const full = path.join(dir, exe);
    try {
      if (fs.statSync(full).isFile()) return full;
    } catch { /* 这个目录里没有，看下一个 */ }
  }
  return null;
}

/**
 * PowerShell 可执行文件（Windows 专用路径）。
 *
 * 优先用系统目录下的绝对路径：PATH 是用户可改的，一个同名 powershell 挡在前面
 * 就能劫持整个插件。找不到（非标准安装）再退回按 PATH 找。
 */
export function powershellExe() {
  const root = process.env['SystemRoot'] || 'C:\\Windows';
  const fixed = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return fs.existsSync(fixed) ? fixed : 'powershell';
}

/** PowerShell 读剪贴板的脚本（在常驻进程外一次性执行，仅测试/降级路径使用） */
const PS_READ = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  '[Windows.Forms.Clipboard]::GetText()',
].join('; ');

/**
 * 本平台的剪贴板工具。返回 { read(): string|null, write(text): ok, missing?: string }；
 * 平台上没有任何可用工具时 read/write 都走 missing 提示。
 */
export function clipboardIO() {
  if (process.platform === 'win32') {
    return {
      read() {
        const r = spawnSync(powershellExe(), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', PS_READ],
          { encoding: 'utf8', windowsHide: true, timeout: 20000 });
        return r.status === 0 ? (r.stdout ?? '') : null;
      },
      write(text) {
        // 文本走 stdin 而不是命令行参数：正文可能很长、含引号换行，塞进
        // -Command 的字符串里迟早被转义咬到；走管道则原样进原样出。
        // StreamReader 显式按 UTF-8 读，避免受控制台代码页影响（中文会乱）。
        const script = [
          'Add-Type -AssemblyName System.Windows.Forms',
          '$r = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [Text.Encoding]::UTF8)',
          '$t = $r.ReadToEnd()',
          'Set-Clipboard -Value $t',
        ].join('; ');
        const r = spawnSync(powershellExe(), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
          { input: text, encoding: 'utf8', windowsHide: true, timeout: 20000 });
        return r.status === 0 ? { ok: true } : { ok: false, error: (r.stderr || r.error?.message || '未知原因').trim() };
      },
    };
  }

  if (process.platform === 'darwin') {
    return {
      read() {
        const r = spawnSync('pbpaste', [], { encoding: 'utf8', timeout: 10000 });
        // pbpaste 在无 GUI 的会话里可能失败：按「这次没读到」处理，别当变化
        return r.status === 0 ? (r.stdout ?? '') : null;
      },
      write(text) {
        const r = spawnSync('pbcopy', [], { input: text, timeout: 10000 });
        return r.status === 0
          ? { ok: true }
          : { ok: false, error: (r.error?.message ?? 'pbcopy 失败').trim() };
      },
    };
  }

  // Linux：xclip / xsel 二选一，都没有就给安装指引
  if (which('xclip')) {
    return {
      read() {
        const r = spawnSync('xclip', ['-selection', 'clipboard', '-o'], { encoding: 'utf8', timeout: 10000 });
        return r.status === 0 ? (r.stdout ?? '') : null;
      },
      write(text) {
        const r = spawnSync('xclip', ['-selection', 'clipboard', '-i'], { input: text, timeout: 10000 });
        return r.status === 0 ? { ok: true } : { ok: false, error: (r.stderr || r.error?.message || 'xclip 失败').trim() };
      },
    };
  }
  if (which('xsel')) {
    return {
      read() {
        const r = spawnSync('xsel', ['--clipboard', '--output'], { encoding: 'utf8', timeout: 10000 });
        return r.status === 0 ? (r.stdout ?? '') : null;
      },
      write(text) {
        const r = spawnSync('xsel', ['--clipboard', '--input'], { input: text, timeout: 10000 });
        return r.status === 0 ? { ok: true } : { ok: false, error: (r.stderr || r.error?.message || 'xsel 失败').trim() };
      },
    };
  }

  const hint = '这个平台读写剪贴板需要 xclip 或 xsel（例如 Debian/Ubuntu: sudo apt install xclip；'
    + 'Arch: sudo pacman -S xclip）。装好后这个插件就能用。';
  return {
    missing: hint,
    read() { return null; },
    write() { return { ok: false, error: hint }; },
  };
}
