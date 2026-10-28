#!/usr/bin/env bash
# 第四十六轮⑤：文档一致性巡检——内链存在性 + 版本号四处同步 + cookbook 与 README 命令漂移。
# 实现全部走 node（CI 三平台必有 node；python 解释器在 Windows runner 缺裸 python3、
# macOS runner 行为不稳，踩过两轮 CI）。
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
fail=0
say() { printf '%s\n' "$*"; }
bad() { say "✗ $*"; fail=$((fail+1)); }
trap 'rc=$?; if [ "$rc" -ne 0 ]; then say "trap: 异常中止 rc=$rc"; fi' EXIT

# ① Markdown 相对内链存在性
node - <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const bad = [];
const skip = new Set(['node_modules', '.git', 'target', '.trellis', 'apps', '.claude', '.codex', '.agents']);
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
        if (!fs.existsSync(path.resolve(path.dirname(p), t))) bad.push(`${p}:${t}`);
      }
    }
  }
};
walk('.');
if (bad.length) { console.log('✗ 死链：'); for (const b of bad) console.log('   ', b); process.exit(1); }
console.log('✓ 内链全部存在');
JS
node_exit=$?
[ "$node_exit" -ne 0 ] && fail=$((fail+1))

# ② 版本号四处同步（node 一把读，bash 只比对）
read -r v v2 v3 v4 <<EOF
$(node -e "
const fs=require('fs');
const pk=JSON.parse(fs.readFileSync('package.json','utf8'));
const tj=JSON.parse(fs.readFileSync('apps/desktop/src-tauri/tauri.conf.json','utf8'));
const ct=fs.readFileSync('apps/desktop/src-tauri/Cargo.toml','utf8').match(/version = \"([^\"]+)\"/);
const cl=fs.readFileSync('apps/desktop/src-tauri/Cargo.lock','utf8').split('name = \"zerokit-desktop\"')[1]?.match(/version = \"([^\"]+)\"/);
console.log([pk.version,tj.version,ct?.[1]??'',cl?.[1]??''].join(' '));
")
EOF
[ -n "$v" ] || { echo "✗ node 读版本失败"; exit 1; }
[ "$v" = "$v2" ] || bad "tauri.conf.json 版本 $v2 ≠ package.json $v"
[ "$v" = "$v3" ] || bad "Cargo.toml 版本 $v3 ≠ $v"
[ "$v" = "$v4" ] || bad "Cargo.lock zerokit-desktop 版本 $v4 ≠ $v"
[ $fail -eq 0 ] && say "✓ 版本号四处同步（$v）"

# ③ cookbook 与 --help 命令漂移
node src/cli.ts --help > /tmp/zk-help.txt 2>/dev/null
while IFS= read -r sub; do
  grep -q "$sub" /tmp/zk-help.txt || grep -qE "plugin (new|dev|validate|install|add|update|remove|bundled|export|import|pack|unpack|info|recommend|lint|doc|publish-ready)" /tmp/zk-help.txt \
    || bad "cookbook 用了子命令 '$sub'，但 --help 里没有（命令漂移？）"
done < <(grep -oE 'zkit (plugin )?[a-z][a-z-]*' docs/cookbook.md | awk '{print $NF}' | sort -u)
[ $fail -eq 0 ] && say "✓ cookbook 命令与 --help 一致"

if [ $fail -gt 0 ]; then say "有 $fail 处问题"; exit 1; fi
say "文档巡检全部通过"
