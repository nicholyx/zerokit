import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { type Plugin, toolName } from './core/manifest.ts';
import { PKG_ROOT } from './core/paths.ts';
import { needsConfirm, rememberApproval } from './core/approvals.ts';
import { killAllProcesses, killProcess, listProcesses } from './core/runtime.ts';
import { listServices, stopService } from './core/services.ts';
import { shutdownHosts } from './core/host.ts';
import { checkAiReady, loadSettings } from './core/settings.ts';
// 注意这里**不要**顶层导入 './ai/index.ts'：那条链会把 @anthropic-ai/sdk
// 一起拉进来，光加载就 240ms，而启动器绝大多数时候用不到它。
// Workbench 与工具清单在 agent.ts 里，那一支不碰任何模型 SDK，可以静态导入。
import { Workbench, collectToolDefs } from './ai/agent.ts';
import { listPlugins } from './core/registry.ts';
import { checkRequires } from './core/resolve.ts';
import { applyDefaults, coerceParam, toFormFields, toJsonSchema } from './core/schema.ts';
import { buildArgv, confirmPolicy, displayCommand, runAction } from './core/runner.ts';

/**
 * 本地 HTTP 面：给启动器 / Web 页面 / Tauri 壳提供同一套 API。
 *
 * 前端是纯静态页面（无构建步骤），所以浏览器、Tauri 壳用的是同一份前端代码，
 * 以后换壳不用重写界面。
 *
 * 安全：这个端口能执行插件，属于高危面，所以
 *   1. 只绑 127.0.0.1
 *   2. 校验 Origin，防 DNS rebinding（恶意网页把域名解析到 127.0.0.1 来打本地服务）
 *   3. 每次启动生成随机 token，写操作必须带上
 *   4. 有副作用的动作要先拿确认令牌，令牌和「这条命令 + 这组参数」绑定，
 *      避免出现"用户确认的是 A、实际执行的是 B"
 */

const WEB_DIR = path.join(PKG_ROOT, 'web');
const SESSION_TOKEN = crypto.randomBytes(24).toString('hex');
const CONFIRM_SECRET = crypto.randomBytes(32);

/** 工作台会话：持有该会话的模型上下文与待审批的调用 */
const sessions = new Map<string, Workbench>();
const SESSION_TTL_MS = 30 * 60 * 1000;

export interface ServerOptions {
  port?: number;
  host?: string;
  /** 打开浏览器 */
  open?: boolean;
}

interface WiredPlugin {
  id: string;
  name: string;
  version: string;
  summary: string;
  keywords: string[];
  requiresOk: boolean;
  missingDeps: string[];
  actions: Array<Record<string, unknown>>;
}

function wirePlugins(): WiredPlugin[] {
  const out: WiredPlugin[] = [];
  for (const entry of listPlugins()) {
    const p: Plugin | undefined = entry.plugin;
    if (!p) continue;
    const reqs = checkRequires(p.requires);
    out.push({
      id: p.id,
      name: p.name,
      version: p.version,
      summary: p.summary,
      keywords: p.keywords,
      requiresOk: reqs.every((r) => r.ok),
      missingDeps: reqs.filter((r) => !r.ok).map((r) => r.name),
      actions: p.actions.map((a) => ({
        id: a.id,
        title: a.title,
        description: a.description,
        risk: a.risk,
        type: a.type,
        output: a.output,
        render: a.render,
        tool: toolName(p.id, a.id),
        // 表单字段和 MCP 的 inputSchema 是同一份参数声明的两种投影
        fields: toFormFields(a),
        inputSchema: toJsonSchema(a),
        needsConfirm: confirmPolicy(a.risk) === 'always',
        // 内容智能匹配的声明：前端据此判断"输入像什么"然后推荐
        match: a.match ?? null,
      })),
    });
  }
  return out;
}

function confirmToken(pluginId: string, actionId: string, values: Record<string, unknown>): string {
  const payload = `${pluginId}|${actionId}|${JSON.stringify(values)}`;
  return crypto.createHmac('sha256', CONFIRM_SECRET).update(payload).digest('hex');
}

function sameToken(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function json(res: http.ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(text);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

function serveStatic(res: http.ServerResponse, urlPath: string): void {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const full = path.resolve(WEB_DIR, rel);
  // 目录穿越防护
  if (!full.startsWith(WEB_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    // 前端是单页应用，未知路径一律回 index.html
    const index = path.join(WEB_DIR, 'index.html');
    if (!fs.existsSync(index)) {
      res.writeHead(404).end('web/ 目录还没生成');
      return;
    }
    const html = fs.readFileSync(index, 'utf8').replace('__TOKEN__', SESSION_TOKEN);
    res.writeHead(200, { 'content-type': MIME['.html']! }).end(html);
    return;
  }
  const ext = path.extname(full).toLowerCase();
  let body = fs.readFileSync(full);
  if (ext === '.html' || ext === '.js') {
    body = Buffer.from(body.toString('utf8').replace('__TOKEN__', SESSION_TOKEN));
  }
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 1 << 20) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        reject(new Error(`请求体不是合法 JSON：${(e as Error).message}`));
      }
    });
    req.on('error', reject);
  });
}

export function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const isApi = url.pathname.startsWith('/api/');

    // 防 DNS rebinding：浏览器发起的请求会带 Origin，只接受本机来源
    const origin = req.headers.origin;
    if (origin) {
      let ok = false;
      try {
        const o = new URL(origin);
        ok = (o.hostname === '127.0.0.1' || o.hostname === 'localhost');
      } catch {
        ok = false;
      }
      if (!ok) {
        json(res, 403, { error: `拒绝来源 ${origin}（防止被外部网页调用本地服务）` });
        return;
      }
    }

    if (isApi && req.method === 'POST') {
      const token = req.headers['x-zerokit-token'];
      if (token !== SESSION_TOKEN) {
        json(res, 403, { error: '缺少或错误的会话令牌' });
        return;
      }
    }

    try {
      if (url.pathname === '/api/plugins') {
        json(res, 200, { plugins: wirePlugins() });
        return;
      }

      // 「运行中」：托管的进程 + 插件声明的服务。启动器和一堆快捷方式的区别就在这。
      if (url.pathname === '/api/ps' && req.method === 'GET') {
        json(res, 200, {
          // 只列真正在跑的：登记表是落盘的，已经不在了的会被自动清掉
          processes: listProcesses(),
          services: listServices(),
        });
        return;
      }

      if (url.pathname === '/api/kill' && req.method === 'POST') {
        const body = await readBody(req);
        const results: Array<{ target: string; ok: boolean; message: string }> = [];

        if (body['all'] === true) {
          for (const s of listServices().filter((x) => x.running)) {
            const r = await stopService(s.pluginId, s.id);
            results.push({ target: `${s.pluginId}.${s.id}`, ...r });
          }
          const swept = killAllProcesses();
          results.push({
            target: '托管进程',
            ok: swept.failed === 0,
            message: swept.killed === 0 ? '没有需要结束的' : `结束了 ${swept.killed} 个`,
          });
        } else {
          const ids = Array.isArray(body['ids']) ? body['ids'].map(String) : [];
          for (const id of ids) {
            // 形如 插件.服务 交给插件自己的停止命令；纯 id 是托管进程
            if (id.includes('.')) {
              const i = id.lastIndexOf('.');
              const r = await stopService(id.slice(0, i), id.slice(i + 1));
              results.push({ target: id, ...r });
            } else {
              results.push({ target: id, ...killProcess(id) });
            }
          }
        }
        json(res, 200, { ok: results.every((r) => r.ok), results });
        return;
      }

      if (url.pathname === '/api/ai' && req.method === 'GET') {
        const settings = loadSettings(true);
        const ready = checkAiReady(settings);
        json(res, 200, {
          provider: settings.ai.provider,
          model: settings.ai.model,
          effort: settings.ai.effort,
          ready: ready.ready,
          reason: ready.reason ?? '',
          hint: ready.hint ?? '',
          tools: collectToolDefs().length,
        });
        return;
      }

      // 工作台：SSE 流式。审批走 /api/chat/approve，两条请求通过 sessionId 关联
      if (url.pathname === '/api/chat' && req.method === 'POST') {
        const body = await readBody(req);
        const message = String(body['message'] ?? '').trim();
        const sessionId = String(body['sessionId'] ?? '') || crypto.randomBytes(8).toString('hex');
        if (!message) {
          json(res, 400, { error: '消息为空' });
          return;
        }

        const ready = checkAiReady();
        if (!ready.ready) {
          json(res, 400, { error: ready.reason, hint: ready.hint });
          return;
        }

        let wb = sessions.get(sessionId);
        if (!wb) {
          const { createProvider } = await import('./ai/index.ts');
          wb = new Workbench(await createProvider());
          sessions.set(sessionId, wb);
          setTimeout(() => sessions.delete(sessionId), SESSION_TTL_MS).unref?.();
        }

        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        const send = (type: string, payload: unknown) => {
          res.write(`data: ${JSON.stringify({ type, ...(payload as object) })}\n\n`);
        };
        send('session', { sessionId, model: loadSettings().ai.model });

        let closed = false;
        req.on('close', () => { closed = true; });

        await wb.chat(message, {
          onText: (d) => { if (!closed) send('text', { delta: d }); },
          onThinking: (d) => { if (!closed) send('thinking', { delta: d }); },
          onToolPending: (c) => { if (!closed) send('tool_pending', { call: c }); },
          onToolStart: (c) => { if (!closed) send('tool_start', { call: c }); },
          onToolResult: (r) => { if (!closed) send('tool_result', { result: r }); },
          onDone: (info) => { if (!closed) send('done', info); },
          onError: (m) => { if (!closed) send('error', { message: m }); },
        });
        if (!closed) res.end();
        return;
      }

      if (url.pathname === '/api/chat/approve' && req.method === 'POST') {
        const body = await readBody(req);
        const sessionId = String(body['sessionId'] ?? '');
        const callId = String(body['callId'] ?? '');
        const allow = body['allow'] === true;
        const wb = sessions.get(sessionId);
        if (!wb) {
          json(res, 404, { error: '这个会话已经过期了，重新发一条消息即可' });
          return;
        }
        json(res, 200, { ok: wb.resolveApproval(callId, allow) });
        return;
      }

      if (url.pathname === '/api/approve' && req.method === 'POST') {
        const body = await readBody(req);
        const pluginId = String(body['plugin'] ?? '');
        const actionId = String(body['action'] ?? '');
        const entry = listPlugins().find((e) => e.plugin?.id === pluginId);
        const action = entry?.plugin?.actions.find((a) => a.id === actionId);
        if (!action) {
          json(res, 404, { error: '没有这个动作' });
          return;
        }
        if (action.risk === 'destructive') {
          // 高风险动作不参与「记住」，每次都问
          json(res, 400, { error: '高风险动作不支持记住，每次都要确认' });
          return;
        }
        rememberApproval(pluginId, actionId);
        json(res, 200, { ok: true });
        return;
      }

      if (url.pathname === '/api/run' && req.method === 'POST') {
        const body = await readBody(req);
        const pluginId = String(body['plugin'] ?? '');
        const actionId = String(body['action'] ?? '');
        const rawValues = (body['values'] ?? {}) as Record<string, unknown>;

        const entry = listPlugins().find((e) => e.plugin?.id === pluginId);
        const plugin = entry?.plugin;
        if (!plugin) {
          json(res, 404, { error: `没有插件 ${pluginId}` });
          return;
        }
        const action = plugin.actions.find((a) => a.id === actionId);
        if (!action) {
          json(res, 404, { error: `插件 ${pluginId} 里没有动作 ${actionId}` });
          return;
        }

        const values: Record<string, unknown> = {};
        const errors: string[] = [];
        for (const p of action.params) {
          if (rawValues[p.name] === undefined) continue;
          const r = coerceParam(p, rawValues[p.name]);
          if (r.error) errors.push(r.error);
          else values[p.name] = r.value;
        }
        if (typeof rawValues['__confirm'] === 'string') {
          // 确认令牌是给服务端用的，不是参数
          delete rawValues['__confirm'];
        }
        const withDefaults = applyDefaults(action, values);
        errors.push(...withDefaults.errors);
        if (errors.length > 0) {
          json(res, 400, { error: errors.join('；') });
          return;
        }

        const policy = confirmPolicy(action.risk);
        const mustAsk = needsConfirm(action.risk, policy, plugin.id, action.id);
        const expected = confirmToken(plugin.id, action.id, withDefaults.values);
        const provided = typeof body['confirm'] === 'string' ? body['confirm'] : '';
        const confirmed = Boolean(provided) && sameToken(provided, expected);

        if (mustAsk && !confirmed) {
          // 还没确认：把"到底要跑什么"原样交给前端展示
          const { argv } = buildArgv(plugin, action, withDefaults.values);
          json(res, 200, {
            needConfirm: true,
            risk: action.risk,
            command: displayCommand(action, argv),
            confirm: expected,
          });
          return;
        }

        const missing = checkRequires(plugin.requires).filter((r) => !r.ok);
        if (missing.length > 0) {
          json(res, 400, {
            error: `缺少依赖：${missing.map((m) => `${m.name}（${m.hint}）`).join('；')}`,
          });
          return;
        }

        const result = await runAction(plugin, action, { caller: 'ui', values: withDefaults.values });
        json(res, 200, {
          needConfirm: false,
          ok: result.ok,
          render: action.render,
          output: action.output,
          stdout: result.stdout,
          data: result.data,
          stderr: result.stderr,
          error: result.error,
          ms: result.ms,
          command: result.command,
          truncated: result.truncated,
          artifactPath: result.artifactPath,
        });
        return;
      }

      if (req.method === 'GET') {
        serveStatic(res, url.pathname);
        return;
      }
      json(res, 405, { error: '不支持的方法' });
    } catch (e) {
      json(res, 500, { error: (e as Error).message });
    }
  });
}

export function startServer(options: ServerOptions = {}): Promise<{ url: string; close: () => void }> {
  const port = options.port ?? 0;
  const host = options.host ?? '127.0.0.1';
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        url: `http://${host}:${actual}`,
        close: () => server.close(),
      });
    });
  });
}

/** zkit ui 的入口 */
export async function cli(args: string[]): Promise<number> {
  const portIdx = args.indexOf('--port');
  const port = portIdx >= 0 ? Number(args[portIdx + 1]) : 0;
  const { url } = await startServer({ port: Number.isFinite(port) ? port : 0 });

  // 被宿主进程（Tauri 壳、脚本）当子进程拉起时，读取端可能在拿到地址后就关掉了，
  // 之后任何 stdout 写入都会变成 EPIPE。默认会抛未捕获异常把进程打死，
  // 所以这里把它降级成静默忽略——内核不该因为没人看输出而死。
  process.stdout.on('error', () => { /* 读取端关了，无所谓 */ });
  process.stderr.on('error', () => { /* 同上 */ });

  process.stdout.write(`zerokit 启动器已就绪：${url}\n`);
  process.stdout.write('按 Ctrl+C 停止\n');
  // 机器可读的就绪行，放在最后一行：宿主解析这一行比猜中文提示稳妥
  process.stdout.write(`zerokit-ready ${JSON.stringify({ url, pid: process.pid })}\n`);
  if (args.includes('--open')) {
    // 按平台选打开浏览器的命令（cmd /c start 只在 Windows 上有）。
    // 注意 spawn 的失败（如命令不存在）走的是 error 事件而不是同步异常，
    // 外面套 try/catch 接不住——必须挂 error handler，否则会把整个服务带崩。
    const { spawn } = await import('node:child_process');
    const exe = process.platform === 'win32' ? 'cmd'
      : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const argv = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    const child = spawn(exe, argv, { windowsHide: true, detached: true });
    child.on('error', () => { /* 打不开浏览器不影响服务 */ });
    child.unref();
  }
  await new Promise<void>((resolve) => {
    const stop = () => {
      // 优雅退出时把常驻宿主一起收掉，别留下孤儿解释器（它们本来也会因为
      // stdin 关闭而自己退出，这里是双保险）
      shutdownHosts();
      resolve();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    if (args.includes('--exit-on-stdin-close')) {
      // 供宿主进程（Tauri 壳等）使用：宿主无论怎么死——正常退出、崩溃、被强杀——
      // 它那一端的管道都会关闭，我们据此跟着退出，避免留下孤儿进程占着端口。
      process.stdin.on('end', stop);
      process.stdin.on('close', stop);
      process.stdin.resume();
    }
  });
  return 0;
}

// 直接被 `node src/server.ts` 拉起时也能工作（被 cli.ts 动态导入时不会触发）
if (process.argv[1] && /server\.ts$/.test(process.argv[1])) {
  cli(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`启动失败：${err?.stack ?? err}\n`);
      process.exit(1);
    });
}