// 剪贴板历史插件的回归测试。
//
// 两条底线：
//   1. **绝不真的去监听剪贴板**。真起了监听就会往用户的真实剪贴板历史里写东西，
//      测试污染用户数据是不可接受的。所以这里只测纯逻辑（历史文件的读写、去重、
//      搜索），监听相关的部分最多验证到"脚本能起来、能干净退出"。
//   2. 剪贴板本身只在"被拒绝"的路径上触碰（copy 越界必须在动剪贴板之前就拒绝）。
//      全程没有一次成功的 Set-Clipboard。
//
// 全部在临时目录里跑，不碰正式环境、不联网。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const PKG_ROOT = path.resolve(import.meta.dirname, '..');
const PLUGIN_DIR = path.join(PKG_ROOT, 'plugins', 'clipboard');
process.env['ZEROKIT_HOME'] = path.join(os.tmpdir(), 'zerokit-clipboard-test');
const HOME = process.env['ZEROKIT_HOME'];
fs.rmSync(HOME, { recursive: true, force: true });

const { loadPlugin } = await import('../src/core/manifest.ts');
const { runAction } = await import('../src/core/runner.ts');
// 纯逻辑单独一套目录：它和下面走 runAction 的那份历史互不干扰
const { appendEntry, clearHistory, openHistory, readEntries, historyPath } =
  await import('../plugins/clipboard/history.mjs');

const DATA_DIR = path.join(HOME, 'data', 'clipboard');
const PURE_DIR = path.join(HOME, 'data', 'pure-history');

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   <- ' + String(detail).slice(0, 300)}`);
};

const loaded = loadPlugin(PLUGIN_DIR);
const plugin = loaded.plugin;
if (!plugin) {
  console.log('插件没通过校验，后面的测试没法进行：' + loaded.errors.join('; '));
  process.exit(1);
}
const action = (id) => plugin.actions.find((a) => a.id === id);
const run = (id, values) => runAction(plugin, action(id), { caller: 'cli', values });

// ---------------------------------------------------------------- 1. 清单

{
  check('清单通过 loadPlugin 校验', loaded.errors.length === 0, loaded.errors.join('; '));
  const ids = plugin.actions.map((a) => a.id);
  const want = ['list', 'search', 'copy', 'clear', 'watch-start', 'watch-stop'];
  check('动作齐全（list/search/copy/clear/watch-start/watch-stop）',
    want.every((id) => ids.includes(id)), ids.join(','));
  check('每个动作都显式声明了 risk',
    plugin.actions.every((a) => ['read', 'mutate', 'destructive'].includes(a.risk)),
    ids.map((id, i) => `${id}:${plugin.actions[i].risk}`).join(','));
  check('clear 是 destructive、watch-start/copy 是 mutate',
    action('clear').risk === 'destructive' && action('watch-start').risk === 'mutate'
    && action('copy').risk === 'mutate');

  // 这条是踩过的坑：services.ts 拼 [[service]].stop 的命令时拿 actions[0] 当模板，
  // 它不会覆盖 background 字段。第一个动作带 background 的话，停止命令会被当成
  // 后台任务拉起来——立刻返回、什么也没停。所以 actions[0] 必须是非后台动作。
  check('第一个动作不是后台动作（否则 service.stop 会失效）',
    plugin.actions[0].id === 'list' && plugin.actions[0].background !== true,
    `${plugin.actions[0].id} background=${plugin.actions[0].background}`);
}

// ---------------------------------------------------------------- 2. [[service]]

{
  const s = plugin.services[0];
  check('声明了恰好一个服务', plugin.services.length === 1, JSON.stringify(plugin.services.map((x) => x.id)));
  check('服务用 pidFile 检测（它不监听端口）',
    s?.pidFile === 'clipboard.pid' && s?.port === undefined,
    `pidFile=${s?.pidFile} port=${s?.port}`);
  // 停止命令里只能用 {node}/{python} 这类内置占位符，不能用参数占位符：
  // services.ts 拼这条命令时传的是**空的参数表**，参数占位符会被整段丢掉（buildArgv 的规则），
  // 命令就会少一个参数甚至跑空。
  const BUILTINS = ['python', 'node', 'git', 'plugin_dir', 'data_dir', 'home'];
  const tokens = (s?.stop ?? []).flatMap((x) => [...x.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]));
  check('服务给了 stop 命令，且只用了内置占位符（参数占位符会被丢掉）',
    Array.isArray(s?.stop) && s.stop.length > 0 && tokens.every((t) => BUILTINS.includes(t)),
    JSON.stringify(s?.stop) + ' tokens=' + JSON.stringify(tokens));
  const pidParam = action('watch-start').params.find((p) => p.name === 'pid_file');
  check('watch-start 的 pid_file 默认值与 service.pidFile 一致（两处漂移会检测不到监听）',
    pidParam?.default === s?.pidFile, `${pidParam?.default} vs ${s?.pidFile}`);
}

// ---------------------------------------------------------------- 3. list/search/clear（走 runAction）

{
  const r = await run('list', { limit: 20, full: false });
  check('历史文件还不存在时 list 返回空数组而不是报错',
    r.ok && Array.isArray(r.data) && r.data.length === 0,
    `ok=${r.ok} exit=${r.exitCode} stdout=${r.stdout.slice(0, 120)} err=${r.error ?? ''}`);
}

// 自己造历史（按时间正序落盘，和监听写入的顺序一致）
const LONG = 'line1\nline2\n' + 'y'.repeat(200);
const FIXTURE = [
  { at: '2026-10-09T01:00:00.000Z', length: 11, max_length: 32000, text: 'Hello World' },
  { at: '2026-10-09T02:00:00.000Z', length: 9, max_length: 32000, text: 'docker ps' },
  { at: '2026-10-09T03:00:00.000Z', length: LONG.length, max_length: 32000, text: LONG },
];
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync(historyPath(DATA_DIR), FIXTURE.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');

{
  const r = await run('list', { limit: 20, full: false });
  const rows = r.data ?? [];
  check('list 按时间倒序（最新的是第 1 条）',
    r.ok && rows.length === 3 && rows[0].index === 1 && rows[2].text === 'Hello World',
    JSON.stringify(rows.map((x) => [x.index, x.text.slice(0, 20)])));
  check('默认截断显示，且换行被折叠（否则表格会被撑坏）',
    rows[0].text.endsWith('…') && rows[0].text.includes('⏎') && rows[0].length === LONG.length,
    JSON.stringify(rows[0]?.text?.slice(0, 80)));

  const r2 = await run('list', { limit: 2, full: false });
  check('list 的 limit 生效（只回最近 2 条）',
    r2.ok && r2.data.length === 2 && r2.data[1].text === 'docker ps',
    JSON.stringify(r2.data?.map?.((x) => x.text)));

  const r3 = await run('list', { limit: 20, full: true });
  check('full=true 时不截断，拿到完整原文',
    r3.ok && r3.data[0].text === LONG, JSON.stringify((r3.data?.[0]?.text ?? '').slice(0, 40)));
}

{
  const r = await run('search', { keyword: 'HELLO', limit: 20 });
  check('search 大小写不敏感（搜 HELLO 命中 Hello World）',
    r.ok && r.data.length === 1 && r.data[0].text === 'Hello World', JSON.stringify(r.data));
  check('搜索结果带上 list 里的序号（可以直接 copy 回去）',
    r.ok && r.data[0].index === 3, JSON.stringify(r.data?.[0]));

  const r2 = await run('search', { keyword: 'y', limit: 1 });
  check('search 的 limit 生效', r2.ok && r2.data.length === 1, JSON.stringify(r2.data?.length));

  const r3 = await run('search', {});
  check('search 不给关键词会被拒（非 0 退出 + 提示）',
    !r3.ok && r3.exitCode === 1 && /关键词/.test(r3.stderr), `exit=${r3.exitCode} err=${r3.stderr}`);
}

// 越界必须在碰剪贴板之前就被拒绝——测试里唯一敢调 copy 的场景
{
  const r = await run('copy', { index: 99 });
  check('copy 下标越界被拒（非 0 退出，且没有去动剪贴板）',
    !r.ok && r.exitCode === 1 && /越界/.test(r.stderr), `exit=${r.exitCode} err=${r.stderr}`);
  const r2 = await run('copy', { index: 0 });
  check('copy 下标 0 也被拒（序号从 1 开始）', !r2.ok && /越界/.test(r2.stderr), r2.stderr);
}

{
  const r = await run('clear', {});
  check('clear 能清空历史并报告删了几条',
    r.ok && /3/.test(r.stdout) && !fs.existsSync(historyPath(DATA_DIR)), r.stdout + r.error);
  const r2 = await run('list', { limit: 20, full: false });
  check('清空后 list 返回空数组', r2.ok && Array.isArray(r2.data) && r2.data.length === 0,
    JSON.stringify(r2.data));
}

// ---------------------------------------------------------------- 4. 去重 / 条数上限（纯逻辑）

{
  check('连续相同的内容不重复记（第二次 added=false）',
    appendEntry(PURE_DIR, 'A').added === true
    && appendEntry(PURE_DIR, 'A').added === false
    && readEntries(PURE_DIR).entries.length === 1,
    JSON.stringify(readEntries(PURE_DIR).entries.map((e) => e.text)));

  check('A→B→A 这种来回复制要记两条 A（不是全局去重）',
    appendEntry(PURE_DIR, 'B').added === true && appendEntry(PURE_DIR, 'A').added === true
    && readEntries(PURE_DIR).entries.map((e) => e.text).join(',') === 'A,B,A',
    JSON.stringify(readEntries(PURE_DIR).entries.map((e) => e.text)));

  check('空内容不记（读到半截/复制图片都会是空串）',
    appendEntry(PURE_DIR, '').added === false && readEntries(PURE_DIR).entries.length === 3);
}

{
  const CAP_DIR = path.join(HOME, 'data', 'cap');
  const log = openHistory(CAP_DIR, { maxEntries: 3, maxLength: 32000 });
  for (const t of ['1', '2', '3', '4', '5']) log.append(t);
  const kept = readEntries(CAP_DIR).entries;
  check('超过条数上限后只保留最近 N 条，且是最新的那几条',
    kept.length === 3 && kept.map((e) => e.text).join(',') === '5,4,3',
    JSON.stringify(kept.map((e) => e.text)));
  check('紧凑后文件里就是 3 行（不多留缓冲行）',
    fs.readFileSync(historyPath(CAP_DIR), 'utf8').trim().split('\n').length === 3);

  const TRUNC_DIR = path.join(HOME, 'data', 'trunc');
  const long = 'z'.repeat(50);
  appendEntry(TRUNC_DIR, long, { maxLength: 10 });
  const e0 = readEntries(TRUNC_DIR).entries[0];
  check('超长文本按上限截断，但 length 记的是原文长度',
    e0.text.length === 10 && e0.length === 50 && e0.truncated === true,
    JSON.stringify({ text: e0.text, length: e0.length, truncated: e0.truncated }));
}

// ---------------------------------------------------------------- 5. 监听：只验证"能起来、能干净退出"

{
  const ps1 = path.join(PLUGIN_DIR, 'watch.ps1');
  check('watch.ps1 存在', fs.existsSync(ps1), ps1);
  // 全中文注释的文件必须带 BOM：PowerShell 5.1 无 BOM 时按 GBK 解，
  // 中文注释会变成乱码字节并触发看不懂的语法错（这条断言就是防它被改回去）。
  const head = fs.readFileSync(ps1).subarray(0, 3);
  check('watch.ps1 是 UTF-8 with BOM（否则 PowerShell 5.1 会把中文注释读乱）',
    head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf,
    [...head].map((b) => b.toString(16)).join(' '));

  // -MaxIterations 1：起来、轮询一轮、立刻退出。这样能验证脚本本身没语法/路径错误，
  // 又不会留下任何常驻进程，也不会往历史里写东西（启动时会先"预热"当前剪贴板）。
  const proc = spawnSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1,
    '-IntervalMs', '50', '-MaxIterations', '1', '-ParentPid', String(process.pid),
  ], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  check('轮询脚本能启动并立刻退出（退出码 0）', proc.status === 0,
    `status=${proc.status} stderr=${(proc.stderr ?? '').slice(0, 200)}`);
  check('这一轮预热不产生任何记录（不会把启动前剪贴板里的旧内容记一遍）',
    (proc.stdout ?? '').trim() === '', JSON.stringify((proc.stdout ?? '').slice(0, 120)));

  // 已在运行时必须拒绝启动：pid 文件里放本测试进程的 PID（它肯定是活的）。
  // 这条同时证明了 watch-start 在"拒绝"路径上不会去拉起 powershell。
  const pidFile = path.join(HOME, 'fake-watcher.pid');
  fs.writeFileSync(pidFile, String(process.pid), 'utf8');
  const guard = spawnSync(process.execPath, [
    path.join(PLUGIN_DIR, 'clipboard.mjs'), 'watch-start', DATA_DIR, pidFile, '5', '100', '100',
  ], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  check('监听已经在跑时 watch-start 拒绝重复启动',
    guard.status === 1 && /已经在运行/.test(guard.stderr ?? ''),
    `status=${guard.status} stderr=${(guard.stderr ?? '').slice(0, 160)}`);
  check('拒绝时不会动别人的 pid 文件（也不留常驻进程）',
    fs.readFileSync(pidFile, 'utf8').trim() === String(process.pid)
    && !fs.existsSync(path.join(DATA_DIR, 'history.jsonl')),
    fs.readFileSync(pidFile, 'utf8'));
  fs.rmSync(pidFile, { force: true });
}

{
  // 监听进程那一层的粘合代码：pid 文件生命周期、行协议解析、落盘去重。
  // 用一个"假轮询器"（ZK_CLIPBOARD_POLLER）顶替 watch.ps1——它不碰剪贴板，
  // 只是说"我看到了这几条内容"，于是这一层能在完全不污染用户剪贴板的前提下被测到。
  const fake = path.join(HOME, 'fake-poller.mjs');
  fs.writeFileSync(fake, `
import fs from 'node:fs';
// 轮询器起来时 pid 文件必须已经写好，而且里面的 PID 得是活的
const pidFile = process.env.ZK_CLIPBOARD_TEST_PIDFILE;
const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
process.stderr.write('PROBE pidfile=' + pid + ' alive=' + (pid === process.ppid) + '\\n');
process.stdout.write(JSON.stringify({ text: '甲' }) + '\\n');
process.stdout.write(JSON.stringify({ text: '甲' }) + '\\n');   // 连续重复：应当被丢掉
process.stdout.write(JSON.stringify({ text: '乙' }) + '\\n');
`, 'utf8');

  const runDir = path.join(HOME, 'data', 'supervisor');
  const pidFile = path.join(HOME, 'supervisor.pid');
  const r = spawnSync(process.execPath, [
    path.join(PLUGIN_DIR, 'clipboard.mjs'), 'watch-start', runDir, pidFile, '50', '100', '100',
  ], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
    env: { ...process.env, ZK_CLIPBOARD_POLLER: fake, ZK_CLIPBOARD_TEST_PIDFILE: pidFile },
  });
  const entries = readEntries(runDir).entries;
  check('监听进程把轮询器给的每一行解析后落盘（连续重复的丢掉）',
    r.status === 0 && entries.length === 2 && entries.map((e) => e.text).join(',') === '乙,甲',
    `status=${r.status} entries=${JSON.stringify(entries.map((e) => e.text))} err=${r.stderr.slice(0, 200)}`);
  check('拉起轮询器之前就写好了 pid 文件，里面是监听进程自己的 PID',
    /PROBE pidfile=\d+ alive=true/.test(r.stderr), JSON.stringify(r.stderr.slice(0, 200)));
  check('轮询器退出后监听跟着退出，并把 pid 文件收干净',
    !fs.existsSync(pidFile), fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8') : '');
  check('「运行中」的实时输出里能看见它在工作',
    /监听已启动/.test(r.stdout) && /\+1 字/.test(r.stdout), JSON.stringify(r.stdout.slice(0, 200)));
  fs.rmSync(fake, { force: true });
}

{
  // 插件目录里不该留下任何运行期产物（pid 文件、历史文件）
  check('插件目录没被写脏（没有 clipboard.pid / history.jsonl 残留）',
    !fs.existsSync(path.join(PLUGIN_DIR, 'clipboard.pid'))
    && !fs.existsSync(path.join(PLUGIN_DIR, 'history.jsonl')));
  check('clearHistory 对不存在的文件也安全（返回 0 条）',
    clearHistory(PURE_DIR).removed === 3, JSON.stringify(clearHistory(PURE_DIR)));
}

console.log('\n' + '='.repeat(60));
const failed = results.filter(([, ok]) => !ok).map(([n]) => n);
console.log(`通过 ${results.length - failed.length} / ${results.length}`);
if (failed.length) console.log('失败：' + failed.join(', '));
process.exit(failed.length ? 1 : 0);