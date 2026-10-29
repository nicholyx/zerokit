// data82-smoke：第八十二轮配置迁移——snapshot（脱敏/明文）/restore（跳过/覆盖）/list/diff/path/负例
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- data82`); } };
const home = mkdtempSync(path.join(tmpdir(), 'd82-'));
const outDir = mkdtempSync(path.join(tmpdir(), 'd82o-'));
process.env.ZEROKIT_HOME = home;
const run = (args, envHome = home) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: envHome },
});
console.log(`data82-smoke（${home}）`);
run(['plugin', 'bundled']);
// ESM 静态 import 提升：migrate.ts 模块加载时固化 ZEROKIT_HOME——
// 纯函数调用前用动态 import 重载（第七十八轮同款坑）
const { makeSnapshot: mk, parseSnapshot: ps, restoreSnapshot: rs, diffSnapshot: ds } = await import('../src/core/migrate.ts');
mkdirSync(path.join(home, 'settings'), { recursive: true });
writeFileSync(path.join(home, 'settings', 'demosettings.json'), JSON.stringify({ api_token: 'sk-live-abcdef123456', retries: 3 }));
writeFileSync(path.join(home, 'allow.json'), JSON.stringify({ entries: [{ key: 'proxy.allow-domain', at: '2026-10-01', ttlDays: -1 }] }));
writeFileSync(path.join(home, 'timers.json'), JSON.stringify({ version: 1, timers: [] }));

// 纯函数层
const snap = mk(outDir, {});
check('① 打包成功', snap.ok === true && existsSync(snap.file ?? ''));
const parsed = ps(readFileSync(snap.file ?? ''));
check('① 头字段齐全', parsed.ok === true && parsed.snap.meta.app === 'zerokit' && parsed.snap.meta.snapshotVersion === 1 && parsed.snap.meta.host.length > 0);
const masked = parsed.ok ? parsed.snap.files.find((f) => f.rel === 'settings/demosettings.json') : null;
check('④ secret 换占位符', masked != null && masked.data.toString().includes('__ZK_SNAPSHOT_SECRET_REMOVED__') && !masked.data.toString().includes('sk-live'));
check('④ 记脱敏计数', parsed.ok === true && parsed.snap.meta.secretsRemoved === 1);
const snap2 = mk(outDir, { withSecrets: true });
const parsed2 = ps(readFileSync(snap2.file ?? ''));
const plain = parsed2.ok ? parsed2.snap.files.find((f) => f.rel === 'settings/demosettings.json') : null;
check('④ --with-secrets 带明文', plain != null && plain.data.toString().includes('sk-live') && parsed2.snap.meta.secretsRemoved === 0);
check('① 不带 audit/logs', parsed.ok === true && !parsed.snap.files.some((f) => f.rel.startsWith('logs/') || f.rel.includes('audit')));
check('① allow/timers 在', parsed.ok === true && parsed.snap.files.some((f) => f.rel === 'allow.json') && parsed.snap.files.some((f) => f.rel === 'timers.json'));

// restore 到新目录
const home2 = mkdtempSync(path.join(tmpdir(), 'd82r-'));
process.env.ZEROKIT_HOME = home2;
// restore 也要用 home2 视角的模块实例（HOME 在模块加载时固化）
const m2 = await import('../src/core/migrate.ts');
const rr = m2.restoreSnapshot(parsed.snap);
check('② 全应用', rr.applied.length === 3 && existsSync(path.join(home2, 'settings', 'demosettings.json')));
// 再恢复一次：默认跳过
const rr2 = m2.restoreSnapshot(parsed.snap);
check('② 已存在跳过', rr2.applied.length === 0 && rr2.skipped.length === 3);
// 覆盖模式
writeFileSync(path.join(home2, 'settings', 'demosettings.json'), '{"x":1}');
const rr3 = m2.restoreSnapshot(parsed.snap, { overwrite: true });
check('② --overwrite 覆盖', rr3.applied.includes('settings/demosettings.json') && readFileSync(path.join(home2, 'settings', 'demosettings.json'), 'utf8').includes('PLACEHOLDER') === false);

// diff
const d1 = m2.diffSnapshot(parsed.snap);
check('⑥ 一致时空', d1.length === 0);
writeFileSync(path.join(home2, 'settings', 'demosettings.json'), '{"changed":true}');
writeFileSync(path.join(home2, 'watch.json'), '{"version":1}');
const d2 = m2.diffSnapshot(parsed.snap);
check('⑥ 改动/本机多 双向', d2.some((e) => e.kind === 'changed') && d2.some((e) => e.kind === 'only-in-here' && e.rel === 'watch.json'));

// 负例
const bad = ps(Buffer.from('not a zip at all'));
check('⑧ 非 zip 拒', !bad.ok);
const trunc = ps(readFileSync(snap.file ?? '').subarray(0, 40));
check('⑧ 截断拒', !trunc.ok);

// CLI 面
const r1 = run(['data', 'path'], home2);
check('⑤ path 一行', r1.status === 0 && r1.stdout.trim() === home2);
const r2 = run(['data', 'list', snap.file ?? ''], home2);
check('③ list 预览', r2.status === 0 && r2.stdout.includes('快照预览') && r2.stdout.includes('demosettings.json'));
const r3 = run(['data', 'restore', snap.file ?? ''], home2);
check('② CLI restore 输出', r3.status === 0 && r3.stdout.includes('应用') && r3.stdout.includes('跳过'));
const r4 = run(['data', 'diff', snap.file ?? ''], home2);
check('⑥ CLI diff', r4.status === 0 && (r4.stdout.includes('差异') || r4.stdout.includes('一致')));
const r5 = run(['data', 'restore', '/tmp/bad.zksnap-x'], home2);
check('⑧ CLI 坏文件 exit 2', r5.status === 2);
const r6 = run(['data', 'snapshot', outDir], home2);
check('① CLI snapshot 提示脱敏', r6.status === 0 && r6.stdout.includes('快照已生成'));

rmSync(home, { recursive: true, force: true });
rmSync(home2, { recursive: true, force: true });
rmSync(outDir, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
