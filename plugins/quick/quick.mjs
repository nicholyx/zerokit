#!/usr/bin/env node
// 「小工具」插件的实现。每个动作都是纯计算，不依赖网络、不依赖外部命令。
const [op, input = ''] = process.argv.slice(2);

const out = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
const fail = (msg) => { process.stderr.write(msg + '\n'); process.exit(1); };

if (op === 'open-url') {
  // 只放行 http/https，并且拒绝任何可能在 cmd 里被重新解析的字符——
  // 这个值来自用户输入，属于不可信输入。
  if (!/^https?:\/\/[^\s"'`<>&|^%]+$/i.test(input)) {
    fail('只接受普通的 http/https 网址');
  }
  const { spawn } = await import('node:child_process');
  const child = spawn('cmd', ['/c', 'start', '', input], {
    detached: true, stdio: 'ignore', windowsHide: true,
  });
  child.unref();
  out({ 已打开: input });
} else if (op === 'ts2date') {
  const digits = input.trim();
  const ms = digits.length === 13 ? Number(digits) : Number(digits) * 1000;
  if (!Number.isFinite(ms)) fail('不是合法的时间戳');
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) fail('这个时间戳超出可表示范围');
  const pad = (n) => String(n).padStart(2, '0');
  out({
    本地时间: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
      + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    UTC: d.toISOString().replace('T', ' ').replace('.000Z', ' UTC'),
    ISO: d.toISOString(),
    星期: '日一二三四五六'[d.getDay()],
    距今: rel(ms - Date.now()),
    原始位数: `${digits.length} 位（${digits.length === 13 ? '毫秒' : '秒'}）`,
  });
} else if (op === 'color') {
  const hex = input.trim().replace(/^#/, '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const [h, s, l] = rgbToHsl(r, g, b);
  // 用 24 位真彩色在终端里给一行色块，能直接看到颜色
  const swatch = `\u001b[48;2;${r};${g};${b}m        \u001b[0m`;
  out({
    预览: swatch,
    HEX: `#${hex.toUpperCase()}`,
    RGB: `rgb(${r}, ${g}, ${b})`,
    HSL: `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`,
    亮度: l > 60 ? '偏亮（配深色文字）' : '偏暗（配浅色文字）',
    颜色块: `${r},${g},${b}`,
  });
} else if (op === 'b64') {
  const text = input;
  const looksBase64 = /^(?:[A-Za-z0-9+/]{4}){2,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text);
  if (looksBase64) {
    try {
      const decoded = Buffer.from(text, 'base64').toString('utf8');
      // 解出来是乱码就不算解码成功，宁可当普通文本去编码
      if (!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(decoded)) {
        out({ 方向: 'Base64 → 文本', 结果: decoded, 长度: decoded.length });
        process.exit(0);
      }
    } catch { /* 往下走 */ }
  }
  const encoded = Buffer.from(text, 'utf8').toString('base64');
  out({ 方向: '文本 → Base64', 结果: encoded, 长度: encoded.length });
} else {
  fail(`不认识的子命令：${op}`);
}

function rel(diff) {
  const abs = Math.abs(diff);
  const past = diff < 0;
  const unit = (n, name) => `${past ? '' : '还有 '}${n} ${name}${past ? '前' : ''}`;
  if (abs < 60_000) return unit(Math.round(abs / 1000), '秒');
  if (abs < 3_600_000) return unit(Math.round(abs / 60_000), '分钟');
  if (abs < 86_400_000) return unit(Math.round(abs / 3_600_000), '小时');
  return unit(Math.round(abs / 86_400_000), '天');
}

function rgbToHsl(r, g, b) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
  else if (max === gg) h = ((bb - rr) / d + 2) / 6;
  else h = ((rr - gg) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}