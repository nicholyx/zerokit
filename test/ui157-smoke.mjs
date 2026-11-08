// ui157-smoke：第一百五十七轮——键盘速查收口 + 滚动记忆（静态断言 + 纯函数）
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- ui157`); } };
console.log('ui157-smoke');

const app = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
const extras = readFileSync(path.join(PKG_ROOT, 'web', 'extras.js'), 'utf8');

// ① 速查浮层新键段（第五十二/六十九/七十轮键全部进表）
check('① 密度/排序键进速查', app.includes("{ keys: 'd', desc: '列表密度循环'") || extras.includes("{ keys: 'd', desc: '列表密度循环'") || extras.includes("{ keys: 'r / m', desc: '插件序/最近序切换'"));
check('① 键盘流四键进速查', extras.includes("{ keys: 'F', desc: '收藏/取消收藏'") && extras.includes("{ keys: 'X / M', desc: '结果导出 CSV/Markdown'"));
check('① 停止/重放/剪贴板进速查', app.includes('Ctrl+.') && app.includes('Ctrl+R') && app.includes('Ctrl+Shift+V'));
// ③ 当前状态区
check('③ 速查浮层当前状态区（第一百七十三轮起手册从 KEYMAP 渲染，状态区随旧浮层退役）', extras.includes('KEYMAP') && app.includes('filterKeymap(qEl.value'));
// ④ palette 占位提示可搜动作与 ? 键
check('④ palette 占位升级（191 轮语法统一：键盘提示入占位符）', app.includes('搜索动作、插件、页面或命令…（↑↓ 选择 · Enter 打开 · 1-9 直选）'));
// ⑥ 滚动记忆：openDetail 存 + backToList 恢复
check('⑥ openDetail 存滚动位置', app.includes("sessionStorage.setItem('zk.listScroll'"));
check('⑥ backToList 恢复滚动', app.includes("sessionStorage.getItem('zk.listScroll')") && app.includes('sc.scrollTop = saved'));
// 已存在项核实（issue ⑤⑦⑧ 关闭依据）
check('⑤ 密度 d 键已有（六十九轮⑧）', app.includes("e.key === 'd'") && app.includes('ldensity'));
check('⑦ 标题运行计数已有', app.includes('announceTitle') && app.includes('updateWatchTitle'));
check('⑧ 风险 tooltip 已有', app.includes('riskText(a.risk)'));
check('① palette 搜动作已有（八十五轮）', app.includes('actionItems') && app.includes('paletteScoreV2'));

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
