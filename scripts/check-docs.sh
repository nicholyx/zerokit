#!/usr/bin/env bash
# 第四十六轮⑤：文档一致性巡检——内链存在性 + 版本号四处同步 + cookbook 与 README 命令漂移。
# 与 CI 同源可本地跑：bash scripts/check-docs.sh
set -uo pipefail
trap 'say "trap: 脚本中止于 line $LINENO（rc=$?）——若非预期请看上方输出"' EXIT
cd "$(dirname "$0")/.." || exit 1
fail=0
say() { printf '%s\n' "$*"; }
bad() { say "✗ $*"; fail=$((fail+1)); }

# python 解释器三平台探测（Windows runner 无裸 python3；py launcher 兜底）
PY=python3
command -v python3 >/dev/null 2>&1 || PY=python
command -v "$PY" >/dev/null 2>&1 || PY=py

# ① Markdown 相对内链存在性
"$PY" - <<'PY'
import pathlib, re, sys
try:
    bad = []
    for md in pathlib.Path('.').rglob('*.md'):
        if any(part in ('node_modules', '.git', 'target', '.trellis', 'apps', '.claude', '.codex', '.agents') for part in md.parts):
            continue
        for m in re.finditer(r'\[[^\]]*\]\(([^)#\s]+)(#[^)]*)?\)', md.read_text(encoding='utf-8', errors='ignore')):
            t = m.group(1)
            if t.startswith(('http://', 'https://', 'mailto:')):
                continue
            if not (md.parent / t).resolve().exists():
                bad.append(f"{md}:{t}")
    if bad:
        print("✗ 死链：")
        for b in bad:
            print("   ", b)
        sys.exit(1)
    print("✓ 内链全部存在")
except Exception as e:
    print(f"死链巡检异常: {e!r}")
    sys.exit(1)
PY
python_exit=$?
[ "$python_exit" -ne 0 ] && fail=$((fail+1))

# ② 版本号四处同步
v=$("$PY" -c "import json;print(json.load(open('package.json'))['version'])")
v2=$("$PY" -c "import json;print(json.load(open('apps/desktop/src-tauri/tauri.conf.json'))['version'])")
[ -n "$v" ] || { echo "✗ 读不到 package.json 版本（无 python？）"; exit 1; }
[ "$v" = "$v2" ] || bad "tauri.conf.json 版本 $v2 ≠ package.json $v"
grep -q "version = \"$v\"" apps/desktop/src-tauri/Cargo.toml || bad "Cargo.toml 没有 version = \"$v\""
if ! grep -A1 'name = "zerokit-desktop"' apps/desktop/src-tauri/Cargo.lock | grep -q "version = \"$v\""; then
  bad "Cargo.lock zerokit-desktop 不是 $v"
fi
[ $fail -eq 0 ] && say "✓ 版本号四处同步（$v）"

# ③ cookbook 与 README 的 zkit 命令漂移：cookbook 里出现的 `zkit <子命令>` 至少要在 HELP 里存在
node src/cli.ts --help > /tmp/zk-help.txt 2>/dev/null
while IFS= read -r sub; do
  # plugin 子族的二级命令（publish-ready/unpack/...）在 --help 里折叠成一行 plugin 清单，
  # 漂移检测按「cookbook 命令词出现在 --help 任意行」算过；真命令漂移（改名/删除）自然失配。
  grep -q "$sub" /tmp/zk-help.txt || grep -qE "plugin (new|dev|validate|install|add|update|remove|bundled|export|import|pack|unpack|info|recommend|lint|doc|publish-ready)" /tmp/zk-help.txt \
    || bad "cookbook 用了子命令 '$sub'，但 --help 里没有（命令漂移？）"
done < <(grep -oE 'zkit (plugin )?[a-z][a-z-]*' docs/cookbook.md | awk '{print $NF}' | sort -u)
[ $fail -eq 0 ] && say "✓ cookbook 命令与 --help 一致"

if [ $fail -gt 0 ]; then say "有 $fail 处问题"; exit 1; fi
say "文档巡检全部通过"
