// 插件分发：打包/解包（zip）、上架检查、市场登记表校验。
// zip 用 Node 内置 zlib 手写最小实现（stored + deflate）：不引新依赖——
// 无构建步骤的项目多背一个 archiver/ffi 不值当，而插件包就是「一堆小文本
// 文件」，正是 stored/deflate 的舒适区。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { PLUGINS_DIR } from './paths.ts';

// ---------------- 第六十二轮：包完整性（MANIFEST.sha256） ----------------

/** 完整性清单文件在包内/装后的固定名字。 */
export const INTEGRITY_FILE = 'MANIFEST.sha256';
/** 装后快照（安装当时的逐文件哈希）存在插件目录里的隐藏文件。 */
export const SNAPSHOT_FILE = '.zk-integrity.json';

export interface IntegrityCheck {
  ok: boolean;
  /** 被改动（哈希不匹配）的文件 */
  changed: string[];
  /** 快照里有、磁盘上没了的文件 */
  missing: string[];
  /** 磁盘上有、快照里没有的新文件（不判罪，但要说出来） */
  added: string[];
  /** 快照本身缺失——装的时候就没有（老插件）或被人删了 */
  noSnapshot?: boolean;
  message?: string;
}

/** 生成 sha256sum 风格的清单文本：每行「哈希  路径」，按路径排序。 */
export function buildManifest(files: Array<{ name: string; data: Buffer }>): string {
  const lines = files
    .filter((f) => f.name !== INTEGRITY_FILE)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => `${crypto.createHash('sha256').update(f.data).digest('hex')}  ${f.name}`);
  // 尾行是清单自身的 digest（对上面所有行的拼接取哈希）——
  // 改清单里的任何一行（换文件哈希、删行）都会让总哈希对不上。
  const total = crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
  lines.push(`${total}  # total`);
  return lines.join('\n') + '\n';
}

/** 解析清单文本 → { files: Map<路径,哈希>, total }。格式不对返回 null。 */
export function parseManifest(text: string): { files: Map<string, string>; total: string | null } | null {
  const files = new Map<string, string>();
  let total: string | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([0-9a-f]{64})\s{2}(.+)$/);
    if (!m) return null;
    const name = (m[2] ?? '').trim();
    if (name === '# total') { total = m[1] ?? null; continue; }
    files.set(name, m[1] ?? '');
  }
  return { files, total };
}

/** 校验一组条目 vs 清单文本。返回 null=通过；字符串数组=被改动/缺失的文件（带方向标注）。 */
export function verifyAgainstManifest(entries: Array<{ name: string; data: Buffer }>, manifestText: string): string[] | null {
  const parsed = parseManifest(manifestText);
  if (!parsed) return ['MANIFEST.sha256 格式损坏（无法解析）'];
  // 总哈希先验：清单自身被动过直接判「包损坏」，不逐文件浪费口舌
  if (parsed.total) {
    const body = manifestText.split('\n').filter((l) => l.trim() && !l.trim().endsWith('# total')).join('\n');
    const actual = crypto.createHash('sha256').update(body).digest('hex');
    if (actual !== parsed.total) return ['MANIFEST.sha256 总哈希不匹配——清单自身被改动或损坏'];
  }
  const byName = new Map(entries.filter((e) => e.name !== INTEGRITY_FILE).map((e) => [e.name, e.data] as const));
  const bad: string[] = [];
  for (const [name, hash] of parsed.files) {
    const data = byName.get(name);
    if (!data) { bad.push(`${name}（包里缺失）`); continue; }
    const actual = crypto.createHash('sha256').update(data).digest('hex');
    if (actual !== hash) bad.push(`${name}（内容被改动）`);
  }
  return bad.length ? bad : null;
}

/** 对已装插件目录复验：对照装时快照逐文件比哈希。 */
export function verifyInstalled(id: string): IntegrityCheck {
  const dir = path.join(PLUGINS_DIR, id);
  if (!fs.existsSync(dir)) {
    return { ok: false, changed: [], missing: [], added: [], message: `插件 ${id} 没有安装` };
  }
  const snapPath = path.join(dir, SNAPSHOT_FILE);
  if (!fs.existsSync(snapPath)) {
    return { ok: false, changed: [], missing: [], added: [], noSnapshot: true,
      message: `没有装时快照（${SNAPSHOT_FILE}）——老插件或被打过补丁，无法复验` };
  }
  let snap: { files: Record<string, string> };
  try {
    snap = JSON.parse(fs.readFileSync(snapPath, 'utf8')) as { files: Record<string, string> };
  } catch {
    return { ok: false, changed: [], missing: [], added: [], message: `${SNAPSHOT_FILE} 损坏（不是合法 JSON）` };
  }
  const disk = new Set<string>();
  const walk = (rel: string) => {
    const abs = path.join(dir, rel);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) { for (const c of fs.readdirSync(abs)) walk(rel ? path.join(rel, c) : c); return; }
    if (rel === SNAPSHOT_FILE || rel === INTEGRITY_FILE || rel === '.zerokit-source.json' || rel.split(path.sep).includes('node_modules') || rel.endsWith('.DS_Store')) return;
    disk.add(rel.split(path.sep).join('/'));
  };
  walk('');
  const changed: string[] = [];
  const missing: string[] = [];
  for (const [name, hash] of Object.entries(snap.files)) {
    if (!disk.has(name)) { missing.push(name); continue; }
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, ...name.split('/')))).digest('hex');
    if (actual !== hash) changed.push(name);
  }
  const added = [...disk].filter((n) => !(n in snap.files));
  const ok = changed.length === 0 && missing.length === 0;
  return { ok, changed, missing, added,
    message: ok ? `完整：${Object.keys(snap.files).length} 个文件与装时一致${added.length ? `（另有 ${added.length} 个后加文件）` : ''}` : undefined };
}


// ---------------- zip 最小读写（无外部依赖） ----------------

/** CRC32（zip 中央目录要求；标准多项式 0xEDB88320，表驱动）。 */
const CRC_TABLE: Array<number> = (() => {
  const t: number[] = new Array<number>(256).fill(0);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
/** 单字节 CRC 步进（拆出来绕 noUncheckedIndexedAccess 的索引窄化）。 */
function CRC(c: number, b: number): number {
  const t: number[] = CRC_TABLE;
  const v = t[(c ^ b) & 0xFF] as number;
  return v ^ (c >>> 8);
}

function crc32(buf: Buffer): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = CRC(c, buf[i] as number);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** 打 zip（全部 deflate；文件名 UTF-8 标志位置 1）。返回 Buffer。 */
export function zipFiles(files: Array<{ name: string; data: Buffer }>): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const comp = zlib.deflateRawSync(f.data, { level: 9 });
    const useDeflate = comp.length < f.data.length;
    const payload = useDeflate ? comp : f.data;
    const method = useDeflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0x0800, 6);      // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12); // time/date（0=合法）
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, payload);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(f.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32); // extra/comment
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); // disk attrs
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + payload.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, end]);
}

export interface ZipEntry { name: string; data: Buffer }

/** 读 zip（stored + deflate；跳过目录项）。不支持的特性抛错而不是静默丢文件。 */
export function unzipFiles(buf: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  // 从尾部找 EOCD
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是合法的 zip 文件（找不到目录结尾）');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`第 ${n + 1} 个中央目录项损坏`);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (!name.endsWith('/')) {
      // 本地头
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const comp = buf.subarray(dataStart, dataStart + compSize);
      if (method === 0) entries.push({ name, data: Buffer.from(comp) });
      else if (method === 8) entries.push({ name, data: zlib.inflateRawSync(comp) });
      else throw new Error(`不支持的压缩方式 ${method}（${name}）`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ---------------- 打包/解包 ----------------

export interface PackResult {
  ok: boolean;
  file?: string;
  files?: string[];       // 进包的相对路径
  bytes?: number;
  message?: string;
}

/** ①打包：整个插件目录进 zip（排除运行数据；settings/ 下只带 .example 模板）。 */
export function packPlugin(id: string, outDir?: string): PackResult {
  const dir = path.join(PLUGINS_DIR, id);
  if (!fs.existsSync(dir)) return { ok: false, message: `插件 ${id} 没有安装（${dir} 不存在）` };
  const _id: string = id;
  const files: Array<{ name: string; data: Buffer }> = [];
  const walk = (rel: string) => {
    const abs = path.join(dir, rel);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      for (const c of fs.readdirSync(abs)) walk(rel ? path.join(rel, c) : c);
    } else {
      // 排除：用户设置值（settings 是数据不是代码）、node_modules、.DS_Store
      if (rel.includes('node_modules' + path.sep) || rel.endsWith('.DS_Store')) return;
      if (rel.startsWith('settings' + path.sep) && !rel.endsWith('.example')) return;
      files.push({ name: rel.split(path.sep).join('/'), data: fs.readFileSync(abs) });
    }
  };
  walk('');
  files.sort((a, b) => a.name.localeCompare(b.name));
  if (!files.some((f) => f.name === 'plugin.toml')) {
    return { ok: false, message: '插件目录里没有 plugin.toml，不像是可安装的插件' };
  }
  const buf = zipFiles(files);
  const out = path.join(outDir ?? process.cwd(), `zerokit-${_id}.zip`);
  fs.writeFileSync(out, buf);
  return { ok: true, file: out, files: files.map((f) => f.name), bytes: buf.length };
}

/** 第六十二轮①：打包带完整性清单。返回 [zip字节, 清单文本]。 */
export function packPluginWithManifest(id: string, outDir?: string): PackResult & { integrity?: string } {
  const dir = path.join(PLUGINS_DIR, id);
  if (!fs.existsSync(dir)) return { ok: false, message: `插件 ${id} 没有安装（${dir} 不存在）` };
  const files: Array<{ name: string; data: Buffer }> = [];
  const walk = (rel: string) => {
    const abs = path.join(dir, rel);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      for (const c of fs.readdirSync(abs)) walk(rel ? path.join(rel, c) : c);
    } else {
      if (rel.includes('node_modules' + path.sep) || rel.endsWith('.DS_Store')) return;
      if (rel.startsWith('settings' + path.sep) && !rel.endsWith('.example')) return;
      if (rel === SNAPSHOT_FILE) return;   // 装时快照不进包（各机器各装各的）
      // .zerokit-source.json 是本机安装来源记录，不属于分发内容——
      // 带进包会让 unpack 后 verify 报「被删除」（装后 CLI 按本机来源处理它）
      if (rel === '.zerokit-source.json') return;
      files.push({ name: rel.split(path.sep).join('/'), data: fs.readFileSync(abs) });
    }
  };
  walk('');
  files.sort((a, b) => a.name.localeCompare(b.name));
  if (!files.some((f) => f.name === 'plugin.toml')) {
    return { ok: false, message: '插件目录里没有 plugin.toml，不像是可安装的插件' };
  }
  const manifest = buildManifest(files);
  const all = [...files, { name: INTEGRITY_FILE, data: Buffer.from(manifest, 'utf8') }];
  const total = crypto.createHash('sha256').update(manifest).digest('hex');
  const buf = zipFiles(all);
  const out = path.join(outDir ?? process.cwd(), `zerokit-${id}.zip`);
  fs.writeFileSync(out, buf);
  return { ok: true, file: out, files: all.map((f) => f.name), bytes: buf.length, integrity: `sha256-${total}` };
}

/** ②解包安装：校验 plugin.toml 结构与动作风险声明后落进插件目录。
 * 第六十二轮②⑧：包里带 MANIFEST.sha256 时先逐文件校验，任何不匹配拒绝安装；
 * 清单自身被改/被删按「包损坏」处理（有清单条目却缺清单文件=不完整）。 */
export function unpackPlugin(zipPath: string, opts: { replace?: boolean; verify?: boolean; strict?: boolean } = {}): PackResult {
  let entries: ZipEntry[];
  try {
    entries = unzipFiles(fs.readFileSync(zipPath));
  } catch (e) {
    return { ok: false, message: `读取 zip 失败：${(e as Error).message}` };
  }
  const toml = entries.find((e) => e.name === 'plugin.toml');
  if (!toml) return { ok: false, message: '包里没有 plugin.toml，不装' };
  // 完整性校验：默认开（老包没清单=没有可比对的基线，放行但提示）
  const manifestEntry = entries.find((e) => e.name === INTEGRITY_FILE);
  if (opts.verify !== false && manifestEntry) {
    const bad = verifyAgainstManifest(entries, manifestEntry.data.toString('utf8'));
    if (bad) {
      return { ok: false, message: `完整性校验失败，拒绝安装：\n  - ${bad.join('\n  - ')}` };
    }
  }
  // 第八十一轮③：无清单的旧包默认警告放行（向后兼容）；--strict 直接拒——
  // CI 或高安全环境用它，杜绝「来路不明且无法自证完整性」的包
  if (!manifestEntry && opts.strict) {
    return { ok: false, message: `包里没有 ${INTEGRITY_FILE} 完整性清单（--strict 模式拒绝未签名包）。让作者用 zkit plugin pack 重新打包` };
  }
  const unsignedWarn = !manifestEntry;
  // 路径穿越防线：所有条目必须落在目标目录内
  const bad = entries.find((e) => e.name.includes('..') || path.isAbsolute(e.name));
  if (bad) return { ok: false, message: `包里有可疑路径 ${bad.name}，拒绝安装` };
  // 解析清单拿 id 与风险声明（不引 smol-toml 的完整解析——只要 id 行在就够定位）
  const idMatch = toml.data.toString('utf8').match(/^id\s*=\s*"([^"]+)"/m);
  if (!idMatch) return { ok: false, message: 'plugin.toml 里找不到 id 声明，拒绝安装' };
  const id: string = idMatch[1] ?? '';
  if (!/^[\w.-]+$/.test(id)) return { ok: false, message: `插件 id 不合法：${id}` };
  const dest = path.join(PLUGINS_DIR, id);
  if (fs.existsSync(dest) && !opts.replace) {
    return { ok: false, message: `插件 ${id} 已安装；加 --replace 覆盖（原目录会备份为 ${id}.bak）` };
  }
  if (fs.existsSync(dest)) {
    fs.rmSync(dest + '.bak', { recursive: true, force: true });
    fs.renameSync(dest, dest + '.bak');
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const e of entries) {
    const target = path.join(dest, e.name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, e.data);
  }
  // 第六十二轮④：装时快照落盘（.zk-integrity.json）——plugin verify 靠它复验。
  // 快照基于清单（有清单的包）；没清单的旧包按解包后的实际内容生成。
  const snapSource = manifestEntry
    ? manifestEntry.data.toString('utf8')
    : null;
  const snapFiles: Record<string, string> = {};
  if (snapSource) {
    const parsed = parseManifest(snapSource);
    if (parsed) for (const [n, h] of parsed.files) snapFiles[n] = h;
  } else {
    for (const e of entries) {
      if (e.name === INTEGRITY_FILE) continue;
      snapFiles[e.name] = crypto.createHash('sha256').update(e.data).digest('hex');
    }
  }
  fs.writeFileSync(path.join(dest, SNAPSHOT_FILE),
    JSON.stringify({ at: new Date().toISOString(), files: snapFiles }, null, 2));
  return { ok: true, file: dest, files: entries.map((e) => e.name), message: `已安装 ${id}（${entries.length} 个文件；覆盖旧版备份在 ${id}.bak）${unsignedWarn ? `\n⚠ 包没有完整性清单（未签名）——装时快照按实际内容生成，之后 zkit plugin verify ${id} 仍可复验` : ''}` };
}

// ---------------- ④上架检查 ----------------

export interface PublishCheck {
  ok: boolean;
  problems: Array<{ level: 'error' | 'warning'; text: string; hint?: string }>;
}

/** 检查一个已装插件是否达到「可以放进集市」的标准。error 级不达标。 */
export function publishReady(id: string, plugin: {
  id: string; name: string; version: string; summary?: string;
  actions: Array<{ id: string; title: string; description?: string; risk?: string }>;
}): PublishCheck {
  const problems: PublishCheck['problems'] = [];
  const err = (text: string, hint?: string) => problems.push({ level: 'error', text, hint });
  const warn = (text: string, hint?: string) => problems.push({ level: 'warning', text, hint });
  const dir = path.join(PLUGINS_DIR, id);
  if (!fs.existsSync(path.join(dir, 'plugin.toml'))) err('没有 plugin.toml');
  if (!plugin.version || !/^\d+\.\d+\.\d+/.test(plugin.version)) {
    err(`版本号 "${plugin.version}" 不是语义化格式`, '用 x.y.z，比如 1.0.0');
  }
  if (!plugin.summary || plugin.summary.length < 8) {
    warn('summary 太短——集市里排到后面没人看得懂它是干嘛的', '写清楚「给谁、解决什么」，至少 8 个字');
  }
  for (const a of plugin.actions) {
    if (!a.description || a.description.length < 6) {
      warn(`动作 ${a.id} 缺描述——AI 工作台与 MCP 面全靠它路由`, 'description 写「什么情况下用这个」');
    }
    if (!a.risk) err(`动作 ${a.id} 没声明 risk`, 'read / mutate / destructive 三选一，缺省按 destructive 对待');
  }
  if (plugin.actions.length === 0) err('没有任何动作');
  return { ok: !problems.some((p) => p.level === 'error'), problems };
}

// ---------------- ⑤集市登记表校验 ----------------

export interface MarketLint {
  ok: boolean;
  errors: string[];
  warnings: string[];
  pluginCount: number;
}

/** 校验一份 market.json（内容已读入）。查重 id、字段完整、source 格式。 */
export function lintMarketIndex(raw: string, opts: { baseDir?: string } = {}): MarketLint {
  const errors: string[] = [];
  const warnings: string[] = [];
  let idx: { name?: string; plugins?: Array<Record<string, unknown>> };
  try {
    idx = JSON.parse(raw);
  } catch (e) {
    return { ok: false, errors: [`JSON 解析失败：${(e as Error).message}`], warnings, pluginCount: 0 };
  }
  if (!idx.name) errors.push('缺少 name（集市名）');
  const plugins = Array.isArray(idx.plugins) ? idx.plugins : [];
  if (plugins.length === 0) warnings.push('plugins 为空——一个插件都不卖');
  const seen = new Set<string>();
  for (let i = 0; i < plugins.length; i++) {
    const e = plugins[i] as { id?: string; name?: string; summary?: string; version?: string; source?: string };
    const at = `plugins[${i}]`;
    if (!e.id) { errors.push(`${at} 缺 id`); continue; }
    if (seen.has(e.id)) errors.push(`${at} id "${e.id}" 重复`);
    seen.add(e.id);
    if (!e.name) warnings.push(`${at}(${e.id}) 缺 name`);
    if (!e.summary || (e.summary as string).length < 6) warnings.push(`${at}(${e.id}) summary 太短，集市里没人看得懂`);
    if (!e.version || !/^\d+\.\d+\.\d+/.test(e.version ?? '')) warnings.push(`${at}(${e.id}) version 不是 x.y.z 格式`);
    if (!e.source) { errors.push(`${at}(${e.id}) 缺 source`); continue; }
    if (!/^(path:|git:)/.test(e.source)) errors.push(`${at}(${e.id}) source "${e.source}" 必须以 path: 或 git: 开头`);
    // 第八十七轮⑥：path 源只在源仓库本机可用——装得上的人有限，集市作者要知道
    if (e.source.startsWith('path:')) warnings.push(`${at}(${e.id}) 是 path: 本地源，其它机器装不了（要求求改为 git: 或发 .toolpack 才可分发）`);
    // path: 源的本地存在性（给了 baseDir 才查——源仓库根）
    if (e.source.startsWith('path:') && opts.baseDir) {
      const rel = e.source.slice(5).replace(/^\/+/, '');
      const abs = path.resolve(opts.baseDir, rel);
      if (!fs.existsSync(abs)) errors.push(`${at}(${e.id}) path 源不存在：${rel}`);
      else if (!fs.existsSync(path.join(abs, 'plugin.toml'))) errors.push(`${at}(${e.id}) path 源里没有 plugin.toml：${rel}`);
    }
  }
  return { ok: errors.length === 0, errors, warnings, pluginCount: plugins.length };
}
