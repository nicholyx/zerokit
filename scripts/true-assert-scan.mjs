// 第四百零一轮：恒真断言护栏——check(…, true) 新增即报（400 复盘「后续三条」之一）
// 背景：398 轮清掉 4 处「声称验证 X 实际没验」的懒恒真，但 lint 不查——新的恒真断言
// 会在几十轮后无声回退。本扫描把现存恒真断言冻结为白名单（scripts/true-assert-whitelist.json，
// 按「文件 + 断言名 + 条数」三元组），新增位置即 FAIL。
// 白名单里的每一条都是合法平台占位（win 无 bash / 无 Chrome / 降级路径 / .git/hooks 不入 CI）。
// 想加新恒真断言：先问「这行到底验了什么」——能写真断言就写；确属占位才进白名单，并在断言名里写明「占位——原因」。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIR = path.join(ROOT, 'test');
const WL_FILE = path.join(ROOT, 'scripts', 'true-assert-whitelist.json');

/** 匹配 check('名', true 或 check("名", true（第二参为字面 true） */
const TRUE_ASSERT = /check\(\s*(['"`])([^'"`]+)\1\s*,\s*true\b/g;

const wl = JSON.parse(fs.readFileSync(WL_FILE, 'utf8'));
const allowed = new Map(wl.map((w) => [`${w.file}\u0000${w.name}`, w.count]));

const found = new Map();  // key -> count
for (const f of fs.readdirSync(TEST_DIR)) {
  if (!f.endsWith('.mjs')) continue;
  const src = fs.readFileSync(path.join(TEST_DIR, f), 'utf8');
  for (const m of src.matchAll(TRUE_ASSERT)) {
    const key = `${f}\u0000${m[2]}`;
    found.set(key, (found.get(key) ?? 0) + 1);
  }
}

const added = [];
for (const [key, n] of found) {
  const ok = allowed.get(key) ?? 0;
  if (n > ok) added.push(`${key.split('\u0000')[0]} :: ${key.split('\u0000')[1]}（${n} 处，白名单 ${ok}）`);
}
const removed = [];
for (const [key, ok] of allowed) {
  if ((found.get(key) ?? 0) < ok) removed.push(`${key.split('\u0000')[0]} :: ${key.split('\u0000')[1]}`);
}

if (added.length > 0) {
  console.error('新增恒真断言（check(…, true)）——声称验证某事、实际什么都没验：');
  for (const a of added) console.error(`  ✗ ${a}`);
  console.error('  处置：能写真断言就写；确属平台占位才登记进 scripts/true-assert-whitelist.json，并在断言名写明「占位——原因」。');
  process.exit(1);
}
const total = [...found.values()].reduce((a, b) => a + b, 0);
console.log(`OK    恒真断言护栏（现存 ${total} 处全在白名单，零新增${removed.length ? `；白名单有 ${removed.length} 条已不再出现——可清理` : ''}）`);
if (removed.length > 0) {
  console.log('  提示（不失败）：以下白名单条目在代码里已找不到，可从白名单删除：');
  for (const r of removed) console.log(`  · ${r}`);
}
