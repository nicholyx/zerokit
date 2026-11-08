# Changelog

## [Unreleased]

### Added

（下一版攒着）

## [3.1.0] - 2026-11-09

### Added

- 搜索历史独立导入导出：CLI `zkit config searches export/import/list/clear`（searches.json 文件真源，CLI 面读写）；UI 日志页 chips 区加「⬆ 导入历史」按钮（File input → searchesMerge → localStorage，与 CLI 同一信封格式）；合并语义与 pushSearch 一致（置顶去重、8 条上限、非数组拒绝）；新纯函数 searchesExport/searchesMerge。

## [3.0.0] - 2026-11-09

### Added

- 结果页签键盘闭环（Alt 修饰层，与行 j/k 区分）：Alt+j/k 页签间移动、Alt+x 关闭当前（跳过固定项）、Alt+p 固定切换、Alt+c 与相邻页签对比；活跃页签挂 aria-current="page"；速查浮层新增 Alt 组行（I18N 两语）；无页签时 Alt 系静默忽略不抢浏览器行为。

## [2.9.0] - 2026-11-09

### Added

- j/k 键盘导航终端级一致性：列表 browse 态新增 j/k 移动（此前只有 ↑↓/数字选）与 g/G 首尾跳（vim 惯例）；三处（列表/表格/面板）统一「到尾停 + scrollIntoView nearest 跟随」；键位速查浮层同步（↑↓/j k 合并行 + g/G 行，I18N 两语）；补修 184 轮回归——zk-closing 出场态只在 CSS，JS 关闭路径（closeDrawer）从未挂类，现经 zkExit 统一出口；五个过时断言修正（123② 断言的 json-foldable 已被 154 轮树渲染替代、185⑥ 全局禁令收紧到 hb 徽标、187② 线色值纠正 #848f9f、199⑤⑥ 注记迁移 CHANGELOG 头部）。

## [2.8.0] - 2026-11-09

### Added

- 设置持久化审计（第七审计线）：persist-audit.mjs 进 lint（localStorage 写点 vs BACKUP_GROUPS 覆盖，孤儿键=0 断言）；收编 10 个孤儿键（ai-assist/batchconc/ldensity/tdensity/textview.wrap/sortmode/timeline-collapsed/clip-hist/cmdhist/last-zshare——此前导出备份会丢这些设置）。

## [2.7.0] - 2026-11-09

### Added

- 桌面壳与 CLI/启动器一致性巡检：托盘「打开设置」从跳回首页改为真正打开设置抽屉（openDrawer 挂 window 供壳 eval 调用）；热键对照表 docs/reference/desktop-keys.md（全局 Alt+Space 系 vs UI Ctrl 系分层审计原则——两层永不交叉）；Cargo/main.rs 补版本语义注释（壳号即内核号，release-prep 五处同步保证）。

## [2.6.0] - 2026-11-09

### Added

- 热路径性能优化（perf-guard 护栏下）：filterRows 的 hay 构造从 Object.values+map+join 换成 for-in 累加——10k 快 12%、50k 快 41%（省三次中间数组分配）；resultQuery 的比较符正则提升到模块级（热路径零重编译）；highlightSegments indexOf 扫描经 profiling 确认已最优，显式不动。

## [2.5.0] - 2026-11-09

### Added

- 插件模板出版级质量：默认 summary 升级为「什么时候用」句式（消除 L01，new 出厂即 lint 100/100）；zkit plugin new 打印「下一步三条」（dev/lint --score/run 真跑验证）；scaffold-smoke +3（三档模板零告警/三步清单/出厂可跑）；cli68 ⑧ 断言随新文案更新。

## [2.4.0] - 2026-11-08

### Added

- 依赖健康与供应链巡检（第六审计线）：scripts/dep-audit.mjs 进 lint（幽灵依赖/lockfile 一致/许可证白名单三护栏）；npm audit 修复 5 项漏洞（2 high：body-parser DoS、zod 内存耗尽；3 moderate）现 0 高危；docs/reference/dependencies.md 依赖对照表（每个依赖一行为什么）；Cargo.toml 逐条用途注释。

## [2.3.0] - 2026-11-08

### Added

- 性能回归防护网：scripts/perf-guard.mjs 进 lint——highlightHtml/filterRows 10k 项 <10ms/次、CLI 冷启动 <300ms 三预算断言 + O(n²) 参照实现自检（证明预算真实有效，非恒过）；基线快照补预算表。

## [2.2.0] - 2026-11-08

### Added

- 项目故事文档 docs/guide/story.md（第 200 轮整轮里程碑）：为什么做/三个关键决策（无构建/数据可抛弃/annotations 不可信）/走过的弯路（弯路全变护栏）/里程碑年表 20 节点/数据总览（引用基线快照）/v2 线路线与新贡献者起点；docs 导航与 README 均已链入。

## [2.1.0] - 2026-11-08

### Added

- v2 线治理基线：新增 SECURITY.md（漏洞报告私密渠道+响应时限+版本支持）与 SUPPORT.md（支持矩阵+求助路径）；CONTRIBUTING 增「治理」段（决策规则/语义化承诺）；docs/reference/baseline-v2.md 基线指标快照（冷启动 99ms/130 文件 3054 断言/13 插件 52 动作）+ scripts/baseline-snapshot.mjs 生成脚本（--check 检测版本漂移）。

## [2.0.0] - 2026-11-08

### Added

- 修复：welcome80 MCP 探针在 Windows runner 冷启动竞速下偶发超时（60s→120s + 三次重试）。

- v2.0.0 里程碑总检：安全（MCP annotations/沙箱 env/打码/0600）、性能（冷启动 90-110ms、list 100ms）、文档（check-docs/生成器）、测试（130 文件 3052 断言、--shuffle 两轮、失败注入验证、慢用例 top5<24s）、发布链（release-prep 干跑、guard146、lint 三审计、对比度 44 组合、i18n 0、FFFD 0）五维度全过。

