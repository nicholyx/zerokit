# Changelog

## [Unreleased]

### Added

（下一版攒着）

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

## [1.99.0] - 2026-11-08

### Added

- MCP 面文案一致性巡检：新增 scripts/mcp-copy-audit.mjs 进 lint（JSON-RPC 实连 tools/list，四类护栏：工具数量/描述尾注结构/destructive 高风险句式/「命令」术语语境白名单）；复核 53 工具描述全部合规。

## [1.98.0] - 2026-11-08

### Added

- CLI 文案一致性巡检：术语统一（书签/bundle 的「命令」→「动作调用」——动作是清单声明的可执行单元）；主帮助补「相关命令」段（与子命令同语言）；新增 scripts/cli-copy-audit.mjs 进 lint（旧术语清零/退出码语义/--no-color 无 ANSI 三类护栏）。

## [1.97.0] - 2026-11-08

### Added

- 可访问性巡检第三波（14 轮设计重构后回归）：a11y-scan 新增三条规则（tabindex 正数/aria-hidden 含焦点元素/focus-ring 令牌覆盖率）并进 lint 护栏；逐动画核对 reduced-motion 全停覆盖（18 种动画）；roving tabindex 无正数确认。

## [1.96.0] - 2026-11-08

### Added

- AI 工作台视觉收编令牌体系：用户消息 accent tint + 右对齐双重编码（与助手区分不靠色单一维度）；流式输出/工具输出接 --code-* 令牌；头部/输入区分隔线、meta 时间戳脱离硬编码色（tabular-nums）；新增空会话态。

## [1.95.0] - 2026-11-08

### Added

- 结果表格精修：表头 sticky 底色/2px 下边框/600 字重令牌化；斑马纹 fg 3% 两主题复核；选中行加左缘记号（inset 3px accent）；汇总行 2px 上边框+12% tint 与数据行明确区隔；KV 表键列等宽 34%。
- 代码/命令输出令牌化：--code-bg/fg/cmd 三变量（暗默认+亮色纸面覆写），pre.out/cmd-line 全部脱离硬编码色。

