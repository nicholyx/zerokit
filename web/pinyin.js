// 拼音与首字母匹配 —— 纯前端实现，不经过服务端。
//
// 中文用户习惯打声母：想看「代理」就打 dl，想看「系统信息」就打 xtxx。
// 这是 uTools 真正好用的地方，也是纯英文模糊搜索给不了的。
//
// 表是生成期产物（scripts/gen-pinyin.mjs），随程序作为静态资源加载，
// 运行时不联网、不依赖任何后端。
import { PINYIN_TABLE } from './pinyin-data.js';

// 解析表：格式是「汉字+拼音」直接相接（"啊a阿a埃ai"），汉字都是 BMP 单码元，
// 所以扫一个码元当汉字、再吃掉后面的字母就是一个条目，不需要分隔符。
const table = new Map();
{
  let i = 0;
  while (i < PINYIN_TABLE.length) {
    const code = PINYIN_TABLE.charCodeAt(i);
    let j = i + 1;
    while (j < PINYIN_TABLE.length) {
      const c = PINYIN_TABLE.charCodeAt(j);
      if (c < 97 || c > 122) break; // 不是 a-z，说明下一条开始了
      j++;
    }
    table.set(code, PINYIN_TABLE.slice(i + 1, j));
    i = j;
  }
}

const cache = new Map();
const EMPTY = { full: '', initials: '' };

/** 把一段文本转成全拼与首字母；非汉字按原样保留（小写）。 */
export function romanize(text) {
  if (!text) return EMPTY;
  const hit = cache.get(text);
  if (hit) return hit;

  let full = '';
  let initials = '';
  for (const ch of text.toLowerCase()) {
    const py = table.get(ch.codePointAt(0));
    if (py) {
      full += py;
      initials += py[0];
    } else if (/[a-z0-9]/.test(ch)) {
      full += ch;
      initials += ch;
    }
    // 标点、空白不参与匹配
  }
  const result = { full, initials };
  if (cache.size < 8000) cache.set(text, result);
  return result;
}

/**
 * 拼音匹配得分。刻意排在「字面前缀」（82 分）之下：
 * 打 dl 时如果真有插件叫 dl，它应该赢过拼音猜出来的「代理」。
 */
export function scorePinyin(r, token) {
  if (!r || !r.full) return 0;
  if (r.initials === token) return 76;
  if (r.full === token) return 72;
  if (r.initials.startsWith(token)) return 60;
  if (r.full.startsWith(token)) return 52;
  // 声母出现在中间也要能命中：打 dl 应该捞出「查看代理状态」（ckdlzt），
  // 而不只是以 dl 开头的词。
  //
  // 但「中间命中」只对 ≥2 个字母放宽：单个字母这么做会把所有含该字母的
  // 词全捞出来（打 d 连「停止代理 tzdl」都算命中），反而没法用。
  if (token.length >= 2) {
    if (r.initials.includes(token)) return 40;
    if (r.full.includes(token)) return 30;
  }
  return 0;
}