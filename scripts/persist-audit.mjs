// 第二百零六轮⑦：持久化审计——localStorage 写点全部进备份分组（孤儿键=0）
// 扫 web/app.js 的 localStorage.setItem('zerokit.x', ...) 字面键，对照 web/extras.js 的
// BACKUP_GROUPS（精确匹配）+ PREFIX_GROUPS（前缀匹配）。孤儿键 = 导出备份会丢的设置。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appJs = readFileSync(path.join(ROOT, 'web', 'app.js'), 'utf8');
const extrasJs = readFileSync(path.join(ROOT, 'web', 'extras.js'), 'utf8');

const writes = [...appJs.matchAll(/localStorage\.setItem\('([^']+)'/g)].map((m) => m[1]).filter((k) => k.startsWith('zerokit.'));
const exactBlockM = extrasJs.match(/export const BACKUP_GROUPS = \[([\s\S]*?)\n\];/);
const exact = exactBlockM ? (exactBlockM[1].match(/'([^']+)'/g) ?? []).map((s2) => s2.replaceAll("'", '')) : [];
const prefixes = [...extrasJs.matchAll(/prefix: '([^']+)'/g)].map((m) => m[1]);

const orphans = [...new Set(writes)].filter((k) => !exact.includes(k) && !prefixes.some((p) => k.startsWith(p)));
if (orphans.length) {
  console.error(`FAIL  孤儿键 ${orphans.length} 个（写了但导出备份会丢）：${orphans.join(', ')}`);
  process.exit(1);
}
console.log(`OK    持久化审计：${new Set(writes).size} 个字面键全部进备份分组`);
// PREF 表键（PREF.xxx 动态形态）单独计数提示（静态扫不到，靠 classifyKey 单测覆盖）
const prefWrites = (appJs.match(/localStorage\.setItem\(PREF\./g) || []).length;
console.log(`OK    PREF 表动态写点 ${prefWrites} 处（覆盖由 extras-smoke classifyKey 断言保证）`);
