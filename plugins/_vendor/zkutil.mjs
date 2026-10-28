/**
 * 插件共享工具（vendor 层）。
 * 放在 plugins/_vendor/ 下、由各插件以相对路径 import——
 * zerokit 的插件是纯文本目录，不打包，共享代码走文件系统最直白。
 * 注意：_vendor 以下划线开头，market.json 与 plugin bundled 都会跳过
 * 它本身（它不是插件，只是代码）。
 */

/**
 * 统一成功输出：单行 JSON 打到 stdout。[[action]] 的标准出口。
 * 约定与 demochain 一致：payload 直接是顶层对象（不包 {ok,data} 信封）——
 * chain 的 {别名.data.字段} 取的是 stdout 解析结果本身，包一层信封会让
 * 引用全部多一级、还容易踩「没有字段」的坑。成败语义交给退出码。
 */
export function ok(data) { console.log(JSON.stringify(data ?? {})); }

/** 统一失败输出：单行 JSON 打到 stdout，退出码交给调用方设。 */
export function err(message) { console.log(JSON.stringify({ error: String(message).slice(0, 500) })); }

/** 千分位。 */
export function groupDigits(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

/** 字节数人性化（1024 进制）。 */
export function humanBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Number(n); let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** 把任意文本按行摊开成 JSON 数组（去空行、去首尾空白）。 */
export function lines(text) {
  return String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}
