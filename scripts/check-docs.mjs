#!/usr/bin/env node
/**
 * 第四十六轮⑤：文档一致性巡检——内链存在性 + 版本号四处同步 + cookbook 命令漂移。
 * 纯 node 实现（此前 bash+heredoc 版在 macOS runner 上 heredoc 段后静默退出，
 * 三轮未定论；node 是 CI 三平台唯一保证一致的解释器）。
 * 用法：node scripts/check-docs.mjs；退出码 0=全过，1=有问题。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

const problems = [];
const bad = (msg) => { console.log(`✗ ${msg}`); problems.push(msg); };

// ① Markdown 相对内链存在性
{
  const skip = new Set(['node_modules', '.git', 'target', '.trellis', 'apps', '.claude', '.codex', '.agents']);
  const dead = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) {
        const text = fs.readFileSync(p, 'utf8');
        for (const m of text.matchAll(/\[[^\]]*\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
          const t = m[1];
          if (/^(https?:|mailto:)/.test(t)) continue;
          if (!fs.existsSync(path.resolve(path.dirname(p), t))) dead.push(`${p}:${t}`);
        }
      }
    }
  };
  walk('.');
  if (dead.length) { bad('死链：'); for (const d of dead) console.log('    ', d); }
  else console.log('✓ 内链全部存在');
}

// ② 版本号四处同步
{
  const v = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
  const v2 = JSON.parse(fs.readFileSync('apps/desktop/src-tauri/tauri.conf.json', 'utf8')).version;
  const ct = fs.readFileSync('apps/desktop/src-tauri/Cargo.toml', 'utf8').match(/version = "([^"]+)"/)?.[1] ?? '';
  const cl = fs.readFileSync('apps/desktop/src-tauri/Cargo.lock', 'utf8')
    .split('name = "zerokit-desktop"')[1]?.match(/version = "([^"]+)"/)?.[1] ?? '';
  if (v !== v2) bad(`tauri.conf.json 版本 ${v2} ≠ package.json ${v}`);
  if (v !== ct) bad(`Cargo.toml 版本 ${ct} ≠ package.json ${v}`);
  if (v !== cl) bad(`Cargo.lock zerokit-desktop 版本 ${cl} ≠ package.json ${v}`);
  if (problems.length === 0) console.log(`✓ 版本号四处同步（${v}）`);
}

// ③ cookbook 与 --help 命令漂移
{
  const help = spawnSync(process.execPath, ['src/cli.ts', '--help'], { encoding: 'utf8' }).stdout ?? '';
  const cb = fs.readFileSync('docs/cookbook.md', 'utf8');
  const subs = [...new Set([...cb.matchAll(/zkit (plugin )?([a-z][a-z-]*)/g)].map((m) => m[2]))];
  const pluginFamily = /(new|dev|validate|install|add|update|remove|bundled|export|import|pack|unpack|info|recommend|lint|doc|publish-ready)/;
  for (const sub of subs) {
    if (help.includes(` ${sub}`)) continue;
    if (pluginFamily.test(sub) && help.includes('plugin')) continue;  // plugin 子族归 plugin 一级命令
    bad(`cookbook 用了子命令 '${sub}'，但 --help 里没有（命令漂移？）`);
  }
  if (problems.length === 0) console.log('✓ cookbook 命令与 --help 一致');
}

if (problems.length > 0) { console.log(`有 ${problems.length} 处问题`); process.exit(1); }
console.log('文档巡检全部通过');
