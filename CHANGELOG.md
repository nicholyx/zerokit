# Changelog

## [Unreleased]

（下一版攒着）

## [1.71.0] - 2026-11-07

### Added
- 主题对比度系统化审计：新增 `scripts/contrast-audit.mjs`（44 组合：两档主题 × 六强调色 × fg/fg-dim/ok/warn/bad/line/accent 文字与焦点环，正文 ≥4.5、非文本 ≥3.0）并进 `lint.sh` 拦截回归；修复暗色分隔线（#262c36→#5b6575）与亮色分隔线（#dbe2ec→#7c8899）不可辨、亮色 ok 绿（#0b8a4b→#07703c）差 0.08 不达标；亮色档六强调色全部启用深色变体（如 amber #f0b43c→#7d5400）——白底文字对比从 1.6~2.7 提到 ≥4.5，暗色档保持原亮值不动。

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

## [1.67.0] - 2026-11-07

### Added
- 插件生命周期闭环：`zkit plugin info <id>`（版本/动作/风险构成/配置痕迹/最近流水，--json 机读）、`plugin remove --dry-run`（预览将删目录/失去动作/--purge 清单/依赖方警示）、`plugin doctor <id>`（单插件体检：清单问题+依赖+配置权限+失败率）、`plugin reinstall <id>`（自带源一键重装）、`plugin bundled` 装完输出上手摘要（每插件动作数/风险/试跑命令）；全局 doctor 新增 settings/*.json 权限审计（0600 合规，按插件归属点名，Windows 跳过）。

- OS 级深链 `zerokit://插件.动作?字段=值`：桌面壳注册协议（macOS Info.plist / Windows+Linux 运行时注册），点击唤起壳并直达动作详情页（参数预填、不自动执行）；`zkit deep-link` 链接生成器（目标校验 exit 1、secret 参数明文警告）；Web UI 二维码双形态（网页链接 / zerokit:// 链接）；未知深链目标回列表并提示；`doctor` 报协议注册状态

## [1.66.0] - 2026-11-07

### Added

- HTTP API 面系统化：`/api/version` 独立端点（协议版本 api:1）；`/api/health` 扩展体检（插件计数/运行中任务/数据目录大小）；`/api/openapi.json` 机读描述（OpenAPI 3.1 子集）；全端点 method 校验（405 + Allow 头，方法表 33 端点与代码分支双向对齐）；错误响应统一 `{ok:false,error,hint}` 信封（46 处收敛）；`docs/reference/http-api.md` 全端点文档

## [1.65.0] - 2026-11-07

### Added

- 脚本化与自动化：`zkit exit-codes` 退出码契约速查（0 成功 / 1 值得重试 / 2 不要盲目重试）；`run --stdin <参数名>` 密钥走 stdin 不进 shell history；`--timeout <秒>` 覆盖清单超时；`--retries N --retry-delay S` 失败重试；`--format '{{ms}}ms {{rows}}行 {{key}}'` 轻模板输出
- 并发锁：同插件同动作互斥（`~/.zerokit/locks/`），等待约 20 秒、陈锁（>1 小时）可抢、`--no-lock` 逃生
- `zkit cron add/list/rm/run`：定时任务登记（0600 原子写）与补打；接线交给系统调度器（crontab / 任务计划程序），zkit 不自带守护进程；`docs/guide/scripting.md` 脚本化指南

## [1.64.0] - 2026-11-06

### Added

- 项目门面：仓库 topics（15 个真实关键词）与 description 校准（五个面 + 桌面壳 + 迭代/测试规模）；README 快速开始改用点分简写、补 Release 版本徽章、「下载安装包」节（三平台资产表 + 免构建 npm 路径并列）、「参与贡献」节（十条军规引用）；overview「一句话现状」重写对齐一百六十一轮

## [1.63.0] - 2026-11-06

### Added

- 维护者工具：`scripts/release-chain.sh` 发布链一条龙——CI 轮询（12 checks / 11+MERGEABLE 捷径）、merge 复核、tag 双确认与幂等保护、https→SSH remote 网络降级、release 资产等待；`feature <PR>` / `release <版本> <PR>` 两模式，`--dry-run` 干跑。CI-FAIL 即停（固化 v1.59.1 事故判据）

### Fixed

- 修复 `release-chain.sh` 在非 UTF-8 locale（CI 的 macOS runner）下 `$VER` 紧邻全角字符被 bash 3.2 读成更长变量名而报 unbound variable 的问题——变量与中文之间一律加大括号，并加 C-locale 回归测试；同时把 release 模式的分支守卫移到一切远端操作之前（detached HEAD 上误跑不再可能真推分支）

## [1.62.0] - 2026-11-06

### Added

- CLI：`zkit data usage`（数据目录分项容量表，`--json` 机读）与审计规模/最老记录年龄一行
- CLI：`zkit data junk`（垃圾识别：.tmp-* 安装残留、无清单孤儿目录、超保留数快照、.bak 审计备份只列不删）与 `zkit data clean`（默认干跑，`--yes` 真删，审计/历史/设置/.bak 不碰）
- CLI：`zkit data snapshots`（快照清点+大小，超 10 份提示清理）
- doctor：数据目录超 100 MB 时警告并指向 `zkit data usage / junk`

## [1.61.0] - 2026-11-06

### Changed

- 依赖养护：npm 三包（@modelcontextprotocol/sdk 1.32.2 / smol-toml 1.9.1 / pinyin-pro 3.29.5）、cargo minor-patch 组、GitHub Actions 依赖组与 setup-node 4→7 全部升到位（三平台 CI 全绿验证）

### Added

- CLI：`zkit completion bash|zsh|fish` 三 shell 补全——40+ 子命令、`run` 的点分动作候选（含 sysinfo.overview 全量）、`bookmark run/rm` 书签动态候选（新增 `zkit bookmark names` 机读端点）、`--keep` 枚举与常用旗标候选；zsh 版去除 python3 运行时依赖
- 修复：bash 补全的 `run` 候选此前因模板插值错误静默为空（写的是 `$(subsRunPlugins)` 字面量而非 `${…}` 插值），本轮修为构建时展开

## [1.60.0] - 2026-11-06

### Added

- 启动器：`?` 速查浮层全局化——任何页面（含动作详情/日志/集市）可唤起，并新增「当前状态」区（上下文/列表密度/排序/主题，看速查即知当前态）；键盘流段收口第五十二/六十九/七十轮全部键位（F/T/Y/E/X/M/d/r/Ctrl+./Ctrl+R 等）
- 启动器：列表→详情→返回的滚动位置记忆（虚拟列表多帧渲染后恢复，离开前的位置不再丢失）
- 启动器：命令面板占位文案升级——提示可搜动作、插件、页面与命令，`?` 键直达速查表

