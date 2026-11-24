# Changelog

## [Unreleased]

### Added

（下一版攒着）

## [5.14.1] - 2026-11-24

### Added

（下一版攒着）

### Changed

- 抖动治理进度更新（监控期 10 run / 代码面失败 1 = fe9ffc5 那次 bcast 时序残留，PR #1275 已修——修复后的后续 run 连续全绿，「连续 2 次超 3% 回清单」未触发，继续观察）。

## [5.14.0] - 2026-11-24

### Added

（下一版攒着）

### Changed

- 例行健康全查（405 红线治理后首个：guard/test/lint/FFFD 全绿）+ 抖动监控期样本 7 run（fe9ffc5 代码面失败 1 次=bcastfilter298 时序边界残留，PR #1275 已修——427 规则的「连续 2 次超 3% 回清单」在验证中）。

## [5.13.1] - 2026-11-24

### Added

（下一版攒着）

### Fixed

- bcastfilter298 等待窗口二次修正（428 轮 Windows CI 抓到 426 修正的边界残留）：广播发生在 tool 执行完成后（mcp.ts 成功路径），Windows 慢机 sysinfo 全量扫描可超 12s——426 的等待循环 40×300ms=12s 不够，超时即回退到老 bug（第二次距第一次广播 <2000ms 被节流丢弃）。扩到 60×500ms=30s。

## [5.13.0] - 2026-11-24

### Added

（下一版攒着）

### Changed

- 抖动治理监控周期启动（426 终判后新周期从终判 PR merge 2026-11-23T22:22Z 起从零累计）：首检 1 run / 代码面 0 失败；监控命令 node scripts/flaky-stats.mjs 2026-11-23T22:22:04Z 落 platform-pitfalls——代码面连续 2 次超 3% 即回五源清单复盘，平台面 cancelled 持续剔除不计入。

## [5.12.1] - 2026-11-24

### Added

（下一版攒着）

### Changed


- 抖动治理正式终判（flaky-stats 样本满 40 run：整体 5.0% / **代码面 2.5% < 3% 终判线——压降被数据证实 ✓**，对照治理前基线 8.5% 降幅约 70%）；分类计：代码面 1（b98d562=第五源，408 修复后 0 失败）+ 平台面 cancelled 1（不计入）；后续规则——代码面连续 2 次超 3% 再复盘，平台面持续剔除。


### Fixed

- bcastfilter298 时序根因修正（PR #1265 Windows run 抓到 408 修复的边界残留）：节流窗从**服务端第一次广播时刻**起算，测试从**发出**起等固定 3200ms——Windows runner 上 sysinfo 处理可超 1200ms，第二次到达时距第一次广播 <2000ms 仍被丢。改为**等到 filteredBroadcasts ≥1（第一次广播确已发生）再等 2400ms（窗口+20%）**——不靠猜处理耗时；本地连跑 3 次全绿。

## [5.12.0] - 2026-11-24

### Added

（下一版攒着）

### Changed

- CI 并发取消策略评估落地（422 归因的第六源——实为消抖特性非缺陷）：ci.yml 已有 concurrency（group=ref, cancel-in-progress），abandoned 语义即「过时 run 被取消」；**消费侧修正**——release-chain.sh 的 poll 把 abandoned 视为过时继续轮询（真正的 fail 仍硬失败，v1.59.1 防线不变），CI 总览不再因消抖误报 CI-FAIL；六源清单升级（第六源标记为「消抖特性」）+ 判据落 platform-pitfalls。

## [5.11.0] - 2026-11-23

### Added

（下一版攒着）

### Changed

- 抖动治理进度更新（flaky-stats 样本 33 run / 1 失败 = 3.0%——正好贴 <3% 终判线，差 7 run 满 40；408 第五源修复后连续 0 失败）。

## [5.10.0] - 2026-11-23

### Added

（下一版攒着）

### Changed

- 抖动治理进度更新（flaky-stats 样本 30 run / 1 失败 = 3.3%——逼近 <3% 终判线，差 10 run 满 40；408 第五源修复后连续 0 失败）。

## [5.8.0] - 2026-11-23

### Added

（下一版攒着）

### Changed

- 抖动治理进度更新（flaky-stats 样本 27 run / 1 失败 = 3.7%——已逼近 <3% 终判线；408 第五源修复后连续 0 失败；仍 <40 run，下轮有望终判）。

## [5.7.1] - 2026-11-23

### Added

（下一版攒着）

### Changed

- 抖动治理进度更新（flaky-stats 样本 23 run / 1 失败 = 4.3%——408 第五源修复后连续 0 失败；仍 <40 run 未终判；样本更新随纯文档轮顺手记录，不专门立轮）。

## [5.7.0] - 2026-11-23

### Added

（下一版攒着）

### Fixed

- 入库现场残留审计（405 红线治理的全仓复核——git ls-files 扫 /Users/liangyuxiang、installedAt、D:\ 全量）：命中全部为合法引用（代码逻辑运行时写入落用户数据目录/帮助文案里的 Windows 示例路径/判据文档事故记录），**真违规 0 处**；405 的 guard146 红线扩入库 JSON 保持现状（按字符串值开头判定不误伤帮助文案）；.zerokit-source.json 已 gitignore 兜底——本机现场残留清零，审计结论落 platform-pitfalls。

## [5.6.0] - 2026-11-23

### Added

（下一版攒着）



### Fixed

- 抖动第五源修复（flaky-stats 样本 15 run / 1 失败——b98d562 归因）：bcastfilter298 的 demochain 广播被**默认节流 2000ms** 丢弃——测试等 2600ms 后发第二次 tool-call，CI 慢机实际间隔可缩到 <2000ms → B 永远收不到（397 四源清单外的**跨请求节流竞态**）；节流余量 2600→3200ms（>2000 窗口 +50%）；platform-pitfalls 四源清单升级**五源**（标题与表格同步）

- changelog-add 写条目工具（308/405/408 三次「锚点误插已发布段」人工事故的机器化根治）：node scripts/changelog-add.mjs <分类> '条目'——只在 [Unreleased] 段内操作（先切出段再找分类段，绝不匹配已发布版本）；新段按分类顺序插入；占位行自动替换；changelogadd409 4 断言（占位替换/段内新建/旧段不动/追加空行分隔）。

