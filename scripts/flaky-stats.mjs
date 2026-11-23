// 第四百零三轮：main CI 抖动统计——按时间切分统计失败率（400 复盘「后续三条」之二）
// 背景：397 轮抖动治理需要数据验收。本轮实证了人工 awk 按行序切分**会误判**
// （gh run list 按时间倒序，但只保证整体倒序——用「出现某 commit 后」切分时
// 一旦该 commit 不在窗口内就会整段算错）。本脚本把口径固化：严格按 createdAt 时间戳切分。
// 用法：
//   node scripts/flaky-stats.mjs <ISO时间> [limit]   —— 统计该时间点之后的 main run 失败率
//   node scripts/flaky-stats.mjs before <ISO时间> [limit] —— 该时间点之前
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const mode = args[0] === 'before' ? 'before' : 'after';
const cut = mode === 'before' ? args[1] : args[0];
const limit = Number(args[mode === 'before' ? 2 : 1] ?? 100);
if (!cut || Number.isNaN(Date.parse(cut))) {
  console.error('用法：node scripts/flaky-stats.mjs <ISO时间> [limit] | before <ISO时间> [limit]');
  process.exit(2);
}
const env = { ...process.env };
for (const k of ['https_proxy', 'http_proxy', 'all_proxy', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY']) delete env[k];
const out = execFileSync('gh', ['run', 'list', '--branch', 'main', '--workflow', 'ci.yml', '--limit', String(limit), '--json', 'databaseId,conclusion,headSha,createdAt'], { encoding: 'utf8', env });
const rows = JSON.parse(out);
const sel = rows.filter((r) => (mode === 'after' ? r.createdAt >= cut : r.createdAt < cut) && r.conclusion !== null && r.conclusion !== undefined && r.conclusion !== 'cancelled');
const fails = sel.filter((r) => r.conclusion === 'failure');
const rate = sel.length ? ((fails.length / sel.length) * 100).toFixed(1) : 'n/a';
console.log(`${mode} ${cut}：${sel.length} 个 main run，失败 ${fails.length}（${rate}%）`);
for (const f of fails) console.log(`  ✗ ${f.headSha.slice(0, 7)} ${f.createdAt} run ${f.databaseId}`);
if (mode === 'after' && sel.length < 40) console.log(`  （样本 ${sel.length} < 40——不足以终判，待积累）`);
