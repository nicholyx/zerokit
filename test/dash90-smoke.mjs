// dash90-smoke：第九十轮——首页仪表盘
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- dash90`); } };
const app = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
const html = readFileSync(path.join(PKG_ROOT, 'web', 'index.html'), 'utf8');
const css = readFileSync(path.join(PKG_ROOT, 'web', 'style.css'), 'utf8');

const { dashGreeting, dashEmpty, dashStats } = await import('../web/extras.js');

console.log('dash90-smoke');

// 纯函数
check('① dashGreeting 五档', ['夜深了', '早上好', '午安', '下午好', '晚上好'].every((w, i) => dashGreeting([3, 7, 11, 15, 20][i]) === w));
check('⑧ dashEmpty 三态引导', dashEmpty('favs').hint.includes('F') && dashEmpty('runs').hint.includes('跑') && dashEmpty('watch').hint.includes('监控') && dashEmpty('nope') === null);
check('⑤ dashStats 零执行', JSON.stringify(dashStats(null, () => 'x')) === JSON.stringify({ total: 0, ok: 0, rate: 0, avgMs: 0, topName: '' }));
check('⑤ dashStats 正常+topName', (() => {
  const d = dashStats({ total: 4, ok: 3, failed: 1, top: [['sysinfo.overview', 3]], avgMs: 1200 }, (k) => k === 'sysinfo.overview' ? '系统概况' : k);
  return d.rate === 75 && d.topName === '系统概况' && d.avgMs === 1200;
})());
check('⑤ dashStats 卸载插件 key 兜底', dashStats({ total: 1, ok: 1, failed: 0, top: [['gone.act', 1]], avgMs: 5 }, () => '').topName === '');

// 静态接线
check('① #/dash 面板容器', html.includes('id="dashView"'));
check('⑦ 顶栏 NetBar 按钮', html.includes('id="dashBtn"') && html.includes('NetBar'));
check('① showDash 定义+mode', app.includes('function showDash()') && app.includes("mode = 'dash'") && app.includes("t('modeDash')"));
check('⑥ hashchange #/dash 分支', app.includes("(location.hash || '') === '#/dash'"));
check('⑥ runCommand dash 条目', app.includes("case 'dash': showDash(); break;"));
check('⑥ 命令面板「仪表盘」', app.includes("label: '仪表盘'") && app.includes('showDash()'));
check('① 四宫格 widget', app.includes('快捷动作') && app.includes('最近执行') && app.includes('监控') && app.includes('今日'));
check('② 收藏磁贴 data-dash-go', app.includes('data-dash-go'));
check('⑧ 空态分级接线', app.includes("dashEmpty('favs')") && app.includes("dashEmpty('runs')") && app.includes("dashEmpty('watch')"));
check('⑦ dashBtn 绑定', app.includes("el.dashBtn?.addEventListener('click', () => showDash())"));
check('① hidePanels 含 dashView', app.includes('el.devView, el.dashView])'));
check('CSS 四宫格', css.includes('.dash-grid') && css.includes('.dash-tile') && css.includes('.dash-stats'));

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
