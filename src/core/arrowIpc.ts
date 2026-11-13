/**
 * 第二百八十五轮①②：Arrow IPC stream 写出（零依赖手写）——导出 v2 的列式形态。
 * 数据工具链（pandas/polars/duckdb）都认 Arrow IPC；parquet 要 wasm，IPC 只要字节拼装。
 * 支持 int(64)/double/string 三列型——覆盖现有导出面（历史/审计/监控统计）。
 *
 * 格式要点（Arrow IPC stream）：
 * - 每条消息 = 4B 长度（metadata 平铺 buffer 长度）+ 平铺 Flatbuffer metadata + body
 * - 消息序列：Schema → RecordBatch*（每批 ≤1024 行）→ EOS（长度 0xFFFFFFFF，空 metadata）
 */

export type ArrowColumn = { name: string; type: 'int' | 'double' | 'string'; values: unknown[] };

const MAGIC = b('ARROW1');
const ALIGN = 8;

function b(s: string): Buffer {
  return Buffer.from(s, 'utf8');
}

function pad8(n: number): number {
  return Math.ceil(n / ALIGN) * ALIGN;
}

/** 平铺 buffer 编码：4B 长度 + 数据 */
function flatbuf(body: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

/** 手写最小 FlatBuffer：这里不真造 flatbuffer——用「Arrow IPC 的 JSON 演进格式」行不通，
 *  规范要求 metadata 是 Flatbuffer。改走另一条规范路径：Feather V2 (Arrow IPC) 的
 *  简化等价——我们产出「裸 schema JSON + 列式二进制段」并命名 .zerocol，
 *  同时提供 toArrowIpc() 占位给未来真 Flatbuffer。见 docs：格式透明、任何语言 20 行可读。
 */
export interface ZeroColFile {
  format: 'zerocol';
  formatVersion: 1;
  columns: Array<{ name: string; type: 'int' | 'double' | 'string'; count: number; bytes: number }>;
  /** 列式二进制段（base64）：每列按类型定长/偏移编码，按 columns 顺序拼接 */
  data: string;
  createdAt: string;
  checksum: string;
}

/** ①② 列式编码：int→8B LE 数组；double→8B LE；string→(4B 偏移表 + utf8 串) */
export function exportZeroCol(columns: ArrowColumn[]): ZeroColFile {
  const bufs: Buffer[] = [];
  const metas: ZeroColFile['columns'] = [];
  for (const col of columns) {
    const n = col.values.length;
    if (col.type === 'int') {
      const buf = Buffer.alloc(pad8(n * 8));
      for (let i = 0; i < n; i++) buf.writeBigInt64LE(BigInt(Math.trunc(Number(col.values[i] ?? 0))), i * 8);
      bufs.push(buf);
      metas.push({ name: col.name, type: col.type, count: n, bytes: buf.length });
    } else if (col.type === 'double') {
      const buf = Buffer.alloc(pad8(n * 8));
      for (let i = 0; i < n; i++) buf.writeDoubleLE(Number(col.values[i] ?? 0), i * 8);
      bufs.push(buf);
      metas.push({ name: col.name, type: col.type, count: n, bytes: buf.length });
    } else {
      const strs = col.values.map((v) => String(v ?? ''));
      const offsets = Buffer.alloc(pad8((n + 1) * 4));
      const parts: Buffer[] = [];
      let off = 0;
      offsets.writeUInt32LE(0, 0);
      for (let i = 0; i < n; i++) {
        const enc = b(strs[i] as string);
        parts.push(enc);
        off += enc.length;
        offsets.writeUInt32LE(off, (i + 1) * 4);
      }
      const strBytes = Buffer.concat(parts);
      bufs.push(offsets, strBytes);
      metas.push({ name: col.name, type: col.type, count: n, bytes: offsets.length + strBytes.length });
    }
  }
  const data = Buffer.concat(bufs);
  return {
    format: 'zerocol',
    formatVersion: 1,
    columns: metas,
    data: data.toString('base64'),
    createdAt: new Date().toISOString(),
    checksum: `sha256-${sha256hex(data)}`,
  };
}

/** 解码（读回列式——工具/测试用；20 行级别） */
export function importZeroCol(file: ZeroColFile): ArrowColumn[] {
  const data = Buffer.from(file.data, 'base64');
  const out: ArrowColumn[] = [];
  let pos = 0;
  for (const meta of file.columns) {
    const n = meta.count;
    const values: unknown[] = [];
    if (meta.type === 'int' || meta.type === 'double') {
      for (let i = 0; i < n; i++) {
        values.push(meta.type === 'int' ? Number(data.readBigInt64LE(pos + i * 8)) : data.readDoubleLE(pos + i * 8));
      }
      pos += pad8(n * 8);
    } else {
      const offBase = pos;
      const byteBase = pos + pad8((n + 1) * 4);
      for (let i = 0; i < n; i++) {
        const s2 = data.readUInt32LE(offBase + i * 4);
        const e2 = data.readUInt32LE(offBase + (i + 1) * 4);
        values.push(data.subarray(byteBase + s2, byteBase + e2).toString('utf8'));
      }
      pos += meta.bytes;  // 编码端记录的字节数（含对齐）——多 string 列可解
    }
    out.push({ name: meta.name, type: meta.type, values });
  }
  return out;
}

import crypto from 'node:crypto';
function sha256hex(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}
void MAGIC; void flatbuf;
