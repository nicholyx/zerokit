# Changelog

## [Unreleased]

### Added

- app.js 拆分第五步——监控/定时域注入式迁出：14 个函数（showWatchPanel/showTimers/renderTimersRows + scheduleWatch/fireTimer/persistWatch 等 7 主 7 支撑）整域迁 web/watchtimers.js（createWatchTimers(ui) 工厂 + __wt() 惰性 getter——整域内聚后注入面最小化）；10 条断言更新（webui×5/pace177/polish95×2/bookmark180——迁出函数改读 watchtimers.js）；app.js 10233 行（五步累计 -1040）。

## [3.36.0] - 2026-11-11

### Added

- app.js 拆分第四步——导出/分享域注入式迁出：showShareView/showShareImport 迁 web/share.js（createShare(ui) 工厂 + __share() 惰性 getter；window 导出改 wrapper）；残留声明手工清除（调用点替换引擎误替换声明——迭代验证式提取 node --check 立即抓到）；5 条断言更新（table179×2/webshare169 拆分形态）；app.js 10698 行（四步累计 -575）。

## [3.35.0] - 2026-11-11

### Added

- app.js 拆分第三步——面板壳域注入式迁出（refs=0 子集）：15 个零外部状态耦合的纯渲染函数迁 web/panels.js（createPanels(ui) 工厂 + __panels() 惰性 getter）；迭代验证式提取（每删一个函数立即 node --check——renderTextView 删除伤邻居被自动跳过，renderDiffBody 实为 diffResults 内部物）；app.js 10765 行（累计 -508）；4 条断言更新（webui×2/density53×2）；方案表第 3 步 refs=0 层完成。

## [3.34.0] - 2026-11-11

### Added

- app.js 拆分第二步——批量域注入式迁出：runBatch/applyBatchImport/syncBatchView/curBatch 四函数迁 web/batch.js（createBatch(ui) 工厂 + __batch() 惰性 getter；batch/entries 是 app 侧 let——经 batchRef()/entriesRef() 闭包引用传入，赋值改为 .length=0/push 形态）；app.js 11049 行（-153）；8 条断言更新为拆分形态（batch98×4/pace177/webui×3）；方案表第 2 步完成标记。

## [3.33.0] - 2026-11-11

### Added

- v4 清债第一轮——web/app.js 拆分预检与试点：结构盘点（11273 行/249 顶层函数/29 import）；静态断言依赖面分析（webui-smoke 68 条 app2.includes 落点 Top：showServices 8/showPalette 7/showWatchPanel 6）；docs/debt/app-split-plan.md 五步拆分方案（每步独立 minor/断言同步改指向/3134 底线不降）；第一步试点完成——键盘域拆出 web/keys.js（注入式工厂 createKeys(ui) + app 侧惰性 getter __keys()，避免循环依赖与 TDZ）；4 条过时断言更新为拆分形态。

## [3.32.0] - 2026-11-11

### Added

- v3 线总检与 v4 展望（第 240 轮整百里程碑）：docs/guide/maintenance-patterns.md（三类维护轮型判据——功能/盘点锁定/事故修复，选型启发）；docs/guide/v3-incident-index.md（发布链事故全回顾判据索引——网络依赖/Git 工作流/文档护栏/tauri 四组）；docs/guide/v4-outlook.md（六大候选方向议题池+清债优先判据）；docs 导航接入。

## [3.31.0] - 2026-11-10

### Added

- timers 面板下次执行时间可视化：到期高亮（≤5 分钟黄色 due-soon / 已过期灰色划线+「已过期」标 exp——catch-up 前的视觉态）；下次执行时间升序排序（最近的最上、暂停的最后）；相对时间 nextRunLabel（秒/分/时/天四档）复核锁定；webui +2 断言。

## [3.30.0] - 2026-11-10

### Added

- batch 失败重跑体验补全：盘点确认「只重跑失败」25 轮已有（batchRetry 按钮/runBatch(failEntries) 重入/无失败隐藏）——webui 断言锁定既有接线；补重跑批次视觉标记（进度条左缘警示条 + 汇总卡 ↻ 徽标——区分新结果 vs 保留旧结果）。

## [3.29.0] - 2026-11-10

### Added

- 结果表格首列冻结体验复核锁定：39/143/176/195 轮已实现首列 sticky、shouldFreeze ≥4 列阈值、can-r/can-l 滚动阴影、行 hover 贯穿冻结列——webui +1 断言锁定既有接线防回归；sysinfo top 宽表实测（4 列 true/3 列 false 阈值复核）。

## [3.28.0] - 2026-11-10

### Added

- doctor 历史趋势线：doctorTrendSparks 纯函数（jsonl → spark 数据，倒序入正序出/坏条目滤除）；doctor 面板走势条（最近 10 次错误红/警告黄/干净绿——复用 watch-spark 形态）；CLI zkit doctor --trend（文本走势）；server /api/doctor-history GET 端点；I18N docSpark 两键 zh/en；extras-smoke +1 / webui +1 断言。

## [3.27.0] - 2026-11-10

### Added

- 零命中词查看面与同义词表培育：开发者面板新增零命中词管理区（列表/单条删除 chip×/一键清空确认/空态友好提示）；副文案引导高频词进 SYNONYMS（web/extras.js）——零命中数据从收集→利用→可管理可培育；I18N zeroHits 七键 zh/en；webui +2 断言。

## [3.26.0] - 2026-11-10

### Added

- 零命中词消化闭环：suggestFromZeroHits 纯函数（拼音域编辑距离 ≤2——候选 label/py 形态匹配 full 与 initials 各一次，返回原文 top3）；0 命中时命令面板显示「你可能在找」chips（点击即填入重搜；无建议零打扰）；I18N zeroSuggestLabel zh/en；extras-smoke +2 断言（拼音域命中/top3 分档）。

## [3.25.0] - 2026-11-10

### Added

- 命令面板命中率反馈：paletteMatchLine 纯函数（命中数/候选总数——0 命中明示「无匹配」并引导换短词/拼音）；非空查询时 foot 显示命中率行（0 命中标红）；recordZeroHit 高频零命中词本地收集（去重保序上限 30、短词不收——为后续同义词表做数据）；extras-smoke +2 断言。

