# Changelog

## [Unreleased]

### Added

（下一版攒着）

## [3.78.0] - 2026-11-13

### Added

- 契约测试快道（284 复盘清债②）：scripts/contract.sh + npm run contract——结构契约类单独秒级入口（openapicontract279 API 契约 8 断言 + domain-faces 注入面契约 18 断言连跑，实测 760ms vs 全量 ~10min——契约破坏反馈距离从「PR CI」缩到「即改即验」）；CONTRIBUTING/CLAUDE.md 开发流程提及（改 server API 面 / web api() 调用 / 域文件注入面后先跑）。

## [3.77.0] - 2026-11-13

### Added

- 导出 v2 列式 zerocol（284 复盘清债①；parquet 需 wasm 违零依赖约束——设计等价替代）：src/core/arrowIpc.ts——exportZeroCol/importZeroCol 纯函数（int 8B LE / double 8B LE / string 偏移表+utf8【多 string 列支持：columns[].bytes 元数据】；8 字节对齐；sha256 校验和）；格式透明（JSON 信封 + base64 列段——任何语言 20 行读回）；zkit data export --zerocol <history|audit>（history: ts/plugin/action/exitCode；audit: ts/plugin/risk/decision）；zerocol285 5 断言（四列 roundtrip 含中文空串/空表/校验和稳定/Σbytes=数据长度自洽/CLI 导出）；基线 3271→3276。方向 4「数据分析」3/3 全清。

## [3.76.0] - 2026-11-13

### Added

- v4 对账复盘（三方向收官 + 启动评估）：v4-outlook 完成度表终态更新——**五大方向 100%**（274/275 轮成果原表漏计本轮修正；桌面维持冻结）；272→284 十二轮执行回顾（新模块 6/新命令 7/协议文档 2/基线 +77/十二个 minor）；v3 负债清点（240 轮判据重跑：app.js 9677 行稳态【拆分系列后核心+胶水】/测试多层/issue 清零——无阻塞级债）；**v4 启动评估 GO** + 首轮清债建议三条（parquet 收尾/契约快道/发布链手册）；docs/README 锚点更新。

## [3.75.0] - 2026-11-13

### Added

- 脚手架→发布通道（生态链第三步，281+282 后继）：zkit plugin publish-check <目录>——发布前组合检查（清单可加载【loadPlugin 全解析】/动作 risk/版本语义化/签名密钥存在/market index 干跑 buildIndex 不落盘）+ 汇总行（硬伤 exit 1 + 修复指引）；publish-ready 通过后打印「发布通道三步」指引（签名密钥状态——有 ✓ 无提示 keygen；zkit market index 生成命令含目录；zkit plugin export；market.json 提交 git → 用户 market add）；market-protocol.md 发布通道节（new→publish-check→add→publish-ready→keygen→index→export 七命令一条龙）；publish283 3 断言；基线 3268→3271。

## [3.74.0] - 2026-11-13

### Added

- 插件签名链起步——ed25519 最小实现（生态链第二步，281 公开化后继）：src/core/pluginSign.ts（零依赖 Node 内置 crypto）——keygen（密钥对落 ~/.zerokit/keys/ 0600；keyId=SPKI DER sha256 前 16hex 指纹）；canonicalJson 规范串（键排序无空格——签验两侧一致）；signPayload/verifyPayload；.toolpack export 自动签名（有私钥时 sig 段：algo/keyId/sig，不入被签 payload 防自指）；import 强校验（包带 sig 且本机 keys/ 有对应公钥→篡改拒绝；无 sig/无公钥=原行为兼容）；zkit keygen 命令；market-protocol.md 签名节；pluginsign282 8 断言（keygen/纯函数签验/篡改 false/端到端 export 带签/篡改拒/无 sig 兼容）；基线 3260→3268。

## [3.73.0] - 2026-11-13

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

