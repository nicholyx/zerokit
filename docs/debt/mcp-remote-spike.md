# MCP 远程化 Spike（第二百七十六轮，2026-11-13）

> 272 对账建议第 3 条的落地：探水深，不做正式接入。结论先行——**GO，工作量 M**（原估 L 偏保守）。
>
> **✅ 已落地（277 轮：zkit mcp serve --http）**——本文的会话复用模式与鉴权设计全部按计划实现。

## ① SDK 传输支持面（已装 1.32.2 = 当前 latest）

| 传输 | 路径 | 状态 |
|---|---|---|
| stdio（现役） | server/stdio.js | serve() 在用 |
| 旧 SSE | server/sse.js | 可用（协议草案期形态，不建议新接入） |
| **streamable-http** | server/streamableHttp.js | **可用**——spike 实测三步全通 |

**关键发现：无需升级 SDK**。1.32.2 已带 StreamableHTTPServerTransport 且可实例化、可跑通完整 JSON-RPC 会话。

## ② serve() 改造点（spike 验证过的模式）

现役绑定：`new StdioServerTransport()` → `server.connect(transport)`（src/mcp.ts:609）。

远程化形态：在 server.ts 的 HTTP 层加 `/mcp` 路由（POST 三方法 + DELETE 断会话），核心是 **transport 会话复用**：

- 首请求（无 `mcp-session-id` 头）→ 新建 StreamableHTTPServerTransport + connect 一次；
- 后续请求按头取回同一 transport 实例 → `handleRequest(req, res, body)`；
- DELETE 关闭并移除。

spike 踩坑：每请求新建 transport 会丢会话态（tools/list 报 "Server not initialized"）——复用后三步全通。

## ③ 升级路径与破坏面

- **零包升级**（SDK 已具备）。
- mcp.ts：serve() 拆出「server 实例构造」（已有 setRequestHandler 全部可复用）与「传输绑定」两段——stdio 保持默认，加 `zkit mcp serve --http [port]` 或挂进 `zkit ui` 的 HTTP server。
- 破坏面：无（新增路由/新增 flag，stdio 路径不动）。

## ④ 防火墙与鉴权注意点

- macOS/Windows 首次监听非环回地址会弹防火墙授权；默认绑定 127.0.0.1 规避。
- 远程暴露必须有鉴权：zerokit 已有 UI token（48 hex）机制可复用——`/mcp` 要求 `x-zerokit-token` 头，与 /api/* 同款校验。
- streamable-http 协议本身不带鉴权——传输层之外的事，靠我们的 HTTP 层补。

## ⑤ 结论

- **GO**：SDK 就绪、模式已验证（spike 三步全通）、破坏面为零。
- 工作量 **M**（原估 L）：mcp.ts 拆分 + server 路由 + token 校验 + 测试（会话复用/断连/鉴权三面）。
- 建议排期：v4 线内正式轮，先于「资源订阅」（订阅依赖远程化的长连接面）。

## spike 复现

临时脚本（已删）：streamable-http 最小 server + 原生 fetch 三步客户端。关键参数：`accept: 'application/json, text/event-stream'`、响应可能是 SSE 分片——正式实现按 Content-Type 分流解析。
