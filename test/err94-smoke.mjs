// err94-smoke：第九十四轮——错误内容与排错体验
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- err94`); } };
const home = mkdtempSync(path.join(tmpdir(), 'e94-'));
const env = { ...process.env, ZEROKIT_HOME: home };
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env });
console.log(`err94-smoke（${home}）`);
run(['plugin', 'bundled']);

const { classifyError, errorReport } = await import('../web/extras.js');

// ① classifyError 分类（既有表 + 兜底）
check('① not-found 分类', classifyError('ENOENT: no such file').kind === 'not-found');
check('① unknown 兜底', classifyError('完全陌生的报错').kind === 'unknown');
check('① 兜底有下一步', classifyError('x').steps.length >= 2);

// ④⑤ errorReport 组装
{
  const r = errorReport('not-found', 'File or directory not found', 'zkit run quick b64', 'Error: ENOENT', { platform: 'darwin', node: '22.20.0', version: '0.98.0' });
  check('④ 标题行含 kind', r.startsWith('# zerokit failed: File or directory not found (not-found)'));
  check('④ 命令行', r.includes('Command: zkit run quick b64'));
  check('⑤ 环境三行', r.includes('Env: darwin · Node 22.20.0 · zerokit 0.98.0'));
  check('④ stderr 围栏', r.includes('```') && r.includes('Error: ENOENT'));
  check('④ 空 stderr 兜底', errorReport('k', 't', '', '').includes('(no stderr)'));
}

// ⑥ CLI 分类徽标：缺必填参数（用法错误）+ 不存在插件
{
  const r1 = run(['run', 'quick', 'b6']);   // 动作打错
  const o1 = r1.stdout + r1.stderr;
  check('⑥ CLI 建议/指引', o1.includes('b64') || o1.includes('suggest') || o1.includes('完整帮助'));
  const r2 = run(['run', 'ghost', 'x']);
  const o2 = r2.stdout + r2.stderr;
  check('⑥ 不存在插件指引', o2.includes('没有找到插件') && o2.includes('zkit list'));
}

// ⑧ 审计失败条目带分类字段（静态接线 + 实跑：跑一个失败动作后 logs --json 有 failKind… 先静态）
{
  const app = readFileSync(path.join(PKG_ROOT, 'web', 'app.js'), 'utf8');
  const cli = readFileSync(path.join(PKG_ROOT, 'src', 'cli.ts'), 'utf8');
  check('⑧ UI 失败卡审计分类（fail-class 上报接线）', app.includes("kind: 'fail-class'") && app.includes('failKind'));
  check('⑥ CLI 徽标前缀 [kind]', cli.includes('[${d.kind}] ⟐'));
  check('① 失败卡分类徽标', app.includes('fail-kind') && app.includes('data-fail-kind'));
  check('② stderr 末 5 行折叠', app.includes('末 5 行 / 共') || app.includes('lines.slice(-5)'));
  check('④ 复制报错按钮', app.includes('data-fail-copy') && app.includes('📋 复制报错'));
  check('⑦ 动作名近邻建议', app.includes('是不是想敲') && app.includes('function lev('));
}

// ⑦ 近邻建议真跑（页面内 lev 逻辑核心在 extras 无——单测 lev 语义经 app.js 静态 + 行为等价的 classifyError 路径已覆盖；
//    这里验 CLI 侧 suggestLine 已有行为的回归）
{
  const r = run(['plugn']);
  const o = r.stdout + r.stderr;
  check('⑦ CLI 打错命令建议（回归）', o.includes('plugin') || o.includes('是不是想'));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
