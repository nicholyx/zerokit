# Changelog

## [Unreleased]

### Added

- plugin.toml JSON Schema 化（272 对账 S 第二条）：docs/schema/plugin-manifest.schema.json（draft-07，六节全覆盖 plugin/action/param/service/setting/requires；5.3KB）；枚举约束（risk 三值/encoding 六值含 gbk/runtime 三模式/output 六类型）；模式约束（id ^[a-z0-9][a-z0-9._-]{0,63}$、param name ^[a-zA-Z_]、port 1-65535、healthCheck http/tcp pattern）；zkit plugin schema 命令（打印路径 + VS Code Even Better TOML / taplo CLI 接线说明）；plugin-spec 头部互链；tomlschema274 7 断言（quick/clipboard/sysinfo 三清单可满足性）；基线 3205→3212。

## [3.65.0] - 2026-11-13

### Added

- watch 采样窗口聚合（结果数据分析方向起步，272 轮对账 S 第一条）：src/core/watchStats.ts 纯函数——aggregateWindow（min/max/avg/count/first/last；数值提取 numericOf：裸数值/对象首数值字段，失败与非数值跳过）+ windowStats 多窗分组 + DEFAULT_WINDOWS（5m/1h/24h）；zkit watch stats <插件.动作>（不抢顶层 stats——那是历史统计 46/92/120 轮，最初误抢致 cli120/cli46/hist92/ops 四文件 10 断言红，守住后改 watch 子命令族）；zerokit://watch 资源每监控附 stats（MCP 面同步受益）；空样本/全非数值全 null 不抛；watchstats273-smoke 7 断言；基线自动抬升 3198→3205。

## [3.64.0] - 2026-11-13

### Added

- v4 展望全条目对账（第 272 轮盘点）：完成度统计表（六方向：服务编排 100% / MCP 深化 50% / 插件生态 33% / 数据分析·契约·桌面 0%——高中优先级合计 46%）；未动条目评估（14 条各标 S/M/L 工作量+依赖关系——4 条 S 可即起步：watch 聚合/plugin.toml JSON Schema/审计 webhook 投递）；「下一阶段建议」五条（S 先清、生态链最长宜早启、MCP 远程化 spike、M 条目按用户可见价值排序、桌面冻结）；docs/README 对账锚点。

## [3.63.0] - 2026-11-13

### Added

- 断言数回归护栏——270 轮险情判据进 CI：scripts/assertion-baseline.json 基线入库（3198）；test-all 末尾守卫（总数 < 基线且全绿 → exit 1 + 事故型提示「全绿但计数降 = 结构性丢失，参考 270 轮重写吞分支」——skip 不 fail 只有计数会说话）；sync-counts 三路径（计数上升自动抬基线 / 下降不自动提示「删测试须 --force」/ --force 显式降）；assertbaseline271-smoke 守卫自证 4 断言；maintenance-patterns 事故判据条目。修复 sync 写基线时 string 类型泄漏（JSON 数字断言被写成 "3197"——Number() 包一层，守卫 Number.isFinite 拦住）。

## [3.62.0] - 2026-11-12

### Added

- 插件脚手架增强——服务示例节与 MCP probe 指引（插件生态起步）：zkit plugin new --with-service（ScaffoldOptions.withService → [[service]] demo 节含 healthCheck 示范 261-263 轮体系，port 39410）；脚手架 README 开发码块与清单注释各补一行 zkit mcp probe <id>__hello（255 轮探针——新作者第一次就接触 MCP 面验证法）；用法表更新；svcdeps261 +3 断言。

## [3.61.0] - 2026-11-12

### Added

- 守护面板操作化——UI 启停 daemon（267 看 + 268 CLI 管后的「UI 动」）：startWatchDaemon/stopWatchDaemon 助手抽到 services.ts（CLI 与 /api 同源防漂移）；/api/services/watch POST {action: start|stop}（start=daemon 同款活 pid 拒绝；stop=SIGTERM 4s→SIGKILL 幂等）；启动参数固定面板缺省（30s/3/30s——一键不做表单）；UI 守护区「▶ 启动守护」/「■ 停止」（confirm 守卫）+ 操作后 showServices 即时刷新；审计 caller=ui；webui +2 断言。端到端实测：start pid=30839 → 状态 running:true → 重复启动拒绝「已在运行」→ stop ✓。

## [3.60.0] - 2026-11-12

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

