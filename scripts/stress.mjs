#!/usr/bin/env node
// stress.mjs —— 压测与稳定性（第一百四十七轮）
// 用法：node scripts/stress.mjs [home] [--quick]
// --quick 跑最小档（CI 用）；默认全档。
//
// ① 并发 8 动作（含 1 失败）→ 审计无丢行、结果无串台
// ② 3 个 1MB 级输出并行 → 截断+落盘路径正确、无相互覆盖
// ⑤ 3 个 zkit 进程同时写审计 → append 原子性（无交叉半行）
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'src', 'cli.ts');
const quick = process.argv.includes('--quick');
const homeArg = process.argv.slice(2).find((a) => !a.startsWith('-') && a !== 'quick' && a !== __filename);
const home = homeArg ? path.resolve(homeArg) : mkdtempSync(path.join(tmpdir(), 'stress147-'));
process.env.ZEROKIT_HOME = home;

console.log(`stress: home=${home} quick=${quick}`);
spawnSync(process.execPath, [CLI, 'plugin', 'bundled'], { stdio: 'inherit', timeout: 120000 });

// —— 压测插件：并发 + 大输出 + 失败 ——
const dev = path.join(home, 'stress-plugins');
mkdirSync(dev, { recursive: true });
writeFileSync(path.join(dev, 'plugin.toml'), `[plugin]
id = "stx"
name = "压测"
version = "0.1.0"
summary = "压测"

[[action]]
id = "burst"
title = "并发 N"
description = "输出带序号的 JSON"
risk = "read"
run = ["node", "-e", "console.log(JSON.stringify({seq: '{seq}', pid: process.pid}))"]
params = [{name = "seq", type = "string", description = "序号"}]
output = "json"

[[action]]
id = "flood"
title = "大输出"
description = "输出指定 MB 的数据"
risk = "read"
run = ["node", "-e", "const mb=Number('{mb}'||1);const s='x'.repeat(65536);for(let i=0;i<mb*16;i++)console.log(s)"]
params = [{name = "mb", type = "string", description = "MB 数"}]
output = "text"

[[action]]
id = "boom"
title = "必失败"
description = "exit 1"
risk = "read"
run = ["node", "-e", "process.exit(1)"]
output = "text"
`);
spawnSync(process.execPath, [CLI, 'plugin', 'dev', dev], { stdio: 'inherit', timeout: 60000 });

let fails = 0;
const report = (name, ok, detail = '') => {
  if (ok) console.log(`  ✓ ${name}${detail ? '（' + detail + '）' : ''}`);
  else { console.error(`FAIL  ${name} ${detail}`); fails++; }
};

// —— ① 并发 8 动作（7 成功 1 失败）——
{
  const N = quick ? 4 : 8;
  const jobs = Array.from({ length: N }, (_, i) =>
    new Promise((res) => {
      const p = spawn(process.execPath, [CLI, 'run', 'stx', 'burst', '--seq', String(i)], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; p.stdout.on('data', (d) => (out += d));
      p.on('close', (c) => res({ code: c, out }));
    }));
  const results = await Promise.all(jobs);
  const oks = results.filter((r) => r.code === 0).length;
  report(`① 并发 ${N} 全部有结果`, oks === N, `ok=${oks}`);
  const seqs = results.map((r) => { const m = /"seq":\s*"?(\d+)"?/.exec(r.out); return m ? Number(m[1]) : -1; });
  const uniq = new Set(seqs).size;
  report('① 结果无串台（seq 全唯一）', uniq === N, `uniq=${uniq}/${N}`);
}
// ①b 失败混入：boom 与 burst 并发，审计两条都在
{
  const one = spawn(process.execPath, [CLI, 'run', 'stx', 'burst'], { stdio: 'ignore' });
  const boom = spawn(process.execPath, [CLI, 'run', 'stx', 'boom'], { stdio: 'ignore' });
  await Promise.all([new Promise((r) => one.on('close', r)), new Promise((r) => boom.on('close', r))]);
  const auditText = readFileSync(path.join(home, 'logs', 'audit.log'), 'utf8');
  const burstLine = auditText.split('\n').filter((l) => l.includes('"plugin":"stx"') && l.includes('"action":"burst"')).length;
  const boomLine = auditText.split('\n').filter((l) => l.includes('"plugin":"stx"') && l.includes('"action":"boom"')).length;
  report('①b 失败与成功审计都在', burstLine >= 2 && boomLine >= 1, `burst=${burstLine} boom=${boomLine}`);
}

// —— ② 3 个 2MB 输出并行 ——
{
  const MB = quick ? 1 : 2;
  const jobs = Array.from({ length: 3 }, () =>
    new Promise((res) => {
      const p = spawn(process.execPath, [CLI, 'run', 'stx', 'flood', '--mb', String(MB)], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; p.stdout.on('data', (d) => (out += d));
      p.on('close', (c) => res({ code: c, out }));
    }));
  const rs = await Promise.all(jobs);
  report('② 3 个大输出并行完成', rs.every((r) => r.code === 0));
  const arts = readdirSync(path.join(home, 'data', 'artifacts')).filter((f) => f.endsWith('.out'));
  report('② 落盘文件各自独立', arts.length >= 3, `artifacts=${arts.length}`);
  const sizes = arts.map((f) => readFileSync(path.join(home, 'data', 'artifacts', f)).length);
  report('② 落盘大小都接近请求量', sizes.every((s) => s > (MB - 0.5) * 1024 * 1024), sizes.map((s) => `${(s / 1048576).toFixed(1)}MB`).join(','));
}

// —— ⑤ 3 个 CLI 进程同时写审计 ——
{
  const auditFile = path.join(home, 'logs', 'audit.log');
  const before = readFileSync(auditFile, 'utf8').split('\n').filter(Boolean).length;
  const ps = Array.from({ length: 3 }, () => spawn(process.execPath, [CLI, 'run', 'stx', 'burst'], { stdio: 'ignore' }));
  await Promise.all(ps.map((p) => new Promise((r) => p.on('close', r))));
  const after = readFileSync(auditFile, 'utf8').split('\n').filter(Boolean);
  const added = after.length - before;
  const badLines = after.filter((l) => { try { JSON.parse(l); return false; } catch { return true; } });
  report('⑤ 3 进程并发写审计全落', added === 3, `+${added}`);
  report('⑤ 无交叉半行（每行都是合法 JSON）', badLines.length === 0, badLines.length ? `bad=${badLines.length}` : '');
}

if (!homeArg) rmSync(home, { recursive: true, force: true });
console.log(fails === 0 ? 'stress: ALL PASS' : `stress: ${fails} FAIL`);
process.exit(fails ? 1 : 0);
