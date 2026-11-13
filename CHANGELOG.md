# Changelog

## [Unreleased]

### Added

- market 安装源协议公开化（272 对账建议 2 生态链第一步）：docs/reference/market-protocol.md——v1 完整规范（源清单格式/字段语义表/校验规则/生成与注册命令/协议演进约定：小改不动版本、破坏性升大版本）；MarketIndex 加 protocol 字段（缺省=1）；lint 新规则（protocol 必须正整数；比本机新的大版本明确拒绝并提示升级——老客户端不会装错新源）；docs 导航接入；marketproto281 8 断言（lint 三态 / 第三方源端到端 add→list→install --yes→run / protocol=99 源被拒）；基线 3252→3260。

## [3.72.0] - 2026-11-13

### Added

- MCP 资源订阅——变更推送（272 对账 S 第四条收尾，277 远程化解锁长连接面）：capabilities.resources 开 subscribe+listChanged；Subscribe/UnsubscribeRequestSchema handler（订阅集 + 版本计数 resourceVersions）；工具执行成功后 bump——逐订阅 uri sendResourceUpdated（notifications/resources/updated）；GET SSE 长连接打开（277 留的 405 按计划开通——需先 POST initialize 建会话，SDK handleRequest 托管 SSE 流）；mcpsubscribe280 9 断言（活体：initialize 含 subscribe / SSE 200 event-stream / resources/subscribe / 工具执行后真实收到 updated 推送）；基线 3243→3252。

## [3.71.0] - 2026-11-13

### Added

- OpenAPI 契约测试（272 对账 M 第二条）：openapicontract279 五面断言——①API_METHODS↔API_SPEC 端点集一致；②活体 405/404 诚实性；③④UI 调用面采集（web/ 全源码 api() 提取，静态+模板前缀）无漂移；⑤契约 POST 均有 UI 使用（server-internal 白名单）。**契约测试抓出三处真漂移当场修复**：/api/chat/state 与 /api/cache/prune 两端点 UI 在调但 server 无实现（补实现+登记）；API_SPEC 累积缺 34 端点登记（164 轮后新增未同步——按方法表批量补登，活体 paths 25→59）；未知 /api/* 此前落 SPA fallback 返回 200（不诚实——改真 404）。基线 3235→3243。

## [3.70.0] - 2026-11-13

### Added

- 结果历史结构化 diff（272 对账 M 第一条·用户可见价值最高）：src/core/structuredDiff.ts 纯函数——字段级三分类（added/removed/changed，点路径寻址 x.y.z.w）；数组索引对齐（长度差进 added/removed）；嵌套递归深度上限 8（防炸）；deepEqual 同构零 diff；zkit diff <插件.动作>（本次 run vs 上一缓存结果——只支持 read 动作【观测面对比不碰 mutate】；首次无缓存提示、对比后自动更新缓存为下次的「上一值」；--json 机读含 summary+entries）；129 轮文本对比的字段级升级；structurediff278 7 断言；基线 3228→3235。

## [3.69.0] - 2026-11-13

### Added

- MCP 远程化正式接入——zkit mcp serve --http [端口] [--host 地址]（276 spike 结论的落地）：serve() 拆分（buildMcpServer 独立构造，setRequestHandler 全复用，stdio 路径零变化）；serveHttp（spike 会话复用模式——按 mcp-session-id 头取回 transport，首请求建实例 connect 一次）；token 鉴权（进程内随机 48hex 打印 stderr 供复制，ZEROKIT_TOKEN env 可注入——UI token 是页面注入的跨进程不同源，故独立生成；无头/错头 401 带 hint）；默认 127.0.0.1（防火墙友好，远程暴露用户自己 --host）；GET 405（276 spike 决定不维持 SSE 长连）；spike 报告加「已落地」标注；mcphttp277 6 断言（活体端到端：错 token 401 / initialize 200 拿 sid / 会话复用 tools/list 含 zerokit_welcome）；基线 3222→3228。

## [3.68.0] - 2026-11-13

### Added

- MCP 远程化 spike（272 对账建议第 3 条落地，探水深不做接入）：**结论 GO、工作量 L→M**——SDK 1.32.2（当前 latest）已带 StreamableHTTPServerTransport，零包升级；spike 实测三步全通（initialize 200 拿 session-id / tools/list 含 echo / tools/call 返回结果）；**关键坑：transport 会话复用**（每请求新建实例丢会话态报 Server not initialized——按 mcp-session-id 头复用后全通）；docs/debt/mcp-remote-spike.md（传输支持面三行表/serve() 拆分点/破坏面为零/防火墙与 token 鉴权注意/复现要点）；v4-outlook 条目更新（L→M + spike 互链）；mcpspike276 4 断言；基线 3218→3222。

## [3.67.0] - 2026-11-13

### Added

- 审计日志外部投递 webhook（272 对账 S 第三条）：src/core/auditHook.ts——auditWebhookConfig（config.toml [audit] webhook/headers 最小 TOML 节解析；坏配置静默关）；deliverAudit fire-and-forget POST（2s 超时 AbortController，失败不抛不重试）；auditDrain（CLI 退出前排空在途投递上限 2.5s——33 轮「审计后立刻 exit」教训的异步版，CLI 短命进程 fetch 会被带走，手动验证三次空收件后定位）；失败环形缓冲（内存最近 20 条）；zkit audit --failures 视图；audit() 单入口挂钩（无配置零行为）；auditwebhook275 6 断言（含端到端 receiver 实收）；基线 3212→3218。

## [3.66.0] - 2026-11-13

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

