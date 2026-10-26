// 零依赖二维码生成器（SVG path 输出）。
// 算法：QR Code model 2, byte mode, error correction L——覆盖深链场景足够；
// 实现按 ISO/IEC 18004 的标准流程分步写，每步可单测。
// 参考：Thonky.com QR Code Tutorial 的流程描述（算法是标准，非抄代码）。

// ---- 伽罗瓦域 GF(256) ----
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // 本原多项式 x^8+x^4+x^3+x^2+1
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

function gmul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

// ---- 里德-所罗门：生成多项式与余数 ----
function rsGenPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gmul(poly[j], EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data, degree) {
  const gen = rsGenPoly(degree);
  const res = data.concat(new Array(degree).fill(0));
  for (let i = 0; i < data.length; i++) {
    const factor = res[i];
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j++) {
      res[i + j] ^= gmul(gen[j], factor);
    }
  }
  return res.slice(data.length);
}

// ---- 版本容量表（byte 模式 / ECC L）----
// [总码字, [块数, 每块数据码字]] —— 简化：只支持 1–5 版（足够装 100+ 字符的 URL）
const VERSIONS = {
  1: { total: 26, blocks: [[1, 19]] },
  2: { total: 44, blocks: [[1, 34]] },
  3: { total: 70, blocks: [[1, 55]] },
  4: { total: 100, blocks: [[1, 80]] },
  5: { total: 134, blocks: [[1, 108]] },
};

function pickVersion(byteLen) {
  // byte 模式头 4 bit + 长度 8 bit（v1-9）+ 数据 + ECC
  for (let v = 1; v <= 5; v++) {
    const dataBytes = VERSIONS[v].blocks[0][1];
    const eccBytes = VERSIONS[v].total - dataBytes;
    // 每块 ECC = eccBytes / 块数；v1-5 都是单块
    if (byteLen <= dataBytes - 2) return v; // 2 字节给头
    void eccBytes;
  }
  throw new Error('内容太长：二维码只支持到版本 5（约 106 字节）');
}

// ---- 数据编码（byte 模式）----
function encode(text) {
  const bytes = new TextEncoder().encode(text);
  const v = pickVersion(bytes.length);
  const { total, blocks } = VERSIONS[v];
  const dataCW = blocks[0][1];
  const bits = [];
  const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);           // byte 模式
  push(bytes.length, 8);     // 长度（v1-9 用 8 bit）
  for (const b of bytes) push(b, 8);
  // 终止符与填充
  const capacityBits = dataCW * 8;
  push(0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    out.push(b);
  }
  const PAD = [0xec, 0x11];
  for (let i = 0; out.length < dataCW; i++) out.push(PAD[i % 2]);

  const ecc = rsRemainder(out.slice(), total - dataCW);
  return { version: v, modules: total, codewords: out.concat(ecc) };
}

// ---- 掩码与格式信息 ----
const MASK_FNS = [
  (r, c) => (r + c) % 2 === 0,
  (r, c) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r >> 1) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function formatBits(mask) {
  // ECC L(01) + mask(3bit) = 5 bit，BCH(15,5)
  const G = 0x537;
  let data = (0b01 << 3) | mask;
  let d = data << 10;
  for (let i = 14; i >= 10; i--) {
    if (d & (1 << i)) d ^= G << (i - 10);
  }
  const code = ((data << 10) | d) ^ 0x5412;
  return code;
}

// ---- 构建矩阵 ----
function buildMatrix(version, codewords, mask) {
  const size = 17 + version * 4;
  const m = Array.from({ length: size }, () => new Array(size).fill(0)); // 0=空 1=黑 2=白(保留)
  const set = (r, c, v) => { if (r >= 0 && r < size && c >= 0 && c < size) m[r][c] = v; };

  // 三个定位图案
  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = r0 + r, cc = c0 + c;
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
      const inRing = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const edge = r === 0 || r === 6 || c === 0 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      set(rr, cc, inRing ? ((edge || core) ? 1 : 2) : 2);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  // 校正图案（v≥2）
  for (let i = 0; i < version - 1; i++) {
    const pos = 6 + i * 4 + 4; // 粗略：v2=[6,18] v3=[6,22] v4=[6,26] v5=[6,30]
  }
  const alignPos = { 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30] }[version] ?? [];
  for (const ar of alignPos) for (const ac of alignPos) {
    if ((ar <= 8 && ac <= 8) || (ar <= 8 && ac >= size - 9) || (ar >= size - 9 && ac <= 8)) continue;
    for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) {
      const edge = Math.abs(r) === 2 || Math.abs(c) === 2;
      set(ar + r, ac + c, (edge || (r === 0 && c === 0)) ? 1 : 2);
    }
  }

  // 时序线
  for (let i = 8; i < size - 8; i++) {
    if (m[6][i] === 0) m[6][i] = i % 2 === 0 ? 1 : 2;
    if (m[i][6] === 0) m[i][6] = i % 2 === 0 ? 1 : 2;
  }

  // 暗模块
  m[size - 8][8] = 1;

  // 格式信息（两处）
  const fmt = formatBits(mask);
  for (let i = 0; i < 15; i++) {
    const bit = (fmt >> i) & 1;
    // 环绕左上
    if (i < 6) m[8][i] = bit ? 1 : 2;
    else if (i === 6) m[8][7] = bit ? 1 : 2;
    else if (i === 7) m[8][8] = bit ? 1 : 2;
    else if (i === 8) m[7][8] = bit ? 1 : 2;
    else m[14 - i][8] = bit ? 1 : 2;
    // 右上/左下
    if (i < 8) m[size - 1 - i][8] = bit ? 1 : 2;
    else m[8][size - 15 + i] = bit ? 1 : 2;
  }

  // 数据放置（之字形，跳过功能模块）
  const isFunction = (r, c) => m[r][c] !== 0;
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  const getBit = (i) => (i < totalBits ? (codewords[i >> 3] >> (7 - (i & 7))) & 1 : 0);
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // 跳过时序列
    for (let i = 0; i < size; i++) {
      const r = upward ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (isFunction(r, c)) continue;
        let bit = getBit(bitIdx++);
        if (MASK_FNS[mask](r, c)) bit ^= 1;
        m[r][c] = bit ? 1 : 2;
      }
    }
    upward = !upward;
  }

  return m;
}

// 简单评分：全图 1/5 规则的粗略惩罚（够挑一个不太差的掩码）
function penalty(m) {
  const size = m.length;
  let score = 0;
  for (let r = 0; r < size; r++) {
    let run = 1;
    for (let c = 1; c < size; c++) {
      if (m[r][c] === m[r][c - 1]) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
      else run = 1;
    }
  }
  for (let c = 0; c < size; c++) {
    let run = 1;
    for (let r = 1; r < size; r++) {
      if (m[r][c] === m[r - 1][c]) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
      else run = 1;
    }
  }
  return score;
}

/** 生成二维码 SVG。返回 <svg>…</svg> 字符串（黑色模块一个 path）。 */
export function qrSvg(text, { scale = 4, margin = 2 } = {}) {
  const { version, codewords } = encode(text);
  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = buildMatrix(version, codewords, mask);
    const s = penalty(m);
    if (s < bestScore) { bestScore = s; best = m; }
  }
  const size = best.length;
  const dim = (size + margin * 2) * scale;
  let path = '';
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (best[r][c] === 1) path += `M${(c + margin) * scale} ${(r + margin) * scale}h${scale}v${scale}h-${scale}z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
