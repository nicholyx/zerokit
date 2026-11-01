// audit113-smoke：第一百一十三轮——审计与日志面深耕（纯函数 + CLI 端到端）
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- audit113`); } };
const home = mkdtempSync(path.join(tmpdir(), 'a113-'));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, cwd: PKG_ROOT, env: { ...process.env, ZEROKIT_HOME: home } });
console.log(`audit113-smoke（${home}）`);

const { filterAudit, AUDIT_RANGES, auditLine } = await import('../web/extras.js');

// 造 5 条记录：今天×3（含 deny/error）、7天前×1、40天前×1
const DAY = 86400e3;
const now = Date.now();
const iso = (t) => new Date(t).toISOString();
const recs = [
  { ts: iso(now - 3600e3), plugin: 'sysinfo', action: 'overview', decision: 'allow', ms: 30, command: 'node sysinfo.mjs' },
  { ts: iso(now - 7200e3), plugin: 'quick', action: 'b64', decision: 'allow', ms: 20, command: 'node quick.mjs b64', error: '' },
  { ts: iso(now - 2 * 3600e3), plugin: 'quick', action: 'fail', decision: 'deny', ms: 0, command: 'node quick.mjs fail', error: '被拒：未授权' },
  { ts: iso(now - 7 * DAY - 3600e3), plugin: 'sysinfo', action: 'old', decision: 'allow', ms: 1, command: 'x' },
  { ts: iso(now - 40 * DAY), plugin: 'sysinfo', action: 'ancient', decision: 'allow', ms: 1, command: 'x' },
];

// ① filterAudit 时间范围
check('① today=3', filterAudit(recs, { range: 'today', now }).length === 3);
check('① 7d=4', filterAudit(recs, { range: '7d', now }).length === 4);
check('① 30d=4', filterAudit(recs, { range: '30d', now }).length === 4);
check('① 全部=5', filterAudit(recs, { range: '', now }).length === 5);

// ② outcome / ③ plugin
check('② deny=1', filterAudit(recs, { outcome: 'deny', now }).length === 1);
check('③ plugin quick=2', filterAudit(recs, { plugin: 'quick', now }).length === 2);

// ④ 关键词
check('④ 关键词 b64 命中 1', filterAudit(recs, { q: 'b64', now }).length === 1);
check('④ 错误文本可搜（未授权）', filterAudit(recs, { q: '未授权', now }).length === 1);
check('④ 组合：today+quick', filterAudit(recs, { range: 'today', plugin: 'quick', now }).length === 2);

// 边界
check('④ 非数组输入返空', filterAudit(null).length === 0 && filterAudit(undefined).length === 0);

// AUDIT_RANGES 结构
check('① 四档含空档', AUDIT_RANGES.length === 4 && AUDIT_RANGES[0].id === '' && AUDIT_RANGES.some((r) => r.id === '30d'));

// auditLine
check('⑤ auditLine 含插件.动作与耗时', auditLine(recs[0]).includes('sysinfo.overview') && auditLine(recs[0]).includes('30ms'));
check('⑤ auditLine 空记录空串', auditLine(null) === '');

// ⑧ CLI 端到端：真跑两次 + --plugin/--since
{
  run(['plugin', 'bundled']);
  run(['run', 'sysinfo', 'overview']);
  run(['run', 'quick', 'b64', '--text', 'x']);
  const rAll = run(['logs', '--tail', '10']);
  check('⑧ logs 默认两插件都出', rAll.stdout.includes('sysinfo') && rAll.stdout.includes('quick'));
  const rPlug = run(['logs', '--plugin', 'quick']);
  check('⑧ --plugin 只出 quick', rPlug.stdout.includes('quick') && !rPlug.stdout.includes('sysinfo'));
  check('⑧ --plugin 打过滤统计行', rPlug.stdout.includes('命中'));
  const rSince = run(['logs', '--since', 'today']);
  check('⑧ --since today 不误删当天', rSince.stdout.includes('sysinfo'));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
