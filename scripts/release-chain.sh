#!/usr/bin/env bash
# release-chain.sh —— 发布链一条龙（第一百六十一轮）
#
# 背景：一百六十轮迭代沉淀出的发布流程，此前以 /tmp 临时脚本形态每轮重写。
# 本脚本把验证过的判据固化：CI 轮询（12 checks 或 11+MERGEABLE 捷径）、
# merge 复核（CI-FAIL 后绝不继续 tag——v1.59.1 事故）、tag 双确认
# （cat-file 对象存在 + ls-remote 为空）、Unreleased 空段重建（155 轮教训）、
# https→SSH remote 网络降级（github 443 大面积故障期验证过）。
#
# 用法：
#   scripts/release-chain.sh feature 530          # 合并 feature PR + main 同步（到此为止）
#   scripts/release-chain.sh release 1.61.0 531   # release 分支 + PR + merge + tag + 资产等待
#   scripts/release-chain.sh release 1.61.0 531 --dry-run   # 只打印步骤
#
# 依赖：gh（已登录）、git、node（release-prep.mjs）
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

MODE="${1:?用法：release-chain.sh feature <PR> | release <版本> <PR> [--dry-run]}"
DRY=0
for a in "$@"; do [[ "$a" == "--dry-run" ]] && DRY=1; done

# ---------- 基础工具（全部带重试） ----------
GITHUB_HTTPS="https://github.com/nicholyx/zerokit.git"
GITHUB_SSH="git@github.com:nicholyx/zerokit.git"

push_retry() { # push_retry <ref>
  local ref="$1"
  for i in 1 2 3 4 5 6; do
    if git push -u origin "$ref" 2>&1 | tail -1 >&2; then
      if git ls-remote --heads origin "${ref%%:*}" 2>/dev/null | grep -q "$(git rev-parse HEAD | cut -c1-10)" \
         || git ls-remote --tags origin "$ref" 2>/dev/null | grep -q "$ref"; then
        echo "PUSHED $ref"; return 0
      fi
    fi
    # https 失败切 SSH（github 443 故障期验证过）
    [[ "$(git remote get-url origin)" == "$GITHUB_HTTPS" ]] && git remote set-url origin "$GITHUB_SSH"
    [[ $i -lt 6 ]] && sleep 10
  done
  echo "FAIL  push $ref 六次未落地" >&2; return 1
}

ci_poll_merge() { # ci_poll_merge <PR> —— 轮询 CI + merge + 复核
  local pr="$1" green=0 n f p out m st
  for i in $(seq 1 40); do
    out="$(gh pr checks "$pr" 2>/dev/null || true)"
    n="$(echo "$out" | grep -cE '\bpass\b' || true)"
    f="$(echo "$out" | grep -cE '\bfail\b' || true)"
    p="$(echo "$out" | grep -cE 'pending' || true)"
    echo "  poll$i pass=$n fail=$f pending=$p"
    if [[ "$f" -gt 0 ]]; then
      echo "CI-FAIL（PR #${pr}）："; echo "$out" | grep fail | head -3
      return 1                      # CI-FAIL 绝不继续（v1.59.1 事故：fail 后 merge 循环空转、tag 打错提交）
    fi
    [[ "$n" = "12" ]] && green=1 && break
    if [[ "$n" -ge "11" && "$p" = "0" ]]; then
      m="$(gh pr view "$pr" --json mergeable --jq .mergeable 2>/dev/null || true)"
      [[ "$m" = "MERGEABLE" ]] && green=1 && echo "  （11/12 + MERGEABLE 捷径：第 12 项是总览 job 延迟）" && break
    fi
    sleep 45
  done
  [[ "$green" = "1" ]] || { echo "FAIL  PR #$pr CI 超时未绿"; return 1; }
  for i in 1 2 3 4 5; do
    gh pr merge "$pr" --squash --delete-branch >/dev/null 2>&1 || true
    st="$(gh pr view "$pr" --json state --jq .state 2>/dev/null || true)"
    [[ "$st" = "MERGED" ]] && { echo "MERGED #$pr"; return 0; }
    sleep 15
  done
  echo "FAIL  PR #$pr merge 五次未确认 MERGED"; return 1
}

remote_main_sha() { gh api repos/nicholyx/zerokit/branches/main --jq .commit.sha 2>/dev/null; }

# ---------- feature 模式 ----------
if [[ "$MODE" = "feature" ]]; then
  PR="${2:?缺 feature PR 号}"
  echo "== feature 模式：合并 PR #$PR =="
  [[ $DRY = 1 ]] && { echo "（dry-run）将执行：ci_poll_merge ${PR} → main 同步"; exit 0; }
  ci_poll_merge "$PR" || exit 1
  SHA="$(remote_main_sha)" || { echo "FAIL  拿不到远端 main sha"; exit 1; }
  echo "main=$SHA"
  git fetch origin main --quiet 2>/dev/null || true
  [[ "$(git cat-file -t "$SHA" 2>/dev/null || true)" = "commit" ]] || { echo "FAIL  本地没有 $SHA 对象（fetch 被吞？git fetch origin main）"; exit 1; }
  git checkout -q main && git reset -q --hard "$SHA"
  echo "OK  本地 main 已同步 $SHA"
  exit 0
fi

# ---------- release 模式 ----------
[[ "$MODE" = "release" ]] || { echo "FAIL  未知模式：${MODE}（feature | release）"; exit 2; }
VER="${2:?缺版本号（如 1.63.0）}"
PR="${3:?缺 release PR 号}"
BR="chore/release-v$VER"
echo "== release 模式：v${VER}（PR #${PR}）=="

if [[ $DRY = 1 ]]; then
  cat <<'PLAN'
（dry-run）将执行：
  1. 确认在 ${BR} 分支（release-prep 已跑、Unreleased 空段已重建）
  2. push_retry ${BR} → verify-remote
  3. gh pr create（如未建，PR #$PR 已给定则跳过）
  4. ci_poll_merge ${PR}（CI-FAIL 即停）
  5. remote_main_sha + cat-file 双确认 → ls-remote tag 为空 → tag v${VER} 打在 release merge 上
  6. push_retry tag → 资产轮询至 3 件
PLAN
  exit 0
fi

# 前置：当前分支应为 release 分支且已提交（放在一切远端操作之前——
# detached/其它分支上跑 release 模式属于误用，必须在 push 前拦下）
cur="$(git branch --show-current)"
[[ "$cur" = "$BR" ]] || { echo "FAIL  当前分支是「${cur:-（detached）}」，不在 ${BR}（先完成 release-prep 与空段重建）"; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "FAIL  工作区不干净（先提交）"; exit 1; }

push_retry "$BR" || exit 1
bash scripts/verify-remote.sh "$BR" || exit 1

# PR 已给定（创建是人工判断点：标题/正文需要人写）；直接轮询合并
ci_poll_merge "$PR" || exit 1

# tag：双确认 + 打在 release merge 上
SHA="$(remote_main_sha)" || { echo "FAIL  拿不到远端 main sha"; exit 1; }
echo "main=$SHA"
git fetch origin main --quiet 2>/dev/null || true
[[ "$(git cat-file -t "$SHA" 2>/dev/null || true)" = "commit" ]] || { echo "FAIL  本地没有 $SHA 对象"; exit 1; }
if git ls-remote --tags origin "v$VER" 2>/dev/null | grep -q "v$VER"; then
  echo "FAIL  远端已存在 v${VER}（幂等保护）"; exit 1
fi
git tag "v$VER" "$SHA"
push_retry "v$VER" || exit 1
echo "TAGGED v$VER → ${SHA:0:7}"

# 资产等待（release.yml 三平台构建，exe 常最后；Not Found 容错）
for i in $(seq 1 30); do
  n="$(gh api "repos/nicholyx/zerokit/releases/tags/v$VER" --jq '.assets|length' 2>/dev/null || echo 0)"
  echo "  assets=$n"
  [[ "$n" = "3" ]] && gh api "repos/nicholyx/zerokit/releases/tags/v$VER" --jq '.assets[].name' 2>/dev/null && echo "RELEASED v$VER" && exit 0
  sleep 40
done
echo "FAIL  30 轮（20 分钟）资产未齐——查 release.yml run 状态"
exit 1
