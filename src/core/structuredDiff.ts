/**
 * 第二百七十八轮：结果历史结构化 diff——272 对账 M 第一条（用户可见价值最高）。
 * 129 轮给了文本对比；这里补字段级（added/removed/changed 三类，点路径寻址）。
 * 纯函数：a/b 为两次 run 的 JSON 结果。
 */

export interface DiffEntry {
  kind: 'added' | 'removed' | 'changed';
  path: string;          // 点路径（数组用 [i]）
  before?: unknown;
  after?: unknown;
}

export interface DiffSummary {
  added: number;
  removed: number;
  changed: number;
  entries: DiffEntry[];
}

const MAX_DEPTH = 8;

/** ①②③⑤ structuredDiff：字段级三分类；数组按索引对齐（长度差进 added/removed）；递归深度上限 8 */
export function structuredDiff(a: unknown, b: unknown, path = '', depth = 0): DiffSummary {
  const entries: DiffEntry[] = [];
  walk(a, b, path, depth, entries);
  const added = entries.filter((e) => e.kind === 'added').length;
  const removed = entries.filter((e) => e.kind === 'removed').length;
  const changed = entries.filter((e) => e.kind === 'changed').length;
  return { added, removed, changed, entries };
}

function walk(a: unknown, b: unknown, path: string, depth: number, out: DiffEntry[]): void {
  if (depth >= MAX_DEPTH) {
    // 深度上限：剩余整体当一个 changed（或不等才记）
    if (!deepEqual(a, b)) out.push({ kind: 'changed', path: path || '(root)', before: '[depth-limit]', after: '[depth-limit]' });
    return;
  }
  const aObj = isPlainObject(a);
  const bObj = isPlainObject(b);
  if (aObj && bObj) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) {
      const av = (a as Record<string, unknown>)[k];
      const bv = (b as Record<string, unknown>)[k];
      const p = path ? `${path}.${k}` : k;
      if (!(k in (a as object))) out.push({ kind: 'added', path: p, after: bv });
      else if (!(k in (b as object))) out.push({ kind: 'removed', path: p, before: av });
      else walk(av, bv, p, depth + 1, out);
    }
    return;
  }
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr && bArr) {
    const al = (a as unknown[]).length;
    const bl = (b as unknown[]).length;
    const n = Math.min(al, bl);
    for (let i = 0; i < n; i++) walk((a as unknown[])[i], (b as unknown[])[i], `${path}[${i}]`, depth + 1, out);
    if (bl > al) for (let i = al; i < bl; i++) out.push({ kind: 'added', path: `${path}[${i}]`, after: (b as unknown[])[i] });
    if (al > bl) for (let i = bl; i < al; i++) out.push({ kind: 'removed', path: `${path}[${i}]`, before: (a as unknown[])[i] });
    return;
  }
  // 类型不一致或标量：不等记 changed
  if (!deepEqual(a, b)) out.push({ kind: 'changed', path: path || '(root)', before: a, after: b });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a).sort();
    const bk = Object.keys(b).sort();
    if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
    return ak.every((k) => deepEqual(a[k], b[k]));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  return false;
}
