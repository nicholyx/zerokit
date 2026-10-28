#!/usr/bin/env node
/**
 * 发布准备工具（第五十五轮①–⑤）：CHANGELOG 归档 + 版本号四处同步，全部带自检。
 *
 * 用法：
 *   node scripts/release-prep.mjs 0.60.0           # 干跑（默认 --dry-run）
 *   node scripts/release-prep.mjs 0.60.0 --write   # 真正落盘
 *
 * 干的事：
 *   1. CHANGELOG：[Unreleased] 段归档为 [X.Y.Z] - 今日；[Unreleased] 重置为空壳
 *      自检：新段标题存在、新段条目数 === 归档前条目数、[Unreleased] 只剩空壳
 *   2. 版本号四处：package.json / apps/desktop/src-tauri/tauri.conf.json /
 *      apps/desktop/src-tauri/Cargo.toml / Cargo.lock（结构化定位 zerokit-desktop 段）
 *      自检：跑 scripts/check-docs.mjs 的版本号四处断言
 *   3. 干跑只打印 diff，不写任何文件
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const ver = argv.find((a) => /^\d+\.\d+\.\d+$/.test(a));
if (!ver) {
  console.error('用法：node scripts/release-prep.mjs <X.Y.Z> [--write]（不带 --write 为干跑）');
  process.exit(2);
}

const die = (msg) => { console.error(`✗ ${msg}——拒绝执行`); process.exit(1); };
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const write = (f, s) => fs.writeFileSync(path.join(REPO, f), s);

// ---------- ① CHANGELOG 归档 ----------
const cl = read('CHANGELOG.md');
// 第五十七轮⑥：目标版本段已存在 = 双段事故的前兆（第五十四轮 tag 打错重发时几乎踩到）——直接拒绝
if (cl.includes(`## [${ver}] - `)) die(`版本 [${ver}] 的段已存在于 CHANGELOG（重复发布或版本号写错）`);
const mUnrel = /## \[Unreleased\]\n\n### Added\n\n((?:- [^\n]*\n)+)/.exec(cl);
if (!mUnrel) die('[Unreleased] 段没有 ### Added 条目——没有可归档的内容，拒绝执行');
const entries = mUnrel[1];
const entryCount = (entries.match(/^- /gm) || []).length;
if (entryCount === 0) die('[Unreleased] ### Added 条目数为 0');

const today = new Date();
const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
const oldBlock = mUnrel[0];
const newBlock = `## [Unreleased]\n\n（下一版攒着）\n\n## [${ver}] - ${date}\n\n### Added\n\n${entries}`;
let cl2 = cl.replace(oldBlock, newBlock);
// 教训（v0.60.0 首用即踩）：条目正则 (?:- [^\n]*\n)+ 之后紧跟的空行+占位行会被 newBlock 意外带上——
// 归档后把新段内的「（下一版攒着）」清掉
const segStart = cl2.indexOf(`## [${ver}] - ${date}`);
const segEnd = cl2.indexOf('\n## [', segStart);
cl2 = cl2.slice(0, segStart) + cl2.slice(segStart, segEnd === -1 ? cl2.length : segEnd).replace(/\n（下一版攒着）\n/, '\n') + (segEnd === -1 ? '' : cl2.slice(segEnd));

// ② 自检一：新段标题存在且在 [Unreleased] 之后
const idxUnrel = cl2.indexOf('## [Unreleased]');
const idxVer = cl2.indexOf(`## [${ver}] - ${date}`);
if (idxVer < 0 || idxVer < idxUnrel) die('自检失败：新版本段标题不存在或位置不对');
// 自检二：新段条目数一致
const seg = cl2.slice(idxVer, cl2.indexOf('\n## [', idxVer) === -1 ? cl2.length : cl2.indexOf('\n## [', idxVer));
const segCount = (seg.match(/^- /gm) || []).length;
if (segCount !== entryCount) die(`自检失败：新段条目数 ${segCount} ≠ 归档前 ${entryCount}`);
// 自检三：[Unreleased] 只剩空壳
if (!/## \[Unreleased\]\n\n（下一版攒着）/.test(cl2)) die('自检失败：[Unreleased] 未重置为空壳');
// ④ 前置：Cargo.lock 的 zerokit-desktop 段结构化定位（同时在这里预检，避免写一半才发现）
const lock = read('apps/desktop/src-tauri/Cargo.lock');
const lockRe = /(\[\[package\]\]\nname = "zerokit-desktop"\nversion = )"\d+\.\d+\.\d+"/;
if (!lockRe.test(lock)) die('Cargo.lock 里找不到结构完整的 zerokit-desktop 段（[[package]] + name + version）');

// ---------- ③ 版本号四处 ----------
const bumps = [
  ['package.json', /"version": "\d+\.\d+\.\d+"/, `"version": "${ver}"`],
  ['apps/desktop/src-tauri/tauri.conf.json', /"version": "\d+\.\d+\.\d+"/, `"version": "${ver}"`],
  ['apps/desktop/src-tauri/Cargo.toml', /version = "\d+\.\d+\.\d+"/, `version = "${ver}"`],
];
const oldVersions = bumps.map(([f, re]) => re.exec(read(f))?.[0] ?? 'NOT FOUND');
if (oldVersions.some((v) => v === 'NOT FOUND')) die(`版本号定位失败：${oldVersions.join(', ')}`);

console.log(`归档 [Unreleased] → [${ver}] - ${date}（${entryCount} 条）`);
console.log(`版本号：${oldVersions.map((v) => v.match(/[\d.]+$/)?.[0]).join(' / ')} → ${ver}（四处）`);

if (!WRITE) {
  console.log('\n（干跑：未写任何文件。加 --write 落盘。）');
  process.exit(0);
}

write('CHANGELOG.md', cl2);
for (const [f, re, to] of bumps) write(f, read(f).replace(re, to));
write('apps/desktop/src-tauri/Cargo.lock', lock.replace(lockRe, `$1"${ver}"`));

// ③ 自检：写盘后直接复核四处版本号（不依赖 check-docs——它还查全仓内链，
// 在裁剪过的临时树上会误报；真实仓库发布时 CI 的 check-docs job 再兜一层）
{
  const checks = [
    ['package.json', new RegExp(`"version": "${ver}"`)],
    ['apps/desktop/src-tauri/tauri.conf.json', new RegExp(`"version": "${ver}"`)],
    ['apps/desktop/src-tauri/Cargo.toml', new RegExp(`version = "${ver}"`)],
    ['apps/desktop/src-tauri/Cargo.lock', new RegExp(`name = "zerokit-desktop"\nversion = "${ver}"`)],
  ];
  for (const [f, re] of checks) if (!re.test(read(f))) die(`写盘后复核失败：${f} 未到 ${ver}`);
  console.log('✓ 四处版本号写盘复核通过（CI check-docs 再兜一层）');
}
console.log(`✓ 全部落盘（CHANGELOG + 四处版本号 → ${ver}）`);
