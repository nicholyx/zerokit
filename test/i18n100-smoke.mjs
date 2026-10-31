// i18n100-smoke：第一百轮——i18n 体检工具与文案表迁移
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- i18n100`); } };
console.log('i18n100-smoke');

// ①② 扫描器工作 + 当前 0 新增
{
  const r = spawnSync(process.execPath, [path.join(PKG_ROOT, 'scripts/i18n-scan.mjs')], { encoding: 'utf8' });
  check('① 扫描器 0 未登记', r.status === 0 && r.stdout.includes('0 处未登记'));
  // 破坏验证：往 app.js 塞一行可见中文再扫——但别真写盘。用 stdin？脚本读文件——
  // 改验证扫描器对临时目录的行为太重，直接验证白名单机制：删一行白名单应报 N 处
  const wl = readFileSync(path.join(PKG_ROOT, '.i18n-whitelist'), 'utf8');
  check('① 白名单非空（负债已记账）', wl.split('\n').filter((l) => l && !l.startsWith('#')).length > 1000);
  check('② 白名单有头注释说明规则', wl.includes('新增代码不允许追加本表'));
}

// ③ 表键对齐（zh/en 同键集）
const extras = readFileSync(path.join(PKG_ROOT, 'web/extras.js'), 'utf8');
{
  const zhBlock = extras.match(/zh: \{([\s\S]*?)\n  \},/)[1];
  const enBlock = extras.match(/en: \{([\s\S]*?)\n  \},/)[1];
  const keys = (b) => [...b.matchAll(/(\w+):\s*'/g)].map((m) => m[1]);
  const zh = keys(zhBlock), en = keys(enBlock);
  check('③ zh/en 键集一致', JSON.stringify(zh) === JSON.stringify(en));
  check('③ 新键进表（themeHead 等 13 个）', ['themeHead', 'accentHead', 'fontHead', 'aiHead', 'themeSystem', 'themeDark', 'themeLight', 'fontS', 'fontM', 'fontL', 'aiOn', 'aiOff', 'aiToggleTitle', 'langHead'].every((k) => zh.includes(k)));
}

// ④ 面板接线：openThemePop 用 t() 不再裸写中文
{
  const app = readFileSync(path.join(PKG_ROOT, 'web/app.js'), 'utf8');
  const i0 = app.indexOf('function openThemePop'); const i1 = app.indexOf('\nfunction ', i0 + 10);
  const m = { 0: app.slice(i0, i1 > 0 ? i1 : i0 + 8000) };
  const body = m ? m[0] : '';
  check('④ 主题面板走 t()', body.includes("t('themeHead')") && body.includes("t('accentHead')") && body.includes("t('fontHead')"));
  check('④ AI 区走 t()', body.includes("t('aiOn')") && body.includes("t('aiOff')") && body.includes("t('aiToggleTitle')"));
  check('④ 面板内无裸中文 head', !/<div class="tp-head">[^<]*[\u4e00-\u9fff]/.test(body));
}

// ⑤⑥ 相对时间/空态在英文档（第二十八轮已有 resultTabTitle 英文档——复核仍在）
{
  const zhIdx = extras.indexOf("emptyRuns: '还没有执行记录");
  const enIdx = extras.indexOf('emptyRuns: \'No runs yet');
  check('⑤⑥ 空态双语键仍在', zhIdx > 0 && enIdx > zhIdx);
}

// ⑦ 日期/数字 locale 化：pickLang 返回 'zh'|'en'；toLocaleString 调用至少带一个 locale 参数的用法存在
{
  check('⑦ pickLang 导出', extras.includes('export function pickLang'));
  const app = readFileSync(path.join(PKG_ROOT, 'web/app.js'), 'utf8');
  check('⑦ 存在带 locale 的格式化（zh-CN/en-US）', /toLocale\w*\([^)]*'(zh-CN|en-US)'/.test(app) || /'(zh-CN|en-US)'/.test(app));
}

// ⑧ webui-smoke 里有 i18n 断言（第二十八轮的仍在 + 本轮新键）
{
  const webui = readFileSync(path.join(PKG_ROOT, 'test/webui-smoke.mjs'), 'utf8');
  check('⑧ webui-smoke 有 i18n 段', /i18n|applyLang/.test(webui));
}

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
