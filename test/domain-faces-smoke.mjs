// 第二百五十三轮②③：域文件注入面契约——双侧键集一致性静态断言。
// 防的是 251 轮那类「解构与注入面漂移」：改一侧漏另一侧，静态断言全绿但运行时 ReferenceError。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(ROOT, 'web', 'app.js'), 'utf8');

const DOMAINS = [
  ['createKeys', 'web/keys.js'],
  ['createBatch', 'web/batch.js'],
  ['createPanels', 'web/panels.js'],
  ['createShare', 'web/share.js'],
  ['createWatchTimers', 'web/watchtimers.js'],
  ['createMarket', 'web/market.js'],
  ['createLogs', 'web/logs.js'],
  ['createDoctorStats', 'web/doctorstats.js'],
  ['createThemeClip', 'web/themeclip.js'],
];

function splitTop(inner) {
  const parts = []; let depth = 0, instr = null, cur = '', i = 0;
  while (i < len(inner)) {
    const ch = inner[i];
    if (instr) { cur += ch; if (ch === '\\') { cur += inner[i + 1] ?? ''; i += 2; continue; } if (ch === instr) instr = null; i += 1; continue; }
    if (ch === '"' || ch === "'") { instr = ch; cur += ch; }
    else if (ch === '(' || ch === '{' || ch === '[') { depth += 1; cur += ch; }
    else if (ch === ')' || ch === '}' || ch === ']') { depth -= 1; cur += ch; }
    else if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; }
    else cur += ch;
    i += 1;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}
function len(s) { return s.length; }

function callBodies(src, ctor) {
  const out = []; let idx = 0;
  while (true) {
    const i = src.indexOf(ctor + '({', idx);
    if (i < 0) break;
    let j = i + ctor.length, depth = 0, k = j, instr = null;
    while (k < src.length) {
      const ch = src[k];
      if (instr) { if (ch === '\\') { k += 2; continue; } if (ch === instr) instr = null; k += 1; continue; }
      if (ch === '"' || ch === "'") instr = ch;
      else if (ch === '(') depth += 1;
      else if (ch === ')') { depth -= 1; if (depth === 0) break; }
      k += 1;
    }
    let body = src.slice(j, k + 1).trim();
    if (body.startsWith('(') && body.endsWith(')')) body = body.slice(1, -1).trim();
    if (body.startsWith('{') && body.endsWith('}')) body = body.slice(1, -1);
    out.push(body);
    idx = k;
  }
  return out;
}

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`FAIL  ${name}  <- domain-faces ${detail}`); } };

console.log('domain-faces-smoke');
for (const [ctor, file] of DOMAINS) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  // 解构解析：括号平衡取 const { ... } = ui 的完整体（值形可能含内嵌 {}，[^}] 会截断）
  const dm = /const \{ /.exec(src);
  const destr = new Set();
  let dbody = '';
  if (dm) {
    let i2 = dm.index + dm[0].length, depth2 = 1, k2 = i2;
    while (k2 < src.length && depth2 > 0) {
      const ch = src[k2];
      if (ch === '{') depth2 += 1;
      else if (ch === '}') depth2 -= 1;
      k2 += 1;
    }
    dbody = src.slice(i2, k2 - 1);
  }
  if (dbody) for (const part of splitTop(dbody)) {
    const p2 = part.trim(); if (!p2) continue;
    const key = p2.split(/[:=]/)[0].trim();
    destr.add(key);
  }
  const inj = new Set();
  for (const body of callBodies(app, ctor)) for (const part of splitTop(body)) {
    const p2 = part.trim(); if (!p2) continue;
    const key = p2.split(/[:=]/)[0].trim();
    if (/^[A-Za-z_$][\w$]*$/.test(key)) inj.add(key);
  }
  const missing = [...destr].filter((k) => !inj.has(k));
  check(`${file} 注入面契约（解构 ${destr.size} ⊆ 注入 ${inj.size}）`, missing.length === 0, `app 未注入：${missing.join(', ')}`);
  // ③ 跨域引用形态：域文件不得出现裸 __panels/__wt/__market/__logs/__ds/__tc/__share/__batch/__keys（只允许经 ref 注入）
  const uses = src.match(/(?<![\w.])__(panels|wt|market|logs|ds|tc|share|batch|keys)\b/g) ?? [];
  const unimported = [...new Set(uses)].filter((u) => !destr.has(u));
  check(`${file} 跨域引用均有注入依据（使用 ${uses.length} 处）`, unimported.length === 0, `未注入即用：${unimported.join(',')}`);
}
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
