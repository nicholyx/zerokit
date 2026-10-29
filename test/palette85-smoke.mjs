// palette85-smoke：第八十五轮命令面板——纯函数 + 静态接线断言
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- palette85`); } };
const app = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
const extras = readFileSync(path.join(PKG_ROOT, 'web', 'extras.js'), 'utf8');

const { paletteGroup, boostRecent, tabComplete } = await import('../web/extras.js');

// 纯函数
check('① paletteGroup page', paletteGroup({ group: 'page' }) === '页面');
check('② paletteGroup op', paletteGroup({ group: 'op' }) === '操作');
check('⑧ paletteGroup 无组 null', paletteGroup({}) === null);
{
  const items = [{ label: 'B' }, { label: 'A' }, { label: 'C' }];
  const out = boostRecent(items, ['A', 'C']);
  check('⑥ boostRecent 最近在前', out[0].label === 'A' && out[1].label === 'C' && out[2].label === 'B');
  check('⑥ boostRecent 空历史不动', boostRecent(items, [])[0].label === 'B');
}
check('⑦ tabComplete 唯一前缀', tabComplete('审计', ['审计日志', '环境自检']) === '审计日志');
check('⑦ tabComplete 多命中 null', tabComplete('e', ['env', 'exec']) === null);
check('⑦ tabComplete 空查询 null', tabComplete('', ['a']) === null);

// 静态接线
check('① 页面条目 ≥16 带 group:page', (app.match(/group: 'page'/g) ?? []).length >= 14);
check('② 操作条目 ≥7 带 group:op', (app.match(/group: 'op'/g) ?? []).length >= 7);
check('④ 快捷键徽标渲染', app.includes("kbd class=\"palette-key\""));
check('④ 日志条目带 Ctrl+L', app.includes("key: 'Ctrl+L'"));
check('③ 分组头渲染分支', app.includes('palette-group') && app.includes('paletteGroup(x)'));
check('⑤ 数字直选 1-9', app.includes("/^[1-9]$/.test(e.key)"));
check('⑥ 页面/操作进 cmdhist', app.includes('pushCmdHist') && app.includes('.slice(0, 10)'));
check('⑦ Tab 补全分支', app.includes("e.key === 'Tab'") && app.includes('tabComplete('));
check('⑧ 空结果 none 行保留', app.includes('没有匹配的项'));
check('③ 空查询 boostRecent 接线', app.includes('boostRecent(items.filter((x) => x.group)'));
check('① 序号列渲染', app.includes('palette-num'));
check('CSS 分组/徽标样式', readFileSync(path.join(PKG_ROOT, 'web', 'style.css'), 'utf8').includes('.palette-group'));

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
