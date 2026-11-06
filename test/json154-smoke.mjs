// json154-smoke：第一百五十四轮——JSON 面板纯函数 + CLI --path + webui 静态接线
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
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- json154 ${extra}`); } };
console.log('json154-smoke');

// ---- 纯函数 ----
const E = await import('../web/extras.js');

// ① jsonPanelRows 行模型与路径
{
  const rows = E.jsonPanelRows({ a: 1, items: [{ n: 'x' }, { n: 'y' }] });
  check('① 叶子路径 .items[1].n', rows.find(r => r.path === '.items[1].n')?.text === '"y"');
  check('① 分支行 .items', rows.find(r => r.path === '.items' && r.kind === 'branch') !== undefined);
  check('① 根分支+叶子 .a', rows[0]?.path === '.' && rows.find(r => r.path === '.a')?.type === 'num');
}
// ③ 大数组默认折叠（>100 项）
{
  const rows = E.jsonPanelRows({ list: Array.from({ length: 150 }, (_, i) => i) });
  const b = rows.find(r => r.path === '.list');
  check('③ 150 项默认折', b?.collapsedByDefault === true && b?.childCount === 150);
  check('③ 折叠时不铺子行', !rows.some(r => r.path.startsWith('.list.')));
  const ok99 = E.jsonPanelRows({ list: Array.from({ length: 99 }, (_, i) => i) });
  check('③ 99 项不折（全铺）', ok99.find(r => r.path === '.list')?.collapsedByDefault === false && ok99.some(r => r.path === '.list[98]'));
}
// ④ 深嵌套默认折叠（>8 层）
{
  let deep = { leaf: 1 };
  for (let i = 0; i < 10; i++) deep = { lv: i, inner: deep };
  const rows = E.jsonPanelRows(deep);
  const branches = rows.filter(r => r.kind === 'branch');
  check('④ 11 个分支全列出（含根）', branches.length === 11);
  check('④ 深 9 层起默认折', branches[9]?.collapsedByDefault === true && branches[8]?.collapsedByDefault === false);
}
// ⑤ prefixParts / jsonGetByParts 与 CLI --jq 同语义
{
  check('⑤ prefixParts', JSON.stringify(E.prefixParts('.data.items[2].name')) === JSON.stringify(['data', 'items', '2', 'name']));
  check('⑤ jsonGetByParts 命中', E.jsonGetByParts({ items: [{ n: 'x' }] }, ['items', '0', 'n']).value === 'x');
  check('⑤ jsonGetByParts 越界不命中', E.jsonGetByParts({ items: [] }, ['items', '5', 'n']).hit === false);
}
// jsonExpandChildren 铺一层
{
  const kids = E.jsonExpandChildren([{ a: 1 }, { b: 2 }], '.');
  check('expand 铺一层两行', kids.length === 2 && kids[0]?.kind === 'branch' && kids[0]?.collapsedByDefault === true);
}

// ---- CLI --path ----
const home = mkdtempSync(path.join(tmpdir(), 'j154-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env });
run(['plugin', 'bundled']);
{
  const r = run(['run', 'quick', 'ts2date', '--ts', '1760000000', '--quiet', '--path', '.星期']);
  check('⑤⑤ --path 取顶层字段', r.stdout.includes('"四"'), r.stdout.slice(0, 80) + r.stderr.slice(0, 80));
  const r2 = run(['run', 'quick', 'ts2date', '--ts', '1760000000', '--quiet', '--jq', '.星期']);
  check('⑤⑤ --jq 与 --path 等价', r2.stdout === r.stdout, `${r2.stdout.slice(0,60)}`);
}

// ---- webui 静态接线 ----
{
  const app = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
  const css = readFileSync(path.join(PKG_ROOT, 'web', 'style.css'), 'utf8');
  check('⑥ view-switch chips', app.includes('view-switch') && app.includes("data-jv=\"tree\"") && app.includes('zerokit.jsonview.'));
  check('① json-panel 渲染', app.includes('jsonPanelHtml') && app.includes('jp-row'));
  check('② 点击复制路径', app.includes('writeText(path)') && app.includes('data-jp-path'));
  check('⑧ JSON 态复制格式化全文', app.includes('#result .json-panel') && app.includes("JSON.stringify(res.data, null, 2)"));
  check('CSS 类型四色', css.includes('.jp-val.t-num') && css.includes('.jp-val.t-str') && css.includes('.jp-val.t-bool') && css.includes('.jp-val.t-null'));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
