// plugdoc139-smoke：第一百三十九轮——插件能力速查卡
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
const EXTRAS = readFileSync(path.join(PKG_ROOT, 'web', 'extras.js'), 'utf8');
const CSS = readFileSync(path.join(PKG_ROOT, 'web', 'style.css'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- plugdoc139`); } };
console.log('plugdoc139-smoke');

const extras = await import('../web/extras.js');

// ①② pluginQuickCard：风险构成 + 关键词
{
  const card = extras.pluginQuickCard({
    name: '小工具', summary: '认出你粘进来的东西',
    keywords: ['工具', '转换', '工具', '链接', '时间戳', '颜色', 'base64', 'quick', '多一个', '再多一个', '超了'],
    actions: [
      { id: 'a', risk: 'read' }, { id: 'b', risk: 'read' }, { id: 'c', risk: 'mutate' }, { id: 'd', risk: 'destructive' },
    ],
  });
  check('① 风险构成三档', card.mix.read === 2 && card.mix.mutate === 1 && card.mix.destructive === 1);
  check('① mixText', card.mixText === '只读 2 · 变更 1 · 高风险 1');
  check('② 关键词去重截 8', card.keywords.length === 8 && card.keywords[0] === '工具');
  check('① 动作数', card.actions === 4);
  const empty = extras.pluginQuickCard(undefined);
  check('① 空插件兜底', empty.actions === 0 && empty.mixText === '只读 0 · 变更 0 · 高风险 0');
}

// ③ paramSummary：必填/可选/secret
{
  const ps = extras.paramSummary([
    { name: 'text', required: true }, { name: 'count' }, { name: 'tok', required: true, secret: true },
  ]);
  check('③ 必填/可选计数', ps.required === 2 && ps.optional === 1);
  check('③ 摘要文案', ps.text === '必填 2 / 可选 1');
  check('③ secret 标记', ps.secrets === 1 && ps.secretMark === ' 🔑');
  check('③ 无参数', extras.paramSummary([]).text === '无参数');
  check('③ 非数组兜底', extras.paramSummary(undefined).text === '无参数');
}

// ④ lastRunText：相对时间
{
  const now = Date.now();
  const store = { 'sysinfo.overview': [{ ts: now - 30_000 }, { ts: now - 90_000 }] };
  check('④ 刚刚', extras.lastRunText('sysinfo.overview', store, now) === '刚刚');
  check('④ 分钟前', extras.lastRunText('sysinfo.overview', store, now + 60_000) === '1 分钟前');
  check('④ 无记录 null', extras.lastRunText('quick.b64', store, now) === null);
  check('④ 空 store null', extras.lastRunText('sysinfo.overview', undefined, now) === null);
  check('④ 天前', extras.lastRunText('sysinfo.overview', { 'sysinfo.overview': [{ ts: now - 90_000_000 }] }, now) === '1 天前');
}

// ⑤ buildCapabilitiesMd 导出/复制共用（静态接线）
check('⑤ helper 定义', APP.includes('function buildCapabilitiesMd(p)'));
check('⑤ 导出走 helper', APP.includes('const md = buildCapabilitiesMd(p);'));
check('⑤ 复制 doc 按钮', APP.includes('id="homeCopyDoc"') && APP.includes('复制 doc'));
check('⑤ helper 含参数摘要', APP.includes('参数 ' + '+ psr.text') || /参数 '\+ psr\.text|参数.*psr\.text/.test(APP));
check('⑤ helper 含 🖥 带界面', /a\.ui \? '，带界面'/.test(APP));

// ⑥⑦⑧ 静态接线
check('⑥ 组合步数徽标（既有+保留）', APP.includes('组合 ${a.steps.length} 步'));
check('⑦ 🖥 ui 徽标', APP.includes("a.ui ? '<span class=\"badge\" title=\"带交互界面\">🖥</span>' : ''"));
check('① 速查卡节点', APP.includes('plug-quick-card') && APP.includes('pqc-mix'));
check('② chip 直达搜索绑定', APP.includes("querySelectorAll('[data-kw]')"));
check('④ 动作行上次执行', APP.includes('pa-lastrun') && APP.includes('还没跑过'));
check('CSS 速查卡样式', CSS.includes('.plug-quick-card') && CSS.includes('.pa-lastrun'));

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
