import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 解释器/外部命令的定位与依赖自检。
 *
 * Windows 上 PATH 很不可靠，而且微软商店会塞一个假的 python.exe 占位程序
 * （跑起来只会弹商店），所以这里必须：跳过 WindowsApps、验证真能跑、再兜底常见安装目录。
 * 这套判断是从实际踩坑里总结的。
 */

export interface Resolved {
  path: string;
  version: string;
}

const cache = new Map<string, Resolved | null>();

const WIN = process.platform === 'win32';

function isStoreStub(p: string): boolean {
  return /[\\/]windowsapps[\\/]/i.test(p);
}

function pathCandidates(name: string): string[] {
  const exts = WIN
    ? (process.env['PATHEXT'] ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)
    : [''];
  const out: string[] = [];
  for (const dir of (process.env['PATH'] ?? '').split(path.delimiter)) {
    if (!dir || isStoreStub(dir)) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (fs.existsSync(candidate)) {
        out.push(candidate);
        break;
      }
    }
  }
  return out;
}

/** 常见安装目录兜底（PATH 没配好时用） */
function fallbackCandidates(name: string): string[] {
  if (!WIN) {
    return [`/usr/bin/${name}`, `/usr/local/bin/${name}`, `/opt/homebrew/bin/${name}`];
  }
  const home = os.homedir();
  const out: string[] = [];
  if (name === 'python' || name === 'python3') {
    const roots = [
      path.join(home, 'AppData', 'Local', 'Programs', 'Python'),
      'C:\\Python313', 'C:\\Python312', 'C:\\Python311',
    ];
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      try {
        for (const entry of fs.readdirSync(root)) {
          out.push(path.join(root, entry, 'python.exe'));
        }
      } catch { /* 权限问题就跳过 */ }
      out.push(path.join(root, 'python.exe'));
    }
  }
  if (name === 'node') {
    for (const p of ['C:\\Program Files\\nodejs\\node.exe', 'C:\\Program Files\\node\\node.exe']) {
      out.push(p);
    }
  }
  if (name === 'git') out.push('C:\\Program Files\\Git\\cmd\\git.exe');
  return out;
}

function probe(p: string): Resolved | null {
  if (!fs.existsSync(p)) return null;
  try {
    const out = execFileSync(p, ['--version'], {
      timeout: 5000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const version = out.trim().split('\n')[0] ?? '';
    // 商店占位程序会输出"Python was not found"之类的提示而不是版本号
    if (/not found|无法找到|Microsoft Store/i.test(version)) return null;
    return { path: p, version };
  } catch {
    return null;
  }
}

/**
 * 定位一个外部命令。顺序：
 *   环境变量 ZEROKIT_<NAME> → PATH（排除商店占位）→ 常见安装目录
 * 必须能成功执行 `--version` 才算数。
 */
export function resolveTool(name: string): Resolved | null {
  const key = name.toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;

  const override = process.env[`ZEROKIT_${key.toUpperCase()}`];
  const tried: string[] = [];
  if (override) tried.push(override);
  if (WIN && !name.includes('.')) tried.push(...pathCandidates(`${name}.exe`));
  tried.push(...pathCandidates(name), ...fallbackCandidates(name));

  let result: Resolved | null = null;
  for (const p of tried) {
    result = probe(p);
    if (result) break;
  }
  cache.set(key, result);
  return result;
}

export interface Requirement {
  name: string;
  spec: string;
  ok: boolean;
  found?: Resolved;
  /** 缺失时给出的安装指引 */
  hint?: string;
}

const INSTALL_HINTS: Record<string, string> = {
  python: 'winget install Python.Python.3.13   或   https://www.python.org/downloads/',
  node: 'winget install OpenJS.NodeJS.LTS',
  git: 'winget install Git.Git',
  docker: 'winget install Docker.DockerDesktop',
};

/** 检查插件的 [requires] 是否满足 */
export function checkRequires(requires: Record<string, string>): Requirement[] {
  return Object.entries(requires).map(([name, spec]) => {
    const found = resolveTool(name);
    const req: Requirement = { name, spec, ok: found !== null };
    if (found) req.found = found;
    else req.hint = INSTALL_HINTS[name.toLowerCase()] ?? `请先安装 ${name}`;
    return req;
  });
}

export function clearResolveCache(): void {
  cache.clear();
}