# Changelog

## [Unreleased]

### Added

（下一版攒着）

## [4.47.0] - 2026-11-20

### Added

- 执行热度周环比（stats --trend——趋势可见）：本周（7d）vs 上周（前 7d）分窗统计，每动作箭头标记 ↑+N / ↓-N / →持平，新入榜动作标「新」（top 8）；--trend 开关默认关（保持现有输出形态）；中途吞了 92 轮「最常用」行（334 插入 anchor 撞行）——**全量测试当场抓回已修**（guard 体系有效性实证）；trendstats334 3 断言（分窗输出/新标记/默认关）；基线 3494→3497。
- 11 月依赖卫生月度例跑（dep-hygiene 清单首跑——四步留痕）：步骤 1 dep-audit 四项全过；步骤 2 outdated 分拣（@types/node 26 与 typescript 7 维持观望——运行时/生态未跟）；**步骤 3 抓出 2 条 moderate 公告并当轮修复**（@hono/node-server 2.1.4→2.1.10 + hono 4.13.19——GHSA-qv5m-9pm6-hqp3 WebSocket ECONNRESET 崩溃 + GHSA-jpvv-r467-5p4w 路径绕过；传递依赖零直用，npm audit fix --omit=dev 安全升）——0 vulnerabilities；判据补丁：npm audit 必须 --registry=官方源（jlc 镜像 NOT_IMPLEMENTED）；步骤 4 历史表追加 11 月例跑行；monthlyaudit333 5 断言；基线 3489→3494。
- 桌面安装包烟测（v4.40.0 aarch64.dmg 实测——「下载→装→跑」路径首次验证的只读部分）：gh release 下载 dmg 到 /tmp → sha256 与 release digest 对齐（be0b0156…两侧一致）→ hdiutil 只读挂载 → app 结构核查全过（Info.plist dev.zerokit.desktop/4.40.0、MacOS 二进制 Mach-O arm64、Resources 内嵌 web/plugins/src/node_modules）→ detach 清理；烟测记录入 updater-readiness.md 附录（「实际安装+启动」留首个真实桌面用户——避免破坏本机环境）；dmgsmoke328 3 断言（资产命名判据/Info.plist 源/烟测记录在档）；基线 3485→3489。
- 依赖卫生巡检清单（维护节奏第二轮——例行巡检标准化）：docs/reference/dep-hygiene.md——月度巡检四步（dep-audit 基线 / npm outdated 三档处理【patch 直合、major 评估、停更留 issue】/ npm audit 公告 / dependabot 评论留评估结论）+ 判据四条（lockfile 一致 / 主版本先查引用面——329 sdk 1.8 一行兜底案例 / @types/node 跟运行时 / typescript 7 观望）+ 历史处理记录表；本轮实跑：sdk 1.8→1.11、tauri-cli 2.12.6 minor 直合，@types/node 26 与 typescript 7 观望；dephyg330 4 断言（活体审计全过/清单判据/历史记录/导航）；基线 3485→3485（文档轮断言数由守护测试自证）。
（下一版攒着）

## [4.40.0] - 2026-11-20

### Added

- v4.40.0 整点复盘（v4 线第 41 轮/第 40 个 minor——整数关口）：v4-outlook「40 版本整点复盘」节——三阶段弧线（主题排定 288-300 13 轮 / 深化收官 301-313 13 轮 / 真实信号驱动 306/314 起）；量化对照表（断言 3284→3481、测试 149→186、minor 0→40、内建步 2→4 件套+window/多列、指南 0→4、信号面 0→四层）；三大判据沉淀清单（299 Chrome 严格度语义炸弹 / 304 Windows file:// / 324+325 信号双面与单 try 绑架）；下阶段定调（三候选全部等真实诉求——不再主题内推演，日常转维护节奏）；v40review328 4 断言；基线 3477→3481。
（下一版攒着）

## [4.39.0] - 2026-11-20

### Added

- watch↔dashboard 信号导航（使用信号导航收口）：watch 面板条目加「看统计」链接（#/dashboard 直达首页信号卡片——监控→触发→结果→统计一条线点到底）；⛓ 徽标升级 span + hover title（title 属性带最近统计数字 max/avg/count——不挤行内；无统计时提示触发带 stats 的链路）；dashboard 信号卡片反向导航「去监控」（空态引导 + 卡片头双入口）；signav327 3 断言（入口/徽标 title/反向导航）；基线 3474→3477。监控到信号的导航双向往返。
（下一版攒着）

## [4.38.0] - 2026-11-20

### Added

- UI 首页使用信号卡片（信号第三面——双信号可视化收口）：dashboard tiles 下加「使用信号」卡片——左安装 top（🔥N 插件名）/ 右执行 top（×N 动作名 + 败次数）双列 grid；空态引导（「装一个插件/跑一次动作后这里会有数据」）；执行项点击跳动作详情（fetch /api/plugins 找 plugin+action 对调 openDetail——无缓存依赖，已卸载静默留原地）；30s 自动刷新 + 离开面板 clearInterval；顺带补 95 轮判据（td 空占位 ps-empty 也带 role=status——polish95 抓出）；6 条中文 whitelist 登记；dashsignal326 5 断言（双列/空态/跳转/刷新/双端点联测——安装 1 + 执行 gen×3 卡片可渲染）；基线 3469→3474。信号三面齐：写（306/审计）→ API（324/325）→ UI（326）。
（下一版攒着）

## [4.37.0] - 2026-11-20

### Added

- 动作执行热度 Top（信号第二面——「装了」不等于「在用」）：zkit stats --top N 参数化（92 轮「最常用」行升级，1-20 条；成功/失败分列已在耗时表）；doctor signal 扩展 executions 维度（总次数 + topAction「gen×3」形态）+ 人读行升级「使用信号：安装侧 · 执行 N 次（最常用 X）」；**修 signal 块单 try 绑架坑**（market-stats 缺失时 JSON.parse 抛错把执行数也归零——拆独立 try，实测坑）；GET /api/stats/top-actions?n=（UI 可消费；白名单+openapi；含 count/fail 分列）；topactions325 3 断言（stats --top 2 gen×3 排首 / doctor executions+topAction / 端点 total=4 top[0] count=3）；基线 3466→3469。
（下一版攒着）

## [4.36.0] - 2026-11-20

### Added

- 安装计数读侧消费（真实信号驱动第一轮——信号看得见）：doctor 报告加 signal 字段（plugins/totalInstalls/hasData——json 出口 + 人读行「N 个插件有安装记录（累计 M 次）」；空/缺是 info 级不算 error，提示 zkit plugin install 后会有数据）；UI 市场面板热度徽标独立化（未装插件也显示 🔥N——原先只在已装徽标内）；热度排序入口（面板头「🔥 按热度排」toggle 按钮 + renderEntries 排序链替换 entries 渲染链四点）；signalread324 6 断言（有/无数据两态 + exit 0 + json 字段 + 徽标独立 + 排序入口）；基线 3460→3466。306 写侧 → 324 读侧，安装计数闭环。
（下一版攒着）

## [4.35.0] - 2026-11-20

### Added

- v4 线健康快照（323 轮定盘星——真实信号驱动阶段前的横切收束）：docs/reference/v4-health-snapshot.md——技术基线指纹（181 文件级/基线以 assertion-baseline.json 为准/内建步 4 件套/组合拳 2 条/lint 9 线）；测试主题分布五档（内核 127/数据 18/协作 15/UI 11/稳定性 9——按文件名前缀自动归类）；v4 线 36 轮清单（288-323 轮号-版本-主题对照表）；**顺带发现并记录已知债务**：overview「已完成」清单自 v4 中期起插入守卫静默跳过（anchor find -1 → if 守卫跳过），轮次行只更新「最后更新」——快照文档承担轮次清单职责；**快照与精确断言数解耦**（写死数字会与 sync-counts 每轮 +1 形成追数死循环——首轮快照 3455→3460 三次追赶后改为「以 baseline 文件为准」表述）；v4snap323 5 断言；基线 3455→3460。
（下一版攒着）

## [4.34.0] - 2026-11-20

### Added

- 协作面组合拳回顾（与 321 数据组合拳对偶——六能力单场景串验）：collabcombo322 7 断言——① B 声明 filterTools 排除 sysinfo → A 调它被滤（filteredBroadcasts≥1 且 B 流无 sysinfo）→ A 调 demochain 命中（B 收 tool-call）；③ 1s 连调两次第二次被节流（dropped +1）且 presence joined 不受影响；② A 持慢写锁 1.5s → 快照 locks 含 holder → B busy-locked → A 完成释放（**299 判据复现**：mutate 需 mcp allow 授权才走到锁——测试先 allow）；④ 快照三块同刻互证（sessions≥2 + filtered≥1 + dropped≥1）；基线 3448→3455。协作六能力（广播/摘要/频控/过滤/锁/快照）单场景收官回归。
（下一版攒着）

## [4.33.0] - 2026-11-20

### Added

- 数据工作流组合拳回顾（315 多列 × 301 append × 320 window 三轮能力单一链路串验——收官回归）：combo321 4 断言——多列 append ×5（两列各 5 行）→ window=3 多列统计（value 3..5 / score 30..50 分组各自正确）→ **全表对照防假绿**（全表 min=1 ≠ 窗口 min=3——窗口没生效时对照即拆穿）→ 数据演进（再 3 次后 8 行、窗口滚动 value 6..8）；gen 动作用计数器文件产出递增序列（value=n, score=n×10——多列演进可控）；基线 3444→3448。数据工作流主题收官回归：增量各有测试 + 组合拳一条链。
（下一版攒着）

## [4.32.0] - 2026-11-20

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

