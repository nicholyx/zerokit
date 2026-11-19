# Changelog

## [Unreleased]

### Added

（下一版攒着）

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

## [4.10.0] - 2026-11-15

### Added

- 广播过滤订阅（297 复盘建议 1 第一项，v4 协作面深化）：SessionEntry 加 filters（tool 名前缀集，空=全收）；客户端声明走 initialize params.clientInfo.filterTools（string[]——标准 MCP 握手参数内携带，无需扩展协议）；notifyOthers 发送前按 tool 名前缀匹配（不匹配跳过该会话）；presence 豁免（joined/left 永远全发）；filtered 单列计数进 /mcp/sessions（filteredBroadcasts）；bcastfilter298 4 断言（活体：B 声明只收 demochain → sysinfo 被滤、demochain 命中、filtered≥1、presence 不受影响）；基线 3334→3338。

## [4.9.0] - 2026-11-14

### Added

- v4 双主题阶段复盘（第 297 轮）：v4-outlook 加「v4 线进度」节——协作面 4/4（广播/presence/摘要/频控）+ 数据工作流 4/4（pipe/导出端/读取端/调度面）双表对照（步/轮/交付/版本 v4.1.0–v4.8.0）；下一阶段建议四条（协作深化 M：广播过滤订阅+协作锁 / 数据深化 M：zerocol 多行+管道 DSL 文档化 / 桌面冻结重审 S：首个桌面用户出现时插 / 新议题征集常开——298 轮起 1→2 交替）；docs/README 进度锚点；v4mid297 5 断言；基线 3329→3334。

## [4.8.0] - 2026-11-14

### Added

- 广播频率控制与静默窗口（v4 协作面第四步——防 watch+chain 高频刷屏）：节流（同 method 最小间隔 min-interval-ms 默认 2000——config [broadcast] 节；**presence 豁免**：joined/left 不占 tool-call 配额，开发中靠 gate 日志定位「A 的 join 占用配额致首个 tool-call 被拦」）；静默窗口 quiet = "22:00-07:00"（跨午夜窗口解析；窗口内非 presence 广播丢弃）；丢弃计数 dropped 进 /mcp/sessions（droppedBroadcasts 字段）；zkit mcp sessions 显示「频率控制丢弃 N 条 + 可调提示」；readBroadcastConfig 最小 TOML 解析；broadcastthrottle296 4 断言（活体 500ms 节流只广播 1 次 + dropped≥1 + 窗口/豁免源码面）；修复过程顺带回归验证 289/290/293 全绿；基线 3325→3329。

## [4.7.0] - 2026-11-14

### Added

- watch 触发 chain 管道（v4 数据工作流调度面——无人值守数据流）：watch 配置加 chain 字段（详情页 watch 表单「触发管道」输入 插件.动作；reg 条目与 persistWatch 均持久化 chain + lastChainRun）；浏览器 tick 引擎——采样后数据变化且声明 chain → runChainQuiet 静默执行（/api/run 同款信封 token 头）；lastChainRun 记录 ok/ts/key/err；UI watch 面板徽标（⛓ chain 名 + ✓/✗/待触发三态）；恢复侧（GET /api/watch）带 chain；watchchain295 5 断言；基线 3320→3325。「指标越界→自动跑管道→落盘新 zerocol」调度闭环成形。

## [4.6.0] - 2026-11-14

### Added

- zerocol 读回 chain step（v4 数据工作流第三步——读取端闭环）：内建伪引用 use = "builtin.zerocol-read"（plan 放行 + 执行特判）；params file（data_dir 下的 zerocol 文件）；importZeroCol 读回 → data 带全列首行捷径（{alias.data.value} 直接取）+ _rows/_columns/_all/_file 元数据；错误两态明确（chain-read-missing 提示先跑 export 生成 / chain-read-bad-format 含 JSON 与列解码两层）；demochain pipe-roundtrip 示例（read → export 回写，**往返 checksum 全等实测**——开发中发现并修正 from 路径漏 .data 层）；plugin-spec 读回步行；zerocolread294 4 断言；基线 3316→3320。数据跨 run 流转成形：昨天的导出今天的管道源。

