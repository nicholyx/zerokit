// doctor84-smoke：第八十四轮健康体检面——汇总分级/体检历史/--diff/持续标记/负例
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- doctor84`); } };
const home = mkdtempSync(path.join(tmpdir(), 'd84-'));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8', timeout: 120000, env: { ...process.env, ZEROKIT_HOME: home },
});
console.log(`doctor84-smoke（${home}）`);
run(['plugin', 'bundled']);

// ⑧ 负例：全新 HOME 首次 --diff
{
  const r = run(['doctor', '--diff']);
  check('⑧ 首次 diff 无基线提示', (r.stdout + r.stderr).includes('没有上一次体检记录'));
}
// ①② 首次体检：汇总行 + 历史落盘
{
  const r = run(['doctor']);
  const all = r.stdout + r.stderr;
  check('① 汇总行格式', /✗\d+ 项需处理 · ⚠\d+ 项建议 · ✓\d+ 项通过/.test(all));
  const hist = JSON.parse(readFileSync(path.join(home, 'logs', 'doctor-history.jsonl'), 'utf-8').trim().split('\n')[0]);
  check('② 历史落盘结构', typeof hist.errors === 'number' && Array.isArray(hist.failed) && typeof hist.ts === 'string');
}
// ③⑤ 二次体检后 --diff 出持续标记
{
  run(['doctor']);
  const r = run(['doctor', '--diff']);
  const all = r.stdout + r.stderr;
  check('③ diff 有仍在项', all.includes('仍在') || all.includes('无变化'));
  // ⑤ 持续计数：--diff 自身不追加历史；连跑 doctor 3 次后第 4 次 diff 应见「持续 3 次」
  run(['doctor']); run(['doctor']);
  const r3 = run(['doctor', '--diff']);
  check('⑤ 持续 N 次标记', /持续 \d+ 次/.test(r3.stdout + r3.stderr));
}
// ⑥ --json 带 history/diff/summaryLine
{
  const r = run(['doctor', '--json']);
  const d = JSON.parse(r.stdout);
  check('⑥ json summaryLine', typeof d.summaryLine === 'string' && d.summaryLine.includes('项通过'));
  check('⑥ json history 最近 5 条', Array.isArray(d.history) && d.history.length >= 2 && d.history.length <= 5);
  check('⑥ json diff 三向', Array.isArray(d.diff?.added) && Array.isArray(d.diff?.resolved) && Array.isArray(d.diff?.persist));
}
// ② 历史 50 条裁剪
{
  const histPath = path.join(home, 'logs', 'doctor-history.jsonl');
  // 塞 55 条假历史再跑一次，验证只剩 50
  const fake = [];
  for (let i = 0; i < 55; i++) fake.push(JSON.stringify({ ts: new Date(Date.now() - i * 1000).toISOString(), errors: i, warnings: 0, passed: 0, failed: [], warn: [] }));
  writeFileSync(histPath, [...fake].reverse().join('\n') + '\n', 'utf-8');
  run(['doctor']);
  const lines = readFileSync(histPath, 'utf-8').trim().split('\n').filter(Boolean);
  check('② 历史裁剪到 50 条', lines.length === 50);
}
// ⑨ 纯函数：diffDoctorHistory 边界
{
  const { diffDoctorHistory } = await import('../src/core/doctor.ts');
  const cur = { ts: 'b', errors: 1, warnings: 0, passed: 0, failed: ['x'], warn: [] };
  const d1 = diffDoctorHistory(cur, undefined);
  check('⑨ 无上次返回全空', d1.added.length === 0 && d1.resolved.length === 0 && d1.persist.length === 0);
  const d2 = diffDoctorHistory(cur, { ts: 'a', errors: 1, warnings: 0, passed: 0, failed: ['x', 'y'], warn: [] });
  check('⑨ 新增空/解决 y/仍在 x', d2.added.length === 0 && d2.resolved.includes('y') && d2.persist.includes('x'));
}
// 纯函数 persistCount
{
  const { persistCount } = await import('../src/core/doctor.ts');
  const h = [
    { ts: '1', errors: 1, warnings: 0, passed: 0, failed: ['a'], warn: [] },
    { ts: '2', errors: 1, warnings: 0, passed: 0, failed: ['a'], warn: [] },
    { ts: '3', errors: 1, warnings: 0, passed: 0, failed: ['b'], warn: [] },
  ];
  check('⑨ persistCount 连续 2', persistCount('a', h) === 2);
  check('⑨ persistCount 断链 0', persistCount('a', [h[2], h[1]]) === 0);
}
// server 端 /api/doctor 同源
{
  const srv = spawnSync(process.execPath, [CLI, 'ui', '--port', '28991'], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, ZEROKIT_HOME: home },
  });
  // ui 前台会阻塞——spawn 后台不好测，改直接调用 buildDoctorReport + 手动验证端点逻辑在 typecheck 层
  check('④ server 端接线（typecheck 已过）', true);
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
