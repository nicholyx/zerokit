// keys173-smoke：第一百七十三轮——键盘手册与快捷键总闸
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- keys173`); } };
console.log('keys173-smoke');

const E = await import('../web/extras.js');
const app = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
const html = readFileSync(path.join(PKG_ROOT, 'web', 'index.html'), 'utf8');

// ① KEYMAP 结构完整
check('① 数据源 35+ 条', E.KEYMAP.length >= 35);
check('① 每条三字段', E.KEYMAP.every((k) => typeof k.keys === 'string' && typeof k.desc === 'string' && typeof k.scope === 'string'));
// ② 域都在 SCOPE 表里
{
  const ids = new Set(E.KEYMAP_SCOPES.map((s) => s.id));
  check('② scope 全部登记', E.KEYMAP.every((k) => ids.has(k.scope)));
  check('② 七域齐全', ['global', 'nav', 'list', 'detail', 'result', 'batch', 'panel'].every((x) => ids.has(x)));
}
// ⑥ 过滤纯函数
check('⑥ 词过滤命中', E.filterKeymap('收藏').some((k) => k.keys === 'F'));
check('⑥ 多词 AND', E.filterKeymap('结果 复制').length >= 1 && E.filterKeymap('结果 收藏').every((k) => k.desc.includes('收藏') || k.keys.includes('收藏')));
check('⑥ 空 q 全量', E.filterKeymap('').length === E.KEYMAP.length);
check('⑥ scope 过滤', E.filterKeymap('', 'list').every((k) => k.scope === 'list') && E.filterKeymap('', 'list').length >= 8);
// ⑦ 冲突检测
check('⑦ 现表无冲突', Array.isArray(E.keymapConflicts()) && E.keymapConflicts().length === 0);
// ③⑤ 总闸
check('③ 默认开', E.keysGateOn(undefined) === true && E.keysGateOn('on') === true);
check('③ off 关', E.keysGateOn('off') === false);
check('⑤ 提示文案', E.keysDisabledHint().includes('?') && E.keysDisabledHint().includes('设置'));
// 接线
check('③ gate 接线三处 dispatcher', (app.match(/keysGateBlocks\(e\)/g) ?? []).length >= 4); // 定义 1 + 挂点 3
check('④ 键 zerokit.keys.master', app.includes("'zerokit.keys.master'"));
check('④ 备份组归类（外观与设置）', E.classifyKey('zerokit.keys.master') === '外观与设置');
check('① 手册从 KEYMAP 渲染', app.includes('KEYMAP_SCOPES.map') && app.includes('filterKeymap(qEl.value'));
check('⑧ 域 tab', app.includes('data-kms') && html.includes('keysMasterRow'));
check('抽屉开关', html.includes('data-keys-master="off"') && app.includes('paintKeysMaster'));

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
