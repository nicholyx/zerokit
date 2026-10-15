// 系统代理的回归测试。
//
// 这个文件存在的理由值得写清楚：**原来的实现是"静默失效"的**。
// Node 22 上 `fetch(url, { proxy })` 的 proxy 选项会被直接丢弃——代理指向
// 一个根本不存在的端口，请求照样直连成功。也就是说使用者配了代理，
// 流量却绕过代理打到了目标站，而**没有任何地方会报错**。
//
// 所以这里的测试不能只断言"没抛异常"，必须证明流量**真的经过了代理进程**：
// 用本地假代理计数，并且故意把它指向一个黑洞端口——如果没走代理，
// 第二组用例会"成功"而不是失败，测试就会红。
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '   <- ' + String(detail).slice(0, 300)}`);
};

// 隔离：settings.ts 会读 ~/.zerokit/config.toml，别让开发机上的真实配置影响断言
process.env['ZEROKIT_HOME'] = fs.mkdtempSync(path.join(os.tmpdir(), 'zerokit-proxy-test-'));
// 环境变量是"进程级"的，先清干净，每条用例自己设
for (const k of ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY',
  'all_proxy', 'ALL_PROXY', 'no_proxy', 'NO_PROXY']) {
  delete process.env[k];
}

const { proxyFor, proxyFetch, matchNoProxy } = await import('../src/core/proxy.ts');

// ---------- 假源站：http 与 https（自签）各一个 ----------

const httpOrigin = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      via: 'direct', method: req.method, url: req.url,
      auth: req.headers['authorization'] ?? null, body,
    }));
  });
});
await new Promise((r) => httpOrigin.listen(0, '127.0.0.1', r));
const ORIGIN = `127.0.0.1:${httpOrigin.address().port}`;

// 源站也顺手记一笔"有没有直接被打到"，用于确认代理确实在中间
let originHits = 0;
httpOrigin.on('request', () => { originHits += 1; });

// ---------- 一个真代理：http 请求转发 + https 走 CONNECT ----------

let connects = 0;       // CONNECT 次数
let forwards = 0;       // http 转发次数
const seenOnProxy = []; // 代理侧看到的请求行，用来证明转发方向

const proxySrv = http.createServer((req, res) => {
  // http 目标的转发路径
  forwards += 1;
  seenOnProxy.push(`${req.method} ${req.url}`);
  if (req.headers['proxy-authorization'] !== undefined) {
    seenOnProxy.push(`proxy-authorization: ${req.headers['proxy-authorization']}`);
  }
  const target = new URL(req.url);
  const up = http.request({
    host: target.hostname, port: target.port, path: target.pathname + target.search,
    method: req.method, headers: { ...req.headers, host: target.host },
  }, (upRes) => {
    res.writeHead(upRes.statusCode, upRes.headers);
    upRes.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502); res.end(String(e.message)); });
  req.pipe(up);
});
proxySrv.on('connect', (req, clientSocket, head) => {
  connects += 1;
  seenOnProxy.push(`CONNECT ${req.url}`);
  const [host, port] = req.url.split(':');
  const upstream = net.connect(Number(port || 443), host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head?.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => upstream.destroy());
});
await new Promise((r) => proxySrv.listen(0, '127.0.0.1', r));
const PROXY = `http://127.0.0.1:${proxySrv.address().port}`;

// 一个"装死"的服务器：接受连接、什么也不回。用来验证超时路径，
// 以及"没走代理就会挂"——因为黑洞端口上没有任何东西能应答。
const blackholeSockets = new Set();
const blackhole = net.createServer((s) => {
  blackholeSockets.add(s);
  s.on('close', () => blackholeSockets.delete(s));
  /* 故意什么都不做 */
});
await new Promise((r) => blackhole.listen(0, '127.0.0.1', r));
const DEAD = `http://127.0.0.1:${blackhole.address().port}`;

// ---------- 1. no_proxy 匹配规则 ----------
{
  check('no_proxy 条目精确命中', matchNoProxy('example.com', 'example.com') === true);
  check('no_proxy 后缀命中（.example.com）', matchNoProxy('a.example.com', '.example.com') === true);
  check('no_proxy 不带前导点的后缀也命中', matchNoProxy('a.example.com', 'example.com') === true);
  check('no_proxy 不该误伤同前缀域名', matchNoProxy('notexample.com', 'example.com') === false);
  check('no_proxy 带端口也能命中', matchNoProxy('example.com:8080', 'example.com') === true);
  check('no_proxy 忽略大小写与空白', matchNoProxy('EXAMPLE.com', ' example.com , foo ') === true);
  check('no_proxy = * 表示全都不走', matchNoProxy('anything.test', '*') === true);
  check('没配 no_proxy 时不拦', matchNoProxy('example.com', undefined) === false);
}

// ---------- 2. 代理配置的来源与优先级 ----------
{
  delete process.env['http_proxy'];
  delete process.env['https_proxy'];
  check('没配任何代理时返回 undefined（= 走原生 fetch，行为与改动前一致）',
    proxyFor(new URL('http://example.com/')) === undefined);

  process.env['http_proxy'] = PROXY;
  const got = proxyFor(new URL('http://example.com/x'));
  check('环境变量 http_proxy 被识别', got?.url === PROXY, JSON.stringify(got));
  check('来源被标注成环境变量名，便于报错时指路', /http_proxy/.test(got?.origin ?? ''), got?.origin);

  process.env['no_proxy'] = 'example.com';
  check('no_proxy 优先于 proxy（惯例，也是使用者预期）',
    proxyFor(new URL('http://example.com/x')) === undefined);
  check('no_proxy 只对命中的主机生效',
    proxyFor(new URL('http://other.test/x'))?.url === PROXY);

  // 代理 URL 里带 user:pass：认证要摘出来单独走头，别留在 URL 里（会泄进错误信息）
  delete process.env['no_proxy'];
  process.env['http_proxy'] = `http://user:p%40ss@127.0.0.1:${proxySrv.address().port}`;
  const withAuth = proxyFor(new URL('http://example.com/x'));
  check('代理 URL 里的 user:pass 被摘成 auth 字段', withAuth?.auth === 'user:p@ss', withAuth?.auth);
  check('摘掉认证后的 url 里不再含密码',
    withAuth?.url !== undefined && !withAuth.url.includes('p%40ss'), withAuth?.url);

  process.env['https_proxy'] = 'http://env-https.test:8080';
  check('https 目标优先取 https_proxy 而不是 http_proxy',
    /env-https/.test(proxyFor(new URL('https://example.com/'))?.url ?? ''));
  check('http 目标仍然取 http_proxy',
    /127\.0\.0\.1/.test(proxyFor(new URL('http://example.com/'))?.url ?? ''));

  delete process.env['http_proxy'];
  delete process.env['https_proxy'];

  // 显式 override：测试与将来的 --no-proxy 用得上
  check('传 null 表示强制直连',
    proxyFor(new URL('http://example.com/'), null) === undefined);
  const forced = { url: PROXY, origin: '显式指定' };
  check('显式 override 优先于环境变量',
    proxyFor(new URL('http://example.com/'), forced)?.origin === '显式指定');
}

// ---------- 3. http 目标：真的经代理转发 ----------
{
  const before = forwards;
  const res = await proxyFetch(`http://${ORIGIN}/hello?q=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
    body: JSON.stringify({ n: 1 }),
  }, { url: PROXY, origin: '测试' });

  check('http 目标经代理返回 200', res.status === 200, `status=${res.status}`);
  const body = JSON.parse(await res.text());
  check('代理进程确实收到了这次转发（这是本文件的核心断言）',
    forwards === before + 1 && seenOnProxy.some((s) => s.startsWith('POST http://')),
    `forwards=${forwards - before} seen=${JSON.stringify(seenOnProxy.slice(-2))}`);
  check('转发用的是 absolute-form 请求行（RFC 7230 对 http 代理的要求）',
    seenOnProxy.some((s) => s.startsWith(`POST http://${ORIGIN}/hello?q=1`)),
    JSON.stringify(seenOnProxy.slice(-3)));
  check('业务头（authorization / content-type）原样送达源站',
    body.auth === 'Bearer tok', JSON.stringify(body));
  check('请求体原样送达', body.body === '{"n":1}', body.body);
  check('代理不会把 absolute-form 的完整 URL 当成路径丢给源站',
    body.url === '/hello?q=1', body.url);
}

// ---------- 4. https 目标：走 CONNECT 隧道 ----------
//
// 这条用"隧道建立失败"来证明流量确实到了代理：假代理对不存在的主机会连不上，
// 于是我们必须拿到一个明确的错误；如果实现是直连的，这里会因为 DNS 失败
// 而报出完全不同的错误（或者更糟——静默成功）。
{
  const before = connects;
  let err = '';
  try {
    await proxyFetch('https://nonexistent-host-zkit-test.invalid/x', {
      method: 'GET', connectTimeoutMs: 8000,
    }, { url: PROXY, origin: '测试' });
  } catch (e) {
    err = e.message;
  }
  check('https 目标会先向代理发 CONNECT', connects === before + 1,
    `connects=${connects - before} err=${err}`);
  check('隧道建不起来时给出明确错误（而不是当成直连失败）',
    err.length > 0, err);
  check('错误信息里带上代理地址，方便定位', err.includes(PROXY), err);
}

// ---------- 5. 代理不通时的报错要能看懂 ----------
{
  let err = '';
  try {
    await proxyFetch(`http://${ORIGIN}/x`, { method: 'GET', connectTimeoutMs: 1200 },
      { url: DEAD, origin: '测试' });
  } catch (e) {
    err = e.message;
  }
  // 黑洞端口会连上但不应答 → 必须超时，且错误里要指明"是代理的问题"
  check('代理不应答时报超时而不是静默成功', /超时/.test(err), err);
  check('超时错误指向代理，而不是让使用者去怀疑目标站',
    err.includes(DEAD), err);
}

// ---------- 6. 连不上代理（ECONNREFUSED）要说人话 ----------
{
  // 占一个端口再立刻关掉，拿到一个"确定没人监听"的端口号
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  await new Promise((r) => srv.close(r));

  let err = '';
  try {
    await proxyFetch(`http://${ORIGIN}/x`, { method: 'GET' },
      { url: `http://127.0.0.1:${port}`, origin: '测试' });
  } catch (e) {
    err = e.message;
  }
  check('代理没在运行时报错里点明这一点',
    /ECONNREFUSED/.test(err) && /代理没在运行|端口写错/.test(err), err);
}

// ---------- 7. 407：代理要求认证 ----------
{
  const needAuth = http.createServer((_req, res) => {
    res.writeHead(407, { 'proxy-authenticate': 'Basic realm="x"' });
    res.end('no');
  });
  await new Promise((r) => needAuth.listen(0, '127.0.0.1', r));
  const authProxy = `http://127.0.0.1:${needAuth.address().port}`;

  // http 目标下 407 是**普通响应**（不是隧道拒绝），会原样返回给调用方。
  // 这里确认它没被当成成功、状态码没被吞掉——runner 那边会按 !res.ok 报 HTTP 407。
  const res = await proxyFetch(`http://${ORIGIN}/x`, { method: 'GET' },
    { url: authProxy, origin: '测试' });
  check('http 目标下 407 原样返回（不被当成功，状态码不被吞）',
    res.status === 407 && res.ok === false, `status=${res.status} ok=${res.ok}`);
  check('Proxy-Authenticate 这类逐跳头不透给调用方',
    res.headers.get('proxy-authenticate') === null,
    String(res.headers.get('proxy-authenticate')));

  // https 目标下 407 发生在 CONNECT 阶段，必须翻成人话
  let err = '';
  try {
    await proxyFetch('https://example.com/x', { method: 'GET', connectTimeoutMs: 2000 },
      { url: authProxy, origin: '测试' });
  } catch (e) {
    err = e.message;
  }
  check('https 目标下隧道被 407 拒绝时翻译成「代理要认证」',
    /407/.test(err) && /认证/.test(err), err);

  await new Promise((r) => needAuth.close(r));
}

// ---------- 8. 代理认证头真的发出去了 ----------
{
  seenOnProxy.length = 0;
  await proxyFetch(`http://${ORIGIN}/auth`, { method: 'GET' },
    { url: PROXY, origin: '测试', auth: 'bob:secret' });
  const expected = `Basic ${Buffer.from('bob:secret').toString('base64')}`;
  check('配置了 auth 时会带 Proxy-Authorization',
    seenOnProxy.includes(`proxy-authorization: ${expected}`),
    JSON.stringify(seenOnProxy));
}

// ---------- 9. 黑洞端口：不改代理就一定失败 ----------
//
// 这是防"静默退化"的那道闸：如果哪天有人把代理分支删掉、退回到
// `fetch(url, {proxy})`，这条会变成"直连黑洞端口"→ 超时 → 仍然失败，
// 所以它单独立不住；真正立得住的是第 3 条（计数）。这里测的是
// proxyFetch 本身不会把代理参数吞掉。
{
  let failed = false;
  let err = '';
  try {
    await proxyFetch(`http://${ORIGIN}/x`, { method: 'GET', connectTimeoutMs: 1200 },
      { url: DEAD, origin: '测试' });
  } catch (e) {
    failed = true;
    err = e.message;
  }
  check('把请求交给黑洞代理会失败（证明请求确实交给了代理）', failed, err);
}

// ---------- 10. 与改动前行为一致：没配代理时不碰网络栈 ----------
{
  delete process.env['http_proxy'];
  delete process.env['https_proxy'];
  delete process.env['all_proxy'];
  const before = originHits;
  // 直连（模拟 runner 在 proxyFor 返回 undefined 时走原生 fetch）
  const r = await fetch(`http://${ORIGIN}/direct`);
  check('没配代理时原生 fetch 依然直连成功', r.status === 200);
  check('源站确实被直接打到（说明上面的探针有效）', originHits > before);
}

// ---------- 收尾 ----------
// 黑洞服务器上还挂着超时用例留下的连接，close() 会一直等它们。
// 先记下所有连接，收尾时逐个销毁，否则 setTimeout 没得等、进程也不退。
await new Promise((r) => {
  for (const s of blackholeSockets) s.destroy();
  blackhole.close(() => r());
});
await new Promise((r) => proxySrv.close(r));
await new Promise((r) => httpOrigin.close(r));
fs.rmSync(process.env['ZEROKIT_HOME'], { recursive: true, force: true });

console.log('\n' + '='.repeat(60));
const failed = results.filter(([, ok]) => !ok).map(([n]) => n);
console.log(`通过 ${results.length - failed.length} / ${results.length}`);
if (failed.length) console.log('失败：' + failed.join(', '));
process.exit(failed.length ? 1 : 0);
