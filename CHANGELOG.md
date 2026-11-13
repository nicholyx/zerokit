# Changelog

## [Unreleased]

### Added

（下一版攒着）

## [4.5.0] - 2026-11-14

### Added

- 广播内容增强——结果摘要下发（v4 协作面第三步）：tool-call 广播载荷升级 { type, tool, ok, ms, summary }——summary 先过 maskSensitive 脱敏再分档（≤4KB 紧凑 JSON 全量直放；>4KB 走 { _truncated, head: 600 字首段, fields: fieldStats }——与 MCP 响应同款 48 轮策略复用 summarizeJson）；观察者在 SSE 流直接看到执行结果（value=21 级别），大结果 token 友好不发全文；demochain gen 描述补广播演示注记；broadcastsummary293 5 断言（载荷结构/小结果全量含 value/大结果分档实现/实收 summary）；基线 3311→3316。

## [4.4.0] - 2026-11-14

### Added

- zerocol 导出 chain step 化（v4 数据工作流第二步——管道末端原语）：内建伪引用 use = "builtin.zerocol-export"（无需真实插件动作；plan 静态校验放行 + 执行循环特判）；params file（落 data_dir）+ columns（name/type/from 取值路径——dots 寻址到前步 alias.data.字段 或 alias.stdout）；导出结果回报路径与行列数（data: path/rows/columns）；**修依赖收集真缺陷**：builtin 伪引用曾被当插件依赖致 doctor 报「缺少插件依赖：builtin」——collectDeps 跳过 builtin.*；demochain pipe-export 示例（gen 21 → pipe 计数 → zerocol 落盘 2 列）；plugin-spec 导出步行；zerocolstep292 6 断言；基线 3305→3311。数据工作流闭环成形：取数→pipe 变换→zerocol 落盘。

## [4.3.0] - 2026-11-14

### Added

- chain pipe 管道原语（v4 主题②「数据工作流」起步）：ChainStep 加 pipe = true（清单语法 + parseChainSteps 解析）；RunOptions.stdinData → execArgv stdio pipe（写入后 end——下游读 EOF 即处理完）；chain 执行循环 pipe 步拿上一步 stdout 作 stdin（无上一步输出空串）；审计成功 reason 标注 pipe 步数（chain-ok (N pipe 步)）；错误传播沿用既有链停语义（断在第 N 步，后续不执行——291④ 实测 SHOULD-NOT-RUN 未出现）；demochain 加 pipe-count 示例（gen 14 字符 → count-stdin 数回 14）；plugin-spec pipe 行；chainpipe291 6 断言；基线 3299→3305。

## [4.2.0] - 2026-11-13

### Added

- 协作状态同步 presence（v4 协作面第二步）：会话加入广播（initialize 成功后其余会话收 session-joined 含 clientId）；会话离开广播（DELETE 后 session-left）；GET /mcp/sessions 在线清单（token 同面鉴权；clientId/connectedAt/sid 尾段——sid 全段不泄）；zkit mcp sessions --http [端口] CLI 查询（需 ZEROKIT_TOKEN 同 serve）；presence 广播同走 fromSid 排除与工具广播共用风暴防护；mcppresence290 6 断言（加入/离开/清单两态/CLI/风暴自排除）；289 测试断言适配 290 代码形态（hook 调用点 1→3）；基线 3293→3299。

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

