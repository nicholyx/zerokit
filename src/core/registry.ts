import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { type Plugin, loadPlugin } from './manifest.ts';
import { BUNDLED_PLUGINS_DIR, PLUGINS_DIR, ensureDirs } from './paths.ts';
import { adaptUtoolsPlugin, looksLikeUtoolsPlugin } from './utools.ts';

/** 插件发现与装卸。插件就是 PLUGINS_DIR 下的一个个目录，目录即插件、复制即迁移。 */

export interface PluginEntry {
  dir: string;
  plugin?: Plugin;
  errors: string[];
  warnings: string[];
}

/**
 * 加载一个插件目录。
 *
 * 先按原生格式找 plugin.toml；没有的话看它是不是 uTools 插件（有 plugin.json
 * 且带 uTools 标志字段），是就地**翻译**成 zerokit 的清单。翻译在内存里完成，
 * 不写任何文件，所以既不用用户先转格式，也不污染别人的仓库——删掉目录就等于卸载。
 */
export function loadDir(dir: string) {
  const native = loadPlugin(dir);
  if (native.plugin || !looksLikeUtoolsPlugin(dir)) return native;
  const adapted = adaptUtoolsPlugin(dir);
  // 适配的问题也是问题：原样带出去，让 zkit doctor / 启动器能显示出来
  return adapted;
}

export function listPlugins(): PluginEntry[] {
  ensureDirs();
  if (!fs.existsSync(PLUGINS_DIR)) return [];
  const entries: PluginEntry[] = [];
  for (const name of fs.readdirSync(PLUGINS_DIR).sort()) {
    const dir = path.join(PLUGINS_DIR, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    // 忽略安装过程中的临时目录（.tmp-xxx / .tmp-pack-xxx）
    if (name.startsWith('.tmp-')) continue;
    const result = loadDir(dir);
    const entry: PluginEntry = { dir, errors: result.errors, warnings: result.warnings };
    if (result.plugin) entry.plugin = result.plugin;
    entries.push(entry);
  }
  return entries;
}

export function findPlugin(id: string): PluginEntry | undefined {
  return listPlugins().find(
    (e) => e.plugin?.id === id || path.basename(e.dir) === id,
  );
}

export class PluginNotFound extends Error {}

export function requirePlugin(id: string): Plugin {
  const entry = findPlugin(id);
  if (!entry) throw new PluginNotFound(`没有找到插件 "${id}"。用 zkit list 看看装了什么。`);
  if (!entry.plugin) {
    throw new Error(`插件 "${id}" 的 manifest 有问题：\n  - ${entry.errors.join('\n  - ')}`);
  }
  return entry.plugin;
}

/** 把仓库自带的示例插件装到 ZEROKIT_HOME，已存在就跳过 */
export function installBundled(): string[] {
  ensureDirs();
  const installed: string[] = [];
  if (!fs.existsSync(BUNDLED_PLUGINS_DIR)) return installed;
  for (const name of fs.readdirSync(BUNDLED_PLUGINS_DIR)) {
    const src = path.join(BUNDLED_PLUGINS_DIR, name);
    if (!fs.statSync(src).isDirectory()) continue;
    if (!fs.existsSync(path.join(src, 'plugin.toml'))) continue;
    const dst = path.join(PLUGINS_DIR, name);
    if (fs.existsSync(dst)) continue;
    fs.cpSync(src, dst, { recursive: true });
    installed.push(name);
  }
  return installed;
}

export interface AddResult {
  ok: boolean;
  id?: string;
  dir?: string;
  message: string;
  warnings: string[];
}

/** 从本地目录安装插件（原生 plugin.toml 或 uTools plugin.json 都收） */
export function addFromDir(source: string): AddResult {
  ensureDirs();
  const abs = path.resolve(source);
  const utools = looksLikeUtoolsPlugin(abs);
  if (!fs.existsSync(path.join(abs, 'plugin.toml')) && !utools) {
    return {
      ok: false,
      message: `${abs} 下既没有 plugin.toml，也不像 uTools 插件（缺 plugin.json）`,
      warnings: [],
    };
  }
  const result = loadDir(abs);
  if (!result.plugin) {
    return { ok: false, message: `清单校验没通过：\n  - ${result.errors.join('\n  - ')}`, warnings: result.warnings };
  }
  const dst = path.join(PLUGINS_DIR, result.plugin.id);
  if (fs.existsSync(dst)) {
    return { ok: false, message: `插件 "${result.plugin.id}" 已存在，先 zkit plugin remove ${result.plugin.id}`, warnings: result.warnings };
  }
  fs.cpSync(abs, dst, { recursive: true });
  const note = utools ? '（按 uTools 插件兼容运行）' : '';
  return { ok: true, id: result.plugin.id, dir: dst, message: `已安装 ${result.plugin.name}${note}`, warnings: result.warnings };
}

/** 从 git 仓库安装（信任边界之外，装完必须让人确认） */
export function addFromGit(url: string, ref?: string): AddResult {
  ensureDirs();
  const tmp = path.join(PLUGINS_DIR, `.tmp-${Date.now()}`);
  const args = ['clone', '--depth', '1'];
  if (ref) args.push('--branch', ref);
  args.push(url, tmp);
  const out = spawnSync('git', args, { encoding: 'utf8', windowsHide: true });
  if (out.status !== 0) {
    return { ok: false, message: `git clone 失败：${out.stderr || out.stdout}`, warnings: [] };
  }
  try {
    // 清单可能在仓库根，也可能在 plugins/<name>/ 下
    let root = tmp;
    if (!fs.existsSync(path.join(root, 'plugin.toml'))) {
      const nested = fs.existsSync(path.join(tmp, 'plugins'))
        ? fs.readdirSync(path.join(tmp, 'plugins'))
          .map((n) => path.join(tmp, 'plugins', n))
          .filter((p) => fs.existsSync(path.join(p, 'plugin.toml')))
        : [];
      if (nested.length === 1) root = nested[0]!;
      else {
        return {
          ok: false,
          message: '仓库里没找到 plugin.toml'
            + (nested.length > 1 ? `（找到多个，请用 zkit plugin add <仓库里的子目录>）` : ''),
          warnings: [],
        };
      }
    }
    const result = addFromDir(root);
    return result;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function removePlugin(id: string): boolean {
  const entry = findPlugin(id);
  if (!entry) return false;
  fs.rmSync(entry.dir, { recursive: true, force: true });
  return true;
}

/** 单文件打包：把一个插件压成一个 .toolpack，复制这个文件就等于搬走整套能力 */
export function exportPlugin(id: string): { ok: boolean; path?: string; message: string } {
  const plugin = requirePlugin(id);
  const files: Record<string, string> = {};
  const walk = (dir: string, prefix: string): void => {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git') continue;
      const full = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else files[rel] = fs.readFileSync(full).toString('base64');
    }
  };
  walk(plugin.dir, '');
  const pack = {
    format: 'zerokit-plugin',
    formatVersion: 1,
    plugin: { id: plugin.id, name: plugin.name, version: plugin.version },
    exportedAt: new Date().toISOString(),
    files,
  };
  const outPath = path.join(process.cwd(), `${plugin.id}.toolpack`);
  fs.writeFileSync(outPath, JSON.stringify(pack, null, 2));
  return { ok: true, path: outPath, message: `已导出 ${Object.keys(files).length} 个文件到 ${outPath}` };
}

export function importPlugin(packPath: string): AddResult {
  ensureDirs();
  let pack: { format?: string; files?: Record<string, string> };
  try {
    pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
  } catch (e) {
    return { ok: false, message: `读不了这个包：${(e as Error).message}`, warnings: [] };
  }
  if (pack.format !== 'zerokit-plugin' || !pack.files) {
    return { ok: false, message: '不是 zerokit 插件包（缺少 format: zerokit-plugin）', warnings: [] };
  }
  const tmp = path.join(PLUGINS_DIR, `.tmp-pack-${Date.now()}`);
  try {
    for (const [rel, b64] of Object.entries(pack.files)) {
      const target = path.join(tmp, rel);
      // 防目录穿越：包里的相对路径不允许跳出插件目录
      if (!target.startsWith(tmp + path.sep)) {
        return { ok: false, message: `包里含非法路径 "${rel}"，已拒绝导入`, warnings: [] };
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(b64, 'base64'));
    }
    return addFromDir(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}