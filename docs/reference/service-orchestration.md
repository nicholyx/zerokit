# 服务编排体系（第二百六十一至二百六十四轮，v3.53.0–v3.56.0）

> 从「proxy 挂了 watcher 瞎跑」到依赖声明、拓扑连起、健康可见、逆序关停——服务生命周期全链路。
> 本文档是该体系的单一参考。

## 四步弧线

| 轮 | 版本 | 交付 | 命令/字段 |
|---|---|---|---|
| 261 | v3.53.0 | 依赖声明与前检 | `[[service]].requires` / `serviceDeps()` / startService 拦截 |
| 262 | v3.54.0 | 拓扑连起 | `zkit service up` / `topoStartOrder` / `/api/services/up` |
| 263 | v3.55.0 | 健康探针 | `[[service]].healthCheck` / `probeHealth` / 三态徽标 |
| 264 | v3.56.0 | 逆序关停 | `zkit service down [--all]` / `topoStopOrder` / `globalStopOrder` |
| 265 | v3.57.0 | 拓扑视图 | #/services「拓扑」tab / 本文档 |

## 声明语法

```toml
[[service]]
id = "alpha"
port = 39171
requires = ["beta", "other.remote"]     # 本插件 id 或 插件.服务
healthCheck = { http = "http://127.0.0.1:39171/health" }   # 或 tcp = "host:port"
run = ["{node}", "server.js"]
```

## 语义边界

- **requires**：启动前检查依赖运行状态——存在但未运行拒绝启动并指名；**缺失依赖是清单错误**（doctor/面板 depMissing 管，不拦启动——分层）。
- **topoStartOrder**：DFS 后序（依赖在前、本服务最后）；环边跳过不阻断（cycleSkipped 返回）。
- **topoStopOrder**：启动序的逆（本服务最先、依赖最后）——被依赖的最后停。
- **globalStopOrder**：入度剥离（无依赖先停、被依赖最多的最后）；环残余收敛尾部。
- **healthCheck**：http 期望 2xx / tcp 期望可连（2.5s 超时）；running 细分 healthy/unhealthy/stopped。探针异常全算未通过。
- **up/down 幂等**：已在运行 `=` 跳过；未运行 down `=` 跳过。链中失败即停（up）。

## 三层防线（MCP 特化同款思想）

- L1 静态：svcdeps261-smoke（13 断言——声明解析/缺失/环/拓扑/探针/幂等）
- L2 契约：requires/healthCheck 与 services.ts 同源解析（domain-faces 思想）
- L3 运行时：cdp-smoke 覆盖 #/services 路由

## 维护规则

新加服务字段（如 restart 策略）时：manifest 解析 → serviceDeps/probe 消费 → /api/services 带出 → UI 徽标 → svcdeps261 断言——五层同步，缺一即 domain-faces 式漂移。
