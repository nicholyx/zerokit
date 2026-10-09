// 生成「汉字 → 拼音」表，供启动器的拼音/首字母匹配使用。
//
// 为什么做成生成期任务：拼音库（pinyin-pro，约 900KB）只在**这里**用一次，
// 产物是一个静态数据文件，运行时和前端都不引任何依赖，也不需要构建步骤。
// 想更新数据，跑一次 `node scripts/gen-pinyin.mjs` 即可。
//
// 产物格式刻意做到最省：一整串「汉字+拼音」直接相接，例如
//   啊a阿a埃ai挨ai...
// 解析时扫一个汉字、再吃掉后面的字母即可，不需要分隔符，也不用查表。
import fs from 'node:fs';
import path from 'node:path';
import { pinyin } from 'pinyin-pro';

// 产物是前端静态资源：拼音转换与匹配完全在浏览器里做，不经过任何服务端计算。
// 这样搜索是纯本地、纯离线的，也不依赖内核进程是否活着。
const OUT = path.resolve(import.meta.dirname, '..', 'web', 'pinyin-data.js');

// CJK 统一表意文字主区
const START = 0x4e00;
const END = 0x9fff;

const parts = [];
let count = 0;
const skipped = [];

for (let code = START; code <= END; code++) {
  const ch = String.fromCharCode(code);
  let readings;
  try {
    readings = pinyin(ch, { toneType: 'none', type: 'array' });
  } catch {
    continue;
  }
  const raw = readings?.[0];
  if (!raw) continue;
  // 只保留纯字母的读音（多音字取第一个；非汉字读法直接跳过）
  const clean = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (!clean || clean.length > 8) {
    skipped.push(ch);
    continue;
  }
  parts.push(ch + clean);
  count++;
}

const data = parts.join('');

const header = `// 由 scripts/gen-pinyin.mjs 生成，请勿手工编辑。
//
// 汉字 → 拼音（无声调）表，共 ${count} 字。格式：汉字与拼音直接相接，如 "啊a阿a埃ai"，
// 不需要分隔符——解析时扫一个汉字、再吃掉其后的字母即可（见 pinyin.ts）。
// 更新方式：node scripts/gen-pinyin.mjs

export const PINYIN_TABLE = ${JSON.stringify(data)};
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, header);

const bytes = fs.statSync(OUT).size;
console.log(`已生成 ${OUT}`);
console.log(`  收录 ${count} 个汉字，跳过 ${skipped.length} 个（无纯字母读音）`);
console.log(`  文件 ${(bytes / 1024).toFixed(1)} KB`);
console.log(`  抽样：${parts.slice(0, 3).join(' ')} … ${parts.slice(-3).join(' ')}`);