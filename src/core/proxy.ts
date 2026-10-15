import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import { CONFIG_PATH } from './paths.ts';

/**
 * 走系统代理。
 *
 * 为什么需要这个文件，而不是给 fetch 传个参数就好：
 * **Node 22 上 fetch 的 proxy 选项是被静默丢弃的。** 实测（Node v22.21.1 /
 * 内嵌 undici 6.22.0，用「只建立连接、不回应」的黑洞代理探测——若真走了代理
 * 必然挂到超时）：
 *
 *   fetch(url, { proxy: 'http://127.0.0.1:PORT' })   → 忽略，代理指向不存在的端口也照样直连成功
 *   NODE_USE_ENV_PROXY=1 + http_proxy/https_proxy    → 忽略，直连成功
 *   --use-env-proxy + HTTPS_PROXY                    → 忽略，CONNECT 次数 = 0
 *
 * 对照实验说明探测有效：dispatcher 传垃圾值会立刻 TypeError（undici 会校验它），
 * 而 proxy 传 12345、传 null 都毫无反应。**静默失效比报错更危险**——使用者设了代理，
 * 请求却直连出去，等于把本该经代理的流量直接打到了目标站。
 *
 * 所以这里自己实现：https 目标走 CONNECT 隧道，http 目标走代理转发。
 * 零第三方依赖（仓库硬规则：无构建步骤），且**没配代理时行为与改动前完全一致**。
 *
 * 缺口的边界：plugin add / update 走 spawnSync('git')，git 自己认代理，本来就没问题；
 * 受影响的只有 Node fetch 这两处（type = "http" 动作、AI 工作台的 OpenAI 兼容端点）。
 */

/** 连接/隧道阶段的默认上限 */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * proxyFetch 的额外选项。
 *
 * 挂在 init 上而不是单开一个参数，是为了让它同时满足两个签名约束：
 * 既能直接喂给 `fetch(input, init)`，又能被 proxyFetch 读出连接阶段的上限。
 */
export interface ProxyFetchInit extends RequestInit {
  /** 连接代理 / 建立隧道的超时，毫秒。不传按 60 秒 */
  connectTimeoutMs?: number;
}

/** 代理配置。没有配置时为 undefined，调用方据此走原生 fetch。 */
export interface ProxyConfig {
  /** 代理地址，例如 http://127.0.0.1:7890 */
  url: string;
  /** 代理需要的 Basic 认证（user:pass），undefined = 不需要 */
  auth?: string;
  /** 来源描述，给错误信息用（"环境变量 https_proxy" / "config.toml 的 [proxy] 段"） */
  origin: string;
}

/**
 * 判断主机是否命中 no_proxy。
 *
 * 惯例：逗号分隔的域名 / 后缀 / IP / `*`。`*` = 全不走代理。
 * 匹配按 curl 的语义：与主机相等，或以 `.条目` 结尾；条目本身带前导点时
 * 直接按后缀比（`example.com` 与 `.example.com` 两种写法使用者都在用）。
 */
export function matchNoProxy(host: string, noProxy: string | undefined): boolean {
  if (!noProxy) return false;
  const h = host.toLowerCase().replace(/:\d+$/, '');
  for (const raw of noProxy.split(',')) {
    const entry = raw.trim().toLowerCase().replace(/:\d+$/, '');
    if (!entry) continue;
    if (entry === '*') return true;
    if (h === entry) return true;
    if (entry.startsWith('.') ? h.endsWith(entry) : h.endsWith(`.${entry}`)) return true;
  }
  return false;
}

/** 从环境变量取代理。https 目标优先 https_proxy，http 目标优先 http_proxy。 */
function fromEnv(target: URL): { url: string; key: string } | undefined {
  const httpsProxy = process.env['https_proxy'] || process.env['HTTPS_PROXY'];
  const httpProxy = process.env['http_proxy'] || process.env['HTTP_PROXY'];
  const allProxy = process.env['all_proxy'] || process.env['ALL_PROXY'];

  if (target.protocol === 'https:') {
    if (httpsProxy) return { url: httpsProxy, key: 'https_proxy' };
    if (httpProxy) return { url: httpProxy, key: 'http_proxy' };
    if (allProxy) return { url: allProxy, key: 'all_proxy' };
  } else {
    if (httpProxy) return { url: httpProxy, key: 'http_proxy' };
    if (allProxy) return { url: allProxy, key: 'all_proxy' };
    if (httpsProxy) return { url: httpsProxy, key: 'https_proxy' };
  }
  return undefined;
}

/** 读取 config.toml 的 [proxy] 段。只认 url / no_proxy 两个键。 */
function fromConfigFile(): { url: string; noProxy?: string } {
  let text: string;
  try {
    text = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch {
    return { url: '' };
  }
  let inProxy = false;
  let url = '';
  let noProxy: string | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const sec = /^\[([^\]]+)\]$/.exec(line);
    if (sec) {
      inProxy = sec[1]!.trim() === 'proxy';
      continue;
    }
    if (!inProxy) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (k === 'url') url = v;
    else if (k === 'no_proxy') noProxy = v;
  }
  return { url, noProxy };
}

/** 代理 URL 里带 user:pass 就摘出来（认证走 Proxy-Authorization 头，不吃 URL 里的） */
function userInfoOf(proxyUrl: string): string | undefined {
  try {
    const u = new URL(proxyUrl);
    if (!u.username) return undefined;
    return `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`;
  } catch {
    return undefined;
  }
}

/** 去掉代理 URL 里的 user:pass，避免它出现在错误信息里 */
function stripAuth(proxyUrl: string): string {
  try {
    const u = new URL(proxyUrl);
    if (!u.username) return proxyUrl;
    u.username = '';
    u.password = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return proxyUrl;
  }
}

/**
 * 解析出「这个 URL 该走哪个代理」。返回 undefined = 直连。
 *
 * 优先级：显式 override（传 null 表示强制直连，测试用）→ 环境变量 → config.toml。
 * **no_proxy 优先于 proxy**，这是惯例，也是使用者的预期。
 */
export function proxyFor(target: URL, override?: ProxyConfig | null): ProxyConfig | undefined {
  if (override === null) return undefined;
  if (override) return override;

  if (matchNoProxy(target.hostname, process.env['no_proxy'] || process.env['NO_PROXY'])) {
    return undefined;
  }

  const env = fromEnv(target);
  if (env) {
    const auth = userInfoOf(env.url);
    return { url: stripAuth(env.url), origin: `环境变量 ${env.key}`, ...(auth ? { auth } : {}) };
  }

  const cfg = fromConfigFile();
  if (cfg.url && !matchNoProxy(target.hostname, cfg.noProxy)) {
    const auth = userInfoOf(cfg.url);
    return {
      url: stripAuth(cfg.url), origin: 'config.toml 的 [proxy] 段',
      ...(auth ? { auth } : {}),
    };
  }
  return undefined;
}

function proxyAuthHeader(auth: string | undefined): Record<string, string> {
  if (!auth) return {};
  return { 'proxy-authorization': `Basic ${Buffer.from(auth).toString('base64')}` };
}

/** 代理自身的连接参数 */
function proxyTarget(proxy: ProxyConfig): { host: string; port: number; secure: boolean } {
  const u = new URL(proxy.url);
  const secure = u.protocol === 'https:';
  return { host: u.hostname, port: Number(u.port || (secure ? 443 : 80)), secure };
}

/**
 * 经代理发一次请求，返回**标准 Response**。
 *
 * 返回 Response 而不是自己解析协议，是为了让调用方（runHttpAction / openai.ts）
 * 继续用 res.ok / res.status / res.text() / res.body 那一套——**代理是否启用，
 * 对上面的业务代码完全透明**，这是这次改动能保持零回归的关键。
 */
export async function proxyFetch(
  url: string,
  init: ProxyFetchInit,
  proxy: ProxyConfig,
): Promise<Response> {
  const target = new URL(url);
  const isHttps = target.protocol === 'https:';
  const { host: proxyHost, port: proxyPort, secure } = proxyTarget(proxy);

  const signal = init.signal ?? undefined;
  // 连接/隧道阶段的上限。用 init 上的私有字段是为了让调用方能收紧它
  // （测试、以及将来按 action.timeout 对齐），不传就是 60 秒。
  const timeoutMs = init.connectTimeoutMs && init.connectTimeoutMs > 0
    ? init.connectTimeoutMs
    : DEFAULT_TIMEOUT_MS;

  if (signal?.aborted) throw new Error('请求已被取消');

  const raw = secure
    ? tls.connect({ host: proxyHost, port: proxyPort, servername: proxyHost })
    : net.connect({ host: proxyHost, port: proxyPort });

  let socket: net.Socket = raw;
  let aborted = false;
  const onAbort = () => {
    aborted = true;
    try { socket.destroy(); } catch { /* 已经没了 */ }
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    await onceConnected(raw, proxyHost, proxyPort, timeoutMs);
    if (aborted) throw new Error('请求已被取消');

    if (isHttps) {
      socket = await openTunnel(raw, target, proxy, timeoutMs);
      if (aborted) throw new Error('请求已被取消');
      return await exchange(socket, target, init, true, proxy, timeoutMs);
    }
    return await exchange(socket, target, init, false, proxy, timeoutMs);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try { socket.destroy(); } catch { /* 已经没了 */ }
  }
}

/** 等 socket 连上（明文或 TLS 都支持），并把「连不上代理」翻成人话 */
function onceConnected(
  socket: net.Socket | tls.TLSSocket,
  host: string,
  port: number,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`连接代理 ${host}:${port} 超时（${timeoutMs / 1000} 秒）`));
    }, timeoutMs);
    const finish = (err?: Error) => {
      clearTimeout(timer);
      socket.removeListener('error', onErr);
      socket.removeListener('connect', onConnect);
      socket.removeListener('secureConnect', onConnect);
      err ? reject(err) : resolve();
    };
    const onErr = (e: NodeJS.ErrnoException) => {
      const hint = e.code === 'ECONNREFUSED'
        ? '——代理没在运行，或端口写错了'
        : e.code === 'ENOTFOUND' ? '——代理主机名解析不了' : '';
      finish(new Error(`连不上代理 ${host}:${port}（${e.code ?? e.message}）${hint}`));
    };
    const onConnect = () => finish();
    socket.once('error', onErr);
    socket.once('connect', onConnect);
    socket.once('secureConnect', onConnect);
  });
}

/** 在已连上代理的 socket 上发 CONNECT，返回其上的 TLS socket */
function openTunnel(
  socket: net.Socket,
  target: URL,
  proxy: ProxyConfig,
  timeoutMs: number,
): Promise<tls.TLSSocket> {
  const hostPort = `${target.hostname}:${target.port || 443}`;
  return new Promise((resolve, reject) => {
    let buf = '';
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error(`经代理 ${proxy.url} 建立到 ${hostPort} 的隧道超时（${timeoutMs / 1000} 秒）`));
    }, timeoutMs);

    // 代理可能在 CONNECT 阶段直接断开（拒绝认证、不允许该目标、自己挂了）。
    // 不听 close 的话这里要白等到超时——60 秒的"没反应"比一句错话难查得多。
    const onClose = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error(
        `代理 ${proxy.url} 在建立到 ${hostPort} 的隧道时断开了连接——`
        + '通常是它拒绝了这个目标，或要求认证（407）',
      ));
    };

    const onData = (chunk: Buffer) => {
      buf += chunk.toString('latin1');
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0 || done) return;
      done = true;
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('close', onClose);

      const statusLine = buf.slice(0, buf.indexOf('\r\n')).trim();
      const code = Number(/^HTTP\/\d\.\d\s+(\d+)/.exec(statusLine)?.[1] ?? 0);
      if (code !== 200) {
        const extra = /^HTTP\/\d\.\d\s+407/.test(statusLine)
          ? '——代理要求认证，检查代理地址里有没有带 user:pass'
          : '';
        reject(new Error(`代理 ${proxy.url} 拒绝建立隧道：${statusLine || '无响应'}${extra}`));
        return;
      }
      // 隧道建立后可能已有残余字节，先塞回 socket 再交给 TLS
      const rest = buf.slice(end + 4);
      if (rest) socket.unshift(Buffer.from(rest, 'latin1'));

      const tlsSocket = tls.connect({ socket, servername: target.hostname });
      tlsSocket.once('secureConnect', () => resolve(tlsSocket));
      tlsSocket.once('error', reject);
    };

    socket.on('data', onData);
    socket.once('close', onClose);
    socket.once('error', reject);
    socket.write(
      `CONNECT ${hostPort} HTTP/1.1\r\nHost: ${hostPort}\r\n`
      + Object.entries(proxyAuthHeader(proxy.auth)).map(([k, v]) => `${k}: ${v}\r\n`).join('')
      + 'Proxy-Connection: keep-alive\r\n\r\n',
    );
  });
}

/**
 * 在（可能已加密的）socket 上发一次 HTTP/1.1 请求。
 *
 * viaTunnel = true（https 经隧道）：请求行用 origin-form，Proxy-Authorization 已随
 * CONNECT 发过，不再重复。
 * viaTunnel = false（http 直发代理）：请求行用 absolute-form，并按需带 Proxy-Authorization。
 */
function exchange(
  socket: net.Socket | tls.TLSSocket,
  target: URL,
  init: RequestInit,
  viaTunnel: boolean,
  proxy: ProxyConfig,
  timeoutMs: number,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const reqPath = viaTunnel ? `${target.pathname}${target.search}` : target.toString();

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = v;
    }
    headers['host'] = target.host;
    headers['connection'] = 'close';
    if (!viaTunnel) {
      headers['proxy-connection'] = 'close';
      for (const [k, v] of Object.entries(proxyAuthHeader(proxy.auth))) headers[k] = v;
    }

    const body = typeof init.body === 'string' ? Buffer.from(init.body, 'utf8') : undefined;
    if (body && headers['content-length'] === undefined) {
      headers['content-length'] = String(body.length);
    }

    const method = (init.method ?? 'GET').toUpperCase();
    const head = Buffer.from(
      `${[`${method} ${reqPath} HTTP/1.1`]
        .concat(Object.entries(headers).map(([k, v]) => `${k}: ${v}`))
        .join('\r\n')}\r\n\r\n`,
      'utf8',
    );

    let raw = Buffer.alloc(0);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`经代理 ${proxy.url} 等待 ${target.host} 的响应超时（${timeoutMs / 1000} 秒）`));
    }, timeoutMs);

    socket.on('data', (chunk: Buffer) => {
      raw = Buffer.concat([raw, chunk]);
      const end = raw.indexOf('\r\n\r\n');
      if (end < 0 || settled) return;
      const headerText = raw.slice(0, end).toString('latin1');
      if (!bodyComplete(raw, end, headerText)) return;

      settled = true;
      clearTimeout(timer);
      try {
        resolve(parseResponse(raw, end, headerText, socket));
      } catch (e) {
        reject(e as Error);
      }
    });
    socket.once('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    socket.once('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // 对端关了连接但响应已经收全（有些代理不发 content-length）
      if (raw.length > 0) {
        const end = raw.indexOf('\r\n\r\n');
        if (end >= 0) {
          try {
            resolve(parseResponse(raw, end, raw.slice(0, end).toString('latin1'), socket));
            return;
          } catch { /* 落到下面的报错 */ }
        }
      }
      reject(new Error(`代理 ${proxy.url} 在返回响应前关闭了连接（${target.host}）`));
    });

    socket.write(head);
    if (body) socket.write(body);
    // 这里**不能** socket.end()。
    //
    // 写过一次就会踩：end() 会发 FIN，等于对代理说"我这边不发了"。Node 的 HTTP
    // server 把它理解成客户端已断开，于是在上游响应回来之前就把 res 销毁掉——
    // 表现是代理侧 `res close, writableEnded=false`、上游稍后才 200，
    // 而我们这边只收到"代理在返回响应前关闭了连接"。
    // 真实代理只要有一点延迟就会这样，不是测试夹具的问题。
    //
    // 靠 `Connection: close` 让**服务端**决定何时收尾即可：响应收全后它自己关，
    // 我们这边已经有 bodyComplete / close 两条收尾路径。
  });
}

/** 把原始 HTTP/1.1 响应解析成标准 Response */
function parseResponse(
  raw: Buffer,
  headerEnd: number,
  headerText: string,
  socket: net.Socket | tls.TLSSocket,
): Response {
  const lines = headerText.split('\r\n');
  const statusLine = lines[0] ?? '';
  const code = Number(/^HTTP\/\d\.\d\s+(\d+)/.exec(statusLine)?.[1] ?? 0);
  const statusText = statusLine.replace(/^HTTP\/\d\.\d\s+\d+\s*/, '').trim();

  const headers = new Headers();
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim().toLowerCase();
    const v = line.slice(idx + 1).trim();
    // 逐跳头不该透给调用方
    if (k === 'proxy-authenticate' || k === 'proxy-connection' || k === 'transfer-encoding') continue;
    try {
      headers.append(k, v);
    } catch { /* 非法头名，丢掉 */ }
  }

  let body = raw.slice(headerEnd + 4);
  if (/^transfer-encoding:\s*chunked/im.test(headerText)) {
    body = decodeChunked(body);
  } else {
    const lenMatch = /^content-length:\s*(\d+)/im.exec(headerText);
    if (lenMatch) body = body.slice(0, Number(lenMatch[1]));
  }

  // 有长度信息（或 chunked）时正文已经完整，直接给缓冲区；否则交回 socket 流。
  const selfDelimiting = /^content-length:/im.test(headerText)
    || /^transfer-encoding:\s*chunked/im.test(headerText);
  const stream = !selfDelimiting && body.length === 0 ? socketToStream(socket) : undefined;

  const out = new Response(stream ?? (body.length ? new Uint8Array(body) : null), {
    status: code || 502,
    statusText,
    headers,
  });
  return out;
}

/**
 * 事件流（SSE）用：响应头已到但正文还没到齐时，把 socket 剩下的数据
 * 包成一个 ReadableStream。AI 工作台的流式返回走的就是这条。
 */
function socketToStream(socket: net.Socket | tls.TLSSocket): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const onData = (chunk: Buffer) => {
        try {
          controller.enqueue(new Uint8Array(chunk));
        } catch { /* 消费者已经走了 */ }
      };
      const onEnd = () => {
        try { controller.close(); } catch { /* 已经关了 */ }
      };
      socket.on('data', onData);
      socket.once('end', onEnd);
      socket.once('close', onEnd);
      socket.once('error', (e) => {
        try { controller.error(e); } catch { /* 已经关了 */ }
      });
    },
  });
}

/** 响应体是否已经收全。能判定才返回 true；判不了（只有 close 才知道）返回 false。 */
function bodyComplete(raw: Buffer, headerEnd: number, headerText: string): boolean {
  const bodyHave = raw.length - (headerEnd + 4);
  const lenMatch = /^content-length:\s*(\d+)/im.exec(headerText);
  if (lenMatch) return bodyHave >= Number(lenMatch[1]);
  if (/^transfer-encoding:\s*chunked/im.test(headerText)) {
    const s = raw.slice(headerEnd + 4).toString('latin1');
    // 终止块是「0\r\n\r\n」，但末尾可能跟着 trailer 头。别只认字面串：
    // 全数字段本身可能是 0，必须从块长度行解析出真正的终止块。
    const m = /(?:^|\r\n)([0-9a-fA-F]+)[^\r\n]*\r\n/g;
    let hit: RegExpExecArray | null;
    let last: { size: number; end: number } | undefined;
    while ((hit = m.exec(s)) !== null) {
      last = { size: parseInt(hit[1]!, 16), end: hit.index + hit[0].length };
      // 长度为 0 的块之后必须紧跟 CRLF（或 trailer），才算真的收尾
      if (last.size === 0) return /^(?:\r\n|[^\r\n]+:)/.test(s.slice(last.end));
    }
    return false;
  }
  return false; // 没有长度信息，只能等连接关闭
}
function decodeChunked(input: Buffer): Buffer {
  const out: Buffer[] = [];
  let pos = 0;
  while (pos < input.length) {
    const lineEnd = input.indexOf('\r\n', pos);
    if (lineEnd < 0) break;
    const size = parseInt(input.slice(pos, lineEnd).toString('latin1').split(';')[0]!.trim(), 16);
    if (!Number.isFinite(size) || size === 0) break;
    const start = lineEnd + 2;
    out.push(input.slice(start, start + size));
    pos = start + size + 2;
  }
  return Buffer.concat(out);
}
