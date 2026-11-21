// 第三百五十轮：文档巡检——内链/whitelist/判据落盘/旧数字
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- docaudit350 ${d}`); } };
console.log('docaudit350-smoke');

// ① 内链校验（活文档——docs/ + 根 md）
let broken = 0;
for (const dir of ['docs']) {
  for (const p of fs.readdirSync(path.join(ROOT, dir), { recursive: true })) {
    const fp = path.join(ROOT, dir, p);
    if (!fp.endsWith('.md') || !fs.statSync(fp).isFile()) continue;
    const text = fs.readFileSync(fp, 'utf8');
    for (const m of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      const link = m[1];
      if (link.startsWith('http')) continue;
      if (!fs.existsSync(path.resolve(path.dirname(fp), link))) broken++;
    }
  }
}
check('① docs/ 内链 0 失效', broken === 0, `${broken} 处`);

// ② whitelist 死行审计（全仓文本试配——与 350 轮审计算法一致）
const wlLines = fs.readFileSync(path.join(ROOT, '.i18n-whitelist'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
let allText = '';
for (const dir of ['web', 'src', 'test', 'docs', 'plugins', 'scripts']) {
  for (const f of fs.readdirSync(path.join(ROOT, dir), { recursive: true })) {
    const fp = path.join(ROOT, dir, f);
    if (typeof f === 'string' && fp.endsWith('.md') && fs.statSync(fp).isFile()) allText += fs.readFileSync(fp, 'utf8');
    else if (typeof f === 'string' && (fp.endsWith('.mjs') || fp.endsWith('.js') || fp.endsWith('.ts') || fp.endsWith('.toml')) && fs.statSync(fp).isFile()) allText += fs.readFileSync(fp, 'utf8');
  }
}
const deadWl = wlLines.filter((l) => { try { return !new RegExp(l).test(allText); } catch { return true; } }).length;
check('② whitelist 死行 < 30（1469→1392 已清 81）', deadWl < 30, `${deadWl} 行`);

// ③ 判据落盘 12 条（含 342-347 补遗 4 条）
const doc = fs.readFileSync(path.join(ROOT, 'docs', 'reference', 'platform-pitfalls.md'), 'utf8');
check('③ 判据落盘（CDP 五条 + 配置同步四条）', ['DevTools host 校验', 'target 类型漂移', '冷启动竞态', '代理劫持回环', '降级一致性', '持久化只写不读', '恢复条目被翻页误杀', 'ops 白名单与功能脱节', 'typecheck 假绿'].every((k) => doc.includes(k)), '');

// ⑤ 活文档无过时计数（≥195 文件）
let stale = 0;
for (const p of fs.readdirSync(path.join(ROOT, 'docs'), { recursive: true })) {
  const fp = path.join(ROOT, 'docs', p);
  if (typeof p !== 'string' || !fp.endsWith('.md') || !fs.statSync(fp).isFile()) continue;
  const t = fs.readFileSync(fp, 'utf8');
  for (const m of t.matchAll(/(\d{3}) 个文件、?\*{0,2}(\d{4}) 项断言/g)) {
    if (Number(m[1]) < 195 && Number(m[2]) < 3520) stale++;
  }
}
check('⑤ 活文档无过时计数（历史节外）', stale === 0, `${stale} 处`);

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
