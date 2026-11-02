// lifecycle125-smoke：插件生命周期与健康（第一百二十五轮）
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- lifecycle125`); } };
const mkHome = () => { const h = mkdtempSync(path.join(tmpdir(), 'l125-')); return h; };
const run = (home, args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 90000, env: { ...process.env, ZEROKIT_HOME: home } });

// ① health 卡
{
  const h = mkHome(); run(h, ['plugin', 'bundled']);
  const r = run(h, ['plugin', 'health', 'quick']);
  const all = r.stdout + r.stderr;
  check('① 健康卡三要素（名称+徽标+风险构成）', r.status === 0 && all.includes('健康') && all.includes('读 3') && all.includes('写 1'));
  check('① 无执行记录不冒充 100%', all.includes('还没跑过'));
  const r2 = run(h, ['quick'].length ? ['run', 'quick', 'b64', '--text', 'x'] : []);
  check('① 实跑后计入', r2.status === 0);
  const r3 = run(h, ['plugin', 'health', 'quick']);
  check('① 成功率出现', r3.stdout.includes('1/1 成功（100%）'));
  const r4 = run(h, ['plugin', 'health', 'nosuch']);
  check('① 负例退出码 1', r4.status === 1 && (r4.stdout + r4.stderr).includes('没有找到'));
  rmSync(h, { recursive: true, force: true });
}

// ④⑦ 失联隔离与处置
{
  const h = mkHome(); run(h, ['plugin', 'bundled']);
  mkdirSync(path.join(h, 'plugins', 'ghost'), { recursive: true });
  writeFileSync(path.join(h, 'plugins', 'ghost', '.zerokit-source.json'), '{"type":"market","market":"zerokit","url":"/tmp/gsrc"}');
  const lr = run(h, ['plugin', 'list']);
  check('④ 失联目录不进正常列表', !lr.stdout.includes('ghost'));
  const d = run(h, ['plugin', 'doctor-lost']);
  const dall = d.stdout + d.stderr;
  check('⑦ doctor-lost 列失联+来源+处置', d.status === 1 && dall.includes('ghost') && dall.includes('集市 zerokit') && dall.includes('处置'));
  rmSync(h, { recursive: true, force: true });
}

// ⑧ 事件审计
{
  const h = mkHome(); run(h, ['plugin', 'bundled']);
  mkdirSync(path.join(h, 'plugins', 'ghost2'), { recursive: true });
  writeFileSync(path.join(h, 'plugins', 'ghost2', '.zerokit-source.json'), '{"type":"market","market":"zerokit"}');
  run(h, ['plugin', 'doctor-lost']);
  const hist = run(h, ['plugin', 'history']);
  check('⑧ lost 事件进流水', hist.stdout.includes('失联') && hist.stdout.includes('ghost2'));
  rmSync(h, { recursive: true, force: true });
}

// ⑤ purge
{
  const h = mkHome(); run(h, ['plugin', 'bundled']);
  mkdirSync(path.join(h, 'settings'), { recursive: true });
  writeFileSync(path.join(h, 'settings', 'convert.json'), '{"a":1}');
  const r = run(h, ['plugin', 'remove', 'convert', '--purge']);
  check('⑤ purge 清配置', r.status === 0 && !exists(path.join(h, 'settings', 'convert.json')));
  // 默认（无 --purge）保留
  const h2 = mkHome(); run(h2, ['plugin', 'bundled']);
  mkdirSync(path.join(h2, 'settings'), { recursive: true });
  writeFileSync(path.join(h2, 'settings', 'convert.json'), '{"a":1}');
  const r2 = run(h2, ['plugin', 'remove', 'convert']);
  check('⑤ 默认保留配置（重装即恢复的承诺）', r2.status === 0 && exists(path.join(h2, 'settings', 'convert.json')));
  rmSync(h, { recursive: true, force: true }); rmSync(h2, { recursive: true, force: true });
}

// 失联 remove 兜底
{
  const h = mkHome(); run(h, ['plugin', 'bundled']);
  mkdirSync(path.join(h, 'plugins', 'ghost3'), { recursive: true });
  writeFileSync(path.join(h, 'plugins', 'ghost3', '.zerokit-source.json'), '{"type":"market"}');
  const r = run(h, ['plugin', 'remove', 'ghost3', '--force']);
  check('⑦ 失联插件可 remove（目录直删兜底）', r.status === 0 && !exists(path.join(h, 'plugins', 'ghost3')));
  rmSync(h, { recursive: true, force: true });
}

// ②③ update --check / --dry-run 等价 + 风险变化警示（静态源码）
{
  const src = (await import('node:fs')).readFileSync(path.join(PKG_ROOT, 'src', 'cli.ts'), 'utf8');
  check("② --check 与 --dry-run 同路（只查不装）", src.includes("args.includes('--dry-run') || args.includes('--check')"));
  check('③ 风险升级警示已有（update116 riskChanged）', src.includes('风险升级'));
}

import fs from 'node:fs';
function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
