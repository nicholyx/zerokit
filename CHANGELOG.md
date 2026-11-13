# Changelog

## [Unreleased]

### Added

（下一版攒着）

## [4.1.0] - 2026-11-13

### Added

- 多客户端会话广播（v4 主题①「远程协作面」起步）：serveHttp 会话表升级（SessionEntry 带 clientId/connectedAt）；tools/call 成功后其余会话收通用通知（sendLoggingMessage 路由——SDK Server 无公有 sendNotification，280 轮的特化方法经验推广；logging 能力声明）；**修复 277 轮遗留真 bug：每会话独立 server 实例**（SDK Server 单 transport 设计——复用 connect 会踢掉前一连接，双客户端实测暴露，此前单客户端测试从未触发）；广播风暴防护（hook 单点 + fromSid 排除自身）；--broadcast 开关默认关（ZEROKIT_BROADCAST env 等价）；DELETE 断连清出；mcpbroadcast289 9 断言（双客户端活体实收/风暴计数=1）；回归三件套 277/280/289 全绿；基线 3284→3293。

## [4.0.0] - 2026-11-13

### Added

- **v4.0.0 起航**——v3 线（v3.1.0–v3.79.0，79 个 minor）收束，v4 线开线。切换前体检全绿（3284 断言基线 / 契约快道 776ms / 八审计 lint / 284 清债三条前置完成）。v4 主题（自 v4-outlook 议题池，按 272 对账 + 284 复盘排定）：① 远程协作面（MCP 远程化已就绪为底座——多客户端共享工作台）；② 数据工作流（watch 聚合/结构化 diff/zerocol 导出三件套为底座——管道化编排）；③ 桌面增强（冻结解除条件：出现真实桌面用户诉求）。技术基线：测试 149 文件 3284 断言、发布链手册化、契约双快道、签名链就绪。

## [3.79.0] - 2026-11-13

### Added

- 发布链操作手册（284 复盘清债③）：docs/reference/release-runbook.md——标准五步（feature/prep/release+tag/资产/收尾，逐条命令与预期）；事故分类处置表三张（网络类：DNS 瞬态/CDN 504/registry；CI 类：cdp flake/断言数下降【270 型结构性丢失】/跨平台差/总览异常/rerun running；发布类：draft 422 顺序/资产陈旧/30 分钟不齐/poll 卡 pending）——全部 284 轮以来实录判据；幂等重入三则（--failed 先确认瞬态、draft=false 先于 edit、tag 删再推）；271 基线联动（≥ 基线 / --force 显式降）；docs/README 导航；runbook287 8 断言防漂移；基线 3276→3284。

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

