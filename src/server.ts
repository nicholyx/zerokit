import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { type Plugin, toolName } from './core/manifest.ts';
import { DATA_DIR, HOME, LOG_DIR, PKG_ROOT } from './core/paths.ts';
import { needsConfirm, rememberApproval } from './core/approvals.ts';
import { readFileSync } from 'node:fs';

/** server 版本号：与 package.json 同源（无构建步骤，运行时读）。 */
const SERVER_VERSION: string = (() => {
  try {
    return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
  } catch {
    return '0.0.0-unknown';
  }
})();
import { killAllProcesses, killProcess, listProcesses } from './core/runtime.ts';
import { listServices, stopService } from './core/services.ts';
import { shutdownHosts } from './core/host.ts';
import { checkAiReady, loadSettings } from './core/settings.ts';
// 注意这里**不要**顶层导入 './ai/index.ts'：那条链会把 @anthropic-ai/sdk
// 一起拉进来，光加载就 240ms，而启动器绝大多数时候用不到它。
// Workbench 与工具清单在 agent.ts 里，那一支不碰任何模型 SDK，可以静态导入。
import { Workbench, collectToolDefs } from './ai/agent.ts';
import { addFromDir, addFromGit, findPlugin, listPlugins, previewAdd, removePlugin } from './core/registry.ts';
import { applyUpdate, checkUpdate } from './core/update.ts';
import { describeSource, readSource } from './core/sources.ts';
import { checkRequires } from './core/resolve.ts';
import { applyDefaults, coerceParam, toFormFields, toJsonSchema } from './core/schema.ts';
import { type PublicSetting, publicSettings, SECRET_MASK, writeSettings } from './core/pluginConfig.ts';
import { dependents, depStates, installDeps, missingDeps } from './core/deps.ts';
import { buildArgv, chainDisplay, confirmPolicy, displayCommand, runAction } from './core/runner.ts';
import { buildDoctorReport, toHistoryEntry, appendDoctorHistory, readDoctorHistory, diffDoctorHistory, doctorSummaryLine } from './core/doctor.ts';
import {
  addMarket, findEntry, installFromMarket, loadMarkets, previewInstall,
  readIndex, refreshMarket, removeMarket,
} from './core/market.ts';

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
/** 会话档案：transcript 快照，供界面恢复对话（内存级，重启即清） */
const chatArchives = new Map<string, Array<{ role: 'user' | 'assistant' | 'tool'; text: string }>>();
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
  /** 插件依赖（其它 zerokit 插件）及其状态——和上面的命令依赖是两回事 */
  pluginDeps: Array<{ id: string; installed: boolean; version?: string }>;
  pluginDepsOk: boolean;
  /** 安装来源（git / 集市 / 自带 / 本地目录 / 未知），前端据此展示「能不能更新」 */
  sourceType: string;
  sourceUrl: string;
  sourceText: string;
  installedAt: string;
  actions: Array<Record<string, unknown>>;
  /** 声明式设置项（密钥已打码，前端只拿得到掩码） */
  settings: PublicSetting[];
}

function wirePlugins(): WiredPlugin[] {
  const out: WiredPlugin[] = [];
  for (const entry of listPlugins()) {
    const p: Plugin | undefined = entry.plugin;
    if (!p) continue;
    const reqs = checkRequires(p.requires);
    const source = readSource(entry.dir);
    out.push({
      id: p.id,
      name: p.name,
      version: p.version,
      summary: p.summary,
      keywords: p.keywords,
      requiresOk: reqs.every((r) => r.ok),
      missingDeps: reqs.filter((r) => !r.ok).map((r) => r.name),
      pluginDeps: depStates(p),
      pluginDepsOk: missingDeps(p).length === 0,
      sourceType: source?.type ?? 'unknown',
      sourceUrl: source?.url ?? '',
      sourceText: describeSource(source),
      installedAt: source?.installedAt ?? '',
      settings: publicSettings(p),
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
        // 复制模板（第十七轮）：结果卡「复制」按它渲染
        copy_template: a.copy_template ?? null,
        // 组合动作的链路（只有 use/as；参数留在清单里，前端不需要知道）
        // 组合动作的链路：use/as 给前端画链路图，params 是模板原文（可能含 {占位符}，
        // 静态就写在清单里，不含运行值）
        steps: a.type === 'chain'
          ? a.steps.map((st) => ({ use: st.use, as: st.as, params: st.params ?? {} }))
          : [],
      })),
    });
  }
  return out;
}

function confirmToken(pluginId: string, actionId: string, values: Record<string, unknown>): string {
  const payload = `${pluginId}|${actionId}|${JSON.stringify(values)}`;
  return crypto.createHmac('sha256', CONFIRM_SECRET).update(payload).digest('hex');
}

/** 安装/更新/卸载的确认令牌：和「这条来源 + 这个插件」绑定，防「确认的是 A、操作的是 B」 */
function installToken(kind: 'install' | 'update' | 'remove' | 'market', key: string): string {
  return crypto.createHmac('sha256', CONFIRM_SECRET).update(`${kind}|${key}`).digest('hex');
}

function sameToken(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** 集市快照：已添加的集市 + 各自索引 + 每个条目是否已装（前端一次拿全） */
function marketSnapshot(): {
  markets: Array<Record<string, unknown>>;
  total: number;
} {
  const installed = new Map<string, string>();
  for (const entry of listPlugins()) {
    if (entry.plugin) installed.set(entry.plugin.id, entry.plugin.version);
  }
  const markets = loadMarkets().map((m) => {
    const index = readIndex(m.name);
    return {
      name: m.name,
      url: m.url,
      addedAt: m.addedAt,
      local: !/^(https?:\/\/|git@|ssh:\/\/)/.test(m.url),
      description: index?.description ?? '',
      plugins: (index?.plugins ?? []).map((e) => ({
        ...e,
        installedVersion: installed.get(e.id) ?? '',
      })),
    };
  });
  return { markets, total: markets.reduce((n, m) => n + (m.plugins as unknown[]).length, 0) };
}

/** 预览里摊开一条动作：装第三方插件时，人要先看到「它到底会跑什么」 */
function previewAction(a: Plugin['actions'][number]): Record<string, unknown> {
  const command = a.type === 'http'
    ? `${a.method} ${a.url ?? ''}`
    : a.type === 'chain' ? chainDisplay(a) : a.run.join(' ');
  return { id: a.id, title: a.title, description: a.description, risk: a.risk, type: a.type, command };
}

/** 第六十七轮①⑤：执行中动作 → AbortController（/api/stop 用） */
const runningRuns = new Map<string, AbortController>();

/** 第七十九轮①：watch.json 透传存储（server 不解析语义——浏览器是唯一写者） */
function watchFilePath(): string {
  return path.join(HOME, 'watch.json');
}
function loadWatchFile(): { version: number; watches: unknown[]; stops?: unknown[] } {
  try {
    const raw = JSON.parse(fs.readFileSync(watchFilePath(), 'utf8'));
    if (raw && Array.isArray(raw.watches)) {
      return { version: 1, watches: raw.watches, stops: Array.isArray(raw.stops) ? raw.stops : [] };
    }
  } catch { /* 不存在/坏文件都当空 */ }
  return { version: 1, watches: [], stops: [] };
}
function saveWatchFile(body: unknown): boolean {
  const b = body as { watches?: unknown } | null;
  if (!b || !Array.isArray(b.watches)) return false;
  const file = { version: 1, watches: b.watches, stops: (b as { stops?: unknown[] }).stops ?? [] };
  fs.mkdirSync(HOME, { recursive: true });
  const tmp = watchFilePath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(file));
  fs.renameSync(tmp, watchFilePath());
  return true;
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

/**
 * 插件自带的 web 面：GET /p/<插件id>/... 托管该插件目录下的 web/。
 *
 * 安全边界（与 serveStatic 的关键差异）：
 *   - **不注入会话令牌**。插件页面是第三方代码，令牌只发给应用自己的前端。
 *     页面跑在 sandbox iframe 里（opaque origin），fetch 不到带令牌的 API，
 *     执行请求只能经 postMessage 桥由宿主转发——确认策略因此无法绕过。
 *   - 注入的 bridge 脚本是宿主资产（/​_zkit/bridge.js），与插件文件分开存放。
 */
function servePluginPage(res: http.ServerResponse, urlPath: string): void {
  const m = /^\/p\/([a-z0-9][a-z0-9._-]*)(?:\/(.*))?$/.exec(urlPath);
  const fail = (code: number, msg: string) => res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }).end(msg);
  if (!m) {
    fail(404, '没有这个页面');
    return;
  }
  const entry = listPlugins().find((e) => e.plugin?.id === m[1]);
  const plugin = entry?.plugin;
  if (!plugin) {
    fail(404, `没有插件 ${m[1]}`);
    return;
  }
  const webDir = path.resolve(plugin.dir, 'web');
  const rel = m[2] === undefined || m[2] === '' ? 'index.html' : m[2];
  const full = path.resolve(webDir, rel);
  // 目录穿越防护：resolve 后必须还在 web 目录里（带分隔符，防 web-xxx 兄弟目录）
  if (full !== webDir && !full.startsWith(webDir + path.sep)) {
    fail(403, 'forbidden');
    return;
  }
  let body: Buffer;
  try {
    body = fs.readFileSync(full);
  } catch {
    fail(404, `插件 ${plugin.id} 的 web 目录里没有 ${rel}`);
    return;
  }
  const ext = path.extname(full).toLowerCase();
  if (ext === '.html') {
    // 注入桥脚本：让页面拿到 window.zkit（读取执行上下文、反向调用本插件动作）
    const tag = '<script src="/_zkit/bridge.js"></script>';
    const html = /<head[^>]*>/i.test(body.toString('utf8'))
      ? body.toString('utf8').replace(/<head[^>]*>/i, (mm) => mm + tag)
      : tag + body.toString('utf8');
    body = Buffer.from(html);
  }
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
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
      // ⑥无鉴权探活端点：给监控/巡检脚本用（不泄露任何数据面信息，
      // 只有存活+版本+uptime）。GET 且无敏感内容，刻意不设防。
      if (url.pathname === '/api/health' && req.method === 'GET') {
        json(res, 200, {
          app: 'zerokit',
          version: SERVER_VERSION,
          uptimeSec: Math.round(process.uptime()),
          pid: process.pid,
        });
        return;
      }
      if (url.pathname === '/api/plugins') {
        json(res, 200, { plugins: wirePlugins() });
        return;
      }

      // 启动器「日志」面板：审计日志只读、倒序、可筛选。只读最后 512KB，
      // 日志再大也不会把整个文件读进内存（老记录本来就该靠归档而不是一次读全）。
      if (url.pathname === '/api/logs' && req.method === 'GET') {
        const file = url.searchParams.get('file') === 'denied' ? 'denied.log' : 'audit.log';
        const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') ?? 200) || 200));
        const decision = url.searchParams.get('decision') ?? '';
        const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
        const logPath = path.join(LOG_DIR, file);
        let entries: Record<string, unknown>[] = [];
        if (fs.existsSync(logPath)) {
          const size = fs.statSync(logPath).size;
          const start = Math.max(0, size - 512 * 1024);
          const buf = Buffer.alloc(size - start);
          const fd = fs.openSync(logPath, 'r');
          try {
            fs.readSync(fd, buf, 0, buf.length, start);
          } finally {
            fs.closeSync(fd);
          }
          entries = buf.toString('utf8').split('\n').filter(Boolean).flatMap((line) => {
            try {
              return [JSON.parse(line) as Record<string, unknown>];
            } catch {
              return [];
            }
          });
        }
        const counts = {
          total: entries.length,
          deny: entries.filter((e) => e['decision'] === 'deny').length,
          error: entries.filter((e) => Boolean(e['error'])).length,
        };
        if (decision === 'error') entries = entries.filter((e) => Boolean(e['error']));
        else if (decision) entries = entries.filter((e) => e['decision'] === decision);
        if (q) entries = entries.filter((e) => JSON.stringify(e).toLowerCase().includes(q));
        json(res, 200, {
          file,
          exists: fs.existsSync(logPath),
          counts,
          entries: entries.slice(-limit).reverse(),
        });
        return;
      }

      // 第七十九轮①②⑤：监控持久化桥——浏览器写（唯一真相源），server 只透传存储
      // ~/.zerokit/watch.json。GET 读回（boot 恢复），PUT 整份覆写（samples 截尾）。
      if (url.pathname === '/api/watch' && req.method === 'GET') {
        json(res, 200, loadWatchFile());
        return;
      }
      if (url.pathname === '/api/watch' && req.method === 'PUT') {
        const body = await readBody(req);
        const ok = saveWatchFile(body);
        if (!ok) { json(res, 400, { error: 'watch 文件需要 watches 数组' }); return; }
        json(res, 200, { ok: true });
        return;
      }
      // 环境自检：与 CLI 的 `zkit doctor` 共用 buildDoctorReport，判定只有一份。
      // 第六十三轮①⑥：定时任务持久化桥——UI 读写 ~/.zerokit/timers.json
      if (url.pathname === '/api/timers' && req.method === 'GET') {
        const { loadTimers, nextFireTime } = await import('./core/timers.ts');
        const { timers } = loadTimers();
        json(res, 200, { timers: timers.map((t) => ({ ...t, nextAt: nextFireTime(t) ?? 0 })) });
        return;
      }
      if (url.pathname === '/api/timers' && req.method === 'POST') {
        const body = await readBody(req);
        const { upsertTimer, removeTimer, setTimerPaused } = await import('./core/timers.ts');
        const op = String(body['op'] ?? '');
        if (op === 'remove') {
          const gone = removeTimer(String(body['key'] ?? ''));
          json(res, gone ? 200 : 404, gone ? { ok: true } : { error: '任务不存在' });
          return;
        }
        if (op === 'pause' || op === 'resume') {
          const st = setTimerPaused(String(body['key'] ?? ''), op === 'pause');
          if (st === null) { json(res, 404, { error: '任务不存在' }); return; }
          json(res, 200, { ok: true, paused: st });
          return;
        }
        if (op === 'upsert') {
          const t = body['timer'] as Record<string, unknown> | undefined;
          if (!t || typeof t['key'] !== 'string' || typeof t['interval'] !== 'number') {
            json(res, 400, { error: 'timer 需要 key 与 interval' });
            return;
          }
          const file = upsertTimer({
            key: String(t['key']), title: String(t['title'] ?? t['key']),
            interval: Number(t['interval']), win: t['win'] ? String(t['win']) : '',
            paused: !!t['paused'], createdAt: Number(t['createdAt'] ?? Date.now()),
            values: t['values'] && typeof t['values'] === 'object' ? t['values'] as Record<string, string> : undefined,
          });
          json(res, 200, { ok: true, count: file.timers.length });
          return;
        }
        json(res, 400, { error: 'op 需要 upsert / pause / resume / remove' });
        return;
      }

      // 第八十六轮④⑤：dev 模式状态——哪些插件是开发链接（symlink）、清单摘要、文件树
      if (url.pathname === '/api/dev/status' && req.method === 'GET') {
        const devs: object[] = [];
        for (const entry of listPlugins()) {
          const pl = entry.plugin;
          if (!pl) continue;
          let isDev = false;
          try { isDev = fs.lstatSync(pl.dir).isSymbolicLink(); } catch { /* 读不了当非 dev */ }
          if (!isDev) continue;
          const tree: string[] = [];
          const walk = (dir: string, prefix: string, depth: number) => {
            if (depth > 2) return;
            let names: string[] = [];
            try { names = fs.readdirSync(dir).sort(); } catch { return; }
            for (const n of names.slice(0, 30)) {
              tree.push(prefix + n);
              const sub = path.join(dir, n);
              try { if (fs.statSync(sub).isDirectory()) walk(sub, prefix + n + '/', depth + 1); } catch { /* 跳过 */ }
            }
          };
          walk(pl.dir, '', 0);
          devs.push({
            id: pl.id, name: pl.name, version: pl.version, dir: pl.dir,
            actions: pl.actions.map((a) => ({ id: a.id, title: a.title, risk: a.risk, params: (a.params ?? []).map((x) => x.name) })),
            files: tree,
          });
        }
        json(res, 200, { devs });
        return;
      }
      // 第八十六轮②：dev 变更通知——长轮询端点，web 端拿 mtime戳比对决定重载 iframe
      if (url.pathname === '/api/dev/poll' && req.method === 'GET') {
        let stamp = 0;
        for (const entry of listPlugins()) {
          const pl = entry.plugin;
          if (!pl) continue;
          try { if (fs.lstatSync(pl.dir).isSymbolicLink()) stamp = Math.max(stamp, fs.statSync(path.resolve(pl.dir, 'plugin.toml')).mtimeMs); } catch { /* 忽略 */ }
        }
        json(res, 200, { stamp });
        return;
      }
      if (url.pathname === '/api/doctor' && req.method === 'GET') {
        // 第八十四轮①④⑥：与 CLI --json 同源——汇总行、最近 5 次历史、对比一并给前端
        const report = buildDoctorReport();
        const passed = report.tools.filter((t) => t.ok).length
          + report.plugins.filter((pl) => pl.problems.length === 0).length;
        const entry = toHistoryEntry(report, passed);
        appendDoctorHistory(entry);
        const full = readDoctorHistory();
        json(res, 200, {
          ...report,
          summaryLine: doctorSummaryLine(report, passed),
          history: full.slice(0, 5),
          diff: diffDoctorHistory(entry, full[1]),
        });
        return;
      }

      // 执行前预览命令：把「将要跑什么」摊开给人看。只算不跑，不写审计。
      if (url.pathname === '/api/preview' && req.method === 'POST') {
        const body = await readBody(req);
        const plugin = findPlugin(String(body['plugin'] ?? ''))?.plugin;
        if (!plugin) {
          json(res, 404, { error: '插件不存在' });
          return;
        }
        const action = plugin.actions.find((a) => a.id === String(body['action'] ?? ''));
        if (!action) {
          json(res, 404, { error: '动作不存在' });
          return;
        }
        const rawValues = (body['values'] ?? {}) as Record<string, unknown>;
        const values: Record<string, unknown> = {};
        for (const param of action.params) {
          const raw = rawValues[param.name];
          if (raw === undefined || raw === null || raw === '') continue;
          const coerced = coerceParam(param, raw);
          if (coerced.error) {
            json(res, 400, { error: `${param.name}：${coerced.error}` });
            return;
          }
          values[param.name] = coerced.value;
        }
        // 预览等于「预演一次参数检查」：必填缺失、类型不对都在这里拦住，
        // 否则界面会显示一条实际执行时必然失败的命令。
        const prepared = applyDefaults(action, values);
        if (prepared.errors.length > 0) {
          json(res, 400, { error: prepared.errors.join('；') });
          return;
        }
        const command = action.type === 'http'
          ? `${action.method} ${action.url}`
          : action.type === 'chain'
            ? chainDisplay(action)
            : displayCommand(buildArgv(plugin, action, prepared.values).redacted);
        json(res, 200, {
          command,
          masked: command.includes(SECRET_MASK),
          // http / chain 的变量在执行时展开，这里原样展示占位符
          hasPlaceholders: action.type !== 'exec',
        });
        return;
      }

      // 插件设置项：声明式配置的读写。密钥只进不出——写进去的是明文，
      // 任何一次读都只回掩码，避免界面 / 日志 / 截图把密钥带出去。
      if (url.pathname === '/api/plugin/config') {
        // 请求体只能读一次：读第二次时 'end' 早已发生，Promise 永远不会 resolve
        const body = req.method === 'POST' ? await readBody(req) : {};
        const id = req.method === 'GET'
          ? (url.searchParams.get('plugin') ?? '')
          : String(body['plugin'] ?? '');
        const entry = findPlugin(id);
        if (!entry?.plugin) {
          json(res, 404, { error: `没有找到插件 ${id}` });
          return;
        }
        if (req.method === 'GET') {
          json(res, 200, { settings: publicSettings(entry.plugin) });
          return;
        }
        if (req.method !== 'POST') {
          json(res, 405, { error: '只支持 GET / POST' });
          return;
        }
        const patch = body['patch'];
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
          json(res, 400, { error: 'patch 必须是「设置项名 → 值」的对象' });
          return;
        }
        const r = writeSettings(entry.plugin, patch as Record<string, unknown>);
        json(res, r.ok ? 200 : 400, {
          ok: r.ok,
          ...(r.error ? { error: r.error } : {}),
          settings: publicSettings(entry.plugin),
        });
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

      // 第十七轮⑤⑥：外部接力——在系统文件管理器里揭示文件 / 用外部编辑器打开文本。
      // target 走白名单：只接受 DATA_DIR/LOG_DIR/PKG_ROOT 之内的绝对路径（防任意目录探测）。
      if (url.pathname === '/api/open' && req.method === 'POST') {
        const body = await readBody(req);
        if (body['dir'] === 'exports') {
          // 简写：浏览器下载目录拿不到绝对路径，给个一键开导出目录的入口
          const dir = path.join(DATA_DIR, 'exports');
          fs.mkdirSync(dir, { recursive: true });
          json(res, 200, { opened: dir, hint: '提示：浏览器「下载」的文件在系统下载目录，此目录是「编辑器打开」落盘的位置' });
          return;
        }
        const target = String(body['target'] ?? '');
        const abs = path.resolve(target);
        const inSandbox = [DATA_DIR, LOG_DIR, PKG_ROOT].some((base) => abs.startsWith(path.resolve(base) + path.sep) || abs === path.resolve(base));
        if (!target || !path.isAbsolute(abs) || !inSandbox) {
          json(res, 400, { error: '只允许打开 zerokit 数据/日志/程序目录内的路径' });
          return;
        }
        if (!fs.existsSync(abs)) {
          json(res, 404, { error: `路径不存在：${abs}` });
          return;
        }
        const { spawn } = await import('node:child_process');
        // explorer 打开「文件所在目录并选中」要 /select,；macOS/Linux 直接 open/xdg-open 目标
        const exe = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        const argv = process.platform === 'win32' && fs.statSync(abs).isFile() ? ['/select,', abs] : [abs];
        await new Promise<void>((resolve) => {
          const child: import('node:child_process').ChildProcess = spawn(exe, argv, { windowsHide: true, detached: true });
          child.on('error', () => resolve());
          child.on('spawn', () => resolve());
          setTimeout(resolve, 3000);
        });
        json(res, 200, { opened: abs });
        return;
      }

      // 第十七轮⑤：把文本丢给外部编辑器（ZEROKIT_EDITOR 环境变量，或系统默认）。
      // 内容先落到数据目录 exports/ 再打开——编辑器改的是文件，不碰剪贴板。
      if (url.pathname === '/api/edit' && req.method === 'POST') {
        const body = await readBody(req);
        const text = String(body['text'] ?? '');
        const name = String(body['name'] ?? 'result.txt').replace(/[^\w.-]+/g, '-').slice(0, 60) || 'result.txt';
        const editorRaw = process.env['ZEROKIT_EDITOR'] ?? '';
        let editor = editorRaw.split(/\s+/).filter(Boolean);
        if (!editor.length) {
          // 没配就按平台给默认：macOS 的 open -t、Windows notepad、Linux xdg-open
          editor = process.platform === 'darwin' ? ['open', '-t']
            : process.platform === 'win32' ? ['notepad'] : ['xdg-open'];
        }
        const dir = path.join(DATA_DIR, 'exports');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${Date.now()}-${name}`);
        fs.writeFileSync(file, text, 'utf-8');
        const { spawn } = await import('node:child_process');
        const ok = await new Promise<boolean>((resolve) => {
          const child: import('node:child_process').ChildProcess = spawn(editor[0] ?? 'open', [...editor.slice(1), file], { windowsHide: true, detached: true });
          child.on('error', () => resolve(false));
          child.on('spawn', () => resolve(true));
          setTimeout(() => resolve(false), 3000);
        });
        if (!ok) {
          json(res, 500, { error: `打不开编辑器「${editorRaw || editor.join(' ')}」——设置环境变量 ZEROKIT_EDITOR 指向你的编辑器（如 code --wait）后重试`, file });
          return;
        }
        json(res, 200, { file, editor: editor.join(' ') });
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

      // ---------------------------------------------------------------- 插件安装 / 更新
      //
      // 装第三方插件是高权限动作，和跑 mutate 动作同级：先摊开能力（preview），
      // 用户确认拿到令牌后才落地。令牌绑「来源字符串」，安装时重新拉取——
      // 确认的含义是「我看过这个来源的能力并同意装它」。

      if (url.pathname === '/api/plugin/install' && req.method === 'POST') {
        const body = await readBody(req);
        const source = String(body['source'] ?? '').trim();
        if (!source) {
          json(res, 400, { error: '缺少来源：给一个 git 仓库地址或本地目录' });
          return;
        }
        const preview = previewAdd(source);
        if (!preview.ok || !preview.load.plugin) {
          json(res, 400, {
            error: preview.message ?? `清单没通过校验：${preview.load.errors.join('；')}`,
          });
          return;
        }
        const p = preview.load.plugin;
        if (typeof body['confirm'] !== 'string') {
          // 第一步：摊开全部能力让人审查（和集市 install 的原则一致）
          json(res, 200, {
            needConfirm: true,
            confirm: installToken('install', preview.source),
            plugin: {
              id: p.id, name: p.name, version: p.version, summary: p.summary,
              requires: Object.keys(p.requires),
              pluginDeps: depStates(p),
              missingPluginDeps: missingDeps(p),
              actions: p.actions.map((a) => ({
                id: a.id, title: a.title, risk: a.risk,
                command: a.type === 'http' ? `${a.method} ${a.url ?? ''}` : a.run.join(' '),
              })),
            },
            warnings: preview.load.warnings,
          });
          return;
        }
        if (!sameToken(body['confirm'], installToken('install', preview.source))) {
          json(res, 403, { error: '确认令牌不对：请重新预览后再确认' });
          return;
        }
        const isLocal = !/^(https?:\/\/|git@)/.test(preview.source)
          && (() => { try { return fs.statSync(preview.source).isDirectory(); } catch { return false; } })();
        const result = isLocal
          ? addFromDir(preview.source, { source: { type: 'dir', installedAt: new Date().toISOString(), installedVersion: '' } })
          : addFromGit(preview.source);
        // 先装插件、再补依赖：插件目录里已经能看到它缺什么，补齐过程也按同一套校验走。
        // 依赖只在用户显式勾选 / 带 withDeps 时才装——装插件等于允许执行代码，
        // 不能因为「顺手」就装一堆没看过的能力。
        let depsInstalled: string[] = [];
        let depsErrors: string[] = [];
        let depsMissing: string[] = [];
        if (result.ok && result.id) {
          const installed = findPlugin(result.id)?.plugin;
          if (installed) {
            if (body['withDeps'] === true) {
              const r = installDeps(installed);
              depsInstalled = r.installed;
              depsErrors = r.errors;
            }
            depsMissing = missingDeps(installed);
          }
        }
        json(res, 200, {
          ok: result.ok,
          message: result.message,
          warnings: result.warnings,
          depsInstalled,
          depsErrors,
          depsMissing,
          // 前端收到后重新拉 /api/plugins
        });
        return;
      }

      // 集市：浏览 / 添加 / 刷新 / 移除 / 预览 / 安装。
      // 索引来自本地缓存，只有 add 与 refresh 会碰网络（git clone）；
      // 安装仍然要能力摊开 + 确认令牌，令牌绑定「集市 + 插件 id」。
      if (url.pathname === '/api/markets' && req.method === 'GET') {
        json(res, 200, marketSnapshot());
        return;
      }

      if (url.pathname === '/api/market/add' && req.method === 'POST') {
        const body = await readBody(req);
        const source = String(body['source'] ?? '').trim();
        if (!source) {
          json(res, 400, { error: '缺少集市地址：git 地址、owner/repo 或本地目录' });
          return;
        }
        const result = addMarket(source);
        json(res, result.ok ? 200 : 400, { ...result, ...marketSnapshot() });
        return;
      }

      if (url.pathname === '/api/market/remove' && req.method === 'POST') {
        const body = await readBody(req);
        const name = String(body['name'] ?? '');
        if (!removeMarket(name)) {
          json(res, 404, { error: `没有这个集市：${name}` });
          return;
        }
        json(res, 200, {
          ok: true,
          message: `已移除集市「${name}」（已装的插件不受影响）`,
          ...marketSnapshot(),
        });
        return;
      }

      if (url.pathname === '/api/market/refresh' && req.method === 'POST') {
        const body = await readBody(req);
        const name = String(body['name'] ?? '');
        const result = refreshMarket(name);
        json(res, result.ok ? 200 : 400, { ...result, ...marketSnapshot() });
        return;
      }

      if (url.pathname === '/api/market/preview' && req.method === 'POST') {
        const body = await readBody(req);
        const id = String(body['id'] ?? '');
        const market = typeof body['market'] === 'string' ? body['market'] : undefined;
        const preview = previewInstall(id, market);
        if (!preview) {
          json(res, 404, { error: `所有集市里都没有插件 "${id}"` });
          return;
        }
        json(res, 200, {
          needConfirm: true,
          confirm: installToken('market', `${preview.market}:${id}`),
          id,
          market: preview.market,
          entry: preview.entry,
          actions: preview.load.plugin?.actions.map(previewAction) ?? [],
          errors: preview.load.errors,
          warnings: preview.load.warnings,
          pluginDeps: preview.load.plugin ? depStates(preview.load.plugin) : [],
          missingPluginDeps: preview.load.plugin ? missingDeps(preview.load.plugin) : [],
        });
        return;
      }

      // 集市「装前试跑」：用临时目录里摊开的插件真跑一次。只放行 read 风险——
      // 没审查过的代码绝不执行有副作用的动作。cwd 指向临时目录本身（插件代码的相对引用才有效）。
      if (url.pathname === '/api/market/tryrun' && req.method === 'POST') {
        const body = await readBody(req);
        const id = String(body['id'] ?? '');
        const actionId = String(body['action'] ?? '');
        const market = typeof body['market'] === 'string' ? body['market'] : undefined;
        const preview = previewInstall(id, market);
        const plugin = preview?.load.plugin;
        if (!preview || !plugin) {
          json(res, 404, { error: `集市里没有插件 "${id}"，或清单没通过校验` });
          return;
        }
        const action = plugin.actions.find((a) => a.id === actionId);
        if (!action) {
          json(res, 404, { error: `插件 ${id} 没有动作 ${actionId}` });
          return;
        }
        if (action.risk !== 'read') {
          json(res, 403, { error: '只放行只读动作的试运行——有副作用的动作请安装后再用（会走确认弹窗）' });
          return;
        }
        const rawValues = (body['values'] ?? {}) as Record<string, unknown>;
        const values: Record<string, unknown> = {};
        for (const param of action.params) {
          const raw = rawValues[param.name];
          if (raw === undefined || raw === null || raw === '') continue;
          const coerced = coerceParam(param, raw);
          if (coerced.error) {
            json(res, 400, { error: `${param.name}：${coerced.error}` });
            return;
          }
          values[param.name] = coerced.value;
        }
        const prepared = applyDefaults(action, values);
        if (prepared.errors.length > 0) {
          json(res, 400, { error: prepared.errors.join('；') });
          return;
        }
        const result = await runAction(plugin, action, { caller: 'ui', values: prepared.values });
        json(res, 200, {
          ok: result.ok,
          stdout: result.stdout,
          stderr: result.stderr,
          error: result.error,
          ms: result.ms,
          command: displayCommand(result.argv ?? []),
        });
        return;
      }

      if (url.pathname === '/api/market/install' && req.method === 'POST') {
        const body = await readBody(req);
        const id = String(body['id'] ?? '');
        const market = typeof body['market'] === 'string' ? body['market'] : undefined;
        const hit = findEntry(id, market);
        if (!hit) {
          json(res, 404, { error: `所有集市里都没有插件 "${id}"` });
          return;
        }
        if (!sameToken(String(body['confirm'] ?? ''), installToken('market', `${hit.market}:${id}`))) {
          json(res, 403, { error: '确认令牌不对：请重新预览后再确认' });
          return;
        }
        const result = installFromMarket(id, hit.market);
        let depsInstalled: string[] = [];
        let depsErrors: string[] = [];
        let depsMissing: string[] = [];
        if (result.ok && result.id) {
          const installed = findPlugin(result.id)?.plugin;
          if (installed) {
            if (body['withDeps'] === true) {
              const r = installDeps(installed);
              depsInstalled = r.installed;
              depsErrors = r.errors;
            }
            depsMissing = missingDeps(installed);
          }
        }
        json(res, 200, {
          ok: result.ok,
          message: result.message,
          warnings: result.warnings,
          depsInstalled,
          depsErrors,
          depsMissing,
          ...marketSnapshot(),
        });
        return;
      }

      if (url.pathname === '/api/plugin/check' && req.method === 'POST') {
        const body = await readBody(req);
        const id = String(body['id'] ?? '');
        const check = checkUpdate(id);
        json(res, 200, {
          id: check.id, current: check.current, latest: check.latest,
          available: check.available, sourceType: check.source?.type ?? null,
          sourceText: check.sourceText,
          addedActions: check.addedActions, removedActions: check.removedActions,
          reason: check.reason ?? null,
          // 有更新时带上确认令牌：更新同样要先看一眼能力变化
          confirm: check.available ? installToken('update', check.id) : null,
        });
        return;
      }

      if (url.pathname === '/api/plugin/update' && req.method === 'POST') {
        const body = await readBody(req);
        const id = String(body['id'] ?? '');
        const confirm = typeof body['confirm'] === 'string' ? body['confirm'] : '';
        if (!confirm || !sameToken(confirm, installToken('update', id))) {
          json(res, 403, { error: '缺少或错误的确认令牌：先 POST /api/plugin/check 看能力变化' });
          return;
        }
        const result = applyUpdate(id);
        json(res, 200, { ok: result.ok, message: result.message, warnings: result.warnings });
        return;
      }

      // 卸载是删除操作，和更新同级的两步确认：先拿令牌，用户点了「确认卸载」再带回来
      if (url.pathname === '/api/plugin/remove' && req.method === 'POST') {
        const body = await readBody(req);
        const id = String(body['id'] ?? '');
        if (!listPlugins().some((e) => e.plugin?.id === id)) {
          json(res, 404, { error: `没有插件 ${id}` });
          return;
        }
        const users = dependents(id);
        if (users.length > 0 && body['force'] !== true) {
          json(res, 409, {
            error: `还有插件依赖 ${id}：${users.join(', ')}`,
            dependents: users,
          });
          return;
        }
        const confirm = typeof body['confirm'] === 'string' ? body['confirm'] : '';
        if (!confirm) {
          json(res, 200, { needConfirm: true, confirm: installToken('remove', id), dependents: users });
          return;
        }
        if (!sameToken(confirm, installToken('remove', id))) {
          json(res, 403, { error: '确认令牌不对' });
          return;
        }
        const ok = removePlugin(id);
        json(res, 200, { ok, message: ok ? `已卸载 ${id}` : `没有插件 ${id}` });
        return;
      }

      // 插件脚手架进界面：在数据目录 dev 区生成可跑的骨架并进入开发模式。
      // 沿用内核 scaffoldPlugin 的全部校验（id 非法 / 目录已存在都会被拒），不另写一份。
      if (url.pathname === '/api/plugin/new' && req.method === 'POST') {
        const body = await readBody(req);
        const id = String(body['id'] ?? '').trim();
        const runtime = ['node', 'python'].includes(String(body['runtime'])) ? String(body['runtime']) as 'node' | 'python' : 'node';
        const name = String(body['name'] ?? '').trim();
        const { scaffoldPlugin } = await import('./core/scaffold.ts');
        // 骨架统一落在数据目录的 dev/ 下（不在仓库里，删数据目录即重置）
        const devDir = path.join(DATA_DIR, 'dev');
        fs.mkdirSync(devDir, { recursive: true });
        const r = scaffoldPlugin(id, { runtime, name: name || undefined, dir: devDir });
        if (!r.ok) {
          json(res, 400, { error: r.message, files: r.files });
          return;
        }
        // 转成开发模式安装：改文件即生效，界面立刻能看到这个插件
        const { devLink } = await import('./core/registry.ts');
        const dev = devLink(r.dir!);
        if (!dev.ok) {
          json(res, 500, { error: dev.message });
          return;
        }
        json(res, 200, {
          ok: true,
          id: dev.id,
          dir: r.dir,
          files: r.files,
          message: `骨架已生成并进入开发模式：${r.dir}`,
          ...marketSnapshot(),
        });
        return;
      }

      // 偏好导出/导入：把本机 zerokit.* 的 localStorage 偏好打包成一份 JSON。
      // 导出由前端拼好 POST 上来存档；导入时校验形状再原样返回，前端负责写回。
      if (url.pathname === '/api/prefs/export' && req.method === 'POST') {
        const body = await readBody(req);
        const prefs = body['prefs'];
        if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) {
          json(res, 400, { error: 'prefs 要是一个对象' });
          return;
        }
        const payload = { version: 1, exportedAt: new Date().toISOString(), prefs };
        json(res, 200, { ok: true, payload });
        return;
      }

      if (url.pathname === '/api/prefs/import' && req.method === 'POST') {
        const body = await readBody(req);
        const payload = body['payload'];
        const prefs = (payload as Record<string, unknown> | undefined)?.['prefs'];
        if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) {
          json(res, 400, { error: '文件形状不对：要有 payload.prefs 对象' });
          return;
        }
        const clean: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(prefs as Record<string, unknown>)) {
          // 只认 zerokit. 前缀的键，别的键一律丢弃——不往 localStorage 塞不明东西
          if (!k.startsWith('zerokit.')) continue;
          clean[k] = v;
        }
        json(res, 200, { ok: true, prefs: clean, count: Object.keys(clean).length });
        return;
      }

      // MCP 授权面板：列出所有有副作用的动作与其授权状态；POST 增/撤授权。
      // 授权名单与 `zkit mcp allow` 是同一份（~/.zerokit/allow.json，第七十七轮起与 audit 体系统一）。
      if (url.pathname === '/api/mcp/allow' && req.method === 'GET') {
        const mcp = await import('./mcp.ts');
        const allow = mcp.loadAllow();
        const items = mcp.collectTools()
          .filter(({ plugin, action }) => action.risk !== 'read')
          .map(({ plugin, action }) => ({
            key: `${plugin.id}.${action.id}`,
            pluginId: plugin.id,
            pluginName: plugin.name,
            title: action.title,
            risk: action.risk,
            allowed: allow.has(`${plugin.id}.${action.id}`),
          }));
        json(res, 200, { items, allowedCount: items.filter((x) => x.allowed).length });
        return;
      }

      if (url.pathname === '/api/mcp/allow' && req.method === 'POST') {
        const body = await readBody(req);
        const key = String(body['key'] ?? '').trim();
        const revoke = body['revoke'] === true;
        // key 只认「插件id.动作id」的形状——防手滑把别的东西写进名单
        if (!/^[\w.-]+\.[\w.-]+$/.test(key)) {
          json(res, 400, { error: '授权目标要写成 插件id.动作id 的形状' });
          return;
        }
        const mcp = await import('./mcp.ts');
        const [pluginId, actionId] = key.split('.');
        const hit = mcp.collectTools().find((t) => t.plugin.id === pluginId && t.action.id === actionId);
        if (!hit) {
          json(res, 404, { error: `没有这个动作：${key}` });
          return;
        }
        if (hit.action.risk === 'read') {
          json(res, 400, { error: '只读动作默认放行，不需要授权' });
          return;
        }
        const allow = mcp.loadAllow();
        if (revoke) allow.delete(key);
        else allow.add(key);
        mcp.saveAllow(allow);
        json(res, 200, { ok: true, allowed: !revoke, key });
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
          onDone: (info) => {
            if (!closed) send('done', info);
            // 每轮结束存一次快照：界面刷新后能接上刚才的对话
            const t = wb.transcript?.();
            if (t) chatArchives.set(sessionId, t);
          },
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
          // 还没确认：把"到底要跑什么"原样交给前端展示。
          // 组合动作没有 argv，就把整条链路摊开；http 动作显示请求行。
          const command = action.type === 'chain'
            ? chainDisplay(action)
            : action.type === 'http'
              ? `${action.method} ${action.url}`
              : displayCommand(buildArgv(plugin, action, withDefaults.values).redacted);
          json(res, 200, {
            needConfirm: true,
            risk: action.risk,
            command,
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

        // 第六十七轮①⑤：执行中登记 + AbortController，/api/stop 可中断
        const ac = new AbortController();
        const runKey = `${plugin.id}.${action.id}`;
        runningRuns.set(runKey, ac);
        let result;
        try {
          result = await runAction(plugin, action, {
            caller: 'ui', values: withDefaults.values, signal: ac.signal,
          });
        } finally {
          runningRuns.delete(runKey);
        }
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
          stopped: result.stopped === true,
        });
        return;
      }

      // 第六十七轮①⑤：停止指定动作的全部在途执行
      if (url.pathname === '/api/stop' && req.method === 'POST') {
        const body = await readBody(req);
        const key = String(body['key'] ?? '');
        if (!key) {
          // 停全部在途（Ctrl+. 不在详情页时的语义）
          const n = runningRuns.size;
          for (const [k, ac] of runningRuns) { ac.abort(); runningRuns.delete(k); }
          json(res, 200, { stopped: n > 0, count: n });
          return;
        }
        const ac = runningRuns.get(key);
        if (!ac) { json(res, 404, { error: '该动作当前没有在执行' }); return; }
        ac.abort();
        runningRuns.delete(key);
        json(res, 200, { stopped: true });
        return;
      }

      // 插件自带的 web 面（静态托管 + 桥注入），与应用自己的前端分开
      if (url.pathname.startsWith('/p/') && req.method === 'GET') {
        servePluginPage(res, url.pathname);
        return;
      }
      if (url.pathname === '/_zkit/bridge.js' && req.method === 'GET') {
        const bridge = path.join(WEB_DIR, 'zkit-bridge.js');
        try {
          res.writeHead(200, {
            'content-type': 'text/javascript; charset=utf-8',
            'cache-control': 'no-store',
          }).end(fs.readFileSync(bridge));
        } catch {
          res.writeHead(404).end('bridge 脚本缺失');
        }
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

/** zkit ui 的入口。openPath：--open 时打开的路径（含 hash），默认根页面 */
export async function cli(args: string[], opts: { openPath?: string } = {}): Promise<number> {
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
    const target = opts.openPath ? url + opts.openPath : url;
    const argv = process.platform === 'win32' ? ['/c', 'start', '', target] : [target];
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