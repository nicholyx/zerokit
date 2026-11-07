// table179-smoke：第一百七十九轮——表格导出与分享
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- table179 ${extra}`); } };
console.log('table179-smoke');

const E = await import('../web/extras.js');
const app = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
const css = readFileSync(path.join(PKG_ROOT, 'web', 'style.css'), 'utf8');

// ⑦ csvEscape 边界
check('⑦ 逗号加引号', E.csvEscape('a,b') === '"a,b"');
check('⑦ 引号翻倍', E.csvEscape('say "hi"') === '"say ""hi"""');
check('⑦ 换行加引号', E.csvEscape('l1\nl2') === '"l1\nl2"');
check('⑦ 纯文本不动', E.csvEscape('plain') === 'plain');
check('⑦ null/undefined 空串', E.csvEscape(null) === '' && E.csvEscape(undefined) === '');
check('⑦ 数字透传', E.csvEscape(120) === '120');

// ① exportCsv 可见列
{
  const rows = [{ n: '网关,主力', v: 120, secret: 'x' }, { n: '数据|库', v: 80, secret: 'y' }];
  const csv = E.exportCsv(rows, ['n', 'v']);
  check('① 只导可见列（secret 不在）', !csv.includes('secret'));
  check('① 转义行正确', csv.split('\n')[1] === '"网关,主力",120');
}

// ② mdTableVis
{
  const rows = [{ n: '数据|库', v: 80 }];
  const md = E.mdTableVis(rows, ['n', 'v'], ['v']);
  check('② 管道符转义', md.includes('数据\\|库'));
  check('② 数值列右对齐 ---:', md.split('\n')[1].includes('---:'));
  check('② 空表也出表头', E.mdTableVis([], ['a', 'b']).includes('| a | b |'));
}

// ③ exportMeta
check('③ 元信息头含标记/动作/行数', E.exportMeta('sysinfo.top', 10).includes('zerokit export') && E.exportMeta('sysinfo.top', 10).includes('sysinfo.top') && E.exportMeta('a', 10).includes('10 行'));

// ⑤⑥ shareEnvelope/shareAlive
{
  const env = E.shareEnvelope('sysinfo.top', ['a'], [{ a: 1 }]);
  check('⑤ 信封 id/版本/字段', env.id.length >= 6 && env.v === 1 && Array.isArray(env.rows) && Array.isArray(env.cols));
  check('⑤ ttl 默认 24h', env.ttl === 24 * 3600 * 1000);
  check('⑥ 活着判定', E.shareAlive(env) === true);
  check('⑥ 25h 前过期', E.shareAlive({ ...env, at: Date.now() - 25 * 3600 * 1000 }) === false);
  check('⑥ 坏信封（无 rows）拒', E.shareAlive({ id: 'x', at: Date.now(), ttl: 1000 }) === false);
}

// 接线
check('⑧ 导出按钮进工具栏', app.includes('data-texport='));
check('⑧ CSV/MD/复制/分享四模式', app.includes('data-texp="csv"') && app.includes('data-texp="md"') && app.includes('data-texp="copy"') && app.includes('data-texp="share"'));
check('④ 导出走筛选链（filterRows+resultQuery+sortRows）', app.includes('filterRows(rows0, fterms)') && app.includes('sortRows(qrows'));
check('① CSV 下载带 BOM', app.includes("\\ufeff${text}"));
check('⑤ 分享深链路由', app.includes('#/share/') && app.includes('showShareView'));
check('⑥ 分享只读态+自己跑一次', app.includes('shareRerun') && app.includes("t('shareGoneTitle')"));
check('⑤ 过期分享自清', app.includes('zerokit.share.') && app.includes('localStorage.removeItem(k)'));
check('CSS 分享视图', css.includes('.share-view') && css.includes('.share-table'));

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
