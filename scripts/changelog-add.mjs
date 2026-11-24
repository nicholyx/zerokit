// 第四百零九轮：CHANGELOG 加条目辅助——根治「写条目锚点误插已发布段」
// （308 首犯、405 复发、408 再犯——三次人工事故的机器化）
// 用法：node scripts/changelog-add.mjs <Added|Fixed|Changed|...> '条目文本（单行）'
// 规则：只在 [Unreleased] 段内操作——先切出 Unreleased 段，段内找目标分类段，
// 没有则新建（按 Added→Changed→Deprecated→Removed→Fixed→Security 顺序插入）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORDER = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];
const [section, entry] = process.argv.slice(2);
if (!section || !entry || !ORDER.includes(section)) {
  console.error('用法：node scripts/changelog-add.mjs <Added|Changed|Deprecated|Removed|Fixed|Security> \'条目（单行）\'');
  process.exit(2);
}
const CL = path.join(ROOT, 'CHANGELOG.md');
const s = fs.readFileSync(CL, 'utf8');
const start = s.indexOf('## [Unreleased]');
if (start < 0) { console.error('找不到 [Unreleased] 段'); process.exit(1); }
const endRaw = s.indexOf('\n## [', start + 5);
const end = endRaw === -1 ? s.length : endRaw;
let seg = s.slice(start, end);
const line = '- ' + entry.replace(/^-\s*/, '');
// 段内已有该分类 → 追加到该段末尾（段尾 = 下一个 ### 或段尾）
const head = `### ${section}\n`;
const hi = seg.indexOf(head);
if (hi >= 0) {
  let tail = seg.indexOf('\n### ', hi + head.length);
  if (tail === -1) tail = seg.length;
  // 409：条目后接的下一个 '### ' 前必须空一行；段尾则收一个换行
  const after = tail === seg.length ? '' : '\n' + seg.slice(tail + 1);
  const body = seg.slice(hi + head.length, tail).replace(/\n+$/, '');
  seg = seg.slice(0, hi) + head + (body ? body + '\n' : '') + '\n' + line + '\n' + (tail === seg.length ? '' : '\n') + after.replace(/^\n+/, '\n### ') === seg ? seg : seg.slice(0, hi) + head + (body ? body + '\n' : '') + '\n' + line + '\n' + after;
} else {
  // 新建分类段：按 ORDER 插到第一个「序更大的已有段」之前
  const idx = ORDER.indexOf(section);
  let at = seg.length;
  for (let k = idx + 1; k < ORDER.length; k++) {
    const p2 = seg.indexOf(`\n### ${ORDER[k]}\n`);
    if (p2 >= 0) { at = p2 + 1; break; }
  }
  seg = seg.slice(0, at) + `\n${head}\n${line}\n` + seg.slice(at);
}
// 占位行清理：该段有条目后去掉「（下一版攒着）」
// 434：规范化——段头与首条目之间只允许一个空行（去重/删除残留的双空行会让
// release-prep 的「段头紧跟条目」判定失配）
seg = seg.replace(new RegExp(`(### ${section}\n)\n+(- )`, 'g'), '$1\n$2');
seg = seg.replace(new RegExp(`(### ${section}\\n\\n)(?:（下一版攒着）\\n\\n?)`), '$1');
fs.writeFileSync(CL, s.slice(0, start) + seg + s.slice(end));
console.log(`OK    已插入 [Unreleased] → ${section}（${line.slice(0, 40)}…）`);
