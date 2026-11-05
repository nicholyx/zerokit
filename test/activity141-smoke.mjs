// activity141-smoke：第一百四十一轮——活动面板
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
const EXTRAS = readFileSync(path.join(PKG_ROOT, 'web', 'extras.js'), 'utf8');
const HTML = readFileSync(path.join(PKG_ROOT, 'web', 'index.html'), 'utf8');
const CSS = readFileSync(path.join(PKG_ROOT, 'web', 'style.css'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- activity141`); } };
console.log('activity141-smoke');

const extras = await import('../web/extras.js');

// ③ activityStats
{
  const empty = extras.activityStats([]);
  check('③ 空统计', empty.total === 0 && empty.okRate === null && empty.avgMs === null && empty.slowest === null);
  const st = extras.activityStats([
    { ok: true, ms: 100, key: 'a.x' }, { ok: true, ms: 300, key: 'a.y' }, { ok: false, ms: 3500, key: 'b.z' },
  ]);
  check('③ 成功率 67%', st.okRate === 67);
  check('③ 平均耗时', st.avgMs === 1300);
  check('③ 最慢动作', st.slowest.key === 'b.z' && st.slowest.ms === 3500);
  const noMs = extras.activityStats([{ ok: true }, { ok: false }]);
  check('③ 无 ms 字段兜底', noMs.avgMs === null && noMs.slowest === null && noMs.okRate === 50);
  check('③ 非数组兜底', extras.activityStats(undefined).total === 0);
}

// ⑤ slowTier
check('⑤ >3000 红', extras.slowTier(3500) === 'slow3');
check('⑤ >1000 黄', extras.slowTier(1500) === 'slow1');
check('⑤ 正常 null', extras.slowTier(800) === null && extras.slowTier(null) === null);

// ⑧ auditToActivity
{
  const acts = extras.auditToActivity([
    { ts: '2026-11-05T12:00:00Z', plugin: 'quick', action: 'b64', decision: 'allow', exitCode: 0, ms: 40, caller: 'cli' },
    { ts: '2026-11-05T12:01:00Z', plugin: 'sysinfo', action: 'top', decision: 'allow', exitCode: 1, ms: 4000, caller: 'ui', error: 'boom\nsecond line' },
    { ts: '2026-11-05T12:02:00Z', plugin: 'clipboard', action: 'clear', decision: 'deny', reason: '未授权', caller: 'mcp' },
  ]);
  check('⑧ key 拼接', acts[0].key === 'quick.b64');
  check('⑧ 失败摘要取首行', acts[1].error === 'boom' && acts[1].ok === false);
  check('⑧ denied 行', acts[2].denied === true && acts[2].error === '未授权');
  check('⑧ 空 caller 兜底', extras.auditToActivity([{ ts: 't', plugin: 'p', action: 'a', decision: 'allow', exitCode: 0 }])[0].caller === '');
}

// ①②⑥⑦ 静态接线
check('① showActivity 面板', APP.includes('async function showActivity') && APP.includes('actList'));
check('② 行展开错误', APP.includes('err.hidden = !err.hidden'));
check('⑥ applyHash + hashchange 双侧', (APP.match(/#\/activity'\) \{ showActivity\(\); return; \}/g)?.length ?? 0) + (APP.match(/#\/activity'\) \{\n    showActivity\(\);\n    return;\n  \}/g)?.length ?? 0) === 2);
check('⑥ 命令面板入口', EXTRAS.includes("go: '#/activity'") && EXTRAS.includes('cmdActivity'));
check('⑦ 抽屉链接', HTML.includes('id="dlActivity"') && APP.includes("location.hash = '#/activity'"));
check('④ 插件过滤 chips', APP.includes('data-act-plug'));
check('⑤ 慢档 CSS 挂类', APP.includes('slowTier(a.ms)'));
check('① activityView 是顶层兄弟节点（嵌套 logsView 的缺陷回归）', !/>\n*<div id="activityView"/.test(HTML) && HTML.includes('<div id="logsView" class="plug-view hidden"></div>\n    <div id="activityView" class="view hidden"></div>'));
check('I18N 双语键', EXTRAS.includes("cmdActivity: '最近活动'") && EXTRAS.includes("cmdActivity: 'Activity'"));

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
