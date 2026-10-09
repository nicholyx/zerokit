import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { type Plugin, loadPlugin } from './manifest.ts';
import { BUNDLED_PLUGINS_DIR, PLUGINS_DIR, ensureDirs } from './paths.ts';
import { adaptUtoolsPlugin, looksLikeUtoolsPlugin } from './utools.ts';
import { type PluginSource, readSource, writeSource } from './sources.ts';

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
    // 记下来源：自带的示例跟仓库版本走，plugin update 能感知到版本变化
    const version = loadPlugin(src).plugin?.version ?? '0.0.0';
    try {
      writeSource(dst, {
        type: 'bundled', installedAt: new Date().toISOString(), installedVersion: version,
      });
    } catch { /* 来源写不进去不影响安装 */ }
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

export interface InstallOptions {
  /** 落进插件目录的来源记录（装了从哪来的，update 靠它） */
  source?: PluginSource;
  /** 目录已存在时替换而不是报错（更新流程用；替换是备份式的，失败会回滚） */
  replace?: boolean;
}

/** 从本地目录安装插件（原生 plugin.toml 或 uTools plugin.json 都收） */
export function addFromDir(source: string, opts: InstallOptions = {}): AddResult {
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
  if (fs.existsSync(dst) && !opts.replace) {
    return { ok: false, message: `插件 "${result.plugin.id}" 已存在，先 zkit plugin remove ${result.plugin.id}`, warnings: result.warnings };
  }
  // 备份式替换：旧的先挪走，新的放好、删备份；中间任何一步失败就把旧的放回去。
  // 插件目录里除了代码还可能有运行状态（pid 文件等），不能出现「半个插件」。
  const backup = path.join(PLUGINS_DIR, `.tmp-old-${Date.now()}`);
  const hadOld = fs.existsSync(dst);
  if (hadOld) fs.renameSync(dst, backup);
  try {
    fs.cpSync(abs, dst, { recursive: true });
  } catch (e) {
    if (hadOld) fs.renameSync(backup, dst);
    return { ok: false, message: `复制插件文件失败：${(e as Error).message}`, warnings: result.warnings };
  }
  if (opts.source) {
    // 版本号让安装方省心：没填就取清单里实际装上的版本
    const src = opts.source.installedVersion
      ? opts.source
      : { ...opts.source, installedVersion: result.plugin.version };
    try { writeSource(dst, src); } catch { /* 来源写不进去不影响安装 */ }
  } else if (hadOld) {
    // 替换安装但没给新来源：沿用旧来源，只刷新版本号
    const prev = readSource(backup);
    if (prev) {
      try {
        writeSource(dst, { ...prev, installedVersion: result.plugin.version, installedAt: new Date().toISOString() });
      } catch { /* 同上 */ }
    }
  }
  if (hadOld) fs.rmSync(backup, { recursive: true, force: true });
  const note = utools ? '（按 uTools 插件兼容���行）' : '';
  const verb = hadOld ? '已更新' : '已安装';
  return { ok: true, id: result.plugin.id, dir: dst, message: `${verb} ${result.plugin.name}${note}`, warnings: result.warnings };
}

/**
 * 克隆一个 git 仓库并定位其中的插件目录。
 * 安装与更新共用这条路径（更新只是「再 clone 一次然后替换」）。
 */
export function clonePluginRepo(url: string, ref?: string): { ok: boolean; dir?: string; message: string } {
  const tmp = path.join(PLUGINS_DIR, `.tmp-${Date.now()}`);
  const args = ['clone', '--depth', '1'];
  if (ref) args.push('--branch', ref);
  args.push(url, tmp);
  const out = spawnSync('git', args, { encoding: 'utf8', windowsHide: true });
  if (out.status !== 0) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return { ok: false, message: `git clone 失败：${out.stderr || out.stdout}` };
  }
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
      fs.rmSync(tmp, { recursive: true, force: true });
      return {
        ok: false,
        message: '仓库里没找到 plugin.toml'
          + (nested.length > 1 ? `（找到多个，请用 zkit plugin add <仓库里的子目录>）` : ''),
      };
    }
  }
  return { ok: true, dir: root, message: '' };
}

/**
 * 安装前的预演：解析来源（git 仓库 / 本地目录），把要装的东西摊开给人审查。
 * 与安装本身分离（安装时重新拉取）：确认的含义是「我看过这个来源的能力并同意装它」，
 * 拖延期间仓库变了的话，装上的是最新一次拉取——这也是 git 的语义。
 */
export interface AddPreview {
  ok: boolean;
  /** 来源的规范形式（git 补全成完整 URL），安装与确认令牌都绑它 */
  source: string;
  load: { plugin?: Plugin; errors: string[]; warnings: string[] };
  message?: string;
}

/** owner/repo 形状补全成完整 GitHub URL，其它原样返回 */
export function normalizeGitSource(source: string): string {
  return /^[\w.-]+\/[\w.-]+$/.test(source) ? `https://github.com/${source}.git` : source;
}

export function previewAdd(source: string): AddPreview {
  let isLocalDir = false;
  try {
    isLocalDir = fs.statSync(source).isDirectory();
  } catch {
    /* 不存在就当它不是本地目录 */
  }
  const isGit = !isLocalDir
    && (/^(https?:\/\/|git@)/.test(source) || /^[\w.-]+\/[\w.-]+$/.test(source));
  if (isGit) {
    const url = normalizeGitSource(source);
    const cloned = clonePluginRepo(url);
    if (!cloned.ok || !cloned.dir) {
      return { ok: false, source: url, load: { errors: [], warnings: [] }, message: cloned.message };
    }
    try {
      return { ok: true, source: url, load: loadDir(cloned.dir) };
    } finally {
      fs.rmSync(findTmpRoot(cloned.dir), { recursive: true, force: true });
    }
  }
  if (isLocalDir) {
    return { ok: true, source: path.resolve(source), load: loadDir(path.resolve(source)) };
  }
  return {
    ok: false, source, load: { errors: [], warnings: [] },
    message: `不认识的来源 "${source}"：本地目录、https:// 开头或 owner/repo 形状的 git 仓库`,
  };
}

/** 从 git 仓库安装（信任边界之外，装完必须让人确认） */
export function addFromGit(url: string, ref?: string, opts: InstallOptions = {}): AddResult {
  ensureDirs();
  const cloned = clonePluginRepo(url, ref);
  if (!cloned.ok || !cloned.dir) {
    return { ok: false, message: cloned.message, warnings: [] };
  }
  try {
    // 记下来源（url/ref）：以后 plugin update 就是「再 clone 一次替换」
    return addFromDir(cloned.dir, {
      ...opts,
      source: opts.source ?? {
        type: 'git', url, ref, installedAt: new Date().toISOString(), installedVersion: '',
      },
    });
  } finally {
    // clone 出来的临时仓库（或它的父仓库）装完就删
    fs.rmSync(findTmpRoot(cloned.dir), { recursive: true, force: true });
  }
}

/** clone 临时目录都在 PLUGINS_DIR/.tmp-* 下，从子目录找回仓库根删掉（update.ts 也用） */
export function findTmpRoot(dir: string): string {
  let cur = path.resolve(dir);
  for (let i = 0; i < 10; i++) {
    if (path.basename(cur).startsWith('.tmp-')) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.resolve(dir);   // 找不到就把传入的目录当根（rm force 不存在也不报错）
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