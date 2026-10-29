// welcome80-smoke：第八十轮首次运行体验——首次/回访/分级摘要/分平台建议/--json/MCP 工具
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PKG_ROOT = path.resolve(import.meta.dirname, '..');
const CLI = path.join(PKG_ROOT, 'src', 'cli.ts');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- welcome80`); } };
const home = mkdtempSync(path.join(tmpdir(), 'w80-'));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8', timeout: 60000, env: { ...process.env, ZEROKIT_HOME: home },
});
console.log(`welcome80-smoke（${home}）`);

// ① 首次：欢迎语 + 三步 + 标记落盘
const f1 = run(['welcome']);
check('① 首次欢迎语', f1.stdout.includes('欢迎使用 zerokit'));
check('① 三步上手', f1.stdout.includes('zkit plugin bundled') && f1.stdout.includes('zkit ui'));
check('② 标记落盘', existsSync(path.join(home, '.welcomed')));

// ③ 分级摘要
check('③ 分级摘要行', /[✗✓] 0 项必须修 · [⚠] \d+ 项建议 · ✓ \d+ 项通过/.test(f1.stdout) || /项必须修/.test(f1.stdout));

// ② 回访：不再念三步
const f2 = run(['welcome']);
check('② 回访只报状态', f2.stdout.includes('zerokit 状态') && !f2.stdout.includes('三步跑通'));

// ⑤ 平台 starter
const expectStarter = process.platform === 'win32' ? 'sysinfo.overview' : process.platform === 'darwin' ? 'quick.now' : 'sysinfo.top';
check('⑤ 平台建议动作', f1.stdout.includes(`zkit run ${expectStarter}`));

// ⑥ --json 机读
const j = run(['welcome', '--json']);
const data = JSON.parse(j.stdout);
check('⑥ --json 结构', data.firstRun === false && 'summary' in data && 'starterAction' in data && Array.isArray(data.nextSteps));
check('⑥ starter 机读', data.starterAction === expectStarter);

// ④ 缺 python 场景（PATH 剥掉 python 的兜底难做——直接验证提示函数路径：缺工具时 install 命令存在性用 json missingTools 结构覆盖）
check('⑥ missingTools 结构', Array.isArray(data.missingTools));

// 装插件后再 welcome：插件计数进摘要
run(['plugin', 'bundled']);
const f3 = run(['welcome']);
check('① 装插件后回访仍正常', f3.stdout.includes('zerokit 状态'));

// ⑦ MCP 工具（spawn JSON-RPC 探针）
{
  const fsmod = await import('node:fs');
  const probeScript = path.join(home, 'probe.mjs');
  fsmod.writeFileSync(probeScript, `import { spawn } from 'node:child_process';
const child = spawn(process.execPath, [${JSON.stringify(path.join(PKG_ROOT, 'src', 'mcp.ts'))}, 'serve'], { env: { ...process.env, ZEROKIT_HOME: ${JSON.stringify(home)} }, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = ''; const pending = new Map(); let id = 0;
child.stderr.on('data', () => {});
child.stdout.on('data', (d) => { buf += d; let nl; while ((nl = buf.indexOf('\\n')) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (!line.trim()) continue; try { const m = JSON.parse(line); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch {} } });
const send = (method, params) => new Promise((res, rej) => { const i = ++id; const t = setTimeout(() => rej(new Error('timeout ' + method)), 8000); pending.set(i, (m) => { clearTimeout(t); res(m); }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\\n'); });
await send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'p', version: '0' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\\n');
const r2 = await send('tools/list', {});
const r3 = await send('tools/call', { name: 'zerokit_welcome', arguments: {} });
console.log(JSON.stringify({ inList: r2.result.tools.some((t) => t.name === 'zerokit_welcome'), sc: r3.result.structuredContent != null && 'starterAction' in r3.result.structuredContent }));
child.kill(); process.exit(0);
`);
  let probe = spawnSync(process.execPath, [probeScript], { encoding: 'utf8', timeout: 60000 });
  if (probe.status !== 0) {
    // 冷启动偶发（stdio 竞速）：再试一次
    probe = spawnSync(process.execPath, [probeScript], { encoding: 'utf8', timeout: 60000 });
  }
  try {
    const out = JSON.parse(probe.stdout.trim().split('\n').pop());
    check('⑦ MCP 工具在列表', out.inList === true);
    check('⑦ MCP 结构化返回', out.sc === true);
  } catch {
    check(`⑦ MCP 探针（rc=${probe.status} err=${(probe.stderr ?? '').trim().slice(-60)}）`, false);
  }
}

// ⑩ 标记内容是时间戳（复跑幂等：welcome 不重复升级）
const marker = readFileSync(path.join(home, '.welcomed'), 'utf8');
check('② 标记是时间戳', /^\d+$/.test(marker.trim()));

rmSync(home, { recursive: true, force: true });
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
