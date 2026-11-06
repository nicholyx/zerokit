// authordx153-smoke：第一百五十三轮——插件作者体验（质量分/批量体检/文档目录）
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- authordx153 ${extra}`); } };
console.log('authordx153-smoke');

// ---- 纯函数：lintScore ----
const { lintScore } = await import('../src/core/lintdoc.ts');

// ① 分数与等级
{
  const clean = lintScore([]);
  check('① 零发现 100/A', clean.score === 100 && clean.grade === 'A');
  const mid = lintScore([{ rule: 'L01', severity: 'warn', target: 'x', message: 'm' }, { rule: 'L04', severity: 'info', target: 'x', message: 'm' }]);
  check('① warn+info 扣分 92/A', mid.score === 92 && mid.grade === 'A', `score=${mid.score}`);
  const low = lintScore([{ rule: 'L05', severity: 'error', target: 'x', message: 'm' }, { rule: 'L07', severity: 'error', target: 'x', message: 'm' }]);
  check('① 两 error 70/B', low.score === 70, `score=${low.score}`);
  const floor = lintScore(Array.from({ length: 12 }, (_, i) => ({ rule: `L${i}`, severity: 'error', target: 'x', message: 'm' })));
  check('① 下限 0/D', floor.score === 0 && floor.grade === 'D');
}
// ② 建议 top3 排序（error 优先）
{
  const f = [
    { rule: 'L01', severity: 'info', target: 'x', message: 'info-m' },
    { rule: 'L03', severity: 'warn', target: 'x', message: 'warn-m' },
    { rule: 'L05', severity: 'error', target: 'x', message: 'err-m', fixHint: 'fix' },
    { rule: 'L06', severity: 'warn', target: 'x', message: 'warn2-m' },
    { rule: 'L07', severity: 'error', target: 'x', message: 'err2-m' },
  ];
  const sc = lintScore(f, 3);
  check('② top3=error×2+warn', sc.suggestions.length === 3 && sc.suggestions[0].severity === 'error' && sc.suggestions[2].severity === 'warn');
  check('② fixHint 透传', sc.suggestions.some((s) => s.fixHint === 'fix'));
}

// ---- CLI 实跑 ----
const home = mkdtempSync(path.join(tmpdir(), 'adx153-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env });
run(['plugin', 'bundled']);

// ③ --all 批量
{
  const r = run(['plugin', 'lint', '--all']);
  const out = r.stdout ?? '';
  check('③ 批量表头+13 个', out.includes('批量体检（13 个插件') && out.includes('分数'), out.slice(0, 90));
  check('③ 升序（首行分 ≤ 末行分）', (() => { const ns = [...out.matchAll(/^\s+(\d+)\s+[ABCD]\s/gm)].map((m) => Number(m[1])); return ns.length >= 10 && ns[0] <= ns[ns.length - 1]; })());
  check('③ 无 error exit 0', r.status === 0);
}
// ① --score 建议
{
  const r = run(['plugin', 'lint', 'quick', '--score']);
  const out = r.stdout ?? '';
  check('① 质量行 A（98/100）', out.includes('质量：A（98/100）'), out.slice(0, 120));
  check('② 建议段', out.includes('最值得先修的三项'));
}
// ⑦ --rule 过滤
{
  const r = run(['plugin', 'lint', 'proxy', '--rule', 'L16']);
  const out = r.stdout ?? '';
  check('⑦ 只出 L16', out.includes('L16') && !out.includes('L04'));
  const r2 = run(['plugin', 'lint', 'proxy', '--rule=L04']);
  check('⑦ 等号形态', (r2.stdout ?? '').includes('L04') && !(r2.stdout ?? '').includes('L16'));
}
// ⑤ doc 质量徽标
{
  const r = run(['plugin', 'doc', 'quick']);
  check('⑤ doc 徽标', (r.stdout ?? '').includes('质量：A（98/100'));
}
// ④ doc 目录（convert 9 动作 >3）
{
  const r = run(['plugin', 'doc', 'convert']);
  const out = r.stdout ?? '';
  check('④ 目录行', out.includes('目录：[') && out.includes('](#进制转换'));
  const r2 = run(['plugin', 'doc', 'quick']);
  check('④ 小插件无目录（≤6 动作）', !(r2.stdout ?? '').includes('目录：'));
}
// --json 带 score/grade
{
  const r = run(['plugin', 'lint', 'quick', '--json']);
  const j = JSON.parse(r.stdout ?? '{}');
  check('⑩ json 机读含 score/grade', typeof j.score === 'number' && typeof j.grade === 'string' && Array.isArray(j.findings));
}
// ⑥ 模板带体检指引
{
  run(['plugin', 'new', 'tpl153', '--dir', path.join(home, 'src-tpl153')]);
  const tomlPath = path.join(home, 'src-tpl153', 'tpl153', 'plugin.toml');
  let toml = '';
  try { toml = readFileSync(tomlPath, 'utf8'); } catch { toml = ''; }
  check('⑥ 模板体检指引', toml.includes('plugin lint . --score') && toml.includes('plugin doc .'), toml ? '命中' : '未落盘 ' + tomlPath);
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
