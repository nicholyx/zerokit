// uTools 运行时垫片。
//
// 用法（由适配层生成的 run 模板调用，不用手敲）：
//   node utools-runtime.mjs <插件入口脚本> --zkit-code <code> --zkit-data <数据目录> ...
//
// 它做三件事：
//   1. 装上 globalThis.utools（以及 window.utools）——插件代码里就是这么用的
//   2. 加载插件入口脚本
//   3. 派发 onPluginEnter，把结果送出去
//
// 说清楚**没做什么**：这里没有 Electron，没有渲染进程，没有窗口。所以
// `document.querySelector('body').innerHTML = ...` 这种插件在这里拿不到结果——
// 我们会把这种情况变成一条明确的报错，而不是让用户对着空白界面猜。
//
// 复刻的是 utools API 里"无界面也能完成"的那部分：读输入、算、输出结果、读写存储、
// 调系统默认程序。OS 级能力（读活动窗口、模拟键鼠、粘贴进前台窗口）没有对应实现，
// 被调用时抛的是"这个能力需要 uTools 本体"这种能看懂的错，而不是 undefined is not a function。

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------- 参数

const argv = process.argv.slice(2);
const opts = { code: '', data: '', plugin: '', payload: '' };
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--zkit-code') opts.code = argv[++i] ?? '';
  else if (a === '--zkit-data') opts.data = argv[++i] ?? '';
  else if (a === '--zkit-plugin') opts.plugin = argv[++i] ?? '';
  else if (a.startsWith('--zkit-payload=')) opts.payload = a.slice('--zkit-payload='.length);
  else positional.push(a);
}

const entry = positional[0];
if (!entry) {
  process.stderr.write('utools-runtime: 没有给出插件入口脚本\n');
  process.exit(2);
}

// 插件自己看到 argv 时不该看到我们的私有开关（有些插件会解析 argv）
process.argv = [process.execPath, entry];

const pluginName = opts.plugin || path.basename(path.dirname(entry));
const quiet = /^(1|true|yes)$/i.test(process.env['ZKIT_UTOOLS_QUIET'] ?? '');

let printed = false;
const out = (text) => {
  printed = true;
  process.stdout.write(String(text).endsWith('\n') ? String(text) : String(text) + '\n');
};
const err = (text) => {
  printed = true;
  process.stderr.write(String(text).endsWith('\n') ? String(text) : String(text) + '\n');
};

// ---------------------------------------------------------------- 存储

// uTools 的 dbStorage 是"按 key 存 JSON"，语义上等同于每个插件一份偏好设置。
// 落到 {data_dir}（跨插件更新保留），不是插件目录——插件目录是会随更新被覆盖的。
function storageFile() {
  return path.join(opts.data || path.join(process.cwd(), '.zkit-data'), 'utools-storage.json');
}

function readStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(storageFile(), 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

let store = null;
function storeNow() {
  if (store === null) store = readStore();
  return store;
}
function writeStore() {
  try {
    fs.mkdirSync(path.dirname(storageFile()), { recursive: true });
    fs.writeFileSync(storageFile(), JSON.stringify(store ?? {}, null, 2));
  } catch (e) {
    err(`utools-runtime: 存储写不进去：${e.message}`);
  }
}

// ---------------------------------------------------------------- 回调

const enterCbs = [];
const readyCbs = [];
const outCbs = [];

function done(code) {
  process.exitCode = code;
  for (const cb of outCbs) {
    try { cb(); } catch { /* 退出回调里出错不该影响退出码 */ }
  }
  // 非 unref 的定时器：即使插件留下了没清的定时器/句柄，也能保证进程真的退出。
  // 如果事件循环本来就空了，Node 会更早自然退出，这个定时器随之消失。
  setTimeout(() => process.exit(code), 250);
}

function reportError(e) {
  err(`utools-runtime: 插件执行出错：${e && e.stack ? e.stack : String(e)}`);
  process.exitCode = 1;
}

// ---------------------------------------------------------------- 不支持的能力

const UNSUPPORTED = {
  createBrowserWindow: '需要 uTools 的 Electron 窗口',
  createBrowserView: '需要 uTools 的 Electron 视图',
  removeBrowserView: '需要 uTools 的 Electron 视图',
  setBrowserView: '需要 uTools 的 Electron 视图',
  getCurrentWindow: '需要 uTools 的 Electron 窗口',
  redirect: '需要 uTools 的窗口间跳转',
  readCurrentBrowserUrl: '需要 uTools 的浏览器插件',
  simulateKeyboardTap: '需要 uTools 的模拟键鼠能力',
  getCursorScreenPoint: '需要 uTools 的模拟键鼠能力',
  startDrag: '需要 uTools 的拖拽能力',
  createNativeImage: '需要 uTools 的 Electron 能力',
  setFeature: '需要 uTools 的动态功能注册',
  removeFeature: '需要 uTools 的动态功能注册',
  getPath: null,   // 下面有实现，占位说明它不在不支持之列
};
delete UNSUPPORTED.getPath;

const PATHS = {
  home: () => process.env['USERPROFILE'] || process.env['HOME'] || process.cwd(),
  temp: () => process.env['TEMP'] || process.env['TMPDIR'] || process.cwd(),
  desktop: () => path.join(PATHS.home(), 'Desktop'),
  documents: () => path.join(PATHS.home(), 'Documents'),
  downloads: () => path.join(PATHS.home(), 'Downloads'),
  music: () => path.join(PATHS.home(), 'Music'),
  pictures: () => path.join(PATHS.home(), 'Pictures'),
  videos: () => path.join(PATHS.home(), 'Videos'),
  userData: () => opts.data || process.cwd(),
  appData: () => path.join(opts.data || process.cwd(), 'app'),
};

function unsupported(name) {
  return () => {
    throw new Error(`utools.${name} 依赖 uTools 本体（${UNSUPPORTED[name]}），zerokit 的兼容层没有这个能力。`);
  };
}

// ---------------------------------------------------------------- utools 本体

const subInput = { cb: null, placeholder: '', value: '' };

const utools = {
  // --- 生命周期 ---
  onPluginEnter(cb) { if (typeof cb === 'function') enterCbs.push(cb); },
  onPluginReady(cb) { if (typeof cb === 'function') readyCbs.push(cb); },
  onPluginOut(cb) { if (typeof cb === 'function') outCbs.push(cb); },

  // uTools 里这两个是"收起窗口、退回搜索框"。在这里它们唯一有意义的语义就是"我干完了"。
  outPlugin() { done(0); },
  hideMainWindow() { done(0); },
  showMainWindow() { /* 无窗口可显示，语义为空 */ },
  isDarkColors() { return false; },
  isDev() { return false; },
  getAppVersion() { return 'zerokit'; },

  // --- 输出给用户 ---
  // 这是兼容层里最关键的映射：uTools 把结果"贴"到界面上，我们这里没有界面，
  // 所以把它变成 stdout——CLI 直接看到，启动器渲染成结果卡片，MCP 客户端拿到文本。
  showNotification(text) { out(text); },
  showMessageBox(...args) {
    // uTools: (options) 或 (title, message) 两种签名的老代码都有
    if (args.length >= 2 && typeof args[0] === 'string') out(`${args[0]}\n${args[1]}`);
    else if (args[0] && typeof args[0] === 'object') out(args[0].message ?? args[0].title ?? '');
    return 0;
  },

  // --- 剪贴板 / 打开东西 ---
  copyText(text) {
    if (process.platform !== 'win32') return false;
    const ps = 'Set-Clipboard -Value ([Console]::In.ReadToEnd())';
    const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], {
      input: String(text ?? ''), encoding: 'utf8', windowsHide: true,
    });
    return r.status === 0;
  },
  shellOpenExternal(url) {
    openWith(url);
  },
  shellOpenPath(p) {
    openWith(p);
  },
  shellShowItemInFolder(p) {
    openWith(path.dirname(String(p)));
  },

  // --- 子输入框：uTools 是在主输入框下面再挂一层。我们这里没有 UI，
  //     所以把它降级成"直接给一个值、走一遍回调"，让老插件不至于崩。
  setSubInput(cb) { subInput.cb = typeof cb === 'function' ? cb : null; },
  removeSubInput() { subInput.cb = null; },
  setSubInputValue(v) {
    subInput.value = String(v ?? '');
    try { subInput.cb?.({ text: subInput.value }); } catch (e) { reportError(e); }
  },
  subInputFocus() { /* 无输入框可聚焦 */ },
  subInputBlur() { /* 同上 */ },
  setSubInputPlaceholder(p) { subInput.placeholder = String(p ?? ''); },

  // --- 存储 ---
  dbStorage: {
    getItem(key) {
      const v = storeNow()[String(key)];
      return v === undefined ? null : v;
    },
    setItem(key, value) {
      storeNow()[String(key)] = value;
      writeStore();
    },
    removeItem(key) {
      delete storeNow()[String(key)];
      writeStore();
    },
  },
  // db 是文档式存储。这里用一份 JSON 文件近似实现：文档必须有 _id，和 uTools 一致。
  db: {
    put(doc) {
      if (!doc || typeof doc !== 'object' || !doc._id) {
        throw new Error('utools.db.put: 文档必须有 _id 字段');
      }
      const all = storeNow().__docs ?? {};
      all[String(doc._id)] = doc;
      storeNow().__docs = all;
      writeStore();
      return { ok: true, id: doc._id, rev: '1-zkit' };
    },
    get(id) {
      return (storeNow().__docs ?? {})[String(id)] ?? null;
    },
    remove(id) {
      const all = storeNow().__docs ?? {};
      const existed = Object.prototype.hasOwnProperty.call(all, String(id));
      delete all[String(id)];
      storeNow().__docs = all;
      writeStore();
      return existed ? { ok: true, id } : { ok: false, error: 'not found' };
    },
    allDocs() {
      return Object.values(storeNow().__docs ?? {});
    },
  },

  // --- 平台信息 ---
  isWindows: process.platform === 'win32',
  isMacOS: process.platform === 'darwin',
  isLinux: process.platform === 'linux',
  getPath(name) {
    const fn = PATHS[String(name)];
    return fn ? fn() : (opts.data || process.cwd());
  },
  // uTools 用它做机器唯一标识。这里给一个稳定的、不泄露主机名的派生值。
  getNativeId() {
    const seed = `${pluginName}|${PATHS.home()}`;
    let h = 0;
    for (const ch of seed) h = (Math.imul(h, 31) + ch.codePointAt(0)) >>> 0;
    return `zkit${h.toString(16)}`;
  },
};

function openWith(target) {
  const s = String(target ?? '');
  if (!s) return;
  // Windows 上交给系统处理（和"双击"是同一条路），可执行文件/网址都能开。
  // detached + 不接管道：被打开的程序不该拖住插件进程。
  const child = process.platform === 'win32'
    ? spawn('cmd', ['/c', 'start', '', s], { detached: true, stdio: 'ignore', windowsHide: true })
    : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [s], { detached: true, stdio: 'ignore' });
  child.unref();
}

for (const name of Object.keys(UNSUPPORTED)) utools[name] = unsupported(name);

globalThis.utools = utools;
if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
globalThis.window.utools = utools;

// DOM 的友好替代：碰到就抛一句能看懂的话，而不是 "document is not defined"。
// 用一个会抛错的代理，比不定义更省事——插件作者一眼就知道该怎么改。
function domStub(what) {
  return new Proxy({}, {
    get(_t, prop) {
      throw new Error(
        `这个插件用到了浏览器 ${what}.${String(prop)}，而 zerokit 的 uTools 兼容层没有图形界面。`
        + `请把结果改成用 utools.showNotification(...) 输出，或把它当普通 zerokit 插件重写。`,
      );
    },
  });
}
for (const name of ['document', 'navigator', 'localStorage']) {
  if (typeof globalThis[name] === 'undefined') {
    Object.defineProperty(globalThis, name, { get: () => domStub(name), configurable: true });
  }
}

// ---------------------------------------------------------------- 加载并派发

try {
  await import(pathToFileURL(path.resolve(entry)).href);
} catch (e) {
  reportError(e);
  done(1);
}

for (const cb of readyCbs) {
  try { cb(); } catch (e) { reportError(e); }
}

const payload = { code: opts.code, type: 'text', payload: opts.payload };
if (enterCbs.length === 0) {
  // 没有注册 onPluginEnter：多半是"加载即执行"的脚本，它的 console.log 已经在 stdout 里了。
  if (!printed && !quiet) {
    err(`utools-runtime: 插件「${pluginName}」没有注册 onPluginEnter，也没有产生任何输出。`);
  }
} else {
  for (const cb of enterCbs) {
    try {
      const r = cb(payload);
      if (r && typeof r.catch === 'function') r.catch(reportError);
    } catch (e) {
      reportError(e);
    }
  }
  // 给插件一点时间做异步工作；done() 会被显式调用，事件循环空了也会自然退出。
  // 这里不等一个永不 resolve 的 promise（那会把进程挂死），只挂一个兜底超时。
  setTimeout(() => {
    if (!printed && !quiet && process.exitCode !== 1) {
      err(`utools-runtime: 插件「${pluginName}」执行完了但没有任何输出——`
        + '它可能只做界面渲染（DOM），无界面模式下看不到结果。');
    }
  }, 150).unref();
}