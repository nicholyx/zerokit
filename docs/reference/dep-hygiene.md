# 依赖卫生巡检清单（第三百三十轮立，2026-11-20）

> 维护节奏的月度巡检步骤（10 分钟内完成）。工具：dep-audit.mjs（318 轮建）/ npm outdated / npm ls。

## 月度巡检步骤

1. **审计基线**：`node scripts/dep-audit.mjs` —— 四项全 OK 才过（幽灵依赖/lockfile 一致/许可证/白名单）。
2. **过期清单**：`npm outdated` —— 分三档处理：
   - patch/minor（Wanted 可达）：`npm update <pkg>` 后跑全量 → 直接合。
   - major（Latest ≠ Wanted）：开分支评估——grep 引用面 → 本地装新版跑 tsc + 全量 → 一行修复常见（如 325 sdk text optional）→ 评估修复必须在 PR 分支 push 后确认远端可见（299 判据）。
   - 停更/风险：留 issue 说明（不强升）。
3. **安全公告**：`npm audit --omit=dev --registry=https://registry.npmjs.org` —— 官方 registry 才支持 audit endpoint（镜像源会 NOT_IMPLEMENTED）；high/critical 当轮处理。
4. **记录**：处理过的 PR 在 dependabot 评论里留评估结论（引用面/破坏点/测试证据）。

## 判据

- lockfile 与 manifest 必须一致（`npm ls` 无 UNMET/invalid）。
- 主版本跳升先查引用面再决定（329 轮 sdk 1.8：全库仅一处运行时使用 → 一行兜底）。
- `@types/node` 大版本跟 Node 运行时（26.x 对 Node 26——运行时没升就不升）。
- typescript 7.0 观望（325 判据：工具链大版本等生态稳定）。

## 历史处理记录

| 日期 | 项 | 处理 |
|---|---|---|
| 2026-11-20 | @anthropic-ai/sdk 1.8（dependabot #956） | 评估合入 + text optional 一行兜底 |
| 2026-11-20 | codeql-action bump（#957） | 直合 |
| 2026-11-20 | sdk 1.11 / tauri-cli 2.12.6 minor | npm update 直合 |
| 2026-11-20 | @types/node 26 / typescript 7 | 观望（运行时/生态未跟） |
| 2026-11-21（340 轮周检） | audit 0 vulnerabilities / sdk 1.11 已是 latest / outdated 无新增 | 本轮无动作（周检干净） |
| 2026-11-21（347 轮月度例跑） | audit 0 / sdk 1.11→1.12直升 / @types 26、ts 7 维持观望 | sdk 升 1.12 + **判据补全：本地 typecheck 需 npm install --no-save typescript**（无 bin 时静默通过——345 教训） |
| 2026-11-21（355 轮周检） | audit 0 / verify-remote main 对齐（95a2898） / outdated 无新增 | 本轮无动作（周检干净 + 远端对齐） |
| 2026-11-21（357 轮周检） | audit 0 / verify-remote main 对齐（c3e68b8） / outdated 无新增 | 本轮无动作（周检干净；Unreleased 1 条——协作 ops 日志，攒到下个功能轮一起发版） |
| 2026-11-22（363 轮周检） | audit 0 / verify-remote main 对齐（71bfbc1） / outdated 无新增 | 本轮无动作（v4.72.0 发布后例行——5 条积压已清） |
| 2026-11-22（368 轮周检） | audit 0 / verify-remote main 对齐（0308729） / outdated 无新增 | 本轮无动作（v4.77.0 发布后例行——3 条积压已清） |
| 2026-11-22（373 轮周检） | audit 0 / verify-remote main 对齐（eee40bc） / outdated 无新增 | 本轮无动作（v4.82.0 发布后例行）；附带 welcome80 探针降级判据（3 连败=平台抖动——权威面 mcp-smoke） |
| 2026-11-22（375 轮周检+巡检） | audit 0 / verify-remote main 对齐（6ff8dc4） / 内链 0 失效 / whitelist 死行 1 清除 | 组合维护轮（文档巡检第三季：371-374 判据补遗三条落 platform-pitfalls） |
| 2026-11-22（377 轮周检） | audit 0 / verify-remote main 对齐（863dade） / sdk 1.12 仍是 latest / outdated 无新增 | 本轮无动作（v4.86.0 发布后例行 + 12 月月度例跑预检——347 后无新 minor） |
| 2026-11-22（381 轮周检） | audit 0 / verify-remote main 对齐（4948bce） / outdated 无新增 | 本轮无动作（v4.90.0 发布后例行——90 minor 整点已发） |
| 2026-11-22（386 轮月度例跑） | audit 0 / verify-remote main 对齐（87ccb8c） / sdk 1.12 仍 latest / outdated 无新增 | 本轮无动作（12 月月度例跑——377 预检兑现：347 后无积压，干净轮） |
| 2026-11-22（389 轮周检） | audit 0 / verify-remote main 对齐（0759e6f） / outdated 无新增 | 本轮无动作（v4.98.0 发布后例行——距 v5.0.0 还差两个 minor） |
| 2026-11-20（331 轮 11 月例跑） | @hono/node-server 2.1.4→2.1.10 + hono 4.13.19（GHSA-qv5m/GHSA-jpvv moderate——传递依赖，零直用） | `npm audit fix --omit=dev`（需官方 registry；jlc mirror 不支持 audit endpoint）→ 0 vulnerabilities |
