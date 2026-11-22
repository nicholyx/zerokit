# Changelog

## [Unreleased]

### Added

- 恒真断言 lint 护栏（400 复盘「后续三条」第一条兑现——398 的清理不可回退化）：scripts/true-assert-scan.mjs 扫 test/ 的 check(…, true) 模式；**白名单按「文件+断言名+条数」三元组**（非行号——内容挪动不碎；现存 24 处恒真 = 20 条白名单条目，全部为 398 分类过的合法平台占位）；**新增即 FAIL** 并给出处置指引（能写真断言就写；确属占位才登记白名单且断言名须写明「占位——原因」）；白名单条目消失仅提示不失败（可清理）；lint.sh 第十线接线（CI 同源）；自测验证——临时加一处恒真被当场抓到、删除后恢复。
- 400 轮复盘（第四百轮整数关口——前几次盘点交付，这次盘点**债**）：v4-outlook「400 轮复盘」节——三十轮分层（数据面收官 7 / 发布与年检 11 / 测试质量 3 / 例行巡检 7——**全部干净轮**）；**产出结构自检不粉饰**（功能轮只占 19%，394 后数据面探到清单表达边界、边际价值下降；维护节奏惯性真实存在——连续 7 个干净巡检轮说明周检频率可能高于必要，下个月度例跑评估降双周）；**债的诚实账本四项**（恒真断言 29→6 显式但**无自动护栏**；CI 抖动四源有对策但**治理后未再统计失败率**——没数据不算压降；版本号账目已清；里程碑命名规则未成文）；路线图四审（三候选 72 轮无诉求——稳态维持，**稳态意味着少做也是正确选项**）；给后续三条（恒真断言加 lint 护栏 / 40 run 后统计失败率 / 里程碑命名成文）；快照刷新 211/3597；round400review 5 断言；基线 3597→3602。
（下一版攒着）

## [5.2.0] - 2026-11-23

### Fixed

- 恒真断言清理（397 盘点的收尾——check(..., true) 29 处分类处置）：**4 处懒恒真补成真断言**——devweb86⑧（Caller 含 dev + dev caller 写 source:dev——原注释指向 audit.ts 有误，类型与写入点实在 runner.ts）、docs134⑧（self-referential 恒真改为实数本文件 check( 调用数）、selfcheck137⑦（起 ui 常驻命令超时后什么都没验→真验 SelfcheckResult 结构 pluginId/probe/ok/ms/at）、watch79⑥（ui --port 0 阻塞没验任何东西→源码断言 /api/watch GET+PUT 路由在契约面）；**2 处合法占位显式标注**（smokeinst343④ .git/hooks 不入 CI、panelsmoke341① 降级一致性同数——355 判据）；其余为合法平台占位（win 无 bash/无 Chrome/降级路径）不动。
- main CI 抖动治理（4/40 失败率≈10% 全量归因——每类靠重跑绕过从未系统处理）：**四源清单**——①CDP 冷启动/残例竞态（341/342/363/387 已修）②stdio 探针竞速（373 已修）③退出码时序（383 已修）④**纯函数/过滤时间预算**（本轮：perf-guard 重测取较优 + load 3 次采样中位豁免；extras filterRows 失败重试一次——**真退化两次都超仍硬失败**，重试只救环境不救代码）；「先重试再降级」通用判据 + 「权威面永不降级」边界落 platform-pitfalls「CI 抖动四源清单」节；perf-guard load 单点改 3 次中位（runner 调度尖峰漏判豁免修复）。
### Added

（下一版攒着）

## [5.1.0] - 2026-11-23

### Added

- stats distinct 基数统计（去重计数——error code 有几种、user 有几个的多样性语义）：ops 加 distinct（该列不同值个数——数值与 string 列都支持）；白名单同步（355 判据）；**与 where/window 组合**（筛选/窗口内基数——distinct 在 vals 生效后计算）；string 列 gate 放行（distinct 与 top/count 同列合法）；data-pipelines.md 补基数统计示例；statsdistinct394 3 断言（code 3 种/ms 4 种/window=3 内 3 种）；基线 3594→3597。
（下一版攒着）

## [5.0.0] - 2026-11-22

> **v5.0.0 = 版本号自然进位（v4.99 之后），非路线图「v5 大改」**——发布链不变、无破坏性变更；路线图 v5 主题（opt-in 上报 / DSL 进阶 / 桌面启用）继续等真实诉求触发。

### Added

- read limit 取头 N 行（读侧四轴补完——「最近 5 条」语义直达）：read params 加 limit（正整数——**where/sort 之后**截取头 N 行；_rows 为截断后行数）；与 sort desc 组合（「最近 5 条」= sort ts:desc + limit 5 直达——此前要在模板层切片）；无 limit 行为不变（向后兼容）；data-pipelines.md 补取头 N 行示例；readlimit390 3 断言（desc+limit 首行=500 rows=2/全表兼容/asc+limit）；基线 3591→3594。
（下一版攒着）

## [4.98.0] - 2026-11-22

### Added

- read sort 行序控制（读侧最后一块拼图——排序后首行语义由用户掌控）：read params 加 sort（「列名」升序 / 「列名:desc」降序；列不存在报错）；数值列按数值、string 列按字典序；**与 where/columns 组合（先 where 后 sort——筛选行内排序）**；排序后首行捷径 {r.data.列} 与 _all 同步重排；审查期抓掉行索引 bug（idx 误用列数组索引——两列时只排 [0,1]；改为行索引全排）；dashsignal326 boot 门控加固（readyState 轮询替代固定 4s——全量偶发 NO-EL 根修）；data-pipelines.md 补行序控制示例；readsort387 5 断言；基线 3586→3591。
（下一版攒着）

## [4.95.0] - 2026-11-22

### Added

- export select 写侧选列（append 模式的列级追加——旧文件 10 列只追加 2 列，其余保留旧值）：export 加 select（逗号分隔列名——只写声明的这些列；**select 列不在 columns 声明中报错**）；append 合并语义：select 内的列追加新值，**旧文件多出的列整列保留旧值 + 新行 null 占位**；无 select 行为不变（向后兼容）；data-pipelines.md 补写侧选列示例（与 359 rename 并列）；exportselect384 3 断言（select append a=[1,2]/c 旧值保留/报错）；基线 3583→3586。
（下一版攒着）

## [4.90.0] - 2026-11-22

### Added

- stats percol 逐列 ops（复数形态表达力补完——ms 算分位、level 算 top 一条链路搞定）：stats 加 percol 参数（「列名:ops」逗号分隔——逐列覆盖全局 ops；被覆盖列只算覆盖后的 ops）；无 percol 行为不变（向后兼容）；data-pipelines.md 补逐列 ops 示例；statspercol379 3 断言（覆盖 ms 只 median=20/level 只 top=info、兼容、幂等）；基线 3580→3583。
- where 多值 OR（筛选表达力补完——错误行想同时看 error+warn 不用两次查询）：read/stats/MCP 三面的 where 全部支持多值（「level=error,warn」逗号分隔任一匹配——Set 化比较）；单值行为不变（向后兼容——单值是多值特例）；data-pipelines.md 更新多值语法示例；readwhere360 5 断言（+error,warn → rows=3）/ statswhere366 6 断言（+info,error=全表 count=4）/ mcpstatstool346 8 断言（builtinStats 掩码同步）；基线 3578→3580。
（下一版攒着）

## [4.86.0] - 2026-11-22

### Added

- MCP zerokit_stats 加 where/window 参数（366/320 语义对 AI 客户端开放——工具面与链路内建步完全同构）：inputSchema 加 where（「列=值」筛选统计）与 window（最近 N 行——先 where 后 window）；builtinStats 支持掩码+窗口（数值列与 string 列同步筛）；CLI cmdTools 元数据同步（331 同源判据——两处 schema 一致）；mcpstatstool346 8 断言（+where avg=500/+window=1/+schema 含新参）；基线 3575→3578。
（下一版攒着）

## [4.82.0] - 2026-11-22

### Added

- v4.80.0 里程碑（第 80 个 minor——数据面收束盘点）：v4-outlook「80 版本里程碑」节——十轮分层（数据四件套 358/359/360/361/366/369×6 / UI 消费 365×1 / 维护+发布 362-364/367/368×4）；**数据面能力矩阵定稿**（read columns·where / export rename / stats window·median·p90·where·_where / 全家族 rows——8 行参数全景 + CLI --tail 与 UI 窗口切换三端同构标注）；路线图三审（v5.0.0 三候选二十余轮无真实诉求——「维护节奏是稳态」终审确认）；健康快照刷新（205 文件/3571 级/370 轮标记）；v4snap323 与 v60milestone348 历史断言对齐（快照数字与断言解耦判据延续——历史断言锚 outlook 量化节不变文本）；v80milestone370 4 断言；基线 3571→3575。
- stats _where 摘要（366 的可追溯补完——统计结果自带筛选条件）：带 where 的统计输出 data.stats._where（筛选条件原文）；模板 {s.data.stats._where} 可引用（消费端拿到 avg=700 知道是 error 行不是全表）；单数/复数形态都带；无 where 不输出该字段（向后兼容——模板引用不存在字段会炸的严格语义反而保证了误用即发现）；data-pipelines.md 补「筛选可追溯」说明；statswhere366 5 断言（+_where 引用 w=level=error / 无 where 无泄漏）；基线 3570→3571。
（下一版攒着）

## [4.77.0] - 2026-11-22

### Added

- stats where 筛选统计（与 read 同语义——先筛行再统计，少一步中间文件）：stats params 加 where（「列=值」——报错与 read/stats 列检查同文案）；**行掩码同步筛所有列**（数值列与 string 列都对齐——where=level=error 后 avg 只算 error 行、level top=error）；与 window 组合（先 where 后 window——筛选行内取尾 N 行）；无 where 行为不变（向后兼容）；data-pipelines.md 补筛选统计示例；statswhere366 4 断言（avg=700 count=2 top=error/全表兼容/列报错/幂等）；基线 3566→3570。
- dashboard 信号卡片窗口切换（364 CLI --tail 的 UI 对位——三端窗口语义齐同构）：卡片头加窗口切换组（全部 / 最近 20 / 最近 50，active 高亮）；点击后 __sigWin 全局 + fetch 带 window 参数重新渲染；**30s 刷新保持当前窗口**（不弹回全表）；/api/stats/top-actions 加 window 参数（0/缺省=全表——向后兼容；与 CLI --tail 同 clamp 语义 1-1000）；dashsignal326 9 断言（CDP +3：按钮组渲染/点击切换 __sigWin=20/卡片重渲染；降级 +2 同数）；基线 3564→3566。
- CLI stats --tail N（最近 N 次窗口视图——与 320 链路 window / 361 分位打通，实时 SLA）：cmdStats 加 --tail N（1-1000，非法值钳到 1——clamp 语义不炸）；窗口内重新统计（分位数/最常用/最慢都是窗口语义）；输出头部「⏱ 窗口视图 最近 N 次」+ --action 单动作视图带窗口标注 + --json 透传 window 字段；无 --tail 行为不变（向后兼容）；statstail364 4 断言（窗口头/兼容/json window/钳位）；基线 3560→3564。
（下一版攒着）

## [4.72.0] - 2026-11-22

### Added

- stats median/p90 分位数（监控尾部语义——avg 被长尾拉高，P90 才是 SLA 语义）：ops 加 median（偶数行取中间两值平均）与 p90（90 分位线性插值）；**白名单同步**（355 判据兑现——白名单与功能同 commit）；window 组合正常（最近 N 行的分位）；309 的「非法 ops」断言样例 median→bogus（median 现已合法——旧断言用真非法值）；data-pipelines.md 补分位数示例；statstop345 7 断言（+median=3/p90）；基线 3559→3560。
- zerocol-read where 行过滤（读侧行筛选——与 358 列投影组成完整读侧投影面）：read params 加 where（「列=值」单条件字符串精确匹配；列不存在报错与 stats 同文案）；筛选后 _rows 为匹配行数、_all 只含匹配行；**与 columns 可组合（先 where 后投影——错误行只看 msg 一眼可查）**；无 where 行为不变（全表——向后兼容）；审查期修掉双重过滤 bug（原地过滤后 map 再过滤一次会索引错位）；data-pipelines.md 补行筛选示例；readwhere360 4 断言（筛选 rows=2/组合/全表兼容/列不存在）；基线 3555→3559。
- zerocol-export rename（写侧列改名——与 358 读侧投影对称）：export params 加 rename（「旧名:新名」逗号分隔多条；旧名不存在忽略该条）；rename 后下游 stats/read 按新名引用（列元数据一致）；无 rename 行为不变（向后兼容）；data-pipelines.md 补写侧改名示例（与 358 读侧投影并列成对）；exportrename359 4 断言（改名生效/数据集列名/无 rename 兼容/幂等）；基线 3551→3555。
- zerocol-read columns 投影（读侧列裁剪——宽表只看部分列时输出与心智负担都小）：read params 加 columns（逗号分隔，只输出指定列，**列序按参数序**）；列不存在报错与 stats 同文案（「列 x 不存在（有：…）」）；无 columns 时行为不变（全列——向后兼容）；stdout 附「投影自 N」提示；data-pipelines.md 补读侧投影示例；readproj358 4 断言（投影 _columns=2/无 columns 全列 3/列不存在报错/列序按参数）；基线 3547→3551。
- 协作操作可追溯（mcp-sessions 快照含 ops 日志——filters/unlock 留痕）：mcp serve 加 opsLog 环形数组（最近 20 条 { ts, op, target }）；POST /mcp/sessions/filters 与 /unlock 成功时记入（404 失败不记——只有真实生效的操作留痕）；快照透传 ops[]（倒序——最新在前）；协作面板「最近操作」段（时间/操作/目标三列表格）；collaboration.md 补「操作可追溯」节；mcpops356 3 断言（404 不记/404 filters/快照可读）；基线 3544→3547。
（下一版攒着）

## [4.59.0] - 2026-11-21

### Added

- watch 面板数据集行数展示（351 rows 恒全表的 UI 消费端——监控语义完善）：有 chain 的监控条目行「N 次采样」旁加「· 数据集 M 行」（M=lastChainRun.stats 各列 count 取 max——无 window 时即全表行数；无 chain 条目保持原形态）；liveRefresh 与首渲两处同构（352 判据：动态字段与首渲不分裂）；dashsignal326 CDP 卡片等待改「轮询元素出现」（boot 慢时固定 sleep 不够——偶发 NO-EL 根修）；panelsmoke341 +2 断言（CDP 路径 + 降级路径各一）；基线 3543→3544。
- stats rows 恒全表（监控语义完善——总行数跨形态统一）：`{s.data.rows}` 恒为全表行数——复数形态此前恒 0（rows 只在单数分支赋值）、string 列分支不计行——修为**三形态统一**（单数/复数/string 均更新 rows=Max(当前, 列全表行数)；window 只裁 vals 不影响 rows）；MCP zerokit_stats 的 rows 返回同步统一；模板示例入 data-pipelines.md（`{s.data.rows}` 用法）；statstop345 6 断言（+rows 复数形态=6）+ mcpstatstool346 5 断言（+rows:3）；基线 3541→3543。
- 文档巡检第二季（331 先例延续——341-349 十轮积累后的全面体检）：①内链校验（docs/ 全部相对链接存在性——0 失效）；②**i18n whitelist 正则级审计**（1469 行逐行 re.compile 全仓试配——**真死 81 行清除**，1392 行保留；无-match 行用「去转义字面量子串」二次确认防误杀）；③平台判据落盘复核（341-349 新增 8 条全落盘——CDP 五条已有，**补「配置同步/工具面」四条**：restoreWatches 只写不读/恢复条目翻页误杀/ops 白名单与功能脱节/typecheck 假绿）；④活文档过时计数扫描（0 处——50/60 里程碑历史节保留）；docaudit350 4 断言；基线 3537→3541。
- v4.60.0 里程碑（第 60 个 minor——第二次整数关口）：v4-outlook「60 版本里程碑」节——十轮分层（烟测制度 341-343×3 / 数据消费 344-346×3 / 维护节奏 338-340+347×4）；**信号面五层全景定稿表**（写侧 306 / API 324-325 / UI 326+336 / 导航 327 / MCP 346——写→存→查→看→跳闭环全同源）；量化（断言→3533、文件→197、minor 60；烟测体系从无到有；判据遗产新增 ops 白名单同步/typecheck 本地化/CDP host 校验/降级一致性）；路线图复核（v5.0.0 三候选十轮内无真实诉求——「稳态不是等待态」再确认）；健康快照刷新（197 文件/3533 级/主题分布新值/348 轮标记）；v4snap323 与 v50milestone337 断言随刷新对齐（337 历史断言改锚 outlook 量化节不变文本——快照数字与断言解耦的 335 判据延续）；v60milestone348 4 断言；基线 3533→3537。
（下一版攒着）

## [4.58.0] - 2026-11-21

### Added

- MCP zerokit_stats 工具（zerocol-stats 的 MCP 面——AI 客户端可直接查数据集统计）：tools/list 加 zerokit_stats（file/column/ops 参数与 chain 内建步同构）；CallTool 分流调 builtinStats 导出函数（复用 345 统计逻辑——含 string top-frequency）；错误面与 chain-stats-* 同文案（缺参/列不存在/ops 非法）；**CLI cmdTools 同步加 zerokit_statsTool**（331 判据「CLI 与 server 同源」——二波① tools --plugin 断言抓出 builtinStatsTool 错进过滤分支——修为无条件分支才加入）；mcp-smoke serverPath 默认 src/mcp.ts（直接跑不传参不炸）；mcpstatstool346 4 断言（tools/list/统计返回/列不存在/缺参）；基线 3533→3530→3533（346 增 4 + mcp-smoke 修 −4+38→38）。
- stats top-frequency（数据消费端第三块——字符串列可统计了）：ops 加 "top"（出现次数最高值/次数/占比 top_value/top_count/top_ratio）；数值列 top=mode（最高频数值）；string 列带 top 合法（importZeroCol 解码 utf8——字节操作复用内核路径，341 判据兑现）；多列形态带 top 的 string 参与统计（315 的静默跳过收敛为分形态）；空列/单值列边界（null/占比 1.0）；**单数形态平铺+分组双写**（模板任取 stats.min 或 stats.列名.min——317 兼容不破坏）；ops 白名单含 top（旧 gate 报错的根因——白名单过滤把 top 丢掉致 opsHasTop=false）；statstop345 5 断言；基线 3524→3529。
- 信号面板周检（344 轮——dashboard 信号卡片数据链完整回归）：dashsignal326 升级双路径（本地 CDP 真渲染卡片：Chrome headless 起 ui server + dashboard 渲染 + dashSignalBody 元素级抓取；CI 降级源码断言补 2 与 CDP 同数——与 panelsmoke341 降级一致性模式同款）；活体验证市场安装计数（installs=1+last30d 数组）与执行热度 Top（gen×3）双端点数据真实进卡片；执行项跳转 openDetail 链路源码级固化；dashsignal326 7 断言（CDP 路径 6 + 降级 2）；基线 3522→3524。
- 面板烟测制度化（341/342 挖七 bug 后——真渲染验证进日常流程）：scripts/pre-push-smoke.sh（web/src 有改动才跑——panelsmoke 三面板 + cdp-smoke 12 面板两个真渲染验证；无改动秒跳过）；.git/hooks/pre-push 幂等安装（无 husky——exec 脚本）；CDP 判据五条落 platform-pitfalls（DevTools host 校验拒 127.0.0.1→localhost / target 类型漂移按 /devtools/page/ 挑 / 冷启动 20×800ms 重试+pkill 残实例 / 代理劫持回环删 proxy env / **降级一致性**——CI 降级断言数必须与本地 CDP 版同数否则基线拦截 3513<3517 实战）；smokeinst343 5 断言（脚本存在可执行/跳过路径/判据五条/panelsmoke 活体 7 断言）；基线 3517→3522。
- 341 遗留两已知问题清偿（watch 读回 + collab 深链——挖出三个更深的真 bug）：①**restoreWatches 定义了却从未被调用**（79 轮的 watch.json 持久化只写不读——重启页面监控全丢！接通进 load() boot 链）②**读回漏 chain/lastChainRun 字段**（295 写侧有读侧漏——补进 reg 条目重建）③**恢复条目被「翻页自动停」误杀**（boot 时无 detail 上下文 → 首轮 tick 即 stopWatch——加 __restored 首轮宽限标记）；collab 深链根因确认 = 341①（deps 未传）已随上轮修复消失；watch 面板**首渲行也带 ⛓/看统计/趋势段**（此前只有 liveRefresh 动态字段有——首渲与动态同构）；CDP 排障终章：Chrome 111+ 的 DevTools host 校验拒 127.0.0.1 → fetch URL 换 localhost（200+HTML 假响应的真相）；panelsmoke341 升级 7 断言全绿（三面板完整验证）；基线 3514→3517。
- 三面板运行时烟测（CDP 真渲染——首抓四个真 bug 全修）：panelsmoke341 起 ui server + headless Chrome CDP 抓 dashboard/watch/collab 三面板——**首跑即抓出四个潜伏真 bug**：①collab.js 工厂声明 deps 却没传参（showCollab 运行时 ReferenceError——311 轮以来 #/collab 从未真实渲染过）②dashboard 信号卡片点击绑定放在 renderSignal 函数外的 try 块顶层（body 局部变量引用——ReferenceError）③④panels.js renderList 的 deps 漏注入 perfStats 与 renderListInner（243 轮迁出遗漏——**每个全新环境首页都炸**「加载失败：perfStats」，老环境因缓存幸存）——四处全修后插件列表/信号卡片/双列表真实渲染验证通过；CDP 排障判据沉淀（代理劫持 127.0.0.1 fetch / chrome target 选 /devtools/page/ / 冷启动重试）；watch 写盘条目读回与 #/collab 深链时序留 342（已知问题记录）；panelsmoke341 4 断言；基线 3510→3514。
（下一版攒着）

