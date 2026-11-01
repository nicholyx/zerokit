// perf112-smoke：第一百一十二轮——大列表与搜索性能（静态断言为主 + extras 纯函数）
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- perf112`); } };
const app = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
const extras = readFileSync(path.join(PKG_ROOT, 'web', 'extras.js'), 'utf8');
console.log('perf112-smoke（静态断言）');

// ① 防抖核实：input 处理已有 150ms + rAF（既有能力，防回归）
check('① 搜索输入防抖 150ms+rAF 存在', /searchDebounceTimer = setTimeout[\s\S]{0,120}requestAnimationFrame/.test(app));

// ② 搜索记忆化：search 套 memo 层
check('② searchMemo 缓存层存在', app.includes('const searchMemo = new Map()') && app.includes('searchCompute(query)'));
check('② 缓存键含列表版本', app.includes('`${entriesVersion}|${query}`'));
check('② 列表重建时 bump 版本', (app.match(/entries = buildEntries\(plugins\); entriesVersion\+\+;/g) ?? []).length === 2);
check('② 缓存容量上限防膨胀', app.includes('searchMemo.size > 200'));

// ③ stagger 门控
check('③ stagger 受 allowListStagger 门控', app.includes("i < 10 && allowListStagger ? ' zk-stagger'"));
check('③ 搜索重排关 stagger（渲染后恢复）', /allowListStagger = false;[\s\S]{0,80}renderList\(\);[\s\S]{0,80}allowListStagger = true;/.test(app));

// ④ 虚拟窗口核实（第十五轮 virtualWindow 存在，防回归）
{
  const m = extras.match(/export function virtualWindow\(/);
  check('④ virtualWindow 仍导出', !!m);
}

// ⑤ 骨架屏只在列表空时画（防重复 append）
check('⑤ 骨架屏条件 !childElementCount', app.includes('!el.list.childElementCount') && app.includes('skel-row'));

// ⑥ 列表挂载单次 innerHTML 赋值（join 一次）——抽两处代表
check('⑥ 浏览态/搜索态列表都是 join 一次赋值', (app.match(/el\.list\.innerHTML = [^;]*\.join\(''\)/g) ?? []).length >= 2);

// ⑦ renderPs 视图守卫：非 ps 模式跳过 innerHTML
check('⑦ renderPs 非 ps 模式只更新胶囊', app.includes("if (mode !== 'ps') return;"));

// ⑧ 浏览态分组 O(n) 单遍构建（forEach+Map.set）且不缓存（过滤后顺序变，缓存易错——显式取舍）
check('⑧ 分组单遍 forEach 构建（无嵌套循环）', /const groups = new Map\(\);[\s\S]{0,200}filtered\.forEach\(\(entry, i\) => \{[\s\S]{0,150}groups\.get\(id\)\.push/.test(app));

// ⑨ extras 纯函数：virtualWindow 行为抽测
{
  const { virtualWindow } = await import('../web/extras.js');
  const w = virtualWindow(1000, 0, 40, 400, 6);
  // 可见 10 行（400/40）+ 双侧 overscan 6 → end ≤ 10+12+1；实测 22
  check('⑨ 千项首屏窗口 end<=可见行+双侧overscan', w.end <= Math.ceil(400 / 40) + 12 + 1 && w.start === 0);
  const w2 = virtualWindow(10000, 200000, 40, 400, 6);
  check('⑨ 万项滚动窗口行数受限', w2.end - w2.start <= Math.ceil(400 / 40) + 2 * 6 + 1);
}

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
