// 剪贴板历史的**纯逻辑**：读、追加、去重、裁剪、搜索。
//
// 为什么单独一个文件，而不是全塞进 clipboard.mjs：
//   去重、条数上限这些规则是这个插件的核心，也最容易写错（边界在"刚好第 N+1 条"）。
//   放在这里就是一堆纯函数——给一个目录路径就能跑，不需要起 PowerShell、
//   不需要真的碰剪贴板。测试因此可以造几行历史文件直接把规则钉死。
//
// 存储格式：一行一条 JSON（JSONL）。选 JSONL 而不是一个大 JSON 数组，是因为
// 追加只要 append 一行，不需要"读全量 → 解析 → 改 → 全量写回"，
// 而且进程被强杀时最多丢最后一行，不会整个文件变砖。每行形如：
//   {"at":"2026-10-09T05:33:12.345Z","length":386,"max_length":32000,"text":"..."}
import fs from 'node:fs';
import path from 'node:path';

export const HISTORY_FILE = 'history.jsonl';

/** 默认保留的条数上限。《默认值同时写在 plugin.toml 的参数里，两处必须一致。》 */
export const DEFAULT_MAX_ENTRIES = 500;
/** 单条文本的来源长度上限：超长内容（比如整份文件）只留前 32K 字符，避免历史文件失控。 */
export const DEFAULT_MAX_LENGTH = 32000;

export function historyPath(dataDir) {
  return path.join(dataDir, HISTORY_FILE);
}

/** 单条正文截断。length 记的是**原文**长度，截断与否不影响它。 */
export function clipText(text, maxLength) {
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

/**
 * 读出全部历史，**最新的在前**。
 *
 * 解析失败的行直接跳过而不报错：文件可能因为断电/被杀留下半行，
 * 这时候用户想看的是"还有什么历史"，不是一句"文件坏了"。
 * 同时把坏行数带出来，`list` 可以在有坏行时提示一句。
 */
export function readEntries(dataDir) {
  let raw;
  try {
    raw = fs.readFileSync(historyPath(dataDir), 'utf8');
  } catch {
    return { entries: [], damaged: 0 }; // 文件还不存在（从没监听过的正常情况）就当空历史
  }
  const entries = [];
  let damaged = 0;
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const o = JSON.parse(s);
      if (typeof o?.text !== 'string') throw new Error('缺 text');
      entries.push({
        at: typeof o.at === 'string' ? o.at : '',
        length: Number.isFinite(o.length) ? o.length : o.text.length,
        max_length: Number.isFinite(o.max_length) ? o.max_length : null,
        text: o.text,
        // 存进去时被截断了才置位，靠这个在界面上标一句"（已截断）"
        truncated: Number.isFinite(o.length) && o.length > o.text.length,
      });
    } catch {
      damaged++;
    }
  }
  return { entries: entries.reverse(), damaged };
}

/**
 * 打开一份历史，返回一个**有状态**的追加句柄。
 *
 * 为什么要有状态：监听进程一次轮询可能只追加一条，但一分钟可能追加几十条。
 * 每次都"读全量文件 → 判断去重 → 判断条数 → 写回"是 O(文件) 重复劳动；
 * 这里在打开时读一次，之后条数和"最近一条"都记在内存里。
 * 单条追加的那次一行也仍然是真的追加，不需要重写文件。
 */
export function openHistory(dataDir, { maxEntries = DEFAULT_MAX_ENTRIES, maxLength = DEFAULT_MAX_LENGTH } = {}) {
  const prev = readEntries(dataDir);
  let count = prev.entries.length;
  let lastText = prev.entries[0]?.text ?? null; // entries 最新在前

  return {
    count: () => count,

    /**
     * 追加一条。返回 {added, reason}。
     *
     * 去重规则：**与最近一条相同就不记**。
     * 剪贴板轮询天生会重复看到同一份内容（用户复制两次同样的文本、或者
     * 别处让剪贴板"抖"了一下），不挡掉的话历史里全是重复行。
     * 注意是"与最近一条"而不是"与任意一条"：A→B→A 这种来回复制是真实操作，
     * 该记两条 A。
     */
    append(text, now = new Date()) {
      if (typeof text !== 'string' || text.length === 0) return { added: false, reason: 'empty' };
      if (text === lastText) return { added: false, reason: 'duplicate' };

      const entry = {
        at: now.toISOString(),
        length: text.length,
        max_length: maxLength,
        text: clipText(text, maxLength),
      };
      fs.mkdirSync(dataDir, { recursive: true });
      fs.appendFileSync(historyPath(dataDir), JSON.stringify(entry) + '\n', 'utf8');

      count++;
      lastText = text;
      // 超出上限就紧凑一次。规则是"文件里就是最近 N 条"这么简单的一条，
      // 不留缓冲区——典型负载下 500 条也就几十 KB，重写一次不到 1ms，
      // 换来的是 `wc -l` 和历史条数永远对得上。
      if (count > maxEntries) {
        // readEntries 给的就是最新在前，直接截前 N 条就是"最近的 N 条"
        const kept = readEntries(dataDir).entries.slice(0, maxEntries);
        writeAtomic(dataDir, kept);
        count = maxEntries;
      }
      return { added: true, reason: 'ok', entry };
    },
  };
}

/** 一次性追加（不开句柄的调用方用；语义与 openHistory().append 完全一致） */
export function appendEntry(dataDir, text, opts = {}) {
  return openHistory(dataDir, opts).append(text);
}

/**
 * 全量重写历史。先写临时文件再 rename 覆盖。
 *
 * 为什么不直接 writeFileSync 覆盖：中途被杀会留下一个写到一半的文件，
 * 历史就全丢了。rename 在同一个卷上是原子的，要么还是旧文件、要么已经是新的。
 *
 * @param entriesNewestFirst 最新在前（和 readEntries 的输出一致），落盘时再翻成
 *                           时间正序——文件按追加顺序读最自然。
 */
function writeAtomic(dataDir, entriesNewestFirst) {
  const target = historyPath(dataDir);
  const tmp = `${target}.tmp`;
  const body = entriesNewestFirst
    .slice()
    .reverse()
    .map((e) => JSON.stringify({ at: e.at, length: e.length, max_length: e.max_length, text: e.text }))
    .join('\n');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(tmp, body.length ? body + '\n' : '', 'utf8');
  fs.renameSync(tmp, target);
}

/** 清空历史，返回删掉了多少条 */
export function clearHistory(dataDir) {
  const { entries } = readEntries(dataDir);
  try {
    fs.rmSync(historyPath(dataDir), { force: true });
  } catch {
    /* 删不掉就当本来就没了 */
  }
  return { removed: entries.length };
}

/**
 * 关键词搜索。**大小写不敏感**——搜 "hello" 应该能命中 "Hello World"，
 * 否则用户得先猜当初复制时是大写还是小写。
 */
export function searchEntries(entries, keyword, limit = 20) {
  const needle = String(keyword).toLowerCase();
  const hit = [];
  for (const e of entries) {
    if (e.text.toLowerCase().includes(needle)) {
      hit.push(e);
      if (hit.length >= limit) break;
    }
  }
  return hit;
}

/** 按下标取一条：index 是 `list` 里显示的序号，**从 1 开始、最新的是 1**。 */
export function selectEntry(entries, index) {
  if (!Number.isInteger(index) || index < 1 || index > entries.length) {
    return null;
  }
  return entries[index - 1] ?? null;
}

/** 显示用的时间：ISO(UTC) 转成本地可读，机器可读的那份仍然留在文件里 */
export function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
    + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}