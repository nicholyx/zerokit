#!/usr/bin/env bash
# 第二百八十六轮①③：契约快道——结构契约类测试单独秒级入口。
# 适用：改 server.ts API 面 / web 端 api() 调用 / 域文件注入面后，即改即验（全量 test-all ~10 分钟太远）。
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== 契约快道（结构契约：API 契约 + 注入面契约）=="
t0=$(date +%s%N)
node test/openapicontract279-smoke.mjs
node test/domain-faces-smoke.mjs
t1=$(date +%s%N)
echo "== 契约快道通过（$(( (t1 - t0) / 1000000 ))ms）=="
