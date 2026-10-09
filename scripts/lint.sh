#!/usr/bin/env bash
#
# lint.sh —— 本地统一静态检查入口
#
# 一条命令跑完 CI 里**本地能跑**的静态检查，CI 与本地跑同一套，
# 避免「本地能过 CI 不过」。
#
# 缺失的工具会被跳过并提示安装方式；跳过项不算通过。
# 它刻意不覆盖：测试（node scripts/test-all.mjs，按需跑）与提交信息规范
# （PR 标题在 PR 建立前不存在，本地无从验证——用
#  ./scripts/check-commit-msg.sh --message "..." 预检）。
#
# zizmor 需要 docker；有 docker 就跑，没有就打印手动命令。

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fail=0
skip=0

run() {  # run <名称> <命令...>
  local name="$1"; shift
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "SKIP  ${name} —— 未安装 $1"
    case "$1" in
      actionlint) echo "      安装：brew install actionlint" ;;
      yamllint)   echo "      安装：pipx install yamllint" ;;
      shellcheck) echo "      安装：brew install shellcheck" ;;
    esac
    skip=1
    return 0
  fi
  if "$@"; then
    echo "OK    ${name}"
  else
    echo "FAIL  ${name}"
    fail=1
  fi
}

run "actionlint（工作流静态检查）" actionlint -color
run "yamllint（YAML 风格）" yamllint -c .yamllint .github/ market.json
run "shellcheck（shell 脚本）" shellcheck scripts/*.sh
run "bash -n（脚本语法）" bash -n scripts/check-commit-msg.sh

# zizmor：CI 用容器跑，本地有 docker 才跑
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if docker run --rm -v "$PWD":/repo:ro \
      ghcr.io/zizmorcore/zizmor:1.30.1 /repo --no-online-audits; then
    echo "OK    zizmor（工作流安全扫描）"
  else
    echo "FAIL  zizmor（工作流安全扫描）"
    fail=1
  fi
else
  echo "SKIP  zizmor —— 需要 docker；手动跑："
  echo "      docker run --rm -v \"\$PWD\":/repo:ro ghcr.io/zizmorcore/zizmor:1.30.1 /repo --no-online-audits"
  skip=1
fi

echo
if [[ "$fail" -ne 0 ]]; then
  echo "结果：有失败项"
  exit 1
fi
if [[ "$skip" -ne 0 ]]; then
  echo "结果：已跑项全部通过（但有跳过项，跳过不算通过）"
  exit 0
fi
echo "结果：全部通过"
