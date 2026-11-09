#!/usr/bin/env node
// guard146.mjs —— 质量护栏（第一百四十六轮）：把人肉纪律变成机器断言。
// lint.sh 的一个 run 段调用；任何一条断言失败非零退出。
//
// ① CHANGELOG 格式：[Unreleased] 非空壳时，与首个 ### 分类头之间必须有空行；
//    ### 分类头后必须紧跟空行（三次事故的根治：v1.42/v1.48/v1.49 均栽在这里）
// ⑨ 文档数字同步：overview/START-HERE 里的「N 个文件 M 项断言」必须互相一致，
//    且 N 与 test/ 目录下 *-smoke.mjs 文件数一致（防文档数字漂移）
// ⑥ docs 绝对路径引用：Markdown 里引用本地文件的绝对路径（非 http/锚点）报警
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let bad = 0;
const die = (msg) => { console.error(`FAIL  ${msg}`); bad = 1; };

// ---- ① CHANGELOG 格式 ----
{
  const cl = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const unrel = cl.indexOf('## [Unreleased]');
  if (unrel < 0) die('CHANGELOG 没有 [Unreleased] 段——release 分支归档后要补回空壳段（## [Unreleased]\n\n（下一版攒着）\n\n）');
  const next = cl.indexOf('\n## [', unrel + 1);
  const seg = cl.slice(unrel, next < 0 ? undefined : next);
  const hasCat = /### (Added|Changed|Deprecated|Removed|Fixed|Security)/.test(seg);
  const placeholderOnly = !hasCat && seg.includes('（下一版攒着）');
  if (hasCat) {
    // 分类头与 ## [Unreleased] 之间必须空行
    if (/## \[Unreleased\]\n###/.test(seg)) die('CHANGELOG：[Unreleased] 与首个 ### 分类头之间缺空行（三次事故同款）');
    // 分类头后必须紧跟空行
    if (/### (Added|Changed|Deprecated|Removed|Fixed|Security)\n[^\n]/.test(seg)) die('CHANGELOG：### 分类头后缺空行');
    // 有分类就必须有条目
    const item = seg.match(/### \w+\n\n(- [^\n])/);
    const shellWithHeader = seg.includes('（下一版攒着）'); // 第一百七十轮⑧：带 ### Added 的空壳也是规范态
    if (!item && !shellWithHeader) die('CHANGELOG：[Unreleased] 有分类头但没有条目');
  } else if (!placeholderOnly) {
    // 既没分类也不是规范空壳——可能是被清空的异常态
    if (seg.replace(/## \[Unreleased\]\n*/, '').trim().length > 0) die('CHANGELOG：[Unreleased] 段内容非规范（无分类头，也非空壳占位）');
  }
  // 已发布段标题后也必须有空行（曾出现段标题直接接条目）
  const released = /## \[\d+\.\d+\.\d+\][^\n]*\n[^\n#]/.exec(cl);
  if (released && !/## \[\d+\.\d+\.\d+\][^\n]*\n\n/.test(released[0])) {
    // 标题行的下一行非空且非 # 开头 → 缺空行
    die(`CHANGELOG：已发布段「${released[0].split('\n')[0]}」标题后缺空行`);
  }
}

// ---- ⑨ 文档数字同步 ----
{
  const smokeFiles = readdirSync(path.join(ROOT, 'test')).filter((f) => f.endsWith('-smoke.mjs')).length;
  const readNum = (file) => {
    const t = readFileSync(path.join(ROOT, file), 'utf8');
    const m = /(\d+) 个文件[、，,]?\s?\*{0,2}(\d+)\*{0,2}\s?项断言/.exec(t) || /(\d+) 个测试文件，?断言通过 (\d+) \/ \d+/.exec(t);
    if (!m) return null;
    return { files: Number(m[1]), asserts: Number(m[2]) };
  };
  const ov = readNum('docs/reference/overview.md');
  const sh = readNum('START-HERE.md');
  if (!ov) { die('overview.md 找不到「N 个文件 M 项断言」数字'); }
  if (!sh) { die('START-HERE.md 找不到「N 个文件 M 项断言」数字'); }
  if (ov && sh && ov.files !== smokeFiles) die(`overview 文件数 ${ov.files} ≠ test/ 实际 ${smokeFiles} 个 smoke 文件——跑 node scripts/sync-counts.mjs 自动修正`);
  if (ov && sh && sh.files !== smokeFiles) die(`START-HERE 文件数 ${sh.files} ≠ test/ 实际 ${smokeFiles} 个 smoke 文件——跑 node scripts/sync-counts.mjs 自动修正`);
  if (ov && sh && ov.asserts !== sh.asserts) die(`overview 断言数 ${ov.asserts} ≠ START-HERE ${sh.asserts}——跑 node scripts/sync-counts.mjs 自动修正`);
  if (ov && sh) console.log(`OK    文档数字同步（${smokeFiles} 文件 / ${ov.asserts} 断言，两处一致）`);
}

// ---- ⑥ docs 绝对路径引用 ----
{
  const docs = readdirSync(path.join(ROOT, 'docs'), { recursive: true }).filter((f) => String(f).endsWith('.md'));
  for (const f of docs) {
    const t = readFileSync(path.join(ROOT, 'docs', String(f)), 'utf8');
    // ](/Users/... 或 ](D:/... 或 ](C:\（反斜杠形态）
    const abs = /\]\((\/(?:Users|home|private|tmp)\/|D:[\\/]|C:\\)[^)]*\)/.exec(t);
    if (abs) die(`${f}：引用了本机绝对路径 ${abs[0].slice(0, 60)}…（红线：不提交本机路径）`);
  }
}

// ---- ② START-HERE 版本行 === package.json ----
{
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const sh = readFileSync(path.join(ROOT, 'START-HERE.md'), 'utf8');
  const m = /<!-- zk-version -->当前版本 v([\d.]+)<!-- \/zk-version -->/.exec(sh);
  if (!m) die('START-HERE.md 没有版本标记行（<!-- zk-version -->）');
  else if (m[1] !== pkg) die(`START-HERE 版本 ${m[1]} ≠ package.json ${pkg}`);
  else console.log(`OK    版本行同步（v${pkg}）`);
}

if (bad) process.exit(1);

// 第一百七十轮⑧：新条目必须落在 [Unreleased] 段内（三次事故的根治——空壳缺 ### Added 让插条锚点漂到已发布段）
{
  const cl = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const unreleased = cl.indexOf('## [Unreleased]');
  const firstRelease = cl.search(/\n## \[\d/);
  if (unreleased >= 0 && firstRelease > unreleased) {
    const seg = cl.slice(unreleased, firstRelease);
    if (!/### (Added|Changed|Deprecated|Removed|Fixed|Security)/.test(seg)) {
      console.log('FAIL  [Unreleased] 段缺分类头（### Added 等）——新条目会插错段');
      process.exitCode = 1;
    } else if (/^### Added\n*$/m.test(seg) && !seg.includes('（下一版攒着）') && seg.replace(/### \w+\n|\s/g, '') === '') {
      console.log('FAIL  [Unreleased] 的 ### Added 是空头——release-prep 空壳守卫会拒绝空归档');
      process.exitCode = 1;
    }
  }
}

console.log('OK    质量护栏（CHANGELOG 格式/文档数字/绝对路径/版本行）');
