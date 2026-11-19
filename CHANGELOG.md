# Changelog

## [Unreleased]

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

## [4.13.0] - 2026-11-19

### Added

- zerocol 多行导出（300 轮盘点候选 1 第一项，数据深化收尾①）：export 步 mode = "append"（默认 overwrite 保持现状）+ rowsLimit（默认 1000——**kebab 不过 PARAM_RE**，参数名用 camelCase）；append 实现——读旧文件按新列声明对齐合并（**行对齐补 null**：旧行在新列上占位——初版漏此导致旧行丢失，最小复现定位）；回报带 mode 与合并后行数；demochain pipe-append 示例（跑三次 3 行）；plugin-spec mode/rowsLimit 行；zerocolappend301 4 断言（append/上限截断/新列补空/回报）；292/294 回归全绿；基线 3351→3355。时序数据集成形：watch（295）触发 + append 积累 + read 端 _all 消费。

## [4.12.0] - 2026-11-19

### Added

- 第三百轮盘点（v4 深化收官 + 旅程 + 展望）：v4-outlook 深化阶段表（298 过滤订阅 + 299 协作锁——含 Chrome 158 暴露 247 轮笔误的战果记录；建议 2 待续）；三百轮旅程摘要（v3 287 轮 79 minor + v4 13 轮 12 minor；160 文件 3346 断言；发布链全自动 + 生态三链 + 双主题闭环）；下一百轮候选四条（数据深化收尾 M / 真实用户驱动按需 / 稳定性长跑——跨浏览器巡检+perf 自适应 / 议题池新陈代谢）；docs/README 三百轮锚点；round300 5 断言；基线 3346→3351。

## [4.11.0] - 2026-11-19

### Added

- 协作锁（297 复盘建议 1 第二项，v4 协作面深化）：coopLocks 模块级注册表（key → sid/clientId/since；--broadcast 开启才启用；read 不锁）；CallTool 授权闸前检查——同 key 已被他会话持有返回 busy-locked（含 holder clientId + since）+ 结构化 error；**修两个真缺陷**：①授权拒绝路径不释放锁（泄漏——299 排障定位：B busy 但 A 的 handler 从未进 runAction，链路工具未 allow 提前 return）②同 sid 重入不重置锁（SDK POST 重放）；释放三路：完成/失败 finally（闭包捕获 mySid——模块级 currentSid 被并发请求覆盖的坑）+ 授权拒绝 + DELETE 断连批量释放；sessions 端点带 locks 视图；mcplock299 8 断言（互斥/持锁/轮询释放/重试/read 并发/断连）；**perf-guard 加 load>3 降级豁免**（本机外部进程 45% CPU 抢占时冷启动 300-410ms 间歇红——CI 干净机仍守 300ms 真回归）；基线 3338→3346。

