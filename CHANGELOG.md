# Changelog

## [Unreleased]

### Added

- stats 窗口统计（window 最近 N 行——监控语义对齐）：params window（正整数；缺省=全表兼容不变）——每列 vals 取尾 N 行再算 min/max/avg/count；count 语义明确为窗口内行数（5 行 window=3 → count=3）；超行取全表（window=99 > 5 行 → count=5）；多列每列独立取尾（列长一致同窗）；dataflow consume-detail 加窗口扩展注释（不改默认行为）；plugin-spec/guide 同步；zerocolstats309 8 断言（+窗口取尾 1..5→min=3 max=5 count=3 / 超行取全 count=5 min=1）；基线 3442→3444。滚动窗口数据集 + 窗口统计——异常恢复后告警可复位。
（下一版攒着）

## [4.31.0] - 2026-11-20

### Added

- zerocol 内建步 Windows 路径守护（304 坑的系统性后验）：静态审查全绿——三内建步路径全 pathModule.join(DATA_DIR)（三种局部名形态、零手写斜杠拼接）；读写 JSON utf8 + 字符串写（二进制走 base64 不落原始字节）；解码全 LE 后缀（readBigInt64LE/readDoubleLE——Buffer API 级字节序保证平台无关）；web/ 零 /tmp 硬编码、test/ 临时目录全 os.tmpdir；**审查判据固化为 winpaths319 守护测试 5 断言**（join 形态合计/裸读/LE-BE 计数/web tmp/test tmp——任何回归本地即拦）；基线 3437→3442。结论：内建步文件操作无 Windows 隐患，CI 全绿的信任有了静态背书。
（下一版攒着）

## [4.30.0] - 2026-11-19

### Added

- 双指南进主路径（协作/数据指南的用户触达收尾）：START-HERE「六点五、跑起来之后：三条路」——跑动作（demochain.pipe-export）/ 搭数据管道（dataflow 实操 3+1）/ 接协作（mcp serve --broadcast）各带 5 分钟第一实操直达对应指南；overview 首屏路径注（账本入口指同一三步）；startpaths318 4 断言（路径表/实操真实性——引用插件都在 market/互链）；基线 3435→3437。新用户从「跑起来」到「搭管道/接协作」有显式路径。
（下一版攒着）

## [4.29.0] - 2026-11-19

### Added

- v4 全主题进度看板更新（301-316 十六轮复盘）：v4-outlook 深化收官表（候选 1×2 / 3×3 / 2 预检 / 4×1 对照轮次版本）；数据工作流全链贯通段（append/stats 多列/stats 可读化 + 310 端到端实测 + 内建步四件套齐）；协作面 UI 收官段（311 面板 + 312 操作化——四端观察窗）；当前剩余候选三条（opt-in 匿名上报 / 管道 DSL 进阶 / 桌面启用——各带触发条件）；v4board317 6 断言；基线 3427→3433。
（下一版攒着）

## [4.28.0] - 2026-11-19

### Added

- stats 摘要进 watch（指标越界可读化——数据消费端最后一块）：tick 钩子把 chain 结果的 data.stats（309 统计步产物）摘进 lastChainRun.stats；通知文案升级「数据变化 · value max=95 avg=48」人话摘要（尊重 notify 开关）；面板 ⛓ 徽标行内带最新统计（statsBrief max）；watch.json 持久化随 lastChainRun 整体落盘；watchstats316 4 断言（钩子/通知/徽标/持久化）；基线 3423→3427。watch 通知从「数据变了」到「变成多少」——指标越界告警的人话形态。
（下一版攒着）

## [4.27.0] - 2026-11-19

### Added

- builtin.zerocol-stats 多列支持（数据消费端再看一眼）：params columns（复数逗号分隔，优先于单数 column）——一次统计多列，结果 data.stats 按列名分组（{alias.data.stats.duration.min}）；**string 列策略分形态**：多列静默跳过（混列合法）/单数保持 309 明确报错（向后兼容）；单数 column 平铺形态不变（309 行为兼容）；dataflow consume-detail 改分组形态 + 多列扩展注释；plugin-spec/管道指南同步；zerocolstats309 6 断言（+多列分组/单数兼容——string 报错断言随分形态语义保留）；基线 3421→3423。
（下一版攒着）

## [4.26.0] - 2026-11-19

### Added

- dataflow 注释升级（活教材跟上新能力）：plugin.toml 头注释三种用法（手动跑 / watch 触发无人值守——触发管道填 dataflow.append-ts + 面板 ⛓ 徽标 / consume-detail 内置统计）；append-ts 注释补触发指引与 UI 读缓存 fresh 说明；consume-detail 注释补 stats 内建步第四件说明；zkit show dataflow 输出自检（闭环描述串起）；基线不变（纯注释）。
（下一版攒着）

## [4.25.0] - 2026-11-19

### Added

- 桌面 updater 就绪度评估（300 轮盘点候选 2 的零成本预检——冻结不动）：三件套核查——插件签名链 ✅（zkit keygen 干跑通过 + export 自动签名实测 demochain.toolpack 带 sig/keyId）、tauri.conf.json updater 段 ❌ 未启用（配置缺席非损坏）、release.yml 无 latest.json 步骤 ❌（tauri-action 已 pin 在位）；解除步骤清单四步（conf 三行 + Secrets 密钥 + tauri-action 自动产 latest.json + 双通道观察）+ 风险三条（密钥保管/单发 PR/插件签名与 updater 签名两套不混用）；docs/reference/updater-readiness.md 固化评估；updater313 6 断言（三件套/步骤/冻结不动/conf 现状确认/keygen 在位/导航）；基线 3415→3421。结论：解除成本约一轮，维持冻结等真实诉求。
（下一版攒着）

## [4.24.0] - 2026-11-19

### Added

- 协作面板操作化（311 只读面板补操作面）：mcp serve 加 POST /mcp/sessions/filters（session + filters 写回会话并刷快照——在线改订阅前缀立即生效）与 POST /mcp/sessions/unlock（管理员语义手动释放锁并刷快照）；UI server 双代理 POST（转发到 MCP_HTTP_PORT 的 mcp serve，默认 31800；token 用 MCP_HTTP_TOKEN env）+ openapi；collab.js 面板操作面——会话行过滤输入框（回车提交）、锁行「释放」按钮（成功即 refresh）、标题手动刷新按钮；collabops312 6 断言（双端点/代理透传活体：过滤编辑 200+ok、unlock 无锁 404 形态）；基线 3409→3415。协作面从「看」到「管」。
（下一版攒着）

## [4.23.0] - 2026-11-19

### Added

- UI 协作面板（collab，#面）：mcp serve 运行时快照落盘 HOME/mcp-runtime.json（会话建立/断连/锁变化/频控丢弃四处挂钩——Inner 全量写 + writeLocksSnapshot 模块级锁写，双进程解耦）；GET /api/mcp-sessions 代理端点（读快照，15s 心跳超时判 running:false——白名单+openapi）；web/collab.js 面板三块（在线会话表 clientId/连于/过滤、持锁表 tool/holder/since、频控计数 dropped/filtered）+ 三态渲染（未运行引导 zkit mcp serve --broadcast / 读取失败 / 运行中心跳）；#/collab 路由（applyHash + hashchange 双侧）+ 3s 轮询；collabpanel311 7 断言（端点/挂钩×5/三块三态/引导/路由/空态/伪造快照透传）；基线 3396→3409。协作面 UI 收官：CLI、MCP、桌面三端之外，浏览器也成为协作状态的一等观察窗。
（下一版攒着）

## [4.22.0] - 2026-11-19

### Added

- watch × dataflow 端到端闭环验证（定时积累实战定稿）：watchdfe2e310 6 断言——watch.json chain 持久化、UI server /api/run 真实执行 append-ts（**三次触发行数 0→3 实测**）、tick 钩子 lastChainRun 形态、指南 5b 节（dataflow 组合样例 + **/api/run 读缓存坑**：10s TTL 内 cacheHit 直回缓存，POST body 必须 fresh:true 才真跑）；**架构判据沉淀**：/api/*（runChainQuiet 的目标端点）在 zkit ui 的 server（startServer），mcp serve 只有 /mcp 面——watch 触发场景本就是 UI 起着的场景；UI token 随机生成注入页面（__TOKEN__ 替换），测试从首页 HTML 抠取；基线 3396→3402。
（下一版攒着）

## [4.21.0] - 2026-11-19

### Added

- builtin 统计步（dataflow consume-detail 的内置化——数据消费端补强）：use = "builtin.zerocol-stats"（plan 放行 + 执行特判，与 export/read 同模式）；params file + column + ops（min/max/avg/count 逗号分隔——非法 ops/string 列明确报错 chain-stats-*）；int/double 8B LE 解码复用 308 轮经验（列起点=前面 bytes 之和）；结果 data.stats.* 模板直取（{s.data.stats.min}）；dataflow consume-detail 重写为 stats 步（删手写解码 node 脚本）；plugin-spec stats 行 + 管道指南统计快捷方式节；zerocolstats309 4 断言 + dataflow308 断言随新文案更新；基线 3392→3396。
（下一版攒着）

## [4.20.0] - 2026-11-19

### Added

- dataflow 端到端实战插件（数据工作流五件套的组合示例）：gen-ts（产时间戳样本）→ append-ts（mode=append + rowsLimit=20 积累）→ consume-ts（read 汇总行数——**引 {back.data._rows} 不引 {agg.rows}**：导出统计行数与数据行数同名撞车，模板要从读步行数取）→ consume-detail（int 列 8B LE 解码参考实现——**列起点=前面各列 bytes 之和**）；market.json 登记（source=path:plugins/dataflow）；新插件入驻顺带更新 4 个计数断言测试（api164/authordx153 计数 13→14 + deps87/distro 因缺 source 修 market.json）；dataflow308 5 断言（5 次 append 5 行/汇总/明细/登记/指南注释）；基线 3387→3392。

