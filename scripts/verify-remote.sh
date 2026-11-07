#!/usr/bin/env bash
# verify-remote.sh <分支名> —— push 复核（第一百四十六轮③）
# 背景：git push 在网络故障时可能「本地显示成功、远端没更新」（v1.47.0 事故）。
# 用法：git push origin <b> && ./scripts/verify-remote.sh <b>
# 断言：gh api branches/<b> 返回的远端 sha === 本地 <b> 的 sha；不一致非零退出。
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
# verify-remote.sh tag <tag> <sha> —— 打 tag 前双确认（第一百四十六轮④）
# 断言：①对象存在（git cat-file）②目标 sha === 远端 main HEAD（防打在 feature merge 上）
tag_mode() {
  local tag="$1" sha="$2"
  # 第一百七十二轮⑤：对象类型打印出来（cat-file 结果可见，不再静默）
  local obj_t; obj_t="$(git cat-file -t "$sha" 2>/dev/null || true)"
  [[ "$obj_t" = "commit" || "$obj_t" = "tag" ]] || { echo "FAIL  对象 $sha 本地不存在或非提交（fetch 被吞？先 git fetch）"; return 1; }
  echo "OK    确认对象存在：$sha（$obj_t）"
  local rmain
  rmain="$(gh api repos/nicholyx/zerokit/branches/main --jq .commit.sha 2>/dev/null)" || {
    for _ in 1 2 3 4 5; do sleep 5; rmain="$(gh api repos/nicholyx/zerokit/branches/main --jq .commit.sha 2>/dev/null)" && break; done
  }
  [[ -z "$rmain" ]] && { echo "FAIL  查不到远端 main"; return 1; }
  [[ "$sha" != "$rmain" ]] && { echo "FAIL  $sha 不是远端 main HEAD（$rmain）——release merge 还没落 main，别打 tag！"; return 1; }
  echo "OK    tag $tag 可安全打在 $sha（= 远端 main HEAD）"
}

# 第一百七十二轮⑤：tag 子模式分发（此前 "tag" 被当分支名 rev-parse 报歧义）
if [[ "${1:-}" == "tag" && $# -eq 3 ]]; then tag_mode "$2" "$3"; exit $?; fi
branch="${1:?用法：verify-remote.sh <分支名> | tag <tag> <sha>}"
local_sha="$(git rev-parse "$branch")" || exit 1
remote_sha="$(gh api "repos/nicholyx/zerokit/branches/$branch" --jq .commit.sha 2>/dev/null)" || {
  for _ in 1 2 3 4 5; do
    sleep 5
    remote_sha="$(gh api "repos/nicholyx/zerokit/branches/$branch" --jq .commit.sha 2>/dev/null)" && break
  done
}
if [[ -z "$remote_sha" ]]; then
  echo "FAIL  查不到远端分支 $branch（网络？分支名？）"
  exit 1
fi
if [[ "$local_sha" != "$remote_sha" ]]; then
  echo "FAIL  远端 $branch 在 $remote_sha，本地在 $local_sha —— push 没有真正落地，重推！"
  exit 1
fi
echo "OK    远端 $branch 已确认在 $local_sha"


