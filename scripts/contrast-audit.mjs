#!/usr/bin/env node
// scripts/contrast-audit.mjs——第一百七十轮：主题对比度系统化审计
// 扫 web/style.css 的变量组合，用 WCAG 相对亮度（复用 extras.js contrastRatio 语义）
// 判据：正文（fg 系列/accent 作为文字）≥4.5；非文本（边框/焦点环/装饰）≥3.0
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(path.join(PKG_ROOT, 'web', 'style.css'), 'utf8');

// ---- 相对亮度（与 web/extras.js contrastRatio 同实现）----
const lum = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };

// ---- 提取变量 ----
const varBlock = (CSS.match(/:root\s*\{[^}]+\}/)?.[0] ?? '');
const lightBlock = (CSS.match(/html\[data-theme="light"\]\s*\{[^}]+\}/)?.[0] ?? '');
const getVars = (block) => Object.fromEntries(
  [...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]])
);
const dark = getVars(varBlock);
const light = { ...dark, ...getVars(lightBlock) };
const ACCENTS_DARK = {
  default: dark.accent,
  violet: '#a78bfa', emerald: '#34d399', amber: '#f0b43c', rose: '#f472b6', slate: '#94a3b8',
};
const ACCENTS_LIGHT = {
  default: '#1d66d6', violet: '#6d4fd6', emerald: '#0c7d55', amber: '#7d5400', rose: '#c02664', slate: '#46586e',
};

// ---- 待审组合：两档主题 × 六 accent ----
const checks = [];
for (const [theme, V] of [['dark', dark], ['light', light]]) {
  const bg = V.bg, panel = V.panel, panel2 = V['panel-2'];
  checks.push({ theme, label: 'fg / bg', a: V.fg, b: bg, min: 4.5 });
  checks.push({ theme, label: 'fg / panel', a: V.fg, b: panel, min: 4.5 });
  checks.push({ theme, label: 'fg-dim / bg', a: V['fg-dim'], b: bg, min: 4.5 });
  checks.push({ theme, label: 'fg-dim / panel', a: V['fg-dim'], b: panel, min: 4.5 });
  checks.push({ theme, label: 'fg-dim / panel-2', a: V['fg-dim'], b: panel2, min: 4.5 });
  checks.push({ theme, label: 'ok / panel', a: V.ok, b: panel, min: 4.5 });
  checks.push({ theme, label: 'warn / panel', a: V.warn, b: panel, min: 4.5 });
  checks.push({ theme, label: 'bad / panel', a: V.bad, b: panel, min: 4.5 });
  checks.push({ theme, label: 'line / bg（非文本）', a: V.line, b: bg, min: 3.0 });
  checks.push({ theme, label: 'accent 焦点环 / bg（非文本）', a: V.accent, b: bg, min: 3.0 });
  const ACCENTS = theme === 'dark' ? ACCENTS_DARK : ACCENTS_LIGHT;
  for (const [name, hex] of Object.entries(ACCENTS)) {
    checks.push({ theme, label: `accent(${name}) 文字 / panel`, a: hex, b: panel, min: 4.5 });
    checks.push({ theme, label: `accent(${name}) 文字 / panel-2`, a: hex, b: panel2, min: 4.5 });
  }
}

let fail = 0;
for (const c of checks) {
  const r = ratio(c.a, c.b);
  if (r < c.min) {
    fail++;
    console.log(`FAIL  [${c.theme}] ${c.label}: ${c.a} on ${c.b} = ${r.toFixed(2)}（要求 ≥${c.min}）`);
  }
}
console.log(fail === 0
  ? `对比度审计：${checks.length} 组合全过（正文≥4.5 / 非文本≥3.0）`
  : `对比度审计：${fail} / ${checks.length} 组合不达标`);
process.exit(fail > 0 ? 1 : 0);
