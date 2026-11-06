# Changelog

## [Unreleased]

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

## [1.52.0] - 2026-11-05

### Added

- `zkit run --calc 新列=表达式`：计算列（已有列名、数字与 `+ - * /`，可加括号；如 `--calc 内存MB=内存/1048576`）。
- `--where 条件`：行过滤，三形态 `列>5` / `列=值` / `列~子串`，可重复按序应用。
- `--rename 旧列=新列`：显示层列改名（不影响 `--json` 原始数据）。
- `--pipe "shell 命令"`：表格文本经 stdin 接外部命令（如 `--pipe "grep -i mac"`）；与 `--quiet`/`--json` 互斥。
- 输出旗标组合顺序固定并在 `--help` 说明：jq → where → calc → rename → pick → sort → uniq → head → sum → pipe；负例（未知列/除零/坏表达式）都带「→ 怎么改」提示。

## [1.51.0] - 2026-11-05

### Added

- 压测脚本 `scripts/stress.mjs`：并发 8 动作（seq 无串台）、失败混入审计不丢行、3×2MB 大输出并行（溢出落盘各自独立）、3 进程并发写审计无交叉半行；`--quick` 最小档供测试调用。
- `scripts/bench.mjs` 补稳定性段：4 并发轻量探针（avg/max 耗时），完整压测指向 stress.mjs。
- `test/stress147-smoke.mjs` 10 项：并发/审计原子/落盘独立性实测 + 事件委托与 interval 配平的泄漏判据静态断言（addEventListener 数字不是泄漏判据——重建式渲染里旧节点随 innerHTML 整体 GC）。
- 修复大输出溢出落盘的竞态：spill 流 `end()` 不等落盘就 resolve，CLI 路径立即退出时 2MB 级文件还在内核缓冲里，下游读到 0 字节（并发 3×2MB 实测第 3 个文件 0.0MB）——现在挂 finish 回调再返回。

## [1.50.0] - 2026-11-05

### Added

- 质量护栏十项（人肉纪律机器化）：CHANGELOG 格式断言（[Unreleased] 空行三次事故的根治）进 lint.sh；文档测试数字同步断言（overview/START-HERE 与 test/ 实际文件数一致）；docs 本机绝对路径红线扫描；START-HERE 版本行 === package.json 断言；`scripts/verify-remote.sh` push 后远端复核 + tag 前双确认（对象存在 + 远端 main HEAD）；U+FFFD 扫描进 lint.sh；提交信息 subject 与 body 必须空行分隔

## [1.49.0] - 2026-11-05

### Added

- deep 文档补全：新增《插件运行时》（进程模型/占位符参数级展开/常驻宿主原理与适用边界/超时与输出上限两层硬顶/审计流）与《安全边界》（风险三档威胁模型/MCP 授权链路/供应链快照能与非能/沙箱声明能与非能/密钥明文的诚实说明）两篇深读文档；index 导读页坑位替换为真链；quickstart 与 plugin-spec 补交叉链；已知差距表销账

## [1.48.0] - 2026-11-05

### Added

- `plugin new --from <目录>`：从现有插件清单复制起步（自动换 id/name），适合「照着 quick 写一个」的场景
- `plugin lint` 每条告警附「怎么改」修复指引（L01–L12 全覆盖）
- `plugin doc --md <file>`：文档直接落盘，不用重定向
- `plugin publish-ready` doctor 式逐项汇总（清单/版本/risk/描述/打包 5 项 ✓/!/✗）
- `plugin pack` 出目录不存在自动创建；无 README 的插件打包时自动补一份生成的文档
- 模板质量提升：新插件首跑 `plugin lint` 即零告警（补长 description、match 示例）；cookbook 新增「发布前自查清单」一节

## [1.47.0] - 2026-11-05

### Added

- CLI 输出与体验打磨：`--help` 头部加分节索引与 `zkit man` 指引；未知命令建议附一句话说明；修复 `list --json` 不带 `--brief` 时机读旗标被吞的缺陷，brief 补 `lastRun` 字段（审计驱动）；`doctor --fix` 执行后补「修了什么/没修什么」摘要；长表格（>50 行）末尾提示 `--head N` / 管道翻页；`config` 概览每插件补「最近用到」相对时间；`allow add` 授权前显示风险人话与实际动作名

## [1.46.0] - 2026-11-05

### Added

- 移动与窄屏体验：≤720px 详情页底部拇指操作条（← 返回 / ▶ 执行，safe-area 适配）；列表惯性滚动 + 窄屏隐藏滚动条；触屏目标 ≥44px；无键盘设备隐藏快捷键提示条；列表下拉刷新手势（64px 阈值松手触发）；720–1080 过渡区「展开双栏」提示条；表格可横滑渐隐提示（首次滚动消失）；命令面板窄屏全屏化；hover:none 下悬停效果退化为按压效果。新增文案全部走 I18N 双语键

## [Unreleased]

（下一版攒着）

## [1.45.0] - 2026-11-05

### Added

- `plugin lint` 新增 L13–L20 八条规则：enum 参数缺 options（error）、chain 步骤 use 语法与被引动作的 output 声明（error）、chain 模板别名引用（error）、python 动作 encoding 提示（info）、timeout 合理区间（warn）、`{setting.x}` 引用未声明设置项（error）、`[[service]]` 缺 port/pidFile 检测手段（warn）、重复 action id（error）——把最近二十轮踩过的清单坑变成安装前的机器检查。


- 新增「最近活动」面板（#/activity）：审计数据驱动的执行健康时间线——成功率/平均耗时/最慢动作统计卡、逐条执行行（失败可展开错误摘要）、按插件过滤、慢执行（>1s/>3s）分档着色；命令面板与设置抽屉双入口

