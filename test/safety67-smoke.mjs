// 第六十七轮：安全基线第三轮——执行中断（signal 贯通）、destructive 双重确认、
// doctor timeout 提示、/api/stop。纯逻辑 + 端到端（临时 HOME 自包含）。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const REPO = path.resolve(import.meta.dirname, '..');
const results = [];
const check = (name, cond, detail = '') => {
  results.push([name, !!cond]);
  if (!cond) console.error(`FAIL  ${name}   <- ${detail}`);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'safety67-'));
const env = { ...process.env, ZEROKIT_HOME: tmp };
// paths.ts 的 HOME 在模块加载时读 env——本进程内的 import 也要吃到同一个临时 HOME
process.env.ZEROKIT_HOME = tmp;
const run = (args, opts = {}) => spawnSync('node', [path.join(REPO, 'src/cli.ts'), ...args], {
  env, cwd: REPO, timeout: 60000, ...opts,
});

// --- 环境准备 ---
run(['plugin', 'bundled']);

// ①⑧ signal 贯通：runAction 传 AbortSignal，200ms 后 abort，进程被杀、stopped=true
{
  const r = await import(pathToFileURL(path.join(REPO, 'src/core/runner.ts')).href);
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 250);
  const res = await r.runAction(
    { id: 't', name: 't', runtime: 'node', actions: [], settings: [], requires: {}, params: [] },
    { id: 'slow', title: 'slow', description: '', params: [], run: ['node', '-e', 'setTimeout(()=>{},3000)'], risk: 'read', output: 'text', timeout: 30, type: 'cmd' },
    { caller: 'cli', values: {}, signal: ac.signal },
  );
  check('① stopped=true', res.stopped === true);
  check('① ok=false', res.ok === false);
  check('① error 文案', (res.error ?? '').includes('已被用户停止'));
  check('① 快速返回（<2000ms 而非等满 3s）', res.ms < 2000);
}

// ⑥ 审计带 stopped 事件
{
  const auditPath = path.join(tmp, 'logs', 'audit.log');
  const rows = fs.existsSync(auditPath)
    ? fs.readFileSync(auditPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    : [];
  const stoppedRow = rows.find((x) => x.reason === 'stopped');
  check('⑥ 审计 reason=stopped', !!stoppedRow);
}

// ② destructive 双重确认（非交互给 --yes 会跳过确认——确认策略覆盖在 confirmRun；
//    这里测源码语义：CLI 源码包含「输入动作 id」分支）
{
  const cli = fs.readFileSync(path.join(REPO, 'src/cli.ts'), 'utf8');
  check('② CLI 双重确认分支', cli.includes("destructive 动作。请输入动作 id"));
  check('② UI 已有动作名确认（第十九轮）', fs.readFileSync(path.join(REPO, 'web/app.js'), 'utf8').includes('请输入动作名'));
}

// ③ timeout 声明已存在（manifest DEFAULT_TIMEOUT=60 + 校验）
{
  const man = fs.readFileSync(path.join(REPO, 'src/core/manifest.ts'), 'utf8');
  check('③ DEFAULT_TIMEOUT=60', man.includes('DEFAULT_TIMEOUT = 60'));
  check('③ timeout 校验正数秒', man.includes('timeout 必须是正数秒'));
}

// ⑦ doctor 列无 timeout 插件
{
  const out = run(['doctor', '--json']);
  const rep = JSON.parse(out.stdout);
  const warns = rep.plugins.flatMap((p) => p.problems).filter((x) => x.text.includes('未声明 timeout'));
  check('⑦ doctor timeout 警告', warns.length >= 1, JSON.stringify(rep.summary));
  check('⑦ 修复提示可执行', (warns[0]?.hint ?? '').includes('timeout ='));
}

// ⑤ Ctrl+. 与 ① 停止按钮接线（源码级）
{
  const app = fs.readFileSync(path.join(REPO, 'web/app.js'), 'utf8');
  check('⑤ Ctrl+. 监听', app.includes("e.ctrlKey && e.key === '.'"));
  check('① runBtn 停止态', app.includes('■ 停止'));
  check('① /api/stop 调用', app.includes("'/api/stop'"));
  const server = fs.readFileSync(path.join(REPO, 'src/server.ts'), 'utf8');
  check('① /api/stop 端点', server.includes("/api/stop"));
  check('① 停全部语义', server.includes('stopped: n > 0'));
}

// ④ 并发护栏
{
  const app = fs.readFileSync(path.join(REPO, 'web/app.js'), 'utf8');
  check('④ actionInFlight 集合', app.includes('actionInFlight.has('));
  check('④ 拒绝文案', app.includes('同一动作已在执行中'));
}

// ⑧ AbortSignal 组合（http 路径）
{
  const runner = fs.readFileSync(path.join(REPO, 'src/core/runner.ts'), 'utf8');
  check('⑧ AbortSignal.any 组合', runner.includes('AbortSignal.any([timeoutSignal, options.signal])'));
  check('⑧ viaSpawn 传 signal', runner.includes('signal: options.signal'));
}

fs.rmSync(tmp, { recursive: true, force: true });
const pass = results.filter((r) => r[1]).length;
console.log(`通过 ${pass} / ${results.length}`);
if (pass !== results.length) {
  console.log('失败：' + results.filter((r) => !r[1]).map((r) => r[0]).join('、'));
  process.exit(1);
}
process.exit(0);
