// 裸 JSON-RPC 客户端：不依赖 MCP SDK，直接走 stdio 协议。
// 目的是独立验证「任何 AI 客户端都能拉起这个 server」这件事，
// 而不是只验证 SDK 和 SDK 之间能通。
import { spawn } from 'node:child_process';

const serverPath = process.argv[2];
const child = spawn(process.execPath, [serverPath, 'serve'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
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

  // 只读动作应当直接执行
  const call = await request('tools/call', { name: 'sysinfo__overview', arguments: {} });
  const text = call.result?.content?.[0]?.text ?? '';
  if (call.result?.isError !== true && text.includes('核心数')) {
    pass('tools/call 执行只读动作成功，返回真实数据');
  } else {
    fail('tools/call 失败：' + JSON.stringify(call).slice(0, 400));
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
  // 日志只应出现在 stderr；需要看的话加 ZEROKIT_VERBOSE=1
  if (stderrOut.trim() && process.env['ZEROKIT_VERBOSE']) {
    console.log('\n--- server stderr ---');
    console.log(stderrOut.trim().split('\n').slice(0, 6).join('\n'));
  }
}

// 和其它测试保持一致的统计行
console.log('\n' + '='.repeat(60));
console.log(`通过 ${passed} / ${passed + failed}`);