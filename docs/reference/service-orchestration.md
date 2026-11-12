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
| 266 | v3.58.0 | 运行时守护 | `zkit service watch` / `watchCycle` / `watchBackoffMs` |
| 267 | v3.59.0 | 守护可视化 | service-watch.json / `#/services` 守护区 |
| 268 | v3.60.0 | 守护后台化 | `--daemon` / `--status` / `--stop` |

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

## 运行时守护（第 266 轮）

`zkit service watch [--interval 30s] [--threshold 3] [--backoff-base 30s]`

- 前台循环探测所有**声明了 healthCheck 且运行中**的服务（停着的服务归用户，守护不碰）。
- 连续 threshold 次 unhealthy → 重启（走 up 链，依赖先行）。
- 指数退避：连续重启第 n 次后等待 backoff-base × 2^(n-1)，封顶 10 分钟；健康恢复即复位。
- Ctrl+C 干净退出（停探测不杀服务）。
- 审计 caller=service-watch（与人工操作可辨）。

## 守护后台化（第 268 轮）

`zkit service watch --daemon`——脱离终端常驻：

- detached 自我重入（同参去掉 --daemon 进前台循环），日志 `~/.zerokit/logs/service-watch.log`。
- 重复启动拒绝：init 前检查状态文件 pid 存活。
- `--status`：读状态文件 + pid 存活判定（残留文件显示「未运行（残留 pid=N）」）。
- `--stop`：SIGTERM 等 4s，超时 SIGKILL；对未运行幂等（「无需停止」）。
- 前台模式（266 轮行为）不变——Ctrl+C 只停探测不杀服务。
