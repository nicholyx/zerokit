# Changelog

## [Unreleased]

### Added

- 守护后台化——zkit service watch --daemon（266-267 守护体系的「终端一关守护就没」补全）：--daemon 脱离终端常驻（detached 自我重入同参去 --daemon，日志 ~/.zerokit/logs/service-watch.log）；重复启动拒绝（init 前状态文件 pid 存活校验）；--status 查询（pid+时长+最近动作；残留文件显示「未运行（残留 pid=N）」）；--stop 干净停（SIGTERM 等 4s 超时 SIGKILL；未运行幂等「无需停止」）；前台模式 Ctrl+C 语义不变（266 轮行为保留）；svcdeps261 +4 断言（daemon 启动/拒绝重复/status/stop 幂等）；service-orchestration.md 后台化节。

## [3.59.0] - 2026-11-12

### Added

- 守护可视化——watch 状态面板与健康历史（266 轮 CLI 守护的 UI 对位）：~/.zerokit/service-watch.json 状态文件（pid/startedAt/actions 环形日志最近 50 条；同进程续写、异进程覆盖；写前 ensureDirs——修一个目录不存在时 ENOENT 被 catch 吞的真缺陷）；zkit service watch 启动时 init、重启动作时追加；/api/services/watch GET（pid 存活校验——process.kill(pid,0)，残留文件不算在跑）；#/services 面板「守护」区（PID+运行时长+最近 5 条动作：⟳ key ×streak ✓/✗ +退避秒）；I18N 五键；svcdeps261 +3 断言。

## [3.58.0] - 2026-11-12

### Added

- 服务运行时守护——unhealthy 自动重启与退避（服务编排体系续）：zkit service watch [--interval 30s] [--threshold 3] [--backoff-base 30s] 前台循环；只守护「声明 healthCheck 且运行中」的服务（停着的归用户）；连续 threshold 次 unhealthy → 重启走 up 链（依赖先行）；watchCycle/watchBackoffMs 纯函数（指数退避 base×2^(n-1) 封顶 10min，恢复即复位）；Ctrl+C 干净退出（停探测不杀服务）；审计 caller=service-watch；svcdeps261 +3 断言；service-orchestration.md 守护节。

## [3.57.0] - 2026-11-12

### Added

- 服务编排收官——拓扑视图与体系文档（261-265 五轮弧线）：#/services 面板「拓扑」tab（依赖树缩进渲染 + 健康/缺失/环徽标；孤立服务单独分组；环组标红）；docs/reference/service-orchestration.md（四步弧线对照表/声明语法/语义边界七条/三层防线/维护规则五层同步）；v4-outlook 服务编排销项（三项核心全完成）；docs 导航接入；webui +2 断言。

## [3.56.0] - 2026-11-12

### Added

- 服务编排第四步——批量停止与依赖关停顺序 zkit service down：topoStopOrder（topoStart 的逆——本服务最先停、依赖最后）；globalStopOrder（全服务图入度剥离——无依赖先停、被依赖最多的最后；环残余收敛尾部）；zkit service down [插件.服务|--all]（逆序依次 stopService，未运行幂等跳过「=」）；/api/services/down POST（UI ⛓ 依赖关停按钮对位，confirm 守卫）；svcdeps261 +3 断言（逆序/幂等/全局序）。

## [3.55.0] - 2026-11-12

### Added

- 服务健康探针声明与状态页集成（服务编排第三步）：Service.healthCheck?: { http?; tcp? }（http 期望 2xx、tcp 期望可连——fetch/AbortSignal + net.connect 短超时 2.5s）；probeHealth 纯函数（探针异常/超时/拒绝全算未通过）；/api/services 对声明探针的服务真实探测（running 细分 healthy/unhealthy/stopped）；UI 三态徽标（✓ healthy / ⚠ unhealthy）；doctor 集成 healthCheck 声明校验（http/tcp 二选一、URL 形态、host:port 形态——warning 级）；plugin-spec healthCheck 行；svcdeps261 +3 断言。

## [3.54.0] - 2026-11-12

### Added

- 服务编排第二步——依赖拓扑排序与批量启动 zkit service up：topoStartOrder 纯函数（沿 requires DFS 后序收集启动链/环边跳过不阻断/本服务排最后）；zkit service up 子命令（拓扑序依次 startService，已在运行幂等跳过「=」，链中失败即停——后面的没有意义）；/api/services/up POST（UI ⛓ 依赖启动按钮对位，汇总 results + cycleSkipped）；环容错修正（path 命中优先于 seen——DFS 已收集的祖先在 seen 里但仍是环边）；svcdeps261 +3 断言（拓扑序/环容错/up 幂等）。

## [3.53.0] - 2026-11-12

### Added

- 服务依赖图——[[service]] requires 声明与启动顺序（v4 展望服务编排第一步）：Service 接口加 requires?: string[]（本插件 id 或 插件.服务 跨插件）；serviceDeps() 纯函数（解析/缺失检出/循环检测限深 16）；startService 依赖前检——存在但未运行的依赖拒绝启动并指名（缺失依赖是清单错误归 doctor/面板管，不拦启动）；/api/services 响应带 requires/depMissing/depCycle；UI 面板依赖行（缺依赖 ⚠ / 环 ⟳ 标红）；plugin-spec.md requires 行；svcdeps261-smoke 新文件 4 断言。

## [3.52.0] - 2026-11-12

### Added

- MCP 探针体系收官文档（255-259 五轮体系单一参考）：docs/reference/mcp-probe.md——四入口清单（Web 直调/schema、#/mcp 面板、CLI probe）/五支撑端点/三使用场景（插件作者核对 schema、集成排障、CI 验证）/与 dry-run 边界表（probe 执行 vs dry-run 只看）/审计来源/三层防线 MCP 特化；v4-outlook MCP 深化条目销项（已完成探针体系+审计回流，剩余远程 MCP 与资源订阅）；docs 导航接入。

## [3.51.0] - 2026-11-12

### Added

- MCP 探针 CLI 面——zkit mcp probe（255-258 UI 三面的 CLI 对位）：不起 MCP 进程直调工具（插件__动作；--params '{}' 传参；--json 机读）；--schema 打印 inputSchema（256 轮 GET 的 CLI 对位）；错误三态同款（not-found/bad-params/not-authorized）；审计 caller=mcp-probe；用法表登记。MCP 深化五步弧线完成（255-259）：UI 直调→schema 预览→工具面板→资源面板→CLI probe——四面（CLI/启动器/MCP/桌面壳）现在都能不拉起 MCP server 核对工具面。

## [3.50.0] - 2026-11-11

### Added

- MCP 资源面板——zerokit:// 七资源 UI 化（MCP 深化第四步）：/api/mcp-resources GET（resources/list 同构清单）+ /api/mcp-resource?uri= 单资源读取（plugins/health/runs/audit/watch/timers 六实现，{key} 模板示例填充）；UI #/mcp 面板加「资源」tab（行点击展开 JSON——模型可读快照一屏核对）；OpenAPI 登记；I18N 四键；webui +2 断言；顺手修一个 ps-empty 漏 role=status 的 a11y 回归。

## [3.49.0] - 2026-11-11

### Added

- MCP 工具清单面板——tools/list UI 化（MCP 深化第三步）：/api/mcp-tools GET（name/title/inputSchema/annotations 全量——与 MCP tools/list 同构，52 工具实测）；UI #/mcp 面板（工具表：名称/插件·动作/风险/readOnly-destructive hints）；行点击展开 inputSchema + 「直调」按钮（串起 255/256 两轮——面板内完成看 schema→调→核 _meta 全链路）；命令面板「🔌 MCP 工具清单」入口；I18N 九键 zh/en；OpenAPI 登记；webui +2 断言。

## [3.48.0] - 2026-11-11

### Added

- MCP 探针工具清单联动——inputSchema 预览（MCP 深化第二步）：/api/mcp-probe GET（tool=插件__动作 → inputSchema/插件元数据/动作风险机读——toJsonSchema 复用）；UI 动作详情页「inputSchema」折叠按钮（模型实际看到的 JSON Schema——min/max/pattern/enum 透传核对，215 轮字段一屏可见）；未知工具 -32602 透传；OpenAPI 登记；webui +2 断言。

