#!/usr/bin/env node
// 文件搜索插件的实现。
//
// 与其它插件一样的约定：成功时把结构化内容写到 stdout 并退出 0；失败非 0，错误写 stderr。
// 本插件声明了 runtime = "worker"，而 worker **不能单独设工作目录**，所以这里
// 一律不用相对路径；索引该放哪里由清单把 {data_dir} 当参数传进来（见 plugin.toml），
// 插件不去猜 zerokit 的内部布局。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const mode = args[0] ?? '';

/**
 * 取参数，同时接受 `--k=v` 与 `--k v` 两种写法。
 *
 * 为什么要有后一种：清单里用的是 `--k=v`（这样参数没给值时不会把后面的
 * flag 当成自己的值吃掉），但手工敲命令时 `--k v` 更顺手。
 * 返回 undefined 表示"压根没给"，空串表示"给了但值为空"——两者要区别对待。
 */
function opt(name) {
  const eq = `--${name}=`;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith(eq)) return args[i].slice(eq.length);
    if (args[i] === `--${name}`) return args[i + 1] ?? '';
  }
  return undefined;
}
const hasFlag = (name) => args.includes(`--${name}`) || args.some((a) => a.startsWith(`--${name}=`));

/** 失败：错误写 stderr，返回非 0 退出码。调用方负责把它交给 process.exitCode。 */
function fail(msg) {
  process.stderr.write(`文件搜索：${msg}\n`);
  return 1;
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

// 索引位置：优先用清单传进来的 {data_dir}；直接手工跑脚本时退回和
// zerokit 的约定一致的位置（$ZEROKIT_HOME/data/<插件 id>，默认 ~/.zerokit）。
const DATA_DIR = opt('data-dir') || opt('data_dir') || path.join(
  process.env['ZEROKIT_HOME'] || path.join(os.homedir(), '.zerokit'),
  'data',
  'filesearch',
);
const INDEX_PATH = path.join(DATA_DIR, 'index.json');

// 遍历时要跳过的目录名。这些要么是噪音（node_modules 里几万个没人直接找的文件），
// 要么是系统自己的地盘（回收站、卷影信息），进去只会拖慢索引并频繁撞上权限错误。
const SKIP_NAMES = new Set([
  'node_modules',
  '.git',
  '$recycle.bin',
  'system volume information',
]);
const lower = (s) => s.toLowerCase();
/** path.resolve + 大小写归一：Windows 上同一个文件的各种写法要能对上 */
const norm = (p) => (process.platform === 'win32' ? lower(path.resolve(p)) : path.resolve(p));

// AppData\Local\Temp（也就是 os.tmpdir()）整个跳过：里面是随时会被清掉的中间产物，
// 索引它没有意义。判断用的是**整条路径相等**而不是"路径里含这段"——
// 否则临时目录下面的每一层子目录都会被误伤（CI 和我们自己的测试就跑在它下面）。
const TMP_ROOTS = new Set([norm(os.tmpdir())]);
if (process.platform === 'win32') {
  TMP_ROOTS.add(norm(path.join(os.homedir(), 'AppData', 'Local', 'Temp')));
}

/** 这个目录该不该遍历；返回原因字符串表示跳过，null 表示可以进 */
function skipReason(name, full) {
  if (SKIP_NAMES.has(lower(name))) return `按目录名跳过（${name}）`;
  if (TMP_ROOTS.has(norm(full))) return '系统临时目录';
  return null;
}

/** 解析 dirs 参数：逗号或分号分隔，顺手去掉用户粘贴时带上的引号 */
function splitDirs(text) {
  return text
    .split(/[,;]/)
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter((s) => s !== '');
}

/**
 * 迭代式深度优先遍历（用显式栈而不是递归：目录层级可以很深，别去赌调用栈）。
 *
 * 单个目录读不动（权限、坏盘、遍历中被删）只记下来继续走，绝不因此让整次索引失败——
 * 索引一个真实用户的目录，撞上几个没权限的系统目录是常态，不是异常。
 */
function walk(roots, max) {
  const files = [];
  const denied = [];   // 存在但读不动：权限、被占用等
  const missing = [];  // 压根不存在
  let capped = false;

  const stack = [...roots];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      const reason = e?.code ?? e?.message ?? '未知错误';
      (reason === 'ENOENT' ? missing : denied).push(`${dir}（${reason}）`);
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (skipReason(ent.name, full) === null) stack.push(full);
      } else if (ent.isFile()) {
        files.push(full);
        if (files.length >= max) {
          capped = true;
          break;
        }
      }
      // 符号链接/junction 一律不进：既防目录环，也避免顺着链接跑到别的盘或网络位置
    }
    if (capped) break;
  }
  return { files, denied, missing, capped };
}

function readIndex() {
  let text;
  try {
    text = fs.readFileSync(INDEX_PATH, 'utf8');
  } catch {
    return { state: 'absent' };
  }
  try {
    return { state: 'ok', data: JSON.parse(text) };
  } catch {
    return { state: 'broken' };
  }
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function fmtTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ------------------------------------------------------------------ index

function cmdIndex() {
  const given = opt('dirs') ?? '';
  const prev = readIndex();
  // 不给 dirs 就沿用上次的：重建索引是高频操作，每次都重敲一遍目录太烦
  const requested = given.trim() !== ''
    ? splitDirs(given)
    : (prev.state === 'ok' ? (prev.data.roots ?? []) : []);
  if (requested.length === 0) {
    return fail('没有可索引的目录。请用 --dirs 指定，例如 index --dirs=D:\\work 或 --dirs=D:\\a;E:\\b');
  }

  // 跳过规则对根目录同样生效（"必须跳过"就是必须跳过，不是"路过时才跳过"），
  // 但要说清跳了谁，否则用户会以为索引建好了其实一个目录都没进去
  const skippedRoots = [];
  const roots = requested.filter((r) => {
    const why = skipReason(path.basename(r), r);
    if (why !== null) skippedRoots.push(`${r}（${why}）`);
    return why === null;
  });
  if (roots.length === 0) {
    return fail(`给的目录都在跳过名单里，没有可索引的内容：${skippedRoots.join('; ')}`);
  }

  const rawMax = Number(opt('max'));
  const max = Number.isInteger(rawMax) && rawMax > 0 ? rawMax : 200000;

  const t0 = performance.now();
  const { files, denied, missing, capped } = walk(roots, max);
  const ms = Math.round(performance.now() - t0);

  const record = {
    builtAt: new Date().toISOString(),
    roots,
    max,
    capped,
    count: files.length,
    files,
  };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // 先写临时文件再改名：中途出错时用户手里的仍是上一份完整索引，
    // 而不是一个解析不了的半截文件
    const tmp = `${INDEX_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record));
    fs.renameSync(tmp, INDEX_PATH);
  } catch (e) {
    return fail(`写索引失败：${e.message}（索引位置 ${INDEX_PATH}）`);
  }

  emit({
    索引文件数: files.length,
    耗时: `${ms} 毫秒`,
    根目录: roots,
    是否达到上限: capped,
    无权限目录: denied,
    不存在的目录: missing,
    跳过的根目录: skippedRoots,
    跳过的目录名: [...SKIP_NAMES],
    索引文件: INDEX_PATH,
  });
  return 0;
}

// ----------------------------------------------------------------- search

function cmdSearch() {
  const keyword = (opt('keyword') ?? '').trim();
  if (keyword === '') return fail('缺少 keyword：要查找什么？例如 search --keyword=报告');

  const idx = readIndex();
  // 索引没有就明确报错，而不是返回空列表——返回空列表会让人以为"系统里真没有这个文件"
  if (idx.state === 'absent') {
    return fail(`还没有建立索引（${INDEX_PATH} 不存在）。先跑一次：index --dirs=D:\\你的目录`);
  }
  if (idx.state === 'broken') {
    return fail(`索引文件损坏（${INDEX_PATH}）。请重新跑一次 index 重建`);
  }

  const rawLimit = Number(opt('limit'));
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : 20;
  const kw = lower(keyword);

  const hits = [];
  for (const f of idx.data.files ?? []) {
    const name = path.basename(f);
    // 文件名命中（tier 0）优先于整条路径命中（tier 1）：
    // 搜 "报告" 时，名字里带报告的显然比只是恰好在叫"报告"的目录下的更相关
    const tier = lower(name).includes(kw) ? 0 : (lower(f).includes(kw) ? 1 : -1);
    if (tier >= 0) hits.push({ tier, name, full: f });
  }
  hits.sort((a, b) => a.tier - b.tier
    || a.name.length - b.name.length
    || a.full.length - b.full.length);

  const rows = [];
  for (const hit of hits.slice(0, limit)) {
    try {
      const st = fs.statSync(hit.full);
      rows.push({
        文件名: hit.name,
        路径: hit.full,
        大小: human(st.size),
        修改时间: fmtTime(st.mtime),
      });
    } catch {
      // 索引建好之后文件被删/改名了：跳过这条过期记录，
      // 不能让一条陈旧数据把整次搜索搞失败
    }
  }
  emit(rows);
  return 0;
}

// ----------------------------------------------------------------- status

function cmdStatus() {
  const idx = readIndex();
  if (idx.state === 'absent') {
    // 只读动作不该因为"还没建索引"就报错失败：如实report状态就好
    emit({ 状态: '尚未建立索引', 索引文件: INDEX_PATH });
    return 0;
  }
  if (idx.state === 'broken') {
    emit({ 状态: '索引文件损坏，需要重建', 索引文件: INDEX_PATH });
    return 0;
  }
  let size = 0;
  try {
    size = fs.statSync(INDEX_PATH).size;
  } catch { /* 刚被删掉：大小就报 0 */ }
  emit({
    状态: '索引可用',
    文件数: idx.data.count ?? (idx.data.files ?? []).length,
    建立时间: idx.data.builtAt ? fmtTime(new Date(idx.data.builtAt)) : '未知',
    覆盖根目录: idx.data.roots ?? [],
    上次是否达到上限: Boolean(idx.data.capped),
    索引大小: human(size),
    索引文件: INDEX_PATH,
  });
  return 0;
}

// ------------------------------------------------------------------- open

/** 交给文件管理器的命令。分开一个函数，便于测试在不真的弹窗口的前提下检查它。 */
function openCommand(target) {
  if (process.platform === 'win32') {
    // explorer 的 /select 必须和路径拼成**同一个** argv 元素，中间用逗号且不留空格
    return { cmd: 'explorer', argv: [`/select,${target}`] };
  }
  if (process.platform === 'darwin') return { cmd: 'open', argv: ['-R', target] };
  // Linux 没有统一的"定位到文件"，退而求其次打开它所在的目录
  return { cmd: 'xdg-open', argv: [path.dirname(target)] };
}

function cmdOpen() {
  const raw = opt('path') ?? '';
  if (raw.trim() === '') return fail('缺少 path：要定位哪个文件？');

  // path 是不可信输入。explorer 的参数解析很宽松（/select, 后面基本整段当路径），
  // 所以三道校验都在我们这边做完，绝不把没验过的字符串递过去。
  if (/[\0\n\r"]/.test(raw)) return fail('路径里含控制字符或引号，拒绝执行');

  const target = path.resolve(raw.trim());
  let st;
  try {
    st = fs.statSync(target);
  } catch {
    return fail(`文件不存在：${target}`);
  }

  // 有索引时要求它确实在索引里：这样"能被打开的路径"和"搜索能搜出来的路径"
  // 是同一个集合，避免被一段凭空的路径牵着去打开任意位置。
  const idx = readIndex();
  if (idx.state === 'ok') {
    const wanted = norm(target);
    const inIndex = (idx.data.files ?? []).some((f) => norm(f) === wanted);
    if (!inIndex) {
      return fail(`该文件不在索引里：${target}。索引可能过期了，先重建：index（不填 dirs 会沿用上次的目录）`);
    }
  }

  const { cmd, argv } = openCommand(target);
  const dryRun = hasFlag('dry-run'); // 仅供测试/排查：只报告要执行的命令，不真的弹窗口
  if (!dryRun) {
    try {
      // detached + unref：explorer 是"转交出去就完事"的进程，
      // 我们不该等它，也不该让它随 worker 一起被收走
      spawn(cmd, argv, { detached: true, stdio: 'ignore' }).unref();
    } catch (e) {
      return fail(`调用 ${cmd} 失败：${e.message}`);
    }
  }
  emit({
    已定位: target,
    类型: st.isDirectory() ? '目录' : '文件',
    方式: `${cmd} ${argv.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`,
    ...(dryRun ? { 试运行: true } : {}),
  });
  return 0;
}

// ------------------------------------------------------------------- main

let code = 0;
if (mode === 'index') code = cmdIndex();
else if (mode === 'search') code = cmdSearch();
else if (mode === 'status') code = cmdStatus();
else if (mode === 'open') code = cmdOpen();
else code = fail(`未知动作 "${mode}"（可用：index / search / status / open）`);

// 用 exitCode 而不是 process.exit()：worker 里的 stdout/stderr 是异步写的，
// 立刻退出可能把还没落下的输出吃掉
process.exitCode = code;