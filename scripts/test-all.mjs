// 一次跑完所有测试。
//
// 为什么需要这个脚本、而不是 `node test/*.mjs`：大多数测试是自包含的，但
// `mcp-smoke.mjs` 需要显式给出 server 路径（它要 spawn 一个真的 MCP server 进程
// 用裸 JSON-RPC 去敲）。少了参数它不会报"用法错"，而是卡到超时——那看起来
// 像是产品坏了，实际只是调用方式不对。所以把"每个测试怎么起"这件事收到这里。
//
// 每个测试都把结果汇总成一行「通过 X / Y」打印出来。这里解析那一行做总汇总。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const TEST_DIR = path.join(ROOT, 'test');
const SUMMARY_RE = /^通过\s+(\d+)\s*\/\s*(\d+)/m;

/** 需要额外参数的测试：测试文件 → 追加的参数 */
const EXTRA_ARGS = {
  'mcp-smoke.mjs': ['src/mcp.ts'],
};

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const files = fs.readdirSync(TEST_DIR)
  .filter((f) => f.endsWith('.mjs'))
  .filter((f) => only.length === 0 || only.some((o) => f.includes(o)))
  .sort();

if (files.length === 0) {
  process.stderr.write('没找到匹配的测试\n');
  process.exit(1);
}

let passed = 0;
let failed = 0;
let missing = 0;
const failures = [];

for (const file of files) {
  const args = [path.join(TEST_DIR, file), ...(EXTRA_ARGS[file] ?? [])];
  const t = Date.now();
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 300000,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const ms = Date.now() - t;
  const m = SUMMARY_RE.exec(out);
  const label = file.padEnd(26);

  if (!m) {
    // 没有汇总行 = 测试自己崩了（语法错、未捕获异常、超时）。把尾巴打出来，
    // 否则只看到一个 FAIL 完全无从下手。
    missing++;
    failed++;
    failures.push(file);
    console.log(`${label} 崩溃 / 超时（${ms}ms，退出码 ${r.status}）`);
    for (const line of out.trim().split('\n').slice(-8)) console.log(`    ${line}`);
    continue;
  }

  const ok = Number(m[1]);
  const total = Number(m[2]);
  passed += ok;
  const bad = total - ok;
  failed += bad;
  if (bad > 0) failures.push(file);
  const mark = bad === 0 ? '✓' : '✗';
  console.log(`${mark} ${label} ${ok} / ${total}   ${String(ms).padStart(6)}ms`);
  // 部分断言失败时也要把失败详情带出来——CI 上只看到「4 / 10」无从下手。
  // 失败行的格式是各测试的 check() 打的「FAIL  名称   <- 详情」，截前 8 条防刷屏
  if (bad > 0) {
    for (const line of out.trim().split('\n').filter((l) => l.startsWith('FAIL')).slice(0, 8)) {
      console.log(`    ${line}`);
    }
  }
}

console.log('\n' + '='.repeat(56));
console.log(`${files.length} 个测试文件，断言通过 ${passed} / ${passed + failed}`);
if (missing > 0) console.log(`其中 ${missing} 个测试文件没能跑出汇总行（见上面的输出）`);
if (failures.length > 0) console.log('有失败：' + failures.join(', '));
process.exit(failed === 0 ? 0 : 1);