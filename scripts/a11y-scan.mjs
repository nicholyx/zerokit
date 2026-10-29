#!/usr/bin/env node
// 第六十六轮⑨：a11y 静态扫描——已知反模式正则盘点（不引 axe 依赖，CI 可跑）。
// 用法：node scripts/a11y-scan.mjs [文件...]（缺省扫 web/）
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const targets = process.argv.slice(2).length
  ? process.argv.slice(2).map((f) => path.resolve(f))
  : ['web/app.js', 'web/index.html', 'web/extras.js'].map((f) => path.join(ROOT, f));

const findings = [];
const add = (file, line, rule, msg) => findings.push(`${path.relative(ROOT, file)}:${line}  [${rule}] ${msg}`);

for (const file of targets) {
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((l, i) => {
    const n = i + 1;
    // 1. 图标字符按钮无 aria-label（✕ ✎ ⋙ 等独立成按钮文字时）
    if (/<(button|span)[^>]*title="[^"]*"[^>]*>\s*[✕✎⋯☰➤▲▼✂]()\s*</.test(l)
      && !/aria-label/.test(l) && !/role="button"/.test(l)) {
      add(file, n, 'icon-label', '纯符号可点元素缺 aria-label');
    }
    // 2. role="tablist" 容器内的 tab 必须带 aria-selected
    // 模板串里 aria-selected 是动态插值（aria-selected="${...}"），静态扫插值痕迹即可
    if (/class="rtab(?!-)/.test(l) && /data-rtab=/.test(l)) {
      const window2 = l + '\n' + (lines[i + 1] || '');
      if (!/aria-selected/.test(window2)) {
        add(file, n, 'tab-selected', '页签按钮缺 aria-selected（带 data-rtab 的才是 tab）');
      }
    }
    // 3. onclick 的 span 无 role
    if (/<span[^>]*onclick/.test(l) && !/role=/.test(l)) {
      add(file, n, 'span-role', 'onclick 的 span 缺 role（读屏不认为可点）');
    }
    // 4. table 无 caption 且类是 cmp（对比表要求可读出语境）
    if (/<table class="[^"]*cmp/.test(l) && !/caption/.test(l)) {
      add(file, n, 'cmp-caption', '对比表缺 caption');
    }
    // 5. 模态容器无 role
    if (/class="modal"/.test(l) && !/role="(dialog|alertdialog)"/.test(l)) {
      add(file, n, 'modal-role', '模态容器缺 role=dialog');
    }
  });
}

if (findings.length) {
  console.error(`a11y 扫描发现 ${findings.length} 处：`);
  for (const f of findings) console.error('  ' + f);
  process.exit(1);
}
console.log('a11y 静态扫描通过（0 findings）');
