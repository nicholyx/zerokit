import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * zerokit 的数据根目录。
 *
 * 全部状态都在这个目录里，所以「复制这个目录」= 把整套配置和插件搬走，
 * 这正是本项目的核心诉求。测试时用 ZEROKIT_HOME 指到临时目录。
 */
export const HOME: string = process.env.ZEROKIT_HOME
  ? path.resolve(process.env.ZEROKIT_HOME)
  : path.join(os.homedir(), '.zerokit');

export const PLUGINS_DIR: string = path.join(HOME, 'plugins');
export const DATA_DIR: string = path.join(HOME, 'data');
export const LOG_DIR: string = path.join(HOME, 'logs');
export const CONFIG_PATH: string = path.join(HOME, 'config.toml');
/**
 * 插件设置项的存放目录：一个插件一个 `<插件id>.json`。
 *
 * 与 `config.toml`（内核自己的全局配置）分开：插件设置项可能含密钥，
 * 单独放、单独用 0600 权限，删一个插件不会误伤内核配置。
 */
export const SETTINGS_DIR: string = path.join(HOME, 'settings');

/** 仓库根目录（src/core/paths.ts -> 仓库根） */
export const PKG_ROOT: string = path.resolve(import.meta.dirname, '..', '..');
/** 随仓库分发的示例插件 */
export const BUNDLED_PLUGINS_DIR: string = path.join(PKG_ROOT, 'plugins');

export function ensureDirs(): void {
  for (const d of [HOME, PLUGINS_DIR, DATA_DIR, LOG_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
  // 设置项可能含密钥：目录只给当前用户读写（0700）。其它目录沿用默认权限。
  fs.mkdirSync(SETTINGS_DIR, { recursive: true, mode: 0o700 });
}

/** 插件私有的持久化目录（跨更新保留），插件可通过 {data_dir} 使用 */
export function pluginDataDir(pluginId: string): string {
  const p = path.join(DATA_DIR, pluginId);
  fs.mkdirSync(p, { recursive: true });
  return p;
}