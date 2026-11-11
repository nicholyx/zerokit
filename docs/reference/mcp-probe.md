# MCP 探针体系（第二百五十五至二百五十九轮，v3.47.0–v3.51.0）

> 让「核对 MCP 工具面」不需要拉起 MCP server——四个入口全 UI/CLI 化。
> 本文档是该体系的单一参考：入口清单、使用场景、与相邻命令的边界。

## 四个入口

| 入口 | 命令/路径 | 能做什么 | 轮次 |
|---|---|---|---|
| **Web 动作详情页** | 「MCP 调用」按钮 | 以 tools/call 语义直调当前动作（参数走表单） | 255 |
| **Web 动作详情页** | 「inputSchema」按钮 | 看模型实际看到的 JSON Schema（min/max/pattern/enum 透传核对） | 256 |
| **Web #/mcp 面板** | 命令面板「🔌 MCP 工具清单」 | 全量工具表（schema/risk/annotations）+ 行展开 + 直调；「资源」tab 看 zerokit:// 七资源 | 257/258 |
| **CLI** | `zkit mcp probe 插件__动作` | 直调（--params '{}'）；--schema 打印 inputSchema；--json 机读 | 259 |

支撑端点（OpenAPI 已登记）：

- `GET /api/mcp-tools` — tools/list 同构清单
- `GET /api/mcp-resources` — resources/list 同构清单（7 资源）
- `GET /api/mcp-resource?uri=` — 单资源读取
- `GET /api/mcp-probe?tool=` — 单工具 inputSchema
- `POST /api/mcp-probe` — tools/call 语义直调（MCP 信封响应）

## 使用场景

**插件作者核对 schema**：动作详情页点「inputSchema」——215 轮的 min/max/pattern/enum
透传是否生效一屏可见，不用起 MCP 进程。

**MCP 集成排障**：AI 客户端调不通某个工具时——#/mcp 面板看工具在不在清单、
risk/annotations 对不对，行展开看 schema，点「直调」验证服务端执行是否正常。
错误三态（tool-not-found / bad-params / not-authorized）与真实 MCP server
逐字相同，UI 复现的错误就是客户端会看到的错误。

**CI 里验工具面**：`zkit mcp probe 插件__动作 --json` 退出码即成败——
断言输出 JSON 的 `ok`/`data` 字段即可。

## 与相邻命令的边界

| | 执行？ | 看什么 | 授权 |
|---|---|---|---|
| `zkit mcp probe` | **执行** | 结果 + isError + _meta | 同 MCP server（只读放行 / 副作用须 allow） |
| `zkit mcp dry-run` | 不执行 | 将运行的命令/风险/参数 | 不涉及（不执行） |
| `zkit run` | 执行 | 结果（CLI 语义） | CLI confirm 链 |

probe 是「MCP 语义的 dry-run + run」：参数校验与 MCP callTool 同规则
（coerceParam/applyDefaults），响应是 MCP 信封（jsonrpc/content/_meta）。

## 审计来源

probe 执行记审计 `caller=mcp-probe`——与 `mcp`（真实 MCP server 调用）可辨，
审计面板可按来源过滤。

## 三层防线（254 轮判据的 MCP 特化）

- L1 静态：webui-smoke 断言端点/按钮/信封字段存在
- L2 契约：授权策略/参数校验与 mcp.ts callTool 同源（改一处两侧同步——domain-faces 思想）
- L3 运行时：cdp-smoke 面板零错误覆盖 #/mcp 路由
