# 协作指南（第三百零七轮立，v4.19.0）

> zerokit 的 MCP server 支持 `--broadcast` 协作模式：多个客户端连同一 server，
> 一方执行工具、各方实时可见——「你跑我看」，外加过滤订阅、结果摘要、频率控制与协作锁。
> 本指南的载荷样例全部来自测试断言过的真实形态。

## 1. 接入五步（客户端清单）

```
1. 启动：zkit mcp serve --http 31800 --broadcast（server 侧）
2. 带 token：所有请求头 x-zerokit-token: <48 位>
3. 自报家门：POST /mcp 头 x-client-id: <名字>（presence 与锁的 holder 显示用）
4. 握手：POST initialize → 收 mcp-session-id 响应头 → notifications/initialized
5. 监听：GET /mcp（同 session-id，accept: text/event-stream）= 广播 SSE 流
```

## 2. 广播载荷（notifications/message）

观察者的 SSE 流里收到：

```json
event: message
data: {"method":"notifications/message","params":{"level":"info",
  "data":"{\"type\":\"tool-call\",\"tool\":\"demochain__gen\",\"ok\":true,\"ms\":12,
          \"summary\":{\"value\":21}}"}}
```

- `summary` 先过脱敏（token/password 键打码），再分档：≤4KB 全量直放；>4KB
  `{ "_truncated": true, "head": "首段 600 字", "fields": {…统计} }`
- presence 事件（`session-joined` / `session-left`）随时全发，不受过滤与节流影响

## 3. 过滤订阅（只收关心的 tool）

initialize 的 `clientInfo` 里带 `filterTools`（tool 名**前缀**数组）：

```json
"clientInfo": { "name": "watcher", "version": "1.0", "filterTools": ["demochain"] }
```

不匹配前缀的 tool-call 不发给你（server 侧 `filteredBroadcasts` 计数）；
presence 照发。空数组/不声明 = 全收。

## 4. 频率控制与静默窗口

server 侧 config.toml：

```toml
[broadcast]
min-interval-ms = 2000   # 同 method 最小间隔（presence 豁免）
quiet = "22:00-07:00"    # 跨午夜窗口，窗口内非 presence 广播丢弃
```

丢弃量见 `GET /mcp/sessions` 的 `droppedBroadcasts` / `filteredBroadcasts`。

## 5. 协作锁（mutate 互斥）

`--broadcast` 开启时，**非 read** 工具同 key 全局互斥：B 在 A 执行中调用同工具会得到：

```json
{ "error": "busy-locked", "holder": "alice", "since": "2026-11-19T03:00:00Z" }
```

客户端处理：读 `structuredContent.error === 'busy-locked'` 后退避重试（建议 250ms 起步、
封顶 8s）。释放时机：执行完成/失败/异常、授权拒绝、断连（DELETE）批量释放。

## 6. 会话查询

```
GET /mcp/sessions  →  { count, sessions:[{clientId, connectedAt, session}],
                        droppedBroadcasts, filteredBroadcasts,
                        locks:[{tool, holder, since}] }
```

CLI 侧：`zkit mcp sessions`（含频控丢弃提示行）。

## 相关文档

- [插件清单规范](../reference/plugin-spec.md)（动作 risk 分级——锁的触发面）
- [平台差异判据](../reference/platform-pitfalls.md)（SSE 客户端的跨平台坑）
- [数据管道指南](data-pipelines.md)（广播里跑的管道长什么样）
