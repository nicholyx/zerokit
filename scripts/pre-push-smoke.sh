#!/usr/bin/env bash
# 第三百四十三轮：pre-push 真渲染烟测——341/342 两轮挖出七个潜伏 bug 后制度化。
# 只在本地跑（CI 走降级路径）；web/ 或 src/ 有改动才跑（纯 docs push 不拖慢）。
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

CHANGED=$(git diff --name-only "HEAD@{push}"..HEAD 2>/dev/null | grep -cE "^(web|src)/" || true)
if [ "${CHANGED:-0}" -eq 0 ]; then
  echo "pre-push-smoke: web/src 无改动，跳过"
  exit 0
fi

echo "pre-push-smoke: web/src 有改动（${CHANGED} 文件）——跑真渲染烟测"
echo "--- panelsmoke（三面板 CDP） ---"
node test/panelsmoke341-smoke.mjs || exit 1
echo "--- cdp-smoke（12 面板） ---"
node test/cdp-smoke.mjs || exit 1
echo "pre-push-smoke: 全过 ✓"
exit 0
