// polish95-smoke：第九十五轮——1.0 收口
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- polish95`); } };
const home = mkdtempSync(path.join(tmpdir(), 'p95-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 90000, env });
console.log('polish95-smoke');

// ①③ 首跑路径：空 → bundled → 第一个动作 → doctor（README 快速开始等价链）
{
  const r0 = run(['list']);
  check('③ 空态引导', (r0.stdout + r0.stderr).includes('plugin bundled'));
  run(['plugin', 'bundled']);
  const r1 = run(['run', 'sysinfo', 'overview']);
  check('③ 第一个动作成功', r1.status === 0 && r1.stdout.includes('系统'));
  const rd = run(['doctor']);
  const od = rd.stdout + rd.stderr;
  // ④ doctor 版本行
  const ver = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version;
  check('④ doctor 版本行', od.includes(`zerokit v${ver}`));
}

// ①⑤ 空态盘点：25 处 ps-empty 都带 role=status（第十三轮起约定）且非「读取中」占位不算空态
{
  const app = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
  const idx = readFileSync(path.join(PKG_ROOT, 'web', 'index.html'), 'utf8');
  const empties = app.match(/class="ps-empty"/g)?.length ?? 0;
  const withRole = app.match(/class="ps-empty" role="status"/g)?.length ?? 0;
  check('① ps-empty 全带 role=status', empties > 0 && empties === withRole);
  // ② 首跑引导第四步（仪表盘）
  check('② 首跑引导四步含仪表盘', app.includes("t: '仪表盘'") && app.includes('NetBar'));
  check('② 定位副标题', app.includes('插件是能力包：一份清单，四个面'));
  // 空态文案都含下一步动作（「——」后的引导句）——抽三处关键面板
  check('① 定时空态带指引', app.includes('「⏲ 定时」设间隔'));
  check('① 收藏空态带指引', app.includes('还没有收藏——跑一次动作，在结果工具条里点「收藏」'));
  check('① 监控空态带指引', app.includes('没有在跑的监控'));
  check('① 日志空态带指引', app.includes('还没有日志——执行一次动作就会写进来'));
}

// ⑥⑦ 账本对齐：overview 行数覆盖到九十四轮、START-HERE 版本号=package.json
{
  const ver = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version;
  const ov = readFileSync(path.join(PKG_ROOT, 'docs', 'reference', 'overview.md'), 'utf8');
  const sh = readFileSync(path.join(PKG_ROOT, 'START-HERE.md'), 'utf8');
  check('⑥ overview 账本到九十四轮', ov.includes('第九十四轮'));
  check('⑥ 账本轮次提到九十四', ov.includes('九十四'));
  check('⑦ START-HERE 版本号一致', sh.includes(ver));
  check('⑦ README 三命令快速路径', readFileSync(path.join(PKG_ROOT, 'README.md'), 'utf8').includes('market add .'));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
