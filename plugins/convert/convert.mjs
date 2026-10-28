#!/usr/bin/env node
/**
 * convert 插件：八种转换，纯计算零依赖。
 * 共享的输出协议（ok/err/humanBytes/groupDigits）来自 plugins/_vendor/zkutil.mjs——
 * 这是「插件间共享代码」的示范：相对路径 import，不打包、不装依赖。
 * ok()/err() 内部直接 console.log（JSON 单行），出口只有 vendor 一处。
 */
import { ok, err, humanBytes, groupDigits } from '../_vendor/zkutil.mjs';

const [,, cmd, ...args] = process.argv;

try {
  switch (cmd) {
    case 'radix': {
      const [raw, to] = [args[0] ?? '', args[1] ?? '10'];
      const n = /^0x/i.test(raw) ? Number.parseInt(raw, 16) : /^0b/i.test(raw) ? Number.parseInt(raw.slice(2), 2)
        : /^0o/i.test(raw) ? Number.parseInt(raw.slice(2), 8) : Number(raw);
      if (!Number.isFinite(n)) throw new Error(`没法把 "${raw}" 认成数字（支持 255 / 0xff / 0b1111 / 0o17）`);
      const base = Number(to);
      if (![2, 8, 10, 16].includes(base)) throw new Error(`目标进制只能是 2/8/10/16，收到 ${to}`);
      const out = n.toString(base);
      ok({ value: base === 10 ? out : out.toUpperCase(), base, original: raw });
      break;
    }
    case 'case': {
      const [text, mode = 'upper'] = [args[0] ?? '', args[1]];
      const map = {
        upper: () => text.toUpperCase(),
        lower: () => text.toLowerCase(),
        title: () => text.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
      };
      if (!map[mode]) throw new Error(`模式只能是 upper/lower/title，收到 ${mode}`);
      ok({ text: map[mode](), mode });
      break;
    }
    case 'json-pretty': {
      const [text, indentRaw] = [args[0] ?? '', args[1] ?? '2'];
      const o = JSON.parse(text); // 抛错带位置，正好给用户看
      ok({ text: JSON.stringify(o, null, Number(indentRaw) || 2) });
      break;
    }
    case 'json-min': {
      ok({ text: JSON.stringify(JSON.parse(args[0] ?? '')) });
      break;
    }
    case 'b64': {
      const [text, mode = 'encode'] = [args[0] ?? '', args[1]];
      if (mode === 'encode') ok({ text: Buffer.from(text, 'utf8').toString('base64') });
      else if (mode === 'decode') ok({ text: Buffer.from(text, 'base64').toString('utf8') });
      else throw new Error(`方向只能是 encode/decode，收到 ${mode}`);
      break;
    }
    case 'url': {
      const [text, mode = 'encode'] = [args[0] ?? '', args[1]];
      if (mode === 'encode') ok({ text: encodeURIComponent(text) });
      else if (mode === 'decode') ok({ text: decodeURIComponent(text) });
      else throw new Error(`方向只能是 encode/decode，收到 ${mode}`);
      break;
    }
    case 'bytes': ok({ value: humanBytes(Number(args[0])), input: Number(args[0]) }); break;
    case 'digits': {
      const n = Number(args[0]);
      if (!Number.isFinite(n)) throw new Error(`没法把 "${args[0]}" 认成数字`);
      ok({ value: groupDigits(n) });
      break;
    }
    default: err(`未知子命令：${cmd}`); process.exitCode = 1;
  }
} catch (e) {
  err(e?.message ?? e);
  process.exitCode = 1;
}
