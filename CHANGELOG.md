# Changelog

## [Unreleased]

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

## [4.19.0] - 2026-11-19

### Added

- 协作指南（协作面六步文档化收尾）：docs/guide/collaboration.md——接入五步（token/x-client-id/initialize/SSE）→ 广播载荷（tool-call/summary 脱敏分档真实样例）→ 过滤订阅（clientInfo.filterTools 前缀）→ 频率控制与静默窗口（config.toml 两键 + dropped/filtered 计数）→ 协作锁（busy-locked 结构化处理 + 退避策略 + 三路释放）→ 会话查询；plugin-spec / data-pipelines / platform-pitfalls 互链 + docs/README 导航；collabguide307 4 断言（五节/载荷形态/接入清单/互链）；基线 3383→3387。协作面六步全部有正式指南——外部客户端作者照单接入。

## [4.18.0] - 2026-11-19

### Added

- 市场安装计数（300 轮盘点候选 4 首项——真实使用信号）：~/.zerokit/market-stats.json（installs/lastInstallAt/lastVersion）；installFromMarket 成功即计数——**同版本重复装幂等不重复计**（版本变化才 +1）；uninstall 不减（历史累积语义）；zkit market list --by-installs 热度视图（跨集市降序）；GET /api/market-stats 端点（白名单+openapi）；UI market 面板已装徽标附 🔥N；marketstats306 5 断言（幂等/卸载不减/排序视图/端点/UI）；基线 3378→3383。议题池新陈代谢第一步：项目方从此看得到「用户装了什么、升级了几次」。

## [4.17.0] - 2026-11-19

### Added

- 平台差异判据手册（300 轮盘点候选 3 第三项，稳定性长跑③）：docs/reference/platform-pitfalls.md——Windows 五坑（file:// ESM/tmp/CRLF/路径分隔符/execFileSync 相对 cwd）+ Chrome 表（getter 误用/跨版本语法炸弹/固定 sleep）+ 防线三层（本地静态→本地全量→三平台 CI 唯一防线），每坑带判据/修复/战役对照（291/299/303/304）；web-strict-check 扩 RAW_DYN_IMPORT 线（动态 import(path.join…) Windows 炸弹静态可判——现库 0 处）；全量 test/*.mjs 的 /tmp 硬编码排查——4 处均无害（报错用例/字面量/mock/样例）不修记入手册；START-HERE + docs/README 判据索引；platformpit305 7 断言；基线 3371→3378。

## [4.16.0] - 2026-11-19

### Added

- perf 阈值机器自适应（300 轮盘点候选 3 第二项，稳定性长跑②）：perf-guard 先测本机基线（预热 3 次 JIT/文件缓存 + 取样 5 次取中位 b），阈值 = max(300 硬线, b×2.5)——健康机 b≈100ms 仍守 300 真回归；慢机/CI x86 b≈180-200 放宽到 450-500（机器差异不算回归，实测本机 load≈3 下基线 197→493 线全过）；load>3 抢占豁免保留（环境非代码）；报告行带基线/实测/阈值来源（「自适应 493ms（本机基线 197×2.5）」/「300ms 硬线」两态）；perfadaptive304 5 断言（基线采样/阈值公式/豁免保留/报告信息/活体不误伤）；基线 3366→3371。299 的粗豁免升级为精细自校准。

## [4.15.0] - 2026-11-19

### Added

- 跨浏览器语法差异巡检（300 轮盘点候选 3 第一项，稳定性长跑①）：全量扫 web/*.js 的 V8 严格度敏感模式（getter 误用当 setter / 语句位置裸解构赋值）——**当前 0 处残留**（299 轮已清 logs.js 重灾区）；**正本清源**：X.get(k) = v 是 MemberExpression 赋值——语法合法但语义错误（给 getter 返回的临时对象赋值，store 永不更新→静默失效；CI 的 SyntaxError 归因 logs.js 是模块级连锁，4 处 getter 误用是 0/12 面板的真因）；新增 scripts/web-strict-check.mjs（语义正则 .get(k) = 精确命中、成员赋值与比较不误报、注释行跳过——注入样本自证 exit≠0）；lint.sh 挂载新审计线（第九线）；webstrict303 5 断言（注入可抓/全量 0 处/logs 修复保持/cdp URL 捕获保持/lint 挂载）；基线 3361→3366。

## [4.14.0] - 2026-11-19

### Added

- 管道 DSL 指南（300 轮盘点候选 1 第二项，数据深化收尾②）：docs/guide/data-pipelines.md——chain 基础（params 传值/引用规则）→ pipe（stdout 直通 stdin）→ export（mode/rowsLimit/from 路径与类型）→ read（首行捷径/_rows/_all）→ watch 调度（触发管道配置）全链一图 + 每节可运行示例（全部来自 demochain 真实动作）+ 组合模式速查表四行（取数→变换→落盘 / 读回→回写 / 定时积累 / 读回再加工）；plugin-spec 互链 + docs/README 导航；pipedsl302 6 断言（五节齐全/实例引用/速查表/互链/导航/闭环可跑）；基线 3355→3361。数据深化收尾完成（300 轮盘点候选 1 两项全清）。

