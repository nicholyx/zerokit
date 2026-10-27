// 裸 JSON-RPC 客户端：不依赖 MCP SDK，直接走 stdio 协议。
// 目的是独立验证「任何 AI 客户端都能拉起这个 server」这件事，
// 而不是只验证 SDK 和 SDK 之间能通。
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 自包含准备：临时数据目录 + 预装示例插件。
// 原来直接继承真实环境的 ~/.zerokit——本机装过插件就能过，CI 的全新
// runner 上它是空的，tools/list 于是返回空工具列表（实测踩过）。
const ROOT = path.resolve(import.meta.dirname, '..');
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'zerokit-mcp-smoke-'));
const setup = spawnSync(process.execPath, ['src/cli.ts', 'plugin', 'bundled'], {
  cwd: ROOT,
  env: { ...process.env, ZEROKIT_HOME: TMP_HOME },
  encoding: 'utf8', timeout: 60000, windowsHide: true,
});
if (setup.status !== 0) {
  console.log('FAIL  准备临时数据目录失败：'
    + `${setup.stderr || setup.stdout || ''}`.trim().slice(0, 300));
  console.log(`\n${'='.repeat(60)}\n通过 0 / 1`);
  process.exit(1);
}

const serverPath = process.argv[2];
const child = spawn(process.execPath, [serverPath, 'serve'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
  env: { ...process.env, ZEROKIT_HOME: TMP_HOME },
});

let stdoutBuf = '';
const pending = new Map();
let stderrOut = '';

child.stdout.on('data', (chunk) => {
  stdoutBuf += chunk.toString('utf8');
  let idx;
  // MCP stdio 是换行分隔的 JSON-RPC
  while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
    const line = stdoutBuf.slice(0, idx).trim();
    stdoutBuf = stdoutBuf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.log('!! stdout 里出现了非 JSON-RPC 内容：', line.slice(0, 200));
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});
child.stderr.on('data', (c) => { stderrOut += c.toString('utf8'); });

let nextId = 1;
function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} 超时`)), 20000);
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
function notify(method) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
}

let passed = 0;
let failed = 0;
const fail = (msg) => { failed++; console.log('FAIL  ' + msg); process.exitCode = 1; };
const pass = (msg) => { passed++; console.log('PASS  ' + msg); };

try {
  const init = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'raw-test', version: '1.0.0' },
  });
  if (init.result?.serverInfo?.name === 'zerokit') {
    pass(`initialize 握手成功，协商版本 ${init.result.protocolVersion}`);
  } else {
    fail('initialize 响应异常：' + JSON.stringify(init).slice(0, 300));
  }
  notify('notifications/initialized');

  const listed = await request('tools/list', {});
  const tools = listed.result?.tools ?? [];
  if (tools.length > 0) pass(`tools/list 返回 ${tools.length} 个工具`);
  else fail('tools/list 没返回工具');

  const names = tools.map((t) => t.name);
  console.log('      工具名：' + names.join(', '));

  // 工具名必须符合 MCP 规范：^[A-Za-z0-9._-]{1,128}$
  const badName = names.find((n) => !/^[A-Za-z0-9._-]{1,128}$/.test(n));
  if (badName) fail(`工具名 "${badName}" 不符合 MCP 命名规范`);
  else pass('所有工具名都符合 ^[A-Za-z0-9._-]{1,128}$');

  const sample = tools.find((t) => t.name === 'sysinfo__top');
  if (sample && sample.inputSchema?.type === 'object'
      && Object.keys(sample.inputSchema.properties ?? {}).length === 1) {
    pass('自动生成的 inputSchema 正确（sysinfo__top 有 1 个参数）');
    console.log('      inputSchema: ' + JSON.stringify(sample.inputSchema));
  } else {
    fail('inputSchema 不对：' + JSON.stringify(sample?.inputSchema));
  }

  const ann = tools.find((t) => t.name === 'proxy__auth')?.annotations;
  if (ann?.destructiveHint === true && ann?.readOnlyHint === false) {
    pass('高风险动作的 annotations 标注正确（destructiveHint=true）');
  } else {
    fail('annotations 不对：' + JSON.stringify(ann));
  }
  const readAnn = tools.find((t) => t.name === 'sysinfo__overview')?.annotations;
  if (readAnn?.readOnlyHint === true) pass('只读动作标注 readOnlyHint=true');
  else fail('只读动作 annotations 不对：' + JSON.stringify(readAnn));

  // ---- 第三十一轮：MCP 与 AI 协作面 ------------------------------------
  // ①描述模板化：描述里要出现参数说明与风险提示
  const descTop = sample?.description ?? '';
  if (descTop.includes('参数：') && descTop.includes('[插件')) {
    pass('①工具描述模板化（含参数说明与插件标注）');
    console.log('      desc: ' + descTop.slice(0, 140));
  } else {
    fail('①工具描述没有参数说明：' + descTop.slice(0, 140));
  }
  const descMut = tools.find((t) => t.name === 'proxy__auth')?.description ?? '';
  if (descMut.includes('高风险')) pass('①destructive 描述带高风险提示');
  else fail('①destructive 描述缺高风险提示：' + descMut.slice(0, 100));

  // ⑤_meta 透传：成功调用的 structuredContent 里有 risk/ms/plugin
  const callMeta = await request('tools/call', { name: 'sysinfo__overview', arguments: {} });
  const meta = callMeta.result?.structuredContent?._meta;
  if (meta?.risk === 'read' && typeof meta?.ms === 'number' && String(meta?.plugin ?? '').startsWith('sysinfo@')) {
    pass(`⑤_meta 透传（risk=${meta.risk}, ms=${meta.ms}, plugin=${meta.plugin}）`);
  } else {
    fail('⑤_meta 缺失：' + JSON.stringify(meta));
  }

  // ④补救提示：给坏参数的失败响应要带「建议：」
  const badCall = await request('tools/call', {
    name: 'sysinfo__top', arguments: { nope: 1 },
  });
  const badText = (badCall.result?.content ?? []).map((b) => b.text ?? '').join('\n');
  if (badCall.result?.isError === true && /建议：/.test(badText)) {
    pass('④失败响应附补救提示');
  } else {
    fail('④失败响应没有补救提示：' + badText.slice(0, 150));
  }

  // ⑥⑦CLI 侧：mcp tools 与 --json、allow --list（spawnSync，不走 server）
  const toolsCli = spawnSync(process.execPath, ['src/cli.ts', 'mcp', 'tools'], {
    cwd: ROOT, encoding: 'utf8', timeout: 60000, windowsHide: true,
    env: { ...process.env, ZEROKIT_HOME: TMP_HOME },
  });
  if (toolsCli.status === 0 && /个 MCP 工具/.test(toolsCli.stdout) && toolsCli.stdout.includes('⚠destructive')) {
    pass('⑥zkit mcp tools 人读格式（含风险标记）');
  } else {
    fail('⑥mcp tools 输出不对：' + toolsCli.stdout.slice(0, 150));
  }
  const toolsJson = spawnSync(process.execPath, ['src/cli.ts', 'mcp', 'tools', '--json'], {
    cwd: ROOT, encoding: 'utf8', timeout: 60000, windowsHide: true,
    env: { ...process.env, ZEROKIT_HOME: TMP_HOME },
  });
  let tj = null;
  try { tj = JSON.parse(toolsJson.stdout); } catch { /* 下面断言 */ }
  if (tj && tj.count === tools.length && Array.isArray(tj.tools) && tj.tools[0]?.inputSchema) {
    pass(`⑦mcp tools --json 机读格式（count=${tj.count} 与 server 一致）`);
  } else {
    fail('⑦mcp tools --json 解析失败或条数不一致');
  }

  // ⑧allow --list 带授权时间：先授权一个再查
  spawnSync(process.execPath, ['src/cli.ts', 'mcp', 'allow', 'clipboard.copy'], {
    cwd: ROOT, encoding: 'utf8', timeout: 60000, windowsHide: true,
    env: { ...process.env, ZEROKIT_HOME: TMP_HOME },
  });
  const allowList = spawnSync(process.execPath, ['src/cli.ts', 'mcp', 'allow', '--list'], {
    cwd: ROOT, encoding: 'utf8', timeout: 60000, windowsHide: true,
    env: { ...process.env, ZEROKIT_HOME: TMP_HOME },
  });
  if (allowList.status === 0 && allowList.stdout.includes('clipboard.copy')
      && /\d{4}-\d{2}-\d{2}T/.test(allowList.stdout)) {
    pass('⑧allow --list 显示动作与授权时间');
  } else {
    fail('⑧allow --list 输出不对：' + allowList.stdout.slice(0, 150));
  }

  // ⑨连击冷却：连续失败 3 次后要出现「连续失败」提示（用一个必失败的动作：
  // bad params ×3 触发同一条失败链路）
  let streakSeen = false;
  for (let i = 0; i < 3; i++) {
    const r = await request('tools/call', { name: 'sysinfo__top', arguments: { nope: i } });
    const t = (r.result?.content ?? []).map((b) => b.text ?? '').join('\n');
    if (/连续失败/.test(t)) streakSeen = true;
  }
  if (streakSeen) pass('⑨连续失败后响应附冷却建议');
  else fail('⑨连击 3 次没出现冷却提示');

  // 只读动作应当直接执行
  const call = await request('tools/call', { name: 'sysinfo__overview', arguments: {} });
  const text = call.result?.content?.[0]?.text ?? '';
  if (call.result?.isError !== true && text.includes('核心数')) {
    pass('tools/call 执行只读动作成功，返回真实数据');
  } else {
    fail('tools/call 失败：' + JSON.stringify(call).slice(0, 400));
  }

  // 组合动作：AI 面看到的是一整条链路（说明里讲清步骤、annotations 按链路声明）
  const brief = tools.find((t) => t.name === 'sysinfo__brief');
  if (brief && brief.annotations?.readOnlyHint === true
      && brief.annotations?.openWorldHint === false
      && /组合动作/.test(brief.description ?? '')) {
    pass('组合动作在 MCP 面正确暴露（说明含步骤、annotations 按声明）');
  } else {
    fail('组合动作的 MCP 工具不对：' + JSON.stringify(brief).slice(0, 400));
  }
  const briefCall = await request('tools/call', { name: 'sysinfo__brief', arguments: {} });
  const briefText = briefCall.result?.content?.[0]?.text ?? '';
  if (briefCall.result?.isError !== true && briefText.includes('内存')) {
    pass('组合动作经 tools/call 一次调用完成多步');
  } else {
    fail('组合动作调用失败：' + JSON.stringify(briefCall).slice(0, 400));
  }

  // 有副作用的动作，未经授权必须被拒（fail-closed）
  const blocked = await request('tools/call', {
    name: 'proxy__stop', arguments: {},
  });
  if (blocked.result?.isError === true && /zkit mcp allow/.test(blocked.result.content[0].text)) {
    pass('有副作用的动作默认被拒，并提示用户如何授权');
  } else {
    fail('有副作用动作没有被拦住：' + JSON.stringify(blocked).slice(0, 400));
  }

  // 参数校验：给个不存在的参数应报错
  const badArg = await request('tools/call', {
    name: 'sysinfo__top', arguments: { nope: 1 },
  });
  if (badArg.result?.isError === true) pass('未知参数被拒绝');
  else fail('未知参数没被拦住');

  // stdout 洁净度：任何日志都不能混进 stdout
  if (/^\[zerokit\]/m.test(stdoutBuf)) fail('stdout 里混进了日志（会导致握手失败）');
  else pass('stdout 保持洁净，日志都走了 stderr');
} catch (e) {
  fail('异常：' + e.message);
} finally {
  child.kill('SIGKILL');
  fs.rmSync(TMP_HOME, { recursive: true, force: true });
  // 日志只应出现在 stderr；需要看的话加 ZEROKIT_VERBOSE=1
  if (stderrOut.trim() && process.env['ZEROKIT_VERBOSE']) {
    console.log('\n--- server stderr ---');
    console.log(stderrOut.trim().split('\n').slice(0, 6).join('\n'));
  }
}

// 和其它测试保持一致的统计行
console.log('\n' + '='.repeat(60));
console.log(`通过 ${passed} / ${passed + failed}`);