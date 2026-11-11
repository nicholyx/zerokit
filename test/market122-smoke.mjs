// market122-smoke：第一百二十二轮——集市与插件发现体验
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- market122`); } };
const home = mkdtempSync(path.join(tmpdir(), 'm122-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 120000, env });
const all = (r) => (r.stdout || '') + (r.stderr || '');

console.log(`market122-smoke（${home}）`);
run(['plugin', 'bundled']);
run(['market', 'add', PKG_ROOT]);

// ① 集市搜索（核实既有 + 本轮空态文案共存）
{
  const r = run(['market', 'search', '剪贴板']);
  check('① search 命中剪贴板', all(r).includes('剪贴板历史'));
}

// ② buildIndex 摊开动作数与风险构成
{
  const idx = JSON.parse(readFileSync(path.join(PKG_ROOT, 'market.json'), 'utf8'));
  const clip = idx.plugins.find((p) => p.id === 'clipboard');
  check('② 登记表带 actionCount', clip && clip.actionCount === 6);
  check('② 登记表带 riskMix', clip && clip.riskMix.read === 2 && clip.riskMix.mutate === 3 && clip.riskMix.destructive === 1);
  const old = idx.plugins.find((p) => p.id === 'sysinfo');
  check('② 全部插件都有（重新生成过）', Boolean(old && old.actionCount >= 1));
}

// ④ 源健康徽标（server 侧 health 字段）
{
  const srv = readFileSync(path.join(PKG_ROOT, 'src', 'server.ts'), 'utf8');
  check('④ health 三档计算', srv.includes("'bad'") && srv.includes("'stale'") && srv.includes("'ok'"));
  const app = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
  check('④ 卡片渲染徽标', app.includes('market-health') && app.includes('🟢'));
}

// ⑤ 安装 toast 深链
check('⑤ marketMsg 第三参深链（246 轮拆分：marketMsg 在 market.js、深链在 app）', (() => {
  const mk = readFileSync(path.join(PKG_ROOT, 'web', 'market.js'), 'utf8');
  return mk.includes('查看插件主页') && readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8').includes('#/plugins/');
})());

// ⑥ 来源带集市 URL
{
  const src = readFileSync(path.join(PKG_ROOT, 'src', 'core', 'sources.ts'), 'utf8');
  check('⑥ describeSource market 带 url', src.includes('s.url ? ` · ${s.url}`') || src.includes('s.url'));
  const mk = readFileSync(path.join(PKG_ROOT, 'src', 'core', 'market.ts'), 'utf8');
  check('⑥ 安装时记录集市 url', mk.includes('loadMarkets().find((mm) => mm.name === preview.market)?.url'));
}

// ⑦ market info
{
  const r = run(['market', 'info', 'zerokit']);
  check('⑦ info 列出插件与构成', all(r).includes('6 动作') && all(r).includes('读×2'));
  const r2 = run(['market', 'info', '不存在']);
  check('⑦ 负例退 1 带已添加提示', r2.status === 1 && all(r2).includes('已添加'));
  const r3 = run(['market', 'info']);
  check('⑦ 无参列集市清单', all(r3).includes('zerokit'));
}

// ⑧ 空登记表引导
{
  const app = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
  check('⑧ 空态教一步（246 轮起在 market.js）', readFileSync(path.join(PKG_ROOT, 'web', 'market.js'), 'utf8').includes('第一步：把本仓库当集市') && readFileSync(path.join(PKG_ROOT, 'web', 'market.js'), 'utf8').includes('market.json 就是一个集市'));
}

// ⑨ 前端渲染：卡片头部结构（静态断言）
{
  const app = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
  check('② entry 渲染风险徽标组（246 轮起在 market.js）', (() => { const mk = readFileSync(path.join(PKG_ROOT, 'web', 'market.js'), 'utf8'); return mk.includes('market-risk-mix') && mk.includes('marketRiskMix(e)'); })());
  check('② entry 显示动作数（market.js）', readFileSync(path.join(PKG_ROOT, 'web', 'market.js'), 'utf8').includes('e.actionCount'));
  check('③ 预览 diff 既有（market.js）', readFileSync(path.join(PKG_ROOT, 'web', 'market.js'), 'utf8').includes('renderMarketPreviewBox') && readFileSync(path.join(PKG_ROOT, 'web', 'market.js'), 'utf8').includes('marketPreview'));
}

// ① UI 搜索既有（marketQ input 绑定）
{
  const app = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
  check('① UI 搜索框既有（market.js）', (() => { const mk = readFileSync(path.join(PKG_ROOT, 'web', 'market.js'), 'utf8'); return mk.includes('id="marketQ"') && mk.includes('marketQuery'); })());
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
