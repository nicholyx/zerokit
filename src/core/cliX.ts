// CLI 人体工学层（第四十五轮）：命令历史 / last / 输出格式化 / watch 轮询。
// 全部纯函数（除 IO 落点外）——CLI 只是接线，测试直测函数。
import fs from 'node:fs';
import path from 'node:path';
import { HOME } from './paths.ts';

/** 历史文件：~/.zerokit/history.json（数组，最新在尾）。 */
export const HISTORY_FILE = (): string => path.join(HOME, 'history.json');

export interface HistoryEntry {
  ts: string;          // ISO
  plugin: string;
  action: string;
  argv: string[];      // 去掉 --yes/--json 等控制旗标的原始参数对
  exitCode: number;
}

/** ①读历史（坏行跳过）；不存在返回 []。 */
export function readHistory(): HistoryEntry[] {
  const p = HISTORY_FILE();
  if (!fs.existsSync(p)) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(p, 'utf8')) as unknown;
    return Array.isArray(arr) ? arr.filter((e) => e && typeof (e as HistoryEntry).plugin === 'string') : [];
  } catch {
    return [];
  }
}

/** ②追加一条（上限 200，超出挤最老的）。写失败静默——历史是旁路不是主流程。 */
export function appendHistory(entry: HistoryEntry): void {
  try {
    const list = readHistory();
    list.push(entry);
    const trimmed = list.slice(-200);
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(HISTORY_FILE(), JSON.stringify(trimmed));
  } catch { /* 旁路 */ }
}

/** ③把 HistoryEntry 还原成可执行的 argv（zkit run p a --k v ...）。 */
export function historyToArgv(e: HistoryEntry): string[] {
  return ['run', e.plugin, e.action, ...e.argv];
}

/** ④过滤控制旗标（--quiet/--json/--out 不进历史重放的参数部分——重放要干净的参数面）。 */
export function stripControlFlags(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--quiet' || argv[i] === '--json' || argv[i] === '--copy'
      || argv[i] === '--yes' || argv[i] === '-y'
      || (argv[i] === '--out' && i + 1 < argv.length) || argv[i]?.startsWith('--out=')
      || (argv[i] === '--watch' && i + 1 < argv.length) || argv[i]?.startsWith('--watch=')) {
      if (argv[i]?.startsWith('--out') && argv[i]?.includes('=')) continue;
      if (argv[i]?.startsWith('--watch') && argv[i]?.includes('=')) continue;
      if (argv[i] === '--out' || argv[i] === '--watch') i++; // 吞掉值
      continue;
    }
    out.push(argv[i] ?? '');
  }
  return out;
}

// ---------------------------------------------------------------- 输出格式化

export type Row = Record<string, unknown>;

/** ⑤扁平化：data 若是对象数组直接用；对象包一层 [value]；其它返回 []。 */
export function toRows(data: unknown): Row[] {
  if (Array.isArray(data) && data.length > 0 && data.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
    return data as Row[];
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) return [data as Row];
  return [];
}

// ---------------------------------------------------------------- 第七十五轮：结果再加工

/** 75：行级加工选项（按 pick → sort → uniq → head → sum 的固定序应用）。 */
export interface TransformOpts {
  pick?: string[];        // 只取这些列
  sort?: string;          // 列名，前缀 - 降序
  uniq?: string;          // 按列去重（保首见序）
  head?: number;          // 取前 N 行
  sum?: string;           // 数字列合计（附表尾 TOTAL 行）
}

/** 判数字：字符串也认（'120 MB' 前缀数字），先排空。 */
function numVal(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
    const m = /^-?\d+(?:\.\d+)?/.exec(v.trim());
    return m ? Number(m[0]) : null;
  }
  return null;
}

/** 75：transformRows——pick/sort/uniq/head/sum 组合加工。列不存在时报错（带可用列清单）。 */
export function transformRows(rows: Row[], opts: TransformOpts): { rows: Row[]; error?: string } {
  if (rows.length === 0) return { rows };
  const allKeys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  // ① pick
  let out = rows;
  if (opts.pick && opts.pick.length > 0) {
    const missing = opts.pick.filter((k) => !allKeys.includes(k));
    if (missing.length > 0) return { rows, error: `列不存在：${missing.join('、')}——可用列：${allKeys.join('、')}` };
    out = out.map((r) => Object.fromEntries(opts.pick!.map((k) => [k, r[k]])));
  }
  // ② sort：数字列数值序、文本列字典序；-列 降序
  if (opts.sort) {
    const desc = opts.sort.startsWith('-');
    const col = desc ? opts.sort.slice(1) : opts.sort;
    if (!allKeys.includes(col)) return { rows, error: `排序列不存在：${col}——可用列：${allKeys.join('、')}` };
    const allNum = out.every((r) => numVal(r[col]) !== null);
    out = [...out].sort((a, b) => {
      if (allNum) {
        const d = (numVal(a[col]) ?? 0) - (numVal(b[col]) ?? 0);
        return desc ? -d : d;
      }
      const sa = String(a[col] ?? ''); const sb = String(b[col] ?? '');
      return desc ? sb.localeCompare(sa) : sa.localeCompare(sb);
    });
  }
  // ③ uniq：按列去重保首见序
  if (opts.uniq) {
    if (!allKeys.includes(opts.uniq)) return { rows, error: `去重列不存在：${opts.uniq}——可用列：${allKeys.join('、')}` };
    const seen = new Set<string>();
    out = out.filter((r) => {
      const k = JSON.stringify(r[opts.uniq!] ?? '');
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  }
  // ④ head
  if (opts.head !== undefined && opts.head >= 0) out = out.slice(0, opts.head);
  // ⑤ sum：数字列求和附表尾 TOTAL 行
  if (opts.sum) {
    if (!allKeys.includes(opts.sum)) return { rows, error: `合计列不存在：${opts.sum}——可用列：${allKeys.join('、')}` };
    const bad = out.find((r) => numVal(r[opts.sum!]) === null);
    if (bad) return { rows, error: `合计列「${opts.sum}」含非数字值：${String(bad[opts.sum!]).slice(0, 20)}` };
    const total = out.reduce((a, r) => a + (numVal(r[opts.sum!]) ?? 0), 0);
    // TOTAL 行键集跟 pick 后一致（全键集含未 pick 列会让表格多出一列）
    const sumKeys = (opts.pick && opts.pick.length ? opts.pick : allKeys).filter((k) => k !== opts.sum);
    const tail: Row = Object.fromEntries((opts.pick && opts.pick.length ? opts.pick : allKeys).map((k) => [k, k === opts.sum ? total : '']));
    tail[opts.sum] = total;
    // TOTAL 行首列打标（保住表格可读）
    const firstKey = sumKeys[0] ?? opts.sum;
    if (firstKey !== opts.sum) tail[firstKey] = 'TOTAL';
    out = [...out, tail];
  }
  return { rows: out };
}

/** ⑥table：中文不歪的列宽（宽字符计 2）。 */
export function renderTable(rows: Row[]): string {
  if (rows.length === 0) return '（无表格数据）\n';
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 8);
  const w = (s: string): number => [...s].reduce((a, ch) => a + (/[\u2e80-\ua4cf\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef\u3000-\u303f]/.test(ch) ? 2 : 1), 0);
  const colW = keys.map((k) => Math.max(w(k), ...rows.map((r) => w(String(r[k] ?? '')))) + 2);
  const line = (cells: string[]): string => cells.map((s, i) => s + ' '.repeat(Math.max(0, (colW[i] ?? 0) - w(s)))).join('');
  const head = line(keys);
  const sep = colW.map((n) => '-'.repeat(n - 1)).join(' ');
  const body = rows.slice(0, 50).map((r) => line(keys.map((k) => String(r[k] ?? ''))));
  return [head, sep, ...body].join('\n') + '\n';
}

/** ⑦yaml：极简（键: 值 / - 列表），够管道消费，不引依赖。 */
export function renderYaml(data: unknown): string {
  const scalar = (v: unknown): string => {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'string') return /[:"'\n#[\]{}]/.test(v) ? JSON.stringify(v) : v;
    return String(v);
  };
  if (Array.isArray(data)) {
    if (data.length === 0) return '[]\n';
    return data.map((it) => (it && typeof it === 'object')
      ? '- ' + Object.entries(it as Row).map(([k, v]) => `${k}: ${scalar(v)}`).join(', ')
      : `- ${scalar(it)}`).join('\n') + '\n';
  }
  if (data && typeof data === 'object') {
    return Object.entries(data as Row).map(([k, v]) => `${k}: ${scalar(v)}`).join('\n') + '\n';
  }
  return `${scalar(data)}\n`;
}

/** ⑧csv：RFC4180 引号转义。 */
export function renderCsv(rows: Row[]): string {
  if (rows.length === 0) return '\n';
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 8);
  const cell = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [keys.join(',')];
  for (const r of rows) lines.push(keys.map((k) => cell(String(r[k] ?? ''))).join(','));
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- 第七十四轮：输出与报告体验

/** 74②：大 JSON 结果默认截断摘要——行数超过 limit 时截到 limit 并附展开提示由调用方拼。
 * 返回 { text, truncated, totalLines }；truncated=false 时 text 是全文。 */
export function truncateJsonLines(data: unknown, limit = 30): { text: string; truncated: boolean; totalLines: number } {
  const full = JSON.stringify(data, null, 2);
  const lines = full.split('\n');
  if (lines.length <= limit) return { text: full, truncated: false, totalLines: lines.length };
  return {
    text: lines.slice(0, limit).join('\n'),
    truncated: true,
    totalLines: lines.length,
  };
}

/** 74④：Markdown 表格——管道符转义，空值空串。 */
export function renderMdTable(rows: Row[]): string {
  if (rows.length === 0) return '_（无表格数据）_\n';
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 8);
  const cell = (s: string): string => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const head = `| ${keys.join(' | ')} |`;
  const sep = `| ${keys.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${keys.map((k) => cell(String(r[k] ?? ''))).join(' | ')} |`);
  return [head, sep, ...body].join('\n') + '\n';
}

/** 74⑤：TSV——制表符分隔，值内制表符/换行替换为空格（直贴表格软件）。 */
export function renderTsv(rows: Row[]): string {
  if (rows.length === 0) return '\n';
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 8);
  const cell = (s: string): string => String(s).replace(/[\t\n\r]/g, ' ');
  const lines = [keys.join('\t')];
  for (const r of rows) lines.push(keys.map((k) => cell(String(r[k] ?? ''))).join('\t'));
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- watch 轮询

/** ⑨两次结果的逐键 diff 描述（顶层键，值 JSON 化对比）。 */
export function diffTopLevel(prev: unknown, next: unknown): string[] {
  if (prev === undefined) return ['（首轮，无对照）'];
  const a = (prev && typeof prev === 'object') ? prev as Row : { value: prev };
  const b = (next && typeof next === 'object') ? next as Row : { value: next };
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const out: string[] = [];
  for (const k of keys) {
    const va = JSON.stringify(a[k]);
    const vb = JSON.stringify(b[k]);
    if (va !== vb) out.push(`${k}: ${va ?? '∅'} → ${vb ?? '∅'}`);
  }
  if (out.length === 0) out.push('（无变化）');
  return out;
}

/** ⑩watch 间隔收敛：5~300 秒，非法值兜底 10。 */
export function normalizeWatchSec(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 10;
  return Math.min(300, Math.max(5, Math.round(n)));
}

// ---------------------------------------------------------------- 交互模式

/**
 * ①交互菜单：方向键 ↑/↓ 选行、回车确认、q/Esc 退出、/ 进入过滤。
 * 返回选中下标；取消返回 -1。非 TTY 直接 -1。
 * 每次按键重画整屏（行数少，clear 掩盖法够用且零依赖）。
 */
export function menuKeyHandler(
  lines: string[],
  onPick: (index: number) => void,
  onCancel: () => void,
): (key: string) => void {
  let sel = 0;
  let filter = '';
  let filtering = false;
  const visible = (): number[] => lines
    .map((_, i) => i)
    .filter((i) => !filtering || !filter || lines[i]!.toLowerCase().includes(filter.toLowerCase()));
  return (key: string): void => {
    const vis = visible();
    if (key === '\x03' || key === 'q' || key === '\x1b') { onCancel(); return; }
    if (filtering) {
      if (key === '\r') { filtering = false; if (vis.length > 0) { sel = vis[0]!; onPick(sel); } return; }
      if (key === '\x7f') { filter = filter.slice(0, -1); return; }
      if (key >= ' ' && key <= '~') { filter += key; return; }
      return;
    }
    if (key === '/') { filtering = true; filter = ''; return; }
    if (key === '\x1b[A' || key === 'k') { // ↑
      const at = vis.indexOf(sel);
      sel = vis[Math.max(0, at - 1)] ?? vis[0] ?? 0;
      return;
    }
    if (key === '\x1b[B' || key === 'j') { // ↓
      const at = vis.indexOf(sel);
      sel = vis[Math.min(vis.length - 1, at + 1)] ?? sel;
      return;
    }
    if (key === '\r' || key === '\n') { if (vis.includes(sel)) onPick(sel); return; }
  };
}

/** ②渲染当前菜单帧：选中行前缀 ▸，其余空两格；过滤态在尾行显示过滤词。 */
export function renderMenu(lines: string[], sel: number, filter: string, filtering: boolean): string {
  const body = lines.map((l, i) => `${i === sel ? '▸ ' : '  '}${l}`).join('\n');
  return filtering ? `${body}\n/${filter}▏` : body;
}

/** ③参数提示的逐项提问表（交互填写用）：必填标星、secret 标掩码、默认值可回车。 */
export function promptPlan(params: { name: string; title: string; required?: boolean; secret?: boolean; default?: unknown }[]): {
  name: string; label: string; isSecret: boolean; fallback: string;
}[] {
  return params.map((p) => ({
    name: p.name,
    label: `${p.title}${p.required ? '（必填）' : ''}${p.default !== undefined ? ` [回车=${String(p.default)}]` : ''}`,
    isSecret: !!p.secret,
    fallback: p.default !== undefined ? String(p.default) : '',
  }));
}
