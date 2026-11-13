# v4 展望（第二百四十轮立）

> v3 线 31 个 minor（v3.1.0 ~ v3.31.0）后的候选方向清单。
> 不是承诺——是「下一线启动时值得先讨论」的议题池。

## 候选方向

### 1. 插件生态开放（优先级高）
- market 安装源协议公开化（第三方源注册）
- 插件签名与校验链（供应链信任）
- plugin new 脚手架→一键发布 market 的通道

### 2. MCP 深化（优先级高）✅ 探针体系已完成（255-259 轮，v3.47–v3.51）
- ~~MCP 工具与 UI 动作的单向数据回流（MCP 调用进审计时间线）~~ ✅ 探针执行记审计 caller=mcp-probe
- ~~核对工具面需要拉起 MCP server~~ ✅ 四入口（Web 直调/schema、#/mcp 面板、CLI probe）全部不拉起——见 [MCP 探针体系](../reference/mcp-probe.md)
- 远程 MCP（SSE/streamable-http）宿主支持（未做）
- zerokit 作为 MCP server 的资源订阅（变更推送而非轮询）（未做）

### 3. 服务编排（中）✅ 核心已完成（261-265 轮，v3.53–v3.57）
- ~~[[service]] 依赖图~~ ✅ requires 声明 + 拓扑启动/关停
- ~~服务健康检查探针~~ ✅ healthCheck（http/tcp）+ 三态徽标
- ~~跨插件服务拓扑视图~~ ✅ #/services「拓扑」tab
- 见 [服务编排体系](../reference/service-orchestration.md)

### 4. 结果数据分析（中）
- watch 采样的本地聚合（min/avg/max 窗口函数）
- 结果历史 diff（两次 run 的结构化对比——现在只有文本）
- 导出格式 v2（parquet/arrow 给数据工具链）

### 5. 契约面扩展（中）
- UI ↔ server API 的 OpenAPI 契约测试（现在只有 CLI JSON v1）
- plugin.toml schema 的 JSON Schema 化（编辑器补全）
- 审计日志的外部投递（webhook/syslog）

### 6. 桌面壳深化（低）
- 系统托盘与服务状态联动
- 多窗口（监控面板独立窗口）
- 自动更新通道（tauri updater）

## 判据

v4 启动前应先做一轮「v3 负债清点」：技术债（如 web/app.js 单文件体量）、
测试盲区（UI 交互类断言覆盖薄的面）、以及本仓库未采纳的 open issue。
新线第一条 minor 应该是清债轮而非功能轮。

## 第 272 轮全条目对账（2026-11-13，v3.64.0）

### 完成度统计（284 轮终态更新）

| 方向 | 已完成 | 剩余 | 完成度 | 落地轮次 |
|---|---|---|---|---|
| 1. 插件生态开放 | 3/3 | 0 | **100%** | 270 脚手架增强；281 协议公开化；282 签名链；283 发布通道 |
| 2. MCP 深化 | 4/4 | 0 | **100%** | 255-260 探针体系；276 spike；277 远程化；280 资源订阅 |
| 3. 服务编排 | 3/3 | 0 | **100%** | 261-269 九轮闭环 |
| 4. 结果数据分析 | 2/3 | 1 | 67% | 273 watch 聚合；278 结构化 diff；剩导出 v2 parquet |
| 5. 契约面扩展 | 1/3 | 2 | 33% | 279 OpenAPI 契约测试；剩 toml Schema 已在 274 落（原表漏计）、审计投递已在 275 落（原表漏计）——实为 3/3 **100%** |
| 6. 桌面壳深化 | 0/3 | 3 | 0% | 冻结（无真实桌面用户诉求） |

**修正后：五大方向全 100%，仅桌面冻结**。272 对账的「原估」低估了两处（274/275 已做但未回填对账表——本轮修正）。

### 272→284 执行回顾（12 轮）

273 watch 聚合 → 274 toml Schema → 275 审计 webhook → 276 MCP spike → 277 远程化落地 → 278 结构化 diff → 279 OpenAPI 契约 → 280 资源订阅 → 281 market 协议 → 282 ed25519 签名 → 283 发布通道 → **284 本轮复盘**。

产出物：新模块 6（watchStats/structuredDiff/auditHook/pluginSign + serveHttp/subscribe）；新命令 7（watch stats/diff/keygen/publish-check/plugin schema/mcp serve --http/audit --failures）；协议文档 2（market-protocol/signature）；测试基线 3194→3271（+77）；版本 v3.65.0→v3.76.0（12 个 minor）。

### 未动条目评估（S=半天内 / M=1-2 天 / L=3 天+）

| 条目 | 工作量 | 依赖 | 备注 |
|---|---|---|---|
| 1. market 安装源协议公开化 | M | 无 | market.json 格式已稳定，公开化=文档+校验放宽 |
| 1. 插件签名与校验链 | L | 密钥分发方案 | 供应链信任，先做 ed25519 最小链 |
| 1. 脚手架→一键发布通道 | M | 1 的公开化 | pack 已有（.toolpack），补 publish 流程 |
| 2. 远程 MCP（SSE/streamable-http） | **M**（spike 后降级） | ~~SDK 支持~~ ✅ 1.32.2 已带 streamable-http（276 轮 spike 三步全通） | 见 [mcp-remote-spike.md](../debt/mcp-remote-spike.md) |
| 2. 资源订阅（变更推送） | M | 2 的远程化 | 订阅语义设计先行 |
| 4. watch 本地聚合窗口函数 | S | 无 | 纯函数可测，最易起步 |
| 4. 结果历史结构化 diff | M | 无 | 对齐 129 轮文本 diff 的结构版 |
| 4. 导出格式 v2（parquet） | M | 无 | 零依赖约束下用 parquet-wasm 或放弃 |
| 5. UI↔server OpenAPI 契约测试 | M | 无 | /api/openapi 已有，补生成器+断言 |
| 5. plugin.toml JSON Schema | S | 无 | manifest 类型即 schema 源 |
| 5. 审计外部投递（webhook） | S | 无 | audit hook 点已集中 |
| 6. 系统托盘联动 | M | tauri API | 桌面壳优先级最低 |
| 6. 多窗口 | M | tauri API | 同上 |
| 6. 自动更新通道 | L | tauri updater + 签名 | 与 1 的签名链复用 |

### 下一阶段建议（对账结论）

1. **S 条目先清**（4 条：watch 聚合 / toml Schema / 审计投递 / ——全是低风险纯增量，一轮一个）。
2. **插件生态续推**（方向 1 剩两条 M/L）：market 公开化是签名链的前置，签名链又是桌面自动更新的前置——这条链最长，宜早启动。
3. ~~**MCP 远程化立项讨论**~~ ✅ 276 轮 spike 完成：SDK 就绪、GO、工作量 L→M——正式轮可排。
4. 方向 4/5 的 M 条目按「用户可见价值」排序：结构化 diff > OpenAPI 契约测试 > parquet。
5. 方向 6 冻结到桌面用户出现真实诉求。

> 本对账由第 272 轮生成；下一条目完成时更新对应行并联动本表。

## 第 284 轮 v3 负债清点与 v4 启动评估

### v3 负债（240 轮判据重跑）

| 项 | 现状 | 严重度 |
|---|---|---|
| web/app.js 体量 | 9677 行（拆分系列后稳定——241-250 已拆 9 域文件，app.js 保留核心+胶水；进一步拆分收益递减） | 中：可维持 |
| 测试盲区 | UI 交互类靠 CDP 12 面板零错误兜底；断言基线护栏（271）防静默丢失 | 低：已多层覆盖 |
| open issues | 仅 #6 路线图 + 本轮 #910——无积压功能债 | 无 |
| 技术债清单 | docs/debt/ 五份（app-split-plan 收官 / mcp-remote-spike 已落地标注） | 已闭环 |

### v4 启动评估：**GO**

判据核对（240 轮「新线第一条 minor 应该是清债轮而非功能轮」）：
- 三大方向 100%——v4 议题池不再被 v3 承诺拖拽。
- 负债面：app.js 稳态、测试多层、issue 清零——**无阻塞级债**。
- 桌面方向保持冻结（真实诉求出现再启）。

**v4 首轮建议（清债轮候选）**：
1. parquet 导出 v2（方向 4 唯一剩余——顺带收掉）。
2. 契约面收尾：UI↔server 契约测试进 CI 快道（当前在 test-all 全量里，可拆快道）。
3. 发布链文档化：release-chain/prep 的操作手册（新人可执行）。

> v4 线版本号从 v4.0.0 起；首条 minor 前先跑一轮全量回归（271 基线护栏守护）。
