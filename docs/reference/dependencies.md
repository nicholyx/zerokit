# 依赖清单（为什么需要它）

> 第二百零二轮①：每个依赖一行「为什么」。新增依赖必须在此登记——dep-audit 幽灵依赖检查的文档面。

## 生产依赖（dependencies）

| 包 | 为什么需要 | 用在哪 |
|----|-----------|--------|
| `@anthropic-ai/sdk` | AI 工作台的 Anthropic provider（官方 SDK，流式输出） | src/ai/anthropic.ts |
| `@modelcontextprotocol/sdk` | MCP server 的协议实现（stdio transport/工具注册） | src/mcp.ts |
| `smol-toml` | plugin.toml 清单解析（零依赖纯 JS TOML，体积最小） | src/core/manifest.ts |

## 开发依赖（devDependencies）

| 包 | 为什么需要 | 用在哪 |
|----|-----------|--------|
| `@tauri-apps/cli` | 桌面壳构建（tauri build，CI 安装包流水线） | release.yml desktop-installer |
| `@types/node` | Node API 类型（tsc --noEmit 类型检查） | 全仓 ts |
| `pinyin-pro` | **生成期专用**：拼音表是生成期产物（scripts/gen-pinyin.mjs 一次性产出 web/pinyin-data.js），运行时零依赖 | scripts/gen-pinyin.mjs |
| `typescript` | tsc --noEmit 类型检查（不进构建步骤——项目无构建承诺不变） | npm run typecheck |

## 桌面壳 Rust 依赖

见 apps/desktop/src-tauri/Cargo.toml——每条已就地注释用途。

## 依赖规则

- 生产依赖只进「协议实现/平台 SDK」这类自己写不划算的；工具函数一律手写（本项目 0 依赖工具链的承诺）
- 新增依赖必须：在此登记 + 过 dep-audit（被 import + 许可证白名单）+ 评审理由
- 已知漏洞：npm audit --omit=dev（官方 registry）必须 0 high
