// CI 配置的自检：保证「本地有什么命令」和「CI 真的跑了什么」不会悄悄分叉。
//
// 为什么需要这个测试：`tsc --noEmit` 的事故。package.json 里一直有
// `typecheck` 脚本，docs/overview.md 一直写着「tsc --noEmit 干净」，
// 但 CI 和 lint.sh **都没有跑它**。于是内核里积了两个只有类型检查才看得见的
// 错误（proxy.ts 的 Buffer 泛型不兼容、scaffold.ts 的 LoadResult 混用），
// 运行期毫无症状——直到有人手动跑了一次 tsc。
//
// 这类"配置漂移"没法靠跑产品代码发现：文档写着干净、测试全绿、CI 全绿，
// 而真相是那条命令从来没人执行。所以这里直接读工作流文件来验。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CI = path.join(ROOT, '.github/workflows/ci.yml');
const LINT = path.join(ROOT, 'scripts/lint.sh');

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`PASS  ${name}`); } else {
    failed++;
    console.log(`FAIL  ${name}${detail ? '   <- ' + String(detail).slice(0, 400) : ''}`);
  }
};

const ci = fs.readFileSync(CI, 'utf8');
const lint = fs.readFileSync(LINT, 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// ---- 1. package.json 声明的检查，CI 必须真的跑 ----
// 判据取"脚本名出现在工作流里"，而不是匹配某条具体命令：
// CI 里写 npm run typecheck 还是 npx tsc --noEmit 都属于"跑了"，
// 这里要防的是"压根没提"。
{
  const scripts = Object.keys(pkg.scripts ?? {});
  // 只盯这几个：test 由 test-all.mjs 覆盖，其余是发布/工具脚本
  const mustRunInCi = ['typecheck'];
  for (const s of mustRunInCi) {
    check(`package.json 的 ${s} 脚本在 CI 里被执行`,
      scripts.includes(s) && ci.includes(s),
      `scripts 有吗=${scripts.includes(s)} ci.yml 提到吗=${ci.includes(s)}`);
  }
}

// ---- 2. typecheck 必须进 ci-summary，否则它红了也不会让总览变红 ----
// ci-summary 用 needs + R_* env + jobs 数组三处互相自证，漏一处的后果是
// "这一项失败不会让 CI 总览变红"——而分支保护只看总览，等于白跑。
{
  const needsLine = /^    needs: \[(.*)\]$/m.exec(ci)?.[1] ?? '';
  const needs = needsLine.split(',').map((s) => s.trim()).filter(Boolean);
  check('typecheck 在 ci-summary 的 needs 里', needs.includes('typecheck'), needs.join(','));

  check('typecheck 有对应的 R_TYPECHECK 判据',
    /^\s+R_TYPECHECK:/m.test(ci), 'ci-summary 的 env 段里没有 R_TYPECHECK');

  // jobs 数组是「job id:显示名」的清单
  const arrBlock = /\n\s+declare -a jobs=\(([\s\S]*?)\n\s+\)/.exec(ci)?.[1] ?? '';
  const arrIds = [...arrBlock.matchAll(/"([a-z0-9-]+):/g)].map((m) => m[1]);
  check('typecheck 在 ci-summary 的 jobs 数组里',
    arrIds.includes('typecheck'), arrIds.join(','));

  // 三处必须同集合（这正是 workflow 里断言 1 的判据，这里提前在本地拦住）
  const a = [...needs].sort().join(',');
  const b = [...arrIds].sort().join(',');
  check('ci-summary 的 needs 与 jobs 数组是同一集合', a === b, `needs=${a} 数组=${b}`);
}

// ---- 3. lint.sh 与 CI 不该分叉 ----
// CLAUDE.md 说 lint.sh 是「与 CI 同源」的本地检查。断言它至少覆盖了
// CI 里那几个静态检查工具，别一边改了另一边没跟上。
{
  for (const tool of ['actionlint', 'yamllint', 'shellcheck']) {
    check(`lint.sh 覆盖 ${tool}`, lint.includes(tool), `lint.sh 里没提到 ${tool}`);
  }
}

// ---- 4. 三平台矩阵没被偷偷缩回去 ----
// Issue #3 的教训：只跑 Windows 时，macOS/Linux 的平台债没人看得见。
// 这条断言防的是"哪天有人为了让它变绿又把矩阵缩回单平台"。
{
  const osLine = /os: \[(.*)\]/.exec(ci)?.[1] ?? '';
  for (const p of ['ubuntu-latest', 'macos-latest', 'windows-latest']) {
    check(`测试矩阵包含 ${p}`, osLine.includes(p), `矩阵是 [${osLine}]`);
  }
  check('Node 24 的前瞻 job 还在', /^\s+test-node24:/m.test(ci));
}

// ---- 5. Linux 剪贴板真实路径的覆盖没被删掉 ----
// 装了 xclip/xvfb 才走得到 xclip 分支，否则永远测的是"缺工具"那条。
{
  check('CI 在 Linux 上装 xclip 与 xvfb',
    ci.includes('xclip') && ci.includes('xvfb'),
    'ubuntu runner 上没有这两个的话，clipboard 的真实路径测不到');
  check('Linux 上测试跑在 xvfb-run 里',
    /xvfb-run -a node scripts\/test-all\.mjs/.test(ci));
}

console.log('\n' + '='.repeat(60));
console.log(`通过 ${passed} / ${passed + failed}`);
process.exit(failed === 0 ? 0 : 1);
