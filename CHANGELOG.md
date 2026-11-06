# Changelog

## [Unreleased]

（下一版攒着）

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

## [1.59.1] - 2026-11-06

### Added

- **`zkit run 插件.动作` 点分简写**——文档里大量 `run sysinfo.overview` 写法此前实跑报用法错（只认两段形式），现在两种写法等价；报错也点名插件本体（`nothere` 而非 `nothere.x`）
- **文档旅程一致性审计**——quickstart/README/START-HERE/man/cookbook 的命令逐条真跑校准：README 安装命令补 `--yes` 说明（交互确认是设计但文档没提）、quickstart 补点分简写说明、man 十二个核心命令与实现全对齐

## [1.59.0] - 2026-11-06

### Added

- **哨兵通知：`run --notify <cmd>`**——`--alert` 不满足时把稳定格式的告警行（`[ALERT] 时间 | 命令 | 规则 | 实际值`）经 stdin 交给外部命令（发邮件、写 IM、接 webhook 都行）；通知命令失败不吞告警（提示后仍 exit 2）；`--notify-file <path>` 变体追加写文件；与 `--watch` 可组合
- **审计保留策略：`logs --keep 30d`**——过期审计行删除前整体备份到 `logs/audit-<日期>.bak`，幂等可重跑（`permanent` 全保留）；坏行/无时间戳行保守保留
- **doctor 报审计规模**——记录条数与最老记录年龄（保留策略的决策依据）

## [1.58.0] - 2026-11-06

### Added

- **JSON 面板：大结果的结构浏览与路径定位**——交互模式 JSON 树视图（对象/数组折叠展开、叶子类型四色着色），节点悬停显示 JSON 路径、点击复制；大数组（>100 项）默认折叠为「N 项」占位、按需展开；深嵌套（>8 层）默认折叠深层；KV 视图旁「表格 / JSON 树」切换（按动作记忆）；JSON 视图态复制按钮复制格式化全文（issue #521）
- **CLI：`--path` 作为 `--jq` 的同义别名**——路径定位的直觉命名，交互模式定位后提示「已定位：路径」

## [1.57.0] - 2026-11-06

### Added

- `plugin lint` 质量分：`--score` 出 A–D 等级与改进建议 top3；`--all` 批量体检全部已装插件（分数升序，先修最上面的）；`--rule L13` 按规则号过滤；`--json` 附 score/grade
- `plugin doc` 头部带质量徽标（`质量：A（98/100）`），动作超过 6 个时自动生成目录（`--no-toc` 关闭）
- `plugin new` 模板注释段新增体检指引（lint --score / doc 两条命令）；plugin-spec 新增「常见症状 → 规则号」反查表

## [1.56.0] - 2026-11-06

### Added

- `plugin lint` 新增 L13–L20 八条规则：enum 参数缺 options（error）、chain 步骤 use 语法与被引动作的 output 声明（error）、chain 模板别名引用（error）、python 动作 encoding 提示（info）、timeout 合理区间（warn）、`{setting.x}` 引用未声明设置项（error）、`[[service]]` 缺 port/pidFile 检测手段（warn）、重复 action id（error）——把最近二十轮踩过的清单坑变成安装前的机器检查。

## [1.55.0] - 2026-11-06

### Added

- 首次运行引导：裸 `zkit` 在空数据目录（TTY）显示三步引导页（装示例插件 → 跑第一个动作 → 起界面），每步带可直接复制的命令，已完成的步骤打勾折叠；非 TTY 环境降级为三行纯命令清单（脚本可消费）
- `zkit hello`：随时查看引导进度（完成态实时检测）
- `zkit --skip-onboarding`：写 `~/.zerokit/.onboarded` 标记（0600 原子写），之后裸 `zkit` 回到紧凑帮助
- `zkit doctor --first-run`：只查引导相关三件事（插件装没装 / 历史非空 / server 日志存在），与完整 doctor 区分；未完成 exit 1，可接脚本

## [1.54.0] - 2026-11-06

### Added

- 首次运行引导：空数据目录下裸 `zkit`（TTY）显示三步引导页（装插件/跑动作/起界面，完成步打勾折叠，命令可直接复制）；非 TTY 输出三行脚本友好命令清单
- `zkit hello`：随时查看三步进度（完成的打 ✓）
- `zkit --skip-onboarding`：跳过引导并记住（`~/.zerokit/.onboarded`，0600）
- `zkit doctor --first-run`：只查引导三件事的轻量体检（全完成 exit 0，否则 exit 1）
- `run --diff`：与上次同命令执行的结果对比（基线按命令指纹存 `~/.zerokit/baselines/`；首行提示首次执行）
- `run --alert '表达式'`：结果断言哨兵（`列>80`、`值=x`、`ms<500`；满足 exit 0，不满足 exit 2 带实际值——脚本/定时任务可直接当条件用）
- `run --watch N --diff`：轮询中无变化的轮次不再刷屏（打点表示活着）
- `zkit ui --log`：server 请求日志落 `~/.zerokit/logs/server.log`（启动行含端口与 pid；请求行 method path status ms，query 参数剥掉——脱敏）
- `zkit logs server [--tail N] [--follow]`：查看/跟读 server 日志

## [1.53.0] - 2026-11-06

### Added

- `zkit history` 新增 `--grep <词>`（命令行子串过滤，含旗标值）与 `--since Nd/Nh/today`（时间档过滤），与既有 `--plugin/--action/--today/--json` 自由组合
- 新增 `zkit bookmark`：常用命令组合起别名沉淀——`add <别名> <历史编号|命令行> [--note 备注]` / `list [--json]` / `rm` / `run`；存储在 `~/.zerokit/bookmarks.json`（0600 原子写）
- `zkit history --rerun-last`（`!!` 同义）：一键重跑最后一条成功命令
- `zkit history` 默认视图现在展示失败条目（✓/✗ 标记），非交互终端追加「一键重跑」提示行

