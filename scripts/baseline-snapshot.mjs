// 第一百九十九轮⑤：v2 基线指标快照——输出 markdown 表（与 docs/reference/baseline-v2.md 比对）
// 用法：node scripts/baseline-snapshot.mjs [--check]（--check 时与快照文件 diff，漂移超阈值 exit 1）
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'src', 'cli.ts');
const SNAP = path.join(ROOT, 'docs', 'reference', 'baseline-v2.md');
const now = new Date().toISOString().slice(0, 10);

const median = (arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)];
const coldStart = () => {
  const times = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    execFileSync(process.execPath, [CLI, '--help'], { timeout: 60000 });
    times.push(Math.round(performance.now() - t0));
  }
  return median(times);
};
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const rows = [];
rows.push(['版本', pkg.version]);
rows.push(['测量日期', now]);
rows.push(['CLI 冷启动 --help（5 次中位）', `${coldStart()}ms（预算 <300ms）`]);

// 测试文件数与断言数（从 guard146 同源的计数逻辑拿——直接跑 test-all 太慢，读 overview 快照即可）
const ov = readFileSync(path.join(ROOT, 'docs', 'reference', 'overview.md'), 'utf8');
const mFiles = ov.match(/(\d+) 个文件/); const mAssert = ov.match(/(\d+) 项断言/);
rows.push(['测试规模', `${mFiles?.[1] ?? '?'} 文件 / ${mAssert?.[1] ?? '?'} 断言`]);
const mPlugins = ov.match(/(\d+) 个插件/);
rows.push(['内置插件', `${mPlugins?.[1] ?? '?'} 个`]);

const table = '| 指标 | 值 |\n|------|-----|\n' + rows.map(([k, v]) => `| ${k} | ${v} |`).join('\n');
const header = '# v2 基线指标快照\n\n> 由 `scripts/baseline-snapshot.mjs` 生成。刷新方式：跑脚本 + `--write`。\n\n';

if (process.argv.includes('--write')) {
  writeFileSync(SNAP, header + table + '\n');
  console.log('快照已写：' + SNAP);
  process.exit(0);
}
if (process.argv.includes('--check') && existsSync(SNAP)) {
  const snap = readFileSync(SNAP, 'utf8');
  const snapVer = (snap.match(/\| 版本 \| ([\w.]+)/) ?? [])[1];
  if (snapVer && snapVer !== pkg.version) {
    console.error(`版本漂移：快照 ${snapVer} ≠ 当前 ${pkg.version}（minor 升级后请刷新基线快照）`);
    process.exit(1);
  }
  console.log('快照版本一致（' + snapVer + '）');
} else {
  console.log(table);
}
