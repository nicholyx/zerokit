// 一次跑完所有测试。
//
// 为什么需要这个脚本、而不是 `node test/*.mjs`：大多数测试是自包含的，但
// `mcp-smoke.mjs` 需要显式给出 server 路径（它要 spawn 一个真的 MCP server 进程
// 用裸 JSON-RPC 去敲）。少了参数它不会报"用法错"，而是卡到超时——那看起来
// 像是产品坏了，实际只是调用方式不对。所以把"每个测试怎么起"这件事收到这里。
//
// 每个测试都把结果汇总成一行「通过 X / Y」打印出来。这里解析那一行做总汇总。
//
// 用法：
//   node scripts/test-all.mjs                # 全量
//   node scripts/test-all.mjs <片段>         # 只跑文件名含片段的（可多个）
//   node scripts/test-all.mjs --changed      # 按 git diff 挑受影响的测试（IMPACT_MAP）
//   node scripts/test-all.mjs --shuffle      # 随机顺序跑（暴露顺序依赖）
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

/**
 * --changed 的受影响面映射：源文件/目录前缀 → 要跑的测试片段。
 * 语义是「改了这个，至少要跑这些」——宁可多跑不可漏跑；没登记的改动回退全量。
 * 维护约定：新测试文件落地时在对应源行补上自己的片段。
 */
const IMPACT_MAP = {
  'src/core/runner.ts': ['runner', 'batch', 'chain', 'exec', 'sandbox', 'selfheal'],
  'src/core/registry.ts': ['registry', 'lifecycle', 'deps', 'distro', 'market'],
  'src/core/manifest.ts': ['lintdoc', 'scaffold', 'utools', 'cfg', 'settings'],
  'src/core/pluginConfig.ts': ['cfg', 'settings'],
  'src/core/deps.ts': ['deps'],
  'src/core/market.ts': ['market', 'distro'],
  'src/core/distro.ts': ['distro', 'market'],
  'src/core/ops.ts': ['ops', 'audit', 'timeline'],
  'src/core/audit.ts': ['audit', 'mcp'],
  'src/core/suggest.ts': ['selfheal'],
  'src/core/doctor.ts': ['doctor'],
  'src/core/scaffold.ts': ['scaffold', 'lintdoc'],
  'src/core/lintdoc.ts': ['lintdoc'],
  'src/core/timers.ts': ['timers', 'watch'],
  'src/core/datamap.ts': ['data'],
  'src/core/cliX.ts': ['cli', 'audit', 'exec'],
  'src/mcp.ts': ['mcp'],
  'src/server.ts': ['webui', 'ui2', 'server', 'webbridge'],
  'src/cli.ts': ['cli', 'selfheal', 'ops', 'rel', 'polish', 'timers', 'supply'],
  'web/app.js': ['webui', 'keys', 'a11y', 'polish', 'search'],
  'web/extras.js': ['extras', 'i18n', 'search'],
  'web/index.html': ['webui'],
  'web/style.css': ['webui'],
  'plugins/': ['eco', 'roundtrip', 'chain', 'lintdoc', 'health'],
};

const flags = process.argv.slice(2).filter((a) => a.startsWith('-'));
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const files = fs.readdirSync(TEST_DIR)
  .filter((f) => f.endsWith('.mjs'))
  .filter((f) => only.length === 0 || only.some((o) => f.includes(o)))
  .sort();

// --changed：按 git diff 基线（默认 main）挑改动过的源文件，再按 IMPACT_MAP 挑测试。
// 在 feature 分支上即「这轮改了什么 → 至少跑哪些」；没改动或没登记的改动回退全量。
if (flags.includes('--changed')) {
  const base = (flags.find((a) => a.startsWith('--base=')) ?? '').slice(7) || 'main';
  const diff = spawnSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8', cwd: ROOT });
  const changed = (diff.stdout ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const frags = new Set();
  let unmapped = [];
  for (const f of changed) {
    if (f.startsWith('test/') && f.endsWith('.mjs')) { frags.add(f.slice(5, -5)); continue; }  // 测试自己 → 跑自己
    const hit = Object.keys(IMPACT_MAP).filter((k) => f === k || f.startsWith(k));
    if (hit.length === 0) { unmapped.push(f); continue; }
    for (const frag of IMPACT_MAP[hit[0]]) frags.add(frag);
  }
  if (diff.status !== 0 || changed.length === 0) {
    console.log(`（--changed：相对 ${base} 没有可识别的改动，回退全量）`);
  } else if (unmapped.length > 0) {
    console.log(`（--changed：有未登记影响面的改动（${unmapped.join('、')}），保守跑全量）`);
  } else {
    for (const g of frags) only.push(g);
    files.length = 0;
    for (const f of fs.readdirSync(TEST_DIR).filter((f) => f.endsWith('.mjs')).sort()) {
      if (only.some((o) => f.includes(o))) files.push(f);
    }
    console.log(`（--changed：${changed.length} 个源文件改动 → 跑 ${files.length} 个测试）`);
  }
}

// --shuffle：随机顺序跑。用于暴露隐式的顺序依赖（理论上每个测试都该自包含；
// 顺序换了就挂 = 有测试在偷读别的测试留下的状态）。
if (flags.includes('--shuffle')) {
  for (let i = files.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [files[i], files[j]] = [files[j], files[i]];
  }
  console.log('(--shuffle 随机顺序)');
}

if (files.length === 0) {
  process.stderr.write('没找到匹配的测试\n');
  process.exit(1);
}

let passed = 0;
let failed = 0;
let missing = 0;
const failures = [];
const timings = [];

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
  timings.push([file, ms, bad]);
  const mark = bad === 0 ? '✓' : '✗';
  console.log(`${mark} ${label} ${ok} / ${total}   ${String(ms).padStart(6)}ms`);
  // 部分断言失败时也要把失败详情带出来——CI 上只看到「4 / 10」无从下手。
  // 失败行的格式是各测试的 check() 打的「FAIL  名称   <- 详情」，截前 8 条防刷屏
  if (bad > 0) {
    // 第五十七轮③：失败行全量列出（此前截 8 条——失败多于 8 时剩下的要翻 CI 日志），
    // 每行带文件名前缀，多文件失败时不用数行号猜归属
    for (const line of out.trim().split('\n').filter((l) => l.startsWith('FAIL'))) {
      console.log(`    [${file}] ${line}`);
    }
  }
}

console.log('\n' + '='.repeat(56));
console.log(`${files.length} 个测试文件，断言通过 ${passed} / ${passed + failed}`);
// 第二百七十一轮②：断言数基线守卫——总数较基线下降 = 条件断言静默跳过型结构丢失
// （270 轮事故：整块重写吞掉子命令分支，全绿但 -34）。skip 不 fail，只有计数会说话。
{
  const baselineFile = path.join(ROOT, 'scripts', 'assertion-baseline.json');
  try {
    const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
    if (Number.isFinite(baseline.assertions) && passed < baseline.assertions && failed === 0) {
      console.error(`⛔ 断言数回归：${passed} < 基线 ${baseline.assertions}（差 ${baseline.assertions - passed}）`);
      console.error('   全绿但计数降 = 测试被静默跳过型结构丢失（参考 270 轮事故：重写吞分支）。');
      console.error('   排查：git stash 后对照基线跑一遍；恢复后若确认要删测试，--force 降基线。');
      process.exit(1);
    }
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? String(e.code) : '';
    if (code !== 'ENOENT') console.error(`（基线文件读取失败，跳过守卫：${e instanceof Error ? e.message : String(e)}）`);
  }
}
// 第五十七轮⑧：耗时 top5——帮定位慢用例（有 spawn 真进程的测试天然慢，只横向比）
if (timings.length > 1) {
  const top = [...timings].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log('最慢 5 个：' + top.map(([f, m, bad]) => `${f.replace('.mjs', '')} ${m}ms${bad ? '（有失败）' : ''}`).join('、'));
}
if (missing > 0) console.log(`其中 ${missing} 个测试文件没能跑出汇总行（见上面的输出）`);
if (failures.length > 0) console.log('有失败：' + failures.join(', '));
process.exit(failed === 0 ? 0 : 1);