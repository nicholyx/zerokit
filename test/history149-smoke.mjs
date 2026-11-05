// history149-smoke：第一百四十九轮——history 过滤增强与书签
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- history149 ${extra}`); } };
const home = mkdtempSync(path.join(tmpdir(), 'h149-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env });
console.log(`history149-smoke（${home}）`);
run(['plugin', 'bundled']);

// ---- 纯函数直测（bookmarks.ts）----
const bm = await import('../src/core/bookmarks.ts');
const entries = [
  { ts: '2026-11-01T10:00:00Z', plugin: 'sysinfo', action: 'top', argv: ['--head', '5'], exitCode: 0 },
  { ts: '2026-11-02T10:00:00Z', plugin: 'quick', action: 'b64', argv: ['--text', 'x'], exitCode: 1 },
  { ts: '2026-11-03T10:00:00Z', plugin: 'quick', action: 'b64', argv: ['--text', 'where'], exitCode: 0 },
];

// ① grep
check('① grep 命中子串（含旗标值）', bm.filterHistoryEntries(entries, { grep: 'where' }).length === 1);
check('① grep 插件名', bm.filterHistoryEntries(entries, { grep: 'sysinfo' }).length === 1);
check('① grep 无命中空数组', bm.filterHistoryEntries(entries, { grep: '不存在' }).length === 0);

// ③ since
const NOW = Date.parse('2026-11-03T12:00:00Z');
check('③ sinceMs 下限过滤', bm.filterHistoryEntries(entries, { sinceMs: Date.parse('2026-11-02T00:00:00Z') }).length === 2);
check('③ parseSince 2d', bm.parseSinceArg('2d', NOW) === NOW - 2 * 86_400_000);
check('③ parseSince 5h', bm.parseSinceArg('5h', NOW) === NOW - 5 * 3_600_000);
check('③ parseSince today=本地零点', bm.parseSinceArg('today', NOW) === new Date(NOW).setHours(0, 0, 0, 0));
check('③ parseSince 不认识=undefined', bm.parseSinceArg('bogus', NOW) === undefined);
check('③ parseSince 空=undefined', bm.parseSinceArg(undefined, NOW) === undefined);

// ④ 书签纯函数
check('④ 别名合法', bm.validBookmarkName('top5-daily') === null);
check('④ 别名拒中文', bm.validBookmarkName('常用') !== null);
check('④ 别名拒空/超长', bm.validBookmarkName('') !== null && bm.validBookmarkName('a'.repeat(33)) !== null);

// ---- CLI 实跑 ----
run(['run', 'sysinfo', 'overview']);
run(['run', 'quick', 'b64', '--text', 'hi']);
run(['run', 'quick', 'b64']);            // 参数缺失 → exitCode 1 进历史（⑦）
run(['run', 'sysinfo', 'top', '--head', '3']);

// ① CLI grep
{
  const r = run(['history', '--grep', 'b64']);
  const all = r.stdout;
  check('① CLI grep 出 b64 两条（✓/✗）', all.includes('b64') && all.includes('✗') && all.includes('✓'), all.slice(0, 100));
}
// ③ CLI since 1d 全量
{
  const r = run(['history', '--since', '1d']);
  check('③ CLI since 1d', r.stdout.includes('top') || r.stdout.includes('b64'));
}
// ⑥ rerun-last
{
  const r = run(['history', '--rerun-last']);
  check('⑥ rerun-last 重跑最后成功', r.stdout.includes('重跑') && r.stdout.includes('top'), (r.stdout ?? '').slice(0, 60));
}
// ⑦ 默认视图含失败 + 标记
{
  const r = run(['history', '--tail', '5']);
  check('⑦ 默认视图 ✗ 可见', r.stdout.includes('✗ zkit run quick b64'));
  check('⑧ 非TTY 提示行', r.stdout.includes('一键重跑：zkit history --rerun-last'));
}
// ④⑤ 书签闭环
{
  const r1 = run(['bookmark', 'add', 'b64-daily', '2', '--note', '日常']);
  check('④ add 按历史编号', r1.stdout.includes('✓ 书签 b64-daily'), (r1.stdout ?? '') + (r1.stderr ?? ''));
  const r2 = run(['bookmark', 'list']);
  check('④ list 展示+备注', r2.stdout.includes('b64-daily') && r2.stdout.includes('# 日常'));
  const r3 = run(['bookmark', 'list', '--json']);
  const j = JSON.parse(r3.stdout);
  check('⑤ list --json 机读', Array.isArray(j) && j[0]?.name === 'b64-daily' && Array.isArray(j[0]?.argv));
  const r4 = run(['bookmark', 'run', 'b64-daily']);
  check('④ run 真执行', r4.stdout.includes('重跑书签') || r4.stdout.includes('"方向"'));
  const r5 = run(['bookmark', 'add', 'b64-daily', '1']);
  check('④ 重名拒绝', r5.status !== 0 && (r5.stdout + r5.stderr).includes('已存在'));
  const r6 = run(['bookmark', 'add', 'bad name', '1']);
  check('④ 坏别名拒绝', r6.status !== 0 && (r6.stdout + r6.stderr).includes('别名'));
  const r7 = run(['bookmark', 'rm', 'b64-daily']);
  check('④ rm', r7.stdout.includes('已删 b64-daily'));
  const r8 = run(['bookmark', 'rm', 'b64-daily']);
  check('④ rm 不存在报错', r8.status !== 0 && (r8.stdout + r8.stderr).includes('没有别名'));
  // 裸命令形态
  const r9 = run(['bookmark', 'add', 'top3', 'run', 'sysinfo', 'top', '--head', '3']);
  check('④ add 裸命令形态', r9.stdout.includes('✓ 书签 top3') && r9.stdout.includes('--head 3'));
  run(['bookmark', 'rm', 'top3']);
}
// 书签文件 0600
{
  const st = (await import('node:fs')).statSync(path.join(home, 'bookmarks.json'));
  run(['bookmark', 'add', 'perm1', '1']); // 确保文件存在后再 stat（上面 rm 光了）
  const st2 = (await import('node:fs')).statSync(path.join(home, 'bookmarks.json'));
  check('④ 文件权限 0600', (st2.mode & 0o777) === 0o600, `mode=${(st2.mode & 0o777).toString(8)}`);
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
