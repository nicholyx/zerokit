// 安装包瘦身（第一百一十轮）：删 node_modules 里运行时永不读取的文件。
// Node 22 原生类型擦除只看 .js/.mjs/.cjs；.d.ts/.map 是编辑器与调试器资产。
// 用法：node scripts/strip-types.mjs [目录=node_modules]
import { rm, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.argv[2] ?? 'node_modules';
const STRIP = /\.(d\.ts|d\.mts|d\.cts|map)$/;
const STRIP_NAMES = new Set(['CHANGELOG.md', 'README.md', 'LICENSE']);

let removed = 0;
let bytes = 0;

async function walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '.bin' || e.name === '.package-lock.json') continue; // .bin 是链接目录，rm 单文件会误伤
      await walk(p);
    } else if (STRIP.test(e.name) || STRIP_NAMES.has(e.name)) {
      try {
        const s = await stat(p);
        await rm(p);
        removed++; bytes += s.size;
      } catch { /* 并发删除或权限问题：跳过 */ }
    }
  }
}

await walk(root);
console.log(`strip-types：删除 ${removed} 个文件，释放 ${(bytes / 1024 / 1024).toFixed(1)} MB`);
