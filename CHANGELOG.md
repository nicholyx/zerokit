# Changelog

## [Unreleased]

### Added
- 新增 `zkit commands` 一行式命令索引（分类节 + 常用旗标），比 `--help` 全文扫读快
- 新增 `zkit alias add/rm/list` 用户级短命令（`zkit top` → `zkit run sysinfo top --head 3`），0600 存 `aliases.json`；重名、内置命令名、指向别名均拒绝
- `zkit run` 用法错误时附「相关命令」联想段（同类别命令，如 run → list · show · doctor）
- `zkit version` 与 `--version` 同义（此前只有旗标形态）

（下一版攒着）

## [1.79.0] - 2026-11-07

### Added

- 执行反馈与进度：执行中实时计时（200ms 刷新，完成定格 4 秒）+ 长任务安抚提示（>2s「重活」/>8s「可能卡住」）
- 结果卡耗时徽标「⏱ 340ms」：成功失败都显示——失败耗时是诊断线索
- 快慢徽标：与同动作历史均值比（<80% ⚡ 快于平常 / >130% 🐢 慢于均值；不足 2 次样本不判）
- 批量执行单项进行中计时（增量反馈，不等整批完成）
- 监控点阵每点悬停显示该次采样耗时
- CLI：run 结束 stderr 尾行「⏱ 22ms」（--quiet/--json/--pipe/--format 模式不打）

## [1.78.0] - 2026-11-07

### Added

- 表格视图进阶：列头悬停即时统计（N 项/均值/最小~最大/Σ，数值列专属）
- 表格视图进阶：可见列 ≥4 时冻结首列（横向滚动 sticky，首列阴影提示）
- 表格视图进阶：列显隐面板批量动作——全选/只看数值/仅主键（全隐兜底保主键列）
- 表格视图进阶：行点击高亮记忆（同一表格内翻页/排序/重画保留，再点取消）
- 表格视图进阶：表格工具栏「N 行 × M 列」尺寸徽标


### Added

（下一版攒着）

## [1.77.0] - 2026-11-07

### Added

- 结果区文本工具：顶层文本结果（string data 与 stdout）自动进文本视图——等宽不转义、行号列可关、>200 行默认折叠、换行开关持久化、点击/Shift 范围选行 + Enter 复制原始行、字符/行数/最行长统计条、URL 自动可点、复制三形态（原文/带行号/首行做标题）、另存 .txt（第一百七十五轮）。

## [1.76.0] - 2026-11-07

### Added

- 插件配置向导：设置抽屉新增「插件配置」入口与 `#/config` 面板——按插件列出配置完成度（N/M 已设置、缺哪些必填）；`#/config/<插件>` 表单化填写（secret 走掩码输入、enum 下拉），必填缺口与类型/枚举/数值范围校验在输入时就报，全过才亮「保存」（走既有 `/api/plugin/config`，不新开写侧）（第一百七十四轮）。
- CLI↔UI 互指引：`zkit config <插件> list` 与 doctor 的「缺少必填设置项」提示都附 `#/config/<插件>` 深链（第一百七十四轮）。

## [1.75.0] - 2026-11-07

### Added

- 键盘手册：`?` 打开的全量快捷键手册，单一数据源（KEYMAP 35 条）渲染，支持搜索过滤与按域 tab（全局/跳转/列表/详情/结果/批量/面板），同域同键冲突红标（第一百七十三轮）。
- 快捷键总闸：设置抽屉新增「键盘快捷键」开关，整体关闭后除 `?` 与 Esc 外全部失效；关闭态按被禁键在状态行给出一次性指引；状态落盘 `zerokit.keys.master` 并进备份/恢复的「外观与设置」组（第一百七十三轮）。

## [1.74.0] - 2026-11-07

### Added

- `release-prep` 归档后自动补回规范空壳段（`[Unreleased]` + `### Added` 占位）——三次「条目落错段」事故的根因（归档正则把 Unreleased 头一并吃掉）就此消除；`verify-remote` tag 子模式修复（此前 `tag` 被当分支名报歧义）、`cat-file` 结果可见；`release-chain` 总览延迟判断收敛为函数；help/man 补 `bundle`/`bookmark`/`share` 用法段。

## [1.73.0] - 2026-11-07

### Added

- 命令集 bundle 与 CHANGELOG 锚点根治：`zkit bundle create <名字> [--from|--all]` 把书签打包成 `.zbundle` 命令集（指纹与 .zshare 同口径）；`bundle list/diff/apply` 查看/与本机书签三桶对比/导入（重名自动加后缀不覆盖、重复导入无新增）；坏包拒绝文案与分享包同风格；typo 引导 bundl→bundle。**CHANGELOG 三次条目错段事故根治**：release-prep 空 [Unreleased] 段自带 `### Added` 占位（插条锚点不再漂移），guard146 新增「[Unreleased] 段缺分类头即 FAIL」断言（负例验证过）。


### Added

## [1.72.0] - 2026-11-07

### Added

- 主题对比度系统化审计：新增 `scripts/contrast-audit.mjs`（44 组合：两档主题 × 六强调色 × fg/fg-dim/ok/warn/bad/line/accent 文字与焦点环，正文 ≥4.5、非文本 ≥3.0）并进 `lint.sh` 拦截回归；修复暗色分隔线（#262c36→#5b6575）与亮色分隔线（#dbe2ec→#7c8899）不可辨、亮色 ok 绿（#0b8a4b→#07703c）差 0.08 不达标；亮色档六强调色全部启用深色变体（如 amber #f0b43c→#7d5400）——白底文字对比从 1.6~2.7 提到 ≥4.5，暗色档保持原亮值不动。

## [1.71.0] - 2026-11-07

### Added

- Web 端 .zshare 分享闭环：结果区新增「分享包」下载（与 CLI buildSharePack 同构，read 带结果）；设置抽屉「导入分享包」（选文件→校验→展示：动作/时间/来源环境/指纹/结果预览，「来自分享包」徽标视觉区分）；导入包可本机重放（read 直接跑、mutate 弹确认、destructive 显示拒绝原因不可点）；Web 端指纹走 WebCrypto SHA-256（与 CLI 同结果）；新增 `/api/share/import` 端点（校验+审计 share-import）；坏包拒绝文案与 CLI 同源。

## [1.70.0] - 2026-11-07

### Added

- 结果分享与团队协作：`zkit share <插件.动作> [--params JSON] [--note] [--qr]` 生成 `.zshare` 分享包（结果+重放命令+环境指纹，read 动作带结果、mutate/destructive 只带命令）；`zkit run --from-share <file>` 一键重放（destructive 直接拒绝、mutate 要 --yes、插件不在本机给装法）；`zkit share --view <file>`（指纹+环境+命令，--markdown 出可贴 issue 的摘要）；`--qr` 出块状指纹（两台机器比对是否同一份分享包）；伪造/缺字段/版本不符的包都拒绝并说人话。

## [1.69.0] - 2026-11-07


### Added

- `zkit why <报错原文>`——把报错翻译成「发生了什么 + 下一步敲什么」，与 Web 错误知识库同源（同一份 ERROR_BOOK，CLI 侧 createRequire 转发 import）；`--last` 直接解释最近一条失败记录；认不出诚实说 exit 1 并给排查方向；`--json` 机读 {kind,cause,next}。
- `zkit config <插件> env`——生成脚本里引用设置项的环境变量引导（bash `export` / `--shell fish` `set -x`），值恒掩码只给键名；`--json` 机读。
- `zkit logs --errors`（同义 `--failed`）——审计日志只列失败记录。
- 修复：审计日志里 `decision=allow` 但带 `error` 字段的记录此前显示绿色 ✓，现按失败红 ✗。

## [1.68.0] - 2026-11-07

### Fixed

- Windows 上 `plugin reinstall` 把自带插件误判为非自带源（`URL.pathname` 在盘符路径上产出 `/D:/…`，`existsSync` 恒 false）——改走 `fileURLToPath`；`doctor` 的桌面壳探测同款问题一并修复。`plugin info` 的风险构成从「read 3」改为机读友好的 `read:3`。

