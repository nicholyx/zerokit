// batch98-smoke：第九十八轮——执行队列与并发可视化
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- batch98`); } };
const home = mkdtempSync(path.join(tmpdir(), 'b98-'));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home } });
console.log(`batch98-smoke（${home}）`);
run(['plugin', 'bundled']);

// 纯函数直测
const { batchCounts, batchCountsLabel, batchStateIcon } = await import(pathToFileURL(path.join(PKG_ROOT, 'web/extras.js')));

// ① batchCounts
check('① 全排队', JSON.stringify(batchCounts(['queued','queued'])) === JSON.stringify({total:2,done:0,running:0,queued:2,failed:0,ok:0}));
check('① 混合', batchCounts(['ok','running','fail','queued']).running === 1 && batchCounts(['ok','running','fail','queued']).failed === 1);
check('① 空表', batchCounts([]).total === 0);
check('① 缺项按 queued', batchCounts(['ok',undefined,'x']).queued === 2);

// ① label
check('① 进行中标签', batchCountsLabel(batchCounts(['ok','running','queued','queued'])) === '2 排队 / 1 并行 / 1 完成');
check('① 失败含入', batchCountsLabel(batchCounts(['ok','fail','running','queued','queued'])).includes('（含 1 失败）'));
check('① 全完成无失败', batchCountsLabel(batchCounts(['ok','ok'])) === '全部 2 项完成');
check('① 全完成有失败', batchCountsLabel(batchCounts(['ok','fail'])) === '全部 2 项完成（1 失败）');
check('① 空标签', batchCountsLabel(batchCounts([])) === '');

// ② 图标
check('② 四态图标', batchStateIcon('ok') === '✓' && batchStateIcon('fail') === '✗' && batchStateIcon('running') === '▸' && batchStateIcon('queued') === '·');

// ④ CLI --chain
{
  const r = run(['run', '--chain', 'sysinfo.overview,sysinfo.top']);
  const all = r.stdout + r.stderr;
  check('④ 两步都跑', all.includes('[1/2] sysinfo.overview') && all.includes('[2/2] sysinfo.top'));
  check('④ 读链 exit 0', r.status === 0);
  const r2 = run(['run', '--chain', 'sysinfo.overview,quick.b64']);
  check('④ 中途失败停链', (r2.stdout + r2.stderr).includes('链在第 2 步（quick.b64）失败'));
  check('④ 失败链 exit 非 0', r2.status !== 0);
  const r3 = run(['run', '--chain', 'sysinfo.overview']);
  check('④ 单步拒绝', (r3.stdout + r3.stderr).includes('至少要两个'));
  check('④ 单步 exit 2', r3.status === 2);
}

// ⑤ server batch-done 端点（起 server 实测）
{
  const tokenProbe = run(['ui', '--port', '0']); // 只是占位——实际起 server 用子进程
  void tokenProbe;
  // 起 server
  const { spawn } = await import('node:child_process');
  const srv = spawn(process.execPath, [CLI, 'ui', '--port', '29871'], { env: { ...process.env, ZEROKIT_HOME: home }, stdio: ['ignore','pipe','pipe'] });
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  await new Promise((res) => { const t = setTimeout(res, 4000); srv.stdout.on('data', () => { if (out.includes('29871')) { clearTimeout(t); res(); } }); });
  try {
    // 令牌：GET / 拿 HTML（__TOKEN__ 注入在 meta）——或先无 token 打 API 拿 403 后从 HTML 读
    const html = await (await fetch('http://127.0.0.1:29871/')).text();
    const tok = (html.match(/zk-token[^>]*content="([A-Za-z0-9]+)"/) ?? html.match(/content="([a-f0-9]{48})"/) ?? [])[1] ?? '';
    const r4 = await fetch('http://127.0.0.1:29871/api/batch-done', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zerokit-token': tok },
      body: JSON.stringify({ items: [ { plugin: 'sysinfo', action: 'overview', ok: true, ms: 12 }, { plugin: 'quick', action: 'b64', ok: false, ms: 3 } ] }),
    });
    const j = await r4.json().catch(() => ({}));
    check('⑤ batch-done 200', r4.status === 200 && j.ok === true);
    // 审计里能查到
    const logs = await fetch('http://127.0.0.1:29871/api/logs?q=batch_done&limit=5', { headers: { 'x-zerokit-token': tok } });
    const lj = await logs.json().catch(() => ({ entries: [] }));
    check('⑤ 审计含 batch_done', (lj.entries ?? []).some((e) => e.action === 'batch_done'));
    // 空项拒绝
    const r5 = await fetch('http://127.0.0.1:29871/api/batch-done', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-zerokit-token': tok }, body: '{"items":[]}',
    });
    check('⑤ 空项 400', r5.status === 400);
  } catch (e) {
    check('⑤ server 拉起', false);
    console.error(String(e).slice(0, 200));
  } finally { srv.kill(); }
}

// ⑦⑧ 静态断言（源码接线）
{
  const fs = await import('node:fs');
  const appjs = fs.readFileSync(path.join(PKG_ROOT, 'web/app.js'), 'utf8');
  check('⑦ 失败不中断（runOne then 落状态不断链）', appjs.includes("states[i] = r.ok ? 'ok' : 'fail'; paint(); return r;"));
  check('⑧ 空队列按钮禁用', appjs.includes("${batch.length ? '' : 'disabled'}"));
  check('⑧ runBatch 空守卫注释', appjs.includes('空队列守卫'));
  check('③ ps 面板批量提示', appjs.includes('ps-batch-note'));
  check('① 进度条挂载', appjs.includes("id = 'batchProgress'") || appjs.includes("prog.id = 'batchProgress'"));
  // ⑥ chunkWindows 复用（不是新写并发逻辑）
  check('⑥ 复用 chunkWindows', appjs.includes('chunkWindows(ordered.length, conc)'));
}

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
