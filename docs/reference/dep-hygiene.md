# 依赖卫生巡检清单（第三百三十轮立，2026-11-20）

> 维护节奏的月度巡检步骤（10 分钟内完成）。工具：dep-audit.mjs（318 轮建）/ npm outdated / npm ls。

## 月度巡检步骤

1. **审计基线**：`node scripts/dep-audit.mjs` —— 四项全 OK 才过（幽灵依赖/lockfile 一致/许可证/白名单）。
2. **过期清单**：`npm outdated` —— 分三档处理：
   - patch/minor（Wanted 可达）：`npm update <pkg>` 后跑全量 → 直接合。
   - major（Latest ≠ Wanted）：开分支评估——grep 引用面 → 本地装新版跑 tsc + 全量 → 一行修复常见（如 325 sdk text optional）→ 评估修复必须在 PR 分支 push 后确认远端可见（299 判据）。
   - 停更/风险：留 issue 说明（不强升）。
3. **安全公告**：`npm audit --omit=dev` —— high/critical 当轮处理。
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
