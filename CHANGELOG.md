# Changelog

## [Unreleased]

### Added

（下一版攒着）

## [3.46.0] - 2026-11-11

### Added

- 三层防线文档化（拆分系列最终判据汇编）：app-split-plan 补篇——职责矩阵（L1 静态断言查文本 / L2 注入面契约查结构 / L3 CDP 运行时查行为，各层天然漏什么、为什么需要下一层）；各层抓出的真缺陷记录（L3 抓 26 处含九轮潜伏、L2 抓 251 轮漏网之鱼、L1 三行秒级回归不可替代）；通用化模板（双侧约定→L2、组合爆炸→L3、其余 L1）；一句话判据「存在性断言永远不能证明可达性」。v4 及后续大型重构的验收模板。

## [3.45.0] - 2026-11-11

### Added

- 域文件注入面契约静态断言（251 轮缺口类别的第二道防线）：test/domain-faces-smoke.mjs——括号平衡解析双侧键集（域文件解构键 ⊆ app 注入对象键，9 域全覆盖）+ 跨域引用须有注入依据；契约断言当场抓出一个真实缺口（market 的 exitMarket 解构了但 app 未注入——251 轮手工修复的漏网之鱼）+ 一个命名规范偏差（cdp-regression → cdp-smoke 对齐 -smoke.mjs 统计口径）；全量 134 文件 / 3155 断言。

## [3.44.0] - 2026-11-11

### Added

- CDP 面板回归进 CI（251 轮判据常态化）：test/cdp-regression.mjs——自管 server + headless Chrome 生命周期（端口自避）、12 面板逐个打开断言渲染、console/异常 = 0 硬断言；无 Chrome 环境优雅 skip（exit 0）；CI ubuntu 加 chromium 安装步；进 test-all（全量 133 文件 / 3137 断言含 CDP 3 条）。从此每个 PR 都做运行时验证。

## [3.43.0] - 2026-11-11

### Added

- 拆分后运行时回归与三层注入缺口修复（第 251 轮）：CDP 干净会话逐面板扫描（12 面板）发现并修复拆分系列的**运行时缺陷层**——静态断言全绿但 CDP 实测暴露 26 处注入缺口（getter 块嵌套坍塌：__batch 工厂体吞掉了后续 7 个 getter 声明；域文件解构与调用点漏配：mode/$/el/readJson/AUDIT_RANGES/exitMarket/exitStats/renderQuietSection/watchStopLog/accent 等）；全部桥接修复后 12 面板 CDP 零 console error、面板路由链完整恢复。**判据**：拆分类重构必须有「真实浏览器逐面板零错误」验收，静态断言不能替代运行时验证。

## [3.42.0] - 2026-11-11

### Added

- app.js 拆分系列收官（第 250 轮整五十里程碑）：renderTextView 补迁 panels.js（243 轮遗留——根因「参数解构的 { 被误当函数体起点」已解：提取器先括号平衡再定位函数体）；方案文档收官章（九步数据表：10 域文件/61 函数/-1852 行/44 条断言改动；三次判据升级：注入式→迭代验证式→整域内聚+状态桥接；明确 app.js 剩余 9421 行不再继续拆）。

## [3.41.0] - 2026-11-11

### Added

- app.js 拆分第九步——设置/主题/剪贴板域注入式迁出：5 个函数（applyTheme/applyAccent/applyFontScale/cycleTheme + showClipPanel）整域迁 web/themeclip.js（createThemeClip(ui) 工厂 + __tc() 惰性 getter）；零断言改动（主题断言锚在 extras 的 normalize/resolve 纯函数）；app.js 9442 行（九步累计 -1831）。

## [3.40.0] - 2026-11-11

### Added

- app.js 拆分第八步——doctor/统计面板域注入式迁出：4 个函数（showDoctor/exitDoctor/renderDoctor + showStats 设置与统计大盘）整域迁 web/doctorstats.js（createDoctorStats(ui) 工厂 + __ds() 惰性 getter）；零断言改动——doctor 面板断言全部锚在 extras 纯函数与 app 壳层（236 轮走势条断言读 extras 的 doctorTrendSparks，不受拆分影响）；app.js 9504 行（八步累计 -1769）。

## [3.39.0] - 2026-11-11

### Added

- app.js 拆分第七步——日志/审计面板域注入式迁出：4 个函数（showLogs/renderLogs + logRowHtml/logDetailHtml）整域迁 web/logs.js（createLogs(ui) 工厂 + __logs() 惰性 getter）；**面板 let 状态桥接模式**（8 个 logs* let 变量经 logsState().get/set 注入——245 轮 batchRef 判据推广到多变量场景）；5 条断言更新（hist49/hist92/polish95/runs129）；app.js 9819 行（七步累计 -1454）。

## [3.38.0] - 2026-11-11

### Added

- app.js 拆分第六步——插件市场域注入式迁出：9 个函数（showMarket/renderMarket 系列 + 安装三态流 marketMsg/doMarketInstall/doMarketOp 等）整域迁 web/market.js（createMarket(ui) 工厂 + __market() 惰性 getter——整域内聚模式）；7 条断言更新（market-ui/market122——迁出符号改读 market.js）；app.js 9978 行（六步累计 -1295）。

## [3.37.0] - 2026-11-11

### Added

- app.js 拆分第五步——监控/定时域注入式迁出：14 个函数（showWatchPanel/showTimers/renderTimersRows + scheduleWatch/fireTimer/persistWatch 等 7 主 7 支撑）整域迁 web/watchtimers.js（createWatchTimers(ui) 工厂 + __wt() 惰性 getter——整域内聚后注入面最小化）；10 条断言更新（webui×5/pace177/polish95×2/bookmark180——迁出函数改读 watchtimers.js）；app.js 10233 行（五步累计 -1040）。

## [3.36.0] - 2026-11-11

### Added

- app.js 拆分第四步——导出/分享域注入式迁出：showShareView/showShareImport 迁 web/share.js（createShare(ui) 工厂 + __share() 惰性 getter；window 导出改 wrapper）；残留声明手工清除（调用点替换引擎误替换声明——迭代验证式提取 node --check 立即抓到）；5 条断言更新（table179×2/webshare169 拆分形态）；app.js 10698 行（四步累计 -575）。

## [3.35.0] - 2026-11-11

### Added

- app.js 拆分第三步——面板壳域注入式迁出（refs=0 子集）：15 个零外部状态耦合的纯渲染函数迁 web/panels.js（createPanels(ui) 工厂 + __panels() 惰性 getter）；迭代验证式提取（每删一个函数立即 node --check——renderTextView 删除伤邻居被自动跳过，renderDiffBody 实为 diffResults 内部物）；app.js 10765 行（累计 -508）；4 条断言更新（webui×2/density53×2）；方案表第 3 步 refs=0 层完成。

