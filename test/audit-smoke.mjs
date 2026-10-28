/**
 * 第四十一轮：审计与授权管理冒烟（audit.ts 纯函数 + CLI 端到端）。
 * 自包含：临时 ZEROKIT_HOME，不依赖已装插件、不联网。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  DEFAULT_TTL_DAYS, entryAlive, pruneAllow, upsertAllow, affectedByRemove,
  parseSince, lastRunOf, isLongGap,
} from '../src/core/audit.ts';

let pass = 0; let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${label}`); } };
const REPO = path.resolve(import.meta.dirname, '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'zk-audit-'));
const cli = (args, env = {}) => spawnSync(process.execPath, [path.join(REPO, 'src/cli.ts'), ...args], {
  encoding: 'utf8', env: { ...process.env, ZEROKIT_HOME: HOME, ...env },
});

// ④ TTL
{
  const now = Date.parse('2026-10-28T00:00:00Z');
  const alive = { key: 'a.b', at: new Date(now - 5 * 86400000).toISOString(), ttlDays: 30 };
  const dead = { key: 'c.d', at: new Date(now - 31 * 86400000).toISOString(), ttlDays: 30 };
  const forever = { key: 'e.f', at: '2020-01-01T00:00:00Z', ttlDays: -1 };
  ok(entryAlive(alive, now), 'ttl alive');
  ok(!entryAlive(dead, now), 'ttl dead');
  ok(entryAlive(forever, now), 'permanent alive');
  const pr = pruneAllow([alive, dead, forever], now);
  ok(pr.alive.length === 2 && pr.expired.length === 1, 'prune splits');
  const up = upsertAllow([alive], 'x.y', 60, now);
  ok(up.length === 2 && up.find((e) => e.key === 'x.y')?.ttlDays === 60, 'upsert adds');
  const up2 = upsertAllow(up, 'x.y', 10, now);
  ok(up2.length === 2 && up2.find((e) => e.key === 'x.y')?.ttlDays === 10, 'upsert updates');
  ok(DEFAULT_TTL_DAYS === 30, 'default ttl 30');
}

// ⑧连带
{
  const es = [
    { key: 'p.a', at: new Date().toISOString(), ttlDays: 30 },
    { key: 'p.b', at: new Date().toISOString(), ttlDays: 30 },
    { key: 'q.c', at: new Date().toISOString(), ttlDays: 30 },
  ];
  ok(affectedByRemove(es, 'p').length === 2, 'plugin remove affects 2');
  ok(affectedByRemove(es, 'p.a').length === 1, 'action remove affects 1');
  ok(affectedByRemove(es, 'zz').length === 0, 'unknown affects 0');
}

// ⑥ parseSince
{
  ok(parseSince('45s') === 45000, 'since 45s');
  ok(parseSince('30m') === 1800000, 'since 30m');
  ok(parseSince('1h') === 3600000, 'since 1h');
  ok(parseSince('3d') === 3 * 86400000, 'since 3d');
  ok(parseSince('2w') === 2 * 604800000, 'since 2w');
  ok(parseSince('100') === 100000, 'bare number = seconds');
  ok(parseSince('abc') === null, 'garbage null');
  ok(parseSince('1x') === null, 'bad unit null');
}

// ⑤ lastRunOf / isLongGap
{
  const recs = [
    { ts: '2026-10-01T00:00:00Z', key: 'p.a' },
    { ts: '2026-10-20T00:00:00Z', key: 'p.a' },
    { ts: '2026-10-21T00:00:00Z', key: 'q.b' },
  ];
  ok(lastRunOf(recs, 'p.a') === '2026-10-20T00:00:00Z', 'lastRun picks max ts');
  ok(lastRunOf(recs, 'zz') === null, 'lastRun unknown null');
  const now = Date.parse('2026-10-28T00:00:00Z');
  ok(isLongGap('2026-10-20T00:00:00Z', now), '8d gap warns');
  ok(!isLongGap('2026-10-27T00:00:00Z', now), '1d gap no warn');
  ok(!isLongGap(null, now), 'first run no warn');
}

// CLI ② add/list/remove
{
  const a1 = cli(['allow', 'add', 'sysinfo.overview', '60']);
  ok(a1.status === 0 && a1.stdout.includes('已授权 sysinfo.overview'), 'allow add ok');
  const a2 = cli(['allow', 'add', 'quick.b64']);
  ok(a2.status === 0, 'allow add default ttl');
  const l1 = cli(['allow', 'list']);
  ok(l1.stdout.includes('sysinfo.overview') && l1.stdout.includes('60 天'), 'list shows ttl');
  const r1 = cli(['allow', 'remove', 'sysinfo']);
  ok(r1.status === 0 && r1.stdout.includes('1 条'), 'plugin remove reports count');
  const l2 = cli(['allow', 'list']);
  ok(!l2.stdout.includes('sysinfo.overview') && l2.stdout.includes('quick.b64'), 'remove scoped');
  const bad = cli(['allow', 'add', 'nosuch']);
  ok(bad.status === 2, 'add without dot rejected');
}

// ④过期自动清理（写一个 31 天前的条目，list 触发 prune）
{
  const allowFile = path.join(HOME, 'allow.json');
  const stale = [{ key: 'old.act', at: new Date(Date.now() - 31 * 86400000).toISOString(), ttlDays: 30 }];
  fs.writeFileSync(allowFile, JSON.stringify(stale));
  const out = cli(['allow', 'list']);
  ok(out.stdout.includes('已过期'), 'expired prune message');
  const after = JSON.parse(fs.readFileSync(allowFile, 'utf8'));
  ok(!after.some((e) => e.key === 'old.act'), 'expired removed from store');
}

// ①③⑥⑦ 审计视图（种记录）
{
  cli(['plugin', 'bundled']);
  cli(['run', 'sysinfo', 'overview', '--yes']);
  const ax = cli(['audit', '--since', '1h']);
  ok(ax.status === 0 && ax.stdout.includes('sysinfo.overview'), 'audit --since shows run');
  const bad = cli(['audit', '--since', 'nope']);
  ok(bad.status === 2, 'audit bad --since exit 2');
  const aj = cli(['audit', '--json', '--last', '2']);
  const pj = JSON.parse(aj.stdout);
  ok(Array.isArray(pj.records) && pj.records.length >= 1 && pj.records[0].plugin === 'sysinfo', 'audit --json shape');
  // denied：种一条
  fs.appendFileSync(path.join(HOME, 'logs', 'denied.log'), JSON.stringify({ ts: new Date().toISOString(), key: 'demo.fail', reason: '非交互环境拒绝' }) + '\n');
  const ad = cli(['audit', '--denied']);
  ok(ad.stdout.includes('demo.fail') && ad.stdout.includes('非交互'), 'audit --denied lists');
  const adj = cli(['audit', '--denied', '--json']);
  ok(JSON.parse(adj.stdout).records.length >= 1, 'denied --json');
  const empty = cli(['run', 'sysinfo', 'overview']);
  ok(empty.status === 0, 'read action needs no confirm');
}

console.log(`通过 ${pass} / ${pass + fail}`);
fs.rmSync(HOME, { recursive: true, force: true });
process.exit(fail > 0 ? 1 : 0);
