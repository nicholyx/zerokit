// 生成应用图标（PNG + ICO），不依赖任何图形库。
// Tauri 打包需要图标，而这里手写 PNG 编码比引一个依赖更省事：
// PNG = 签名 + IHDR/IDAT/IEND 三个 chunk，全部用 node:zlib 就能拼出来。
// ICO 更简单：Vista 之后可以直接内嵌 PNG。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT_DIR = path.resolve(import.meta.dirname, '..', 'apps', 'desktop', 'src-tauri', 'icons');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // color type: RGBA
  // 10-12: compression / filter / interlace = 0

  // 每行前面加一个 filter 字节（0 = None）
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 画图标：深色圆角方块 + 一个亮色 "z" */
function draw(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size / 512;                 // 以 512 为设计基准缩放
  const radius = 108 * s;
  const bg = [0x16, 0x1a, 0x20];
  const accent = [0x5a, 0xa9, 0xff];

  const inRounded = (x, y) => {
    const r = radius;
    const cx = Math.min(Math.max(x, r), size - r);
    const cy = Math.min(Math.max(y, r), size - r);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  };

  // "z" 的三段：上横、下横、斜杠
  const m = 132 * s;
  const far = size - m;
  const barH = 52 * s;
  const diagW = 46 * s;

  const inZ = (x, y) => {
    if (y >= m && y <= m + barH && x >= m && x <= far) return true;          // 上横
    if (y >= far - barH && y <= far && x >= m && x <= far) return true;      // 下横
    if (y > m + barH && y < far - barH) {                                    // 斜杠
      const t = (y - (m + barH)) / (far - barH - (m + barH));
      const xc = far - t * (far - m);
      if (Math.abs(x - xc) <= diagW / 2) return true;
    }
    return false;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!inRounded(x + 0.5, y + 0.5)) continue;      // 圆角外保持透明
      const color = inZ(x + 0.5, y + 0.5) ? accent : bg;
      rgba[i] = color[0];
      rgba[i + 1] = color[1];
      rgba[i + 2] = color[2];
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

function makeIco(pngBuf, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);   // reserved
  header.writeUInt16LE(1, 2);   // type: icon
  header.writeUInt16LE(1, 4);   // count

  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;   // 256 用 0 表示
  entry[1] = size >= 256 ? 0 : size;
  entry[2] = 0;                        // 调色板数
  entry[3] = 0;                        // reserved
  entry.writeUInt16LE(1, 4);           // color planes
  entry.writeUInt16LE(32, 6);          // bits per pixel
  entry.writeUInt32BE(0, 8);
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(6 + 16, 12);     // 图像数据偏移

  return Buffer.concat([header, entry, pngBuf]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const png512 = encodePng(512, draw(512));
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), png512);

const png256 = encodePng(256, draw(256));
fs.writeFileSync(path.join(OUT_DIR, '128x128.png'), encodePng(128, draw(128)));
fs.writeFileSync(path.join(OUT_DIR, '32x32.png'), encodePng(32, draw(32)));
fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), makeIco(png256, 256));
// macOS 的 .icns 这里不生成（本项目目前只针对 Windows 打包）

console.log('图标已生成：');
for (const f of ['icon.png', 'icon.ico', '128x128.png', '32x32.png']) {
  const p = path.join(OUT_DIR, f);
  console.log(`  ${f}  ${fs.statSync(p).size} 字节`);
}