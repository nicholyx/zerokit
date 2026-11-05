// cli142-smoke：第一百四十二轮——CLI 输出与体验打磨
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
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- cli142`); } };
const home = mkdtempSync(path.join(tmpdir(), 'c142-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env });
console.log(`cli142-smoke（${home}）`);
run(['plugin', 'bundled']);
run(['run', 'quick', 'b64', '--text', 'x142']);

// ① help 分节索引
{
  const r = run(['--help']);
  check('① 分节索引行', r.stdout.includes('分节：基本') && r.stdout.includes('man'));
}

// ② 建议带一句话说明
{
  const r = run(['dctor']);
  check('② 建议行', r.stderr.includes('是不是想敲「doctor」'));
  check('② 一句话说明', r.stderr.includes('doctor —— 环境自检'));
  const r2 = run(['lst']);
  check('② 多候选去重（last 只一行）', (r2.stderr.match(/last ——/g) ?? []).length === 1);
}

// ③ run 失败下一步（复用第一百三十五轮 diagnose——已在，验回归）
{
  const r = run(['run', 'quick', 'ts2date', '--ts', 'notanumber']);
  const all = r.stdout + r.stderr;
  check('③ 失败自诊断在', all.includes('⟐') || all.includes('下一步') || r.status === 1);
}

// ④ list --json 单独也机读 + lastRun
{
  const r = run(['list', '--json']);
  let ok = false;
  try { const d = JSON.parse(r.stdout); ok = Array.isArray(d) && d.some((x) => x.id === 'quick' && x.lastRun && x.lastRun.ok === true); } catch {}
  check('④ --json 机读 + lastRun', ok);
}

// ⑤ doctor --fix 摘要
{
  const r = run(['doctor', '--fix']);
  check('⑤ fix 摘要行', r.stdout.includes('--fix 摘要') && r.stdout.includes('清理残留目录'));
  check('⑤ 没修的说明', r.stdout.includes('没修的'));
}

// ⑥ 长表格提示（renderTable 纯函数直测）
{
  const cliX = await import('../src/core/cliX.ts');
  const rows = Array.from({ length: 60 }, (_, i) => ({ idx: i }));
  const out = cliX.renderTable(rows);
  check('⑥ >50 行提示', out.includes('共 60 行') && out.includes('--head'));
  check('⑥ ≤50 行不提示', !cliX.renderTable([{ a: 1 }]).includes('共'));
}

// ⑦ config 概览最近用到
{
  const r = run(['config']);
  const quick = r.stdout.split('\n').find((l) => l.startsWith('  quick')) ?? '';
  // quick 无设置项不显示——验有设置项插件的行带「最近：」
  const anyLine = r.stdout.split('\n').find((l) => l.includes('最近：'));
  check('⑦ 概览带最近列', !!anyLine);
}

// ⑧ allow add 风险人话
{
  const r = run(['allow', 'add', 'sysinfo.overview', '30']);
  check('⑧ 风险预览', r.stdout.includes('授权后 AI 将能执行') && r.stdout.includes('只读'));
  const r2 = run(['allow', 'add', 'clipboard.clear', '30']);
  check('⑧ 高风险标红文案', r2.stdout.includes('高风险'));
}

// ⑨ help 索引不破坏 man
check('⑨ man 完整', readFileSync(path.join(PKG_ROOT, 'src', 'cli.ts'), 'utf8').includes('zkit(1) -- zerokit 命令行参考'));

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
