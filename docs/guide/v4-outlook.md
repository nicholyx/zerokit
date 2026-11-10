# v4 展望（第二百四十轮立）

> v3 线 31 个 minor（v3.1.0 ~ v3.31.0）后的候选方向清单。
> 不是承诺——是「下一线启动时值得先讨论」的议题池。

## 候选方向

### 1. 插件生态开放（优先级高）
- market 安装源协议公开化（第三方源注册）
- 插件签名与校验链（供应链信任）
- plugin new 脚手架→一键发布 market 的通道

### 2. MCP 深化（优先级高）
- MCP 工具与 UI 动作的单向数据回流（MCP 调用进审计时间线）
- 远程 MCP（SSE/streamable-http）宿主支持
- zerokit 作为 MCP server 的资源订阅（变更推送而非轮询）

### 3. 服务编排（中）
- [[service]] 依赖图（proxy 挂了 watcher 也不该瞎跑）
- 服务健康检查探针（HTTP/TCP 声明式）
- 跨插件服务拓扑视图

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
