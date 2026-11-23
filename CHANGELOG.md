# Changelog

## [Unreleased]

### Added

（下一版攒着）

### Changed

- 抖动治理终判口径固化（39 run / 代码面 2.6%）：flaky-stats **内置平台面剔分**（非 success 的非聚合 job 全 cancelled → 平台面；聚合 job「CI 总览」排除——它会被子 job 连带判 failure）；当前分类：b98d562=第五源已修（408 修复后代码面 0 失败）、33d4998=平台面 cancelled（三 attempt 日志 blob 不存在=从未启动，rerun 无效——**不要无限 rerun**，下一 commit 的 run 做健康证据）；终判线改为**代码面 <3%**（当前 2.6% ✓，差 1 run 满 40 出正式终判）。

- 抖动治理正式终判（flaky-stats 样本满 40 run：整体 5.0% / **代码面 2.5% < 3% 终判线——压降被数据证实 ✓**，对照治理前基线 8.5% 降幅约 70%）；分类计：代码面 1（b98d562=第五源，408 修复后 0 失败）+ 平台面 cancelled 1（不计入）；后续规则——代码面连续 2 次超 3% 再复盘，平台面持续剔除。

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

## [5.5.0] - 2026-11-23

### Added

（下一版攒着）

### Fixed

- .zerokit-source.json 漂移治理（404 收尾线索深查出的存量红线违规）：`plugins/quick/.zerokit-source.json` 自 119 轮入库——**HEAD 版本含本机绝对路径 `/Users/liangyuxiang/...`**（「不提交本机路径」一票否决红线，guard146 只查 Markdown 没查入库 JSON，存量漏网）；且 `type:dev/path/installedAt` 全是本机安装现场（scaffold README 自己都建议加 .gitignore——quick 当初漏了）。修复：从 git 移除（保留本地）+ `.gitignore` 加 `plugins/*/.zerokit-source.json`；**guard146 红线扩到入库 JSON**（`git ls-files *.json` 扫 `/Users/` `D:` `C:\` 一票否决——自测 staged 一个含路径的 evil JSON 被当场拦下 exit=1，清理后恢复）；guard146-smoke +2 断言（红线扩 JSON / gitignore 兜底），顺带把补断言时自己差点写出的 `|| true` 恒真改成 node --check 真语法断言——401 护栏自查通过；基线 3602→3605。

## [5.4.0] - 2026-11-23

### Added

- 抖动治理数据验收基建（400 复盘「后续三条」之二落地）：scripts/flaky-stats.mjs 统计口径固化——**严格按 createdAt 切分**（本轮实证人工按行序 awk 切分会误判：gh run list 只保证整体倒序，锚点 commit 不在窗口内就整段算错——第一遍把 397 之前的 4 个失败误算成「之后」，时间戳切分纠正为 397 后 8 run 零失败）；基线落盘 platform-pitfalls：**治理前 106 run / 9 失败 = 8.5%**，治理后 8 run / 0 失败（样本不足不终判）；待办标记——满 40 run 后重跑终判，<3% 才算压降证实，未达标回四源清单找第五源。
（下一版攒着）

## [5.3.0] - 2026-11-23

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

