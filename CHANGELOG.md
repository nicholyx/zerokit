# Changelog

## [Unreleased]

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

