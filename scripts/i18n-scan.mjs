#!/usr/bin/env node
// i18n-scan：扫描 web/ 下硬编码中文（界面文案未进 i18n 表的缺口体检）
// 用法：node scripts/i18n-scan.mjs [--write-whitelist]
// 白名单 .i18n-whitelist（每行一条正则片段）登记「已知可接受」项（如中文注释、拼音表、同义词表）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(PKG_ROOT, 'web');
const WL_PATH = path.join(PKG_ROOT, '.i18n-whitelist');

// 中文字符（不含注音/扩展区）；只查字符串字面量与模板串所在的行
const CJK = /[\u4e00-\u9fff]/;
const FILES = ['app.js', 'extras.js', 'index.html'];

const whitelist = existsSync(WL_PATH)
  ? readFileSync(WL_PATH, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  : [];
const wlMatch = (line) => whitelist.some((frag) => {
  try { return new RegExp(frag).test(line); } catch { return line.includes(frag); }
});

let findings = [];
for (const f of FILES) {
  const raw = readFileSync(path.join(WEB, f), 'utf8');
  let src = raw;
  let offset = 0;
  // I18N 表是中文文案的家，不是缺口：整块跳过（表键由 i18n100-smoke 的 zh/en 对齐断言把关）
  if (f === 'extras.js') {
    const a = raw.indexOf('export const I18N');
    const b = raw.indexOf('};', a);
    if (a >= 0 && b > a) {
      src = raw.slice(0, a) + raw.slice(b + 2);
      offset = raw.slice(0, a).split('\n').length - 1;
    }
  }
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    // 跳过纯注释行（// 或 <!-- -->）——中文注释是合法的
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    // 行内注释剔除后再判：中文注释合法，界面文案必须进文案表
    const code = line
      .replace(/\/\/.*$/, '')            // // 行尾注释
      .replace(/\/\*[\s\S]*?\*\//g, '')  // /* */ 行内块注释
      .replace(/<!--[^>]*-->/g, '');       // HTML 注释（整行是注释的已被上面拦截，这里清残段）
    if (!CJK.test(code)) return;
    if (wlMatch(line)) return;
    findings.push({ file: f, line: i + 1 + offset, text: trimmed.slice(0, 90), code: code.trim().slice(0, 120) });
  });
}

if (process.argv.includes('--write-whitelist')) {
  // 把当前 findings 以精确片段形式追加白名单（首跑登记用）
  const adds = findings.map((x) => x.text.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  writeFileSync(WL_PATH, [...whitelist, ...adds].join('\n') + '\n');
  console.log(`已登记 ${adds.length} 条到白名单`);
  process.exit(0);
}

// 严重度分层：visible=渲染路径（innerHTML/模板串/textContent 赋值）里的中文——用户看得见；
// data=比较值/键名/日志——内部语义，多数合法。visible 是本轮要清零的。
const visible = findings.filter((x) => /innerHTML|textContent|\?\?|`|'/.test(x.code) && /提示|按钮|标题|空态|确认|执行|复制|导出|失败|成功|加载|没有|还|已|请/.test(x.code));
if (findings.length > 0) {
  console.error(`i18n 扫描：${findings.length} 处疑似未登记（其中渲染路径 ${visible.length} 处）`);
  for (const x of findings.slice(0, 20)) console.error(`  ${x.file}:${x.line}  ${x.text}`);
  if (findings.length > 20) console.error(`  …另有 ${findings.length - 20} 处`);
  console.error('确认可接受的项登记进 .i18n-whitelist；界面文案应进 web/i18n.js 文案表。');
  process.exit(1);
}
console.log('i18n 扫描：0 处未登记硬编码中文');
