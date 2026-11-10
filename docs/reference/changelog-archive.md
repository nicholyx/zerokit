# 变更日志归档（v0.2.0 起）

> 早期版本的全部条目。近期版本见根目录 [CHANGELOG.md](../../CHANGELOG.md)。

## [3.10.0] - 2026-11-09

### Added

- 服务生命周期安全收口：startService 补 run 命令来源校验（argv[0] 必须是已知工具或插件目录内路径——防越界命令）；/api/services/start 补审计（decision + reason，与 CLI stop 同语言）；UI 面板停止/重启按钮确认守卫；面板 5s 自动刷新运行状态。

## [3.9.0] - 2026-11-09

### Added

- 服务生命周期闭环（启动/重启补全）：[[service]] 新增 run 可选字段（启动命令 argv）；zkit service start/restart 子命令（start 走审计）；/api/services/start POST 端点；UI 面板启动/重启按钮（canStart 门卫）；重复启动防护；clipboard 服务补 run 字段。

## [3.8.0] - 2026-11-09

### Added

- services 面板与后台服务生命周期：CLI `zkit service list|status|stop 插件.服务`（与 UI 同一存储，stop 走审计）；server /api/services GET 端点 + OpenAPI；UI #/services 面板（服务表+停止按钮，复用 ps 面板形态与全站令牌）；命令面板「服务面板」入口 + 抽屉链接；I18N zh/en 全键。

## [3.7.0] - 2026-11-09

### Added

- 动作参数校验强化：plugin.toml 参数新增 min/max（数字范围）/pattern（字符串模式）可选字段；coerceParam 转换后统一 validateConstraints（越界/不匹配在确认前 fail，错误带合法值说明）；MCP inputSchema 透传 minimum/maximum/enum/pattern（模型可调用前自校验）；脚手架 chain 模板 value 参数示范 min/max；param215-smoke 新文件 8 断言；plugin-spec.md 字段表更新。

## [3.6.0] - 2026-11-09

### Added

- 可复现构建审计（第八审计线）：scripts/repro-check.mjs 进 lint（engines 覆盖 CI Node/Cargo.lock 在库含桌面壳条目/package-lock 非空三断言）；docs/reference/reproducibility.md 审计记录（npm ci 干跑过、cargo audit 本机未装记为已知差距）。

## [3.5.0] - 2026-11-09

### Added

- 缓存面板与命中统计：zkit cache stats/prune/clear [--older-than] 三子命令；/api/cache GET/DELETE 端点；UI #/cache 面板（条目表+命中统计瓷贴+剔除/清空）；命中计数落盘 cache-stats.json（CLI/server 双面累计 hits/misses）；I18N zh/en 全键。

## [3.4.0] - 2026-11-09

### Added

- UI 执行路径接缓存（三面闭环收官）：/api/run 接 TTL 缓存（与 CLI 共用 result-cache.json——CLI 跑过 UI 秒回）；响应带 cacheHit 标记 → UI 结果卡显示「⚡ 缓存」徽标；详情页只读动作显示「强制刷新」复选框（勾选传 fresh）。

## [3.3.0] - 2026-11-09

### Added

- 只读动作 TTL 缓存：CLI run 同参数 10s 内秒回（⚡ 缓存徽标 + --fresh 跳过 + ZEROKIT_CACHE_TTL=0 关闭 + 写类永不缓存）；缓存命中走同一输出管线（--copy/--out/--format 不因缓存丢失——cli45/148 两个测试抓到后修正）；cacheKey/cacheHit/readResultCache/writeResultCacheEntry 纯函数层（数据目录 result-cache.json，20 条上限）；UI 面 resultCacheKey/Hit 同语义纯函数。

## [3.2.0] - 2026-11-09

### Added

- 设置抽屉搜索定位：抽屉顶部搜索框（输入即过滤七大区，命中区显示/其余隐藏）；命中计数徽标「N / M 区」；无匹配区隐藏即空态；Esc 清空恢复；/ 键抽屉内聚焦搜索框；匹配含中文子串+首词前缀；纯函数 drawerSearchMatch/Count 可测。

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

## [1.94.0] - 2026-11-08

### Added

- 设置抽屉扫视结构升级：各区组头锚点条（accent 左缘 2px）、区间间距 --sp 令牌化；「分类清除」危险区红缘子卡隔离（视觉即语义：这一区碰了不可逆）；抽屉打开组从上到下 stagger 入场（400ms 摘除）。

## [1.93.0] - 2026-11-08

### Added

- 面板与搜索交互一致性：键盘提示从 foot 移入占位符（输入法打字时不低头看脚注）；面板选中项 accent 左缘与搜索列表同语言；面板 foot 增加结果计数；历史 chips/分组头双入口同样式令牌化；窄屏面板全宽贴底。

## [1.92.0] - 2026-11-08

### Added

- 三态（加载/空/失败）语言统一：骨架屏令牌化（--skeleton-base/shine）+ shimmer 渐变位移（取代 opacity 闪烁）；骨架屏从列表推广到集市/日志/自检三个异步视图；新增三档 spinner（sm/md/lg）；集市请求失败给「↻ 重试」明确入口（非纯文字）。

## [1.91.0] - 2026-11-08

### Added

- 集市与安装流视觉信任：集市卡来源标记双编码（🏪 图标+集市名）；安装钮升级 primary.mini 主钮分级；预览卡确认语义（accent 边框+浅底明确「安装前最后一步」）；安装三态反馈图标化（⏳ 进行中/✗ 失败带原因）。

## [1.90.0] - 2026-11-08

### Added

- 数据可视化令牌化：--viz-* 五件套（线宽 1.5px/点径/网格/空态/填充）统一 sparkline、趋势线、统计条；图表容器内边距接 --card-pad。
- 热力色阶语义化：透明度按值内插 0.25→0.95（颜色强度与高度双重编码数值）。
- 空数据可视化态：零值趋势给「空态基线」（灰线+暂无数据标注）而非纯空白。

## [1.89.0] - 2026-11-08

### Added

- 浅色主题独立校准：边框体系按「白底物理隐喻」淡化（--line #7c8899→#848f9f，非文本 ≥3 达标且视觉更轻）；代码块/命令行亮色独立配色（暖白纸面+深墨字，非暗色直翻）；文本层级全表对比度复核（fg 15.68 / dim 5.89 / 语义色全部 ≥4.5）。
- 主题切换无闪烁：color-scheme 同步原生控件、meta theme-color 同步浏览器框底色。
- 新增 scripts/contrast-audit.mjs 进 lint.sh（44 组合全过护栏化）。

## [1.88.0] - 2026-11-08

### Added

- 表单输入细节打磨：输入框 hover 先于 focus 渐显（可预期性）；必填项双重标注（label * + 左缘细条）；占位符焦点隐去推广到全部输入框；select 自绘箭头（appearance:none + SVG，双主题）；checkbox/radio accent-color 统一；输入令牌 --input-pad；textarea 等宽排版。

## [1.87.0] - 2026-11-08

### Added

- 卡片体系令牌化：五类卡（结果/插件/统计/集市/仪表盘）边框统一走 --card-border；可点卡片悬停态统一（accent 渐显边框+背景微亮，无位移）；仪表盘磁贴取消 translateY 位移对齐全站原则。
- 徽标语义表：risk 三色/健康四态全部走语义变量（--ok/--warn/--bad/--accent）+ 同色 12% tint 底；排印统一（11px/500/胶囊/tabular-nums）。
- 统计卡数字层级强化（19px/650 + tabular-nums）。

## [1.86.0] - 2026-11-08

### Added

- 弹层体系统一：入场动效全部走 zk-pop-in（scale 0.97 + 下移 8px 基准）与 --ease-spring 曲线；新增 zk-closing 出场态（150ms 渐隐下移）；遮罩微失焦（backdrop blur 2.5px）。
- 确认框风险强化：destructive 档红缘+⚠ 前缀、mutate 档琥珀缘；命令面板选中项 accent 左缘、输入区分隔弱化；更多菜单对齐圆角/阴影/动效令牌。
- 顶栏反馈统一 setCount 出口：内容变化轻渐入、错误文案自动标红（err）/成功绿（ok）。
- 修复：批量替换把 setCount 函数体内的赋值也替换成自调用导致无限递归——所有顶栏反馈静默失效（CDP 首轮暴露，全量回归抓到）。

## [1.85.0] - 2026-11-08

### Added

- 详情页信息层级重排：动作名主标题 21px/650，插件归属行弱化、徽标行节奏统一，描述限宽 62ch。
- 参数表单精修：聚焦 accent 双环、label 间距接 --sp 令牌；风险条双重编码（斜向刻度条纹+色，色弱可辨）；结果区等宽行高节奏；分区标题令牌（左缘 accent 记号）；动画曲线全面接 --ease/--ease-spring/--ease-out 令牌。
- 修复：风险条内联 background 简写覆盖了 CSS 刻度条纹——改 background-color 后条纹生效。

## [1.84.0] - 2026-11-08

### Changed

- 首屏英雄化：搜索框字号 16→17px、聚焦光晕收拢、静息呼吸光晕（prefers-reduced-motion 下停）；Esc/⌘P 等键位提示升级为胶囊样式。
- 开屏编排：首次加载一次性入场序列（顶栏→搜索→列表 stagger），之后的 DOM 重建不回放。
- 列表行 hover 统一（边框渐显+背景微亮，无位移）、顶栏分隔弱化、结果卡头部字级层级、空态插画微光。
- 修复：completion159 / workbench 两个冒烟测试在带空格的 node 可执行路径下崩（桩脚本未加引号）。

## [1.83.0] - 2026-11-07

### Changed

- 视觉语言重铸第一轮：默认强调色由 SaaS 蓝换为「钛青」（暗色 #3fc4c4 / 亮色 #0e7d80，白底对比达标），强调色档位重排，海水蓝保留可选、新增钛青档。
- 形制令牌化：四档圆角令牌（--r-sm/md/lg/xl）取代 178 处零散 border-radius，三层阴影令牌（--shadow-1/2/3）暗亮两套。
- 焦点环统一：所有可交互元素 focus-visible 使用双环令牌（外强调色内底色），暗亮主题一致可见。
- 正文行高 1.55→1.6，品牌字重 650 / 字距 .3px 微调。

## [1.82.0] - 2026-11-07

### Added

- 书签与快速到达：动作详情页 ◉ 一键钉住（含当前参数快照，别名 pin-插件.动作），命令面板 `>` 前缀直达书签分组，顶栏 ⭐ 徽标常驻计数。
- 书签管理页 `#/bookmarks`：表格列出名称/命令/创建时间，支持一键重跑（走 /api/run，结果页内联展示）与删除（带确认守卫）。
- 书签与 CLI 双向同步：UI 钉住即写入 bookmarks.json（与 `zkit bookmark` 同一存储），新增 /api/bookmarks GET/POST/DELETE 三个端点并入 OpenAPI。

## [1.81.0] - 2026-11-07

### Added

- 表格工具栏新增 ⬇ 导出：CSV / Markdown 按当前可见列与筛选结果导出，带元信息头（动作名·时间·行数）；复制 CSV 一键进剪贴板
- 新增分享深链 `#/share/<id>`：表格结果生成只读分享视图（来源信息 + Markdown 表 + 「自己跑一次」），24 小时过期，生成时自动清理过期分享

### Fixed

- 修复结果查询框（整表查询，如 `size>100`）输入不生效的缺陷：事件绑定作用域是 `.tbl-wrap`，而查询栏渲染在其外——改为绑定最近结果容器

## [1.80.0] - 2026-11-07

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

## [1.70.0] - 2026-11-07

### Added

- 结果分享与团队协作：`zkit share <插件.动作> [--params JSON] [--note] [--qr]` 生成 `.zshare` 分享包（结果+重放命令+环境指纹，read 动作带结果、mutate/destructive 只带命令）；`zkit run --from-share <file>` 一键重放（destructive 直接拒绝、mutate 要 --yes、插件不在本机给装法）；`zkit share --view <file>`（指纹+环境+命令，--markdown 出可贴 issue 的摘要）；`--qr` 出块状指纹（两台机器比对是否同一份分享包）；伪造/缺字段/版本不符的包都拒绝并说人话。

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

### Added

- **JSON 面板：大结果的结构浏览与路径定位**——交互模式 JSON 树视图（对象/数组折叠展开、叶子类型四色着色），节点悬停显示 JSON 路径、点击复制；大数组（>100 项）默认折叠为「N 项」占位、按需展开；深嵌套（>8 层）默认折叠深层；KV 视图旁「表格 / JSON 树」切换（按动作记忆）；JSON 视图态复制按钮复制格式化全文（issue #521）
- **CLI：`--path` 作为 `--jq` 的同义别名**——路径定位的直觉命名，交互模式定位后提示「已定位：路径」

（下一版攒着）

## [1.45.0] - 2026-11-05

### Added

- `plugin lint` 新增 L13–L20 八条规则：enum 参数缺 options（error）、chain 步骤 use 语法与被引动作的 output 声明（error）、chain 模板别名引用（error）、python 动作 encoding 提示（info）、timeout 合理区间（warn）、`{setting.x}` 引用未声明设置项（error）、`[[service]]` 缺 port/pidFile 检测手段（warn）、重复 action id（error）——把最近二十轮踩过的清单坑变成安装前的机器检查。


- 新增「最近活动」面板（#/activity）：审计数据驱动的执行健康时间线——成功率/平均耗时/最慢动作统计卡、逐条执行行（失败可展开错误摘要）、按插件过滤、慢执行（>1s/>3s）分档着色；命令面板与设置抽屉双入口

## [1.44.0] - 2026-11-05

### Added

- **MCP 资源面第三波（只读快照）**：新增 5 个 resources——`zerokit://runs`（最近 20 条执行：时间/动作/成败/耗时/caller）、`zerokit://runs/<插件.动作>`（该动作最近 10 条）、`zerokit://audit`（最近 30 条审计含 denied 与决策理由）、`zerokit://watch`（监控注册表快照）、`zerokit://timers`（定时任务与下次触发，paused 标注）；resources/list 每个资源带一句人话 description；未知 URI 的报错列出全部可用资源（此前只说「不认识」）

## [1.43.0] - 2026-11-05

### Added

- **插件能力速查卡**：插件主页顶部新增风险构成（只读 N · 变更 N · 高风险 N）与关键词 chips（点击直达搜索）；动作行补参数摘要（必填/可选/🔑 密钥标记）、🖥 带界面徽标、上次执行相对时间（无记录显示「还没跑过」）；「复制 doc」按钮与导出能力清单共用同一份 Markdown（含参数摘要与界面标注）

## [1.42.0] - 2026-11-05

### Added

- **定时任务执行历史**：每次触发落盘一条（时间/成败/耗时/输出快照 2KB/触发来源 auto·manual·catchup），每任务封顶 20 条；`zkit timers history <key> [N]` 人读、`zkit timers list --json` 增 `lastRuns`；面板历史弹层合并持久史与会话史，失败条目行首红点、输出快照与错误可展开；`GET /api/timer-runs`

## [1.41.0] - 2026-11-05

### Added

- **集市装机自检**：安装完成后立刻挑一个「只读且零必填参数」的动作真跑一次，把「装上了」和「装上且能跑」区分开（运行环境缺依赖、清单命令在本机不存在，此前要到第一次执行才暴露）；安装反馈带自检结论与耗时；详情页「⋯ 更多」加「🔍 装机自检」随时重跑；无可自检动作（全 mutate/全必填）显式说明跳过原因，自检绝不产生副作用；`POST /api/plugin/selfcheck`；安装按钮三阶段进度（拉取校验 → 落盘 → 自检）

## [1.40.0] - 2026-11-05

### Added

- **备份与恢复面（完整迁移一台新机器）**：插件清单进备份信封（id/来源/版本）；导入预览三类视图（可恢复键 / 需重装插件 / 不随备份走的运行态）；插件配置随备份走且 secret 值不落盘（键名规则 + 服务端明文不可得双保险）；导出文件名带插件数（`zerokit-backup-YYYYMMDD-HHmm-Np.json`）；导入后自动恢复配置 + 按来源装回插件并给恢复报告；CLI `zkit backup --out` / `zkit restore --file [--dry-run]`

## [1.39.0] - 2026-11-04

### Added

- 桌面壳健壮性第二波：记忆位置落在已拔掉的显示器上时钳回主屏；托盘菜单加「重新载入界面」与开发者工具（debug 构建）；tooltip 显示版本与端口；窗口标题带版本号；单实例守卫（二次启动聚焦已有窗口）；接入 autostart 插件（能力已授权，UI 开关随后续版本）；壳内启动检查新版本并在抽屉出升级横幅（断网静默）

## [1.38.0] - 2026-11-04

### Added

- 深读层自学化起步：`docs/deep/design.md` 补导语块/篇内目录/三处「记住这条」callout/尾部交叉链，新增 `docs/deep/index.md` 导读页；check-docs 新增 deep 代码块 `file=` 标签路径校验

## [1.37.0] - 2026-11-04

### Added

- 监控面板自刷新：采样计数/变更次数/相对时间/成败点阵 2 秒节流就地更新，不用重进面板（此前面板显示的是打开那一刻的快照）
- `zkit doctor --trend`：最近 8 次体检的错误/警告趋势表与判读（错误升/警告升/平稳）
- `doctor --json` 与启动器环境自检页新增 `trend` 字段（rows+verdict），CLI 与 UI 三处同源

## [1.36.0] - 2026-11-04

### Added

- 监控通知链路补全：变化通知带 5 分钟节流与点击跳转 `#/watch`，无权限时降级面板提示；`#/watch` 面板新增「通知记录」小节（最近 10 条，静默/节流状态可追溯）与「静默时段」设置（HH:mm，支持跨午夜）；每个监控可单独开关通知（默认开，随 watch.json 持久化）
- `zkit watch list [--json]`：读 `watch.json` 输出监控明细（interval/runs/changes/lastChanged/notify），机读友好
- `zkit doctor` 带监控在册数与通知权限说明

## [1.35.0] - 2026-11-04

### Added

- 详情页深耕（第一百三十一轮）：参数默认值徽标（有 default 且未预填时标注）、enum/select 取值提示行、动作健康徽标（近 20 次成功率 ✓/⚠/✗/新）、插件信息条（版本 · 来源 · 装于）、依赖状态行（插件依赖/命令依赖）、上次执行卡补耗时、secret 参数 👁 明文切换（autocomplete=off）、超 6 行长描述折叠（展开全部/收起）。

## [1.34.0] - 2026-11-04

### Added

- 命令面板打分 v2：拼音/首字母缩写/中文子序列兜底命中，每条结果显示命中信号徽标（精确/前缀/拼音/最近…）。
- 面板最近使用：用过的小幅加权不压过精确命中；顶部最近 chips 一键重查；空态显示「共 N 条命令 · M 个动作」计数。
- 面板支持无前缀 `插件.动作` 直达详情（`;` 前缀语法保留）；Esc/遮罩关闭把焦点还给触发前元素；面板宽度自适应内容（上限 720px）。

## [1.33.0] - 2026-11-04

### Added

- `zkit runs` 执行历史消费面：`list`（最近 N 次一览，`--limit`/`--json`）、`show <序号>`（单条完整 + `--replay` 走完整执行链路含风险确认）、`export`（JSONL 导出）、`gc --days N`（保留近 N 天，`--yes` 执行）。
- `doctor` 新增 `historyStore` 段：执行历史条数/字节/最老一条时间。
- 启动器日志详情给出「CLI 重放」命令行；`Ctrl+R` 快速重放最近一次执行（确认弹层）。

## [1.32.0] - 2026-11-04

### Added

- `mcp tools --markdown`：工具清单导出 Markdown 表（AI 客户端接入文档直接贴）
- `mcp allow --dry-run`：显示将授权什么（动作/风险/TTL/将执行的命令）但不落盘
- `mcp status` 授权到期预警：3 天内到期的条目标 ⚠ 并汇总续期命令——授权悄悄过期是「AI 突然全失败」的头号原因

### Changed

- 大结果截断提示附恢复路径（「完整结果：CLI 加 --full…」+ 约略行数）——模型被截断后知道怎么拿全量
- 并发护栏（busy）附当前在途计数与按拥挤度换算的等待毫秒
- 工具描述中 enum 参数的取值展开（如「取值 2 | 8 | 10 | 16」）——模型不再猜取值范围

## [1.31.0] - 2026-11-04

### Changed

- 测试提速：删掉 batch98/devweb86/doctor84 三个测试里「起前台 ui server 挂满 timeout」的病灶（全量 29 分钟 → 2 分钟）；`--retry` 退避测试加 `ZEROKIT_RETRY_MS` 钩子，测试内 10ms 档
- `scripts/test-all.mjs` 新增 `--changed`：按 git diff 与 IMPACT_MAP 只跑受影响的测试（test/ 文件映射自身；scripts/.github 基建改动走全量并说明）
- CHANGELOG 瘦身：主文件只保留近 12 个版本段，更旧的搬进 `docs/reference/changelog-archive.md`（一次性迁移 70 版）；`release-prep` 归档时自动执行搬运
- 新增 `scripts/README.md`：七个脚本各一句话说明与维护约定

### Fixed

- 测试套件防进程增殖护栏：测试文件内禁止再 spawn 跑测器（曾因自递归 spawn 指数增殖 node 进程拖垮整机）；maint127-smoke 加自检断言锁死

## [1.30.0] - 2026-11-02

### Added

- 设置项 `min`/`max`：清单级校验（类型不符/区间倒置/默认值出域报错）+ 运行时拦截（「port 不能小于 1024（收到 80）」）
- `zkit config diff`：只列改过的设置（「8080 → 9000」），`--json` 机读
- `zkit config history`：配置变更流水（谁在什么时候把什么从什么改成什么；密钥不落值，500 条上限）
- `zkit config reset <键>`：单键回默认值
- `path` 类型设置的相对路径提示（运行时按插件工作目录解析的 warn）
- 启动器设置区保存后即时刷新（已设置/未设置徽标与新值马上可见，不用关开一次）

### Changed

- `config get --reveal` 安全门：只在本地终端允许——输出被管道/重定向时拒绝（防明文被采集）

### Fixed

- 启动器设置区「已设置/未设置」徽标从 v0.3.0 起恒显示「未设置」——前端读的 `set` 字段从未被 API 提供；本轮补上 `PublicSetting.set`

## [1.29.0] - 2026-11-02

### Added

- `zkit plugin health <插件>`：单插件深度体检——清单错误/依赖缺失/动作风险构成/最近 50 次执行成功率（来自审计；没跑过不冒充 100%）；异常时退出码 1
- `zkit plugin doctor-lost`：失联插件处置（目录在、清单没了）——列出上次来源与两条出路（重装/清掉）；失联事件进安装流水
- 失联插件从正常列表隔离（此前表现为「1 个加载失败」噪音——失联有专门的面，正常浏览不再被干扰）；`plugin remove` 对失联目录有直删兜底
- `zkit plugin remove --purge`：连数据目录里的插件配置一起清（默认保留——「重装即恢复」是既有承诺，全清要显式要）
- `zkit plugin update --check`：只查不装（与 --dry-run 同路）
- 启动器插件主页健康徽标（✓ 健康/⚠ 注意/✗ 异常；悬停看原因摘要）

## [1.28.0] - 2026-11-02

### Added

- `zkit run --profile`：耗时分解三段（spawn / 首字节 / 总时长）——「插件慢是启动慢还是跑得慢」一眼可判；`--json` 同步带 `timing` 字段
- `zkit run --measure N`：只读动作连跑 N 次出对照表（每行三段耗时+中位行标出）；非只读拒绝
- 超时/超限被杀时保留已收到的部分输出（此前整体丢弃——跑了 9 秒的进度日志不该因为第 10 秒超时消失）；CLI `--json` 带 `partial` 字段、结果卡示「被杀前已输出的部分」
- 非零退出码在 CLI（`exit=N` 行）与结果卡可见——此前 data 成功渲染时退出码完全隐形
- 结果卡 stderr 分流：成功时警示输出也折叠示出（此前只在失败卡里）；审计记录带 stderr 前 500 字符（排障最值钱的一段）
- `zkit logs --slow N`：只看耗时超 N 毫秒的执行（慢动作猎枪）；日志行带耗时（慢于 3s 标 ⏱）
- `zkit mcp --dry`：dry-run 的别名（进用法提示）

## [1.27.0] - 2026-11-02

### Added

- 结果区键盘还债：KV 表也进 j/k 选中域（此前只有数据表），Enter 复制适配 KV（取值列）与 Shift+Enter（整行 JSON）
- 长 JSON（浅对象 >40 行）按段折叠——`jsonFoldSpans` 算缩进配对段，details/summary 原生可聚焦可读屏
- 结果对比视图差异行加 ▲ 标记（aria-label「有差异」）——不只靠黄色底色，色弱可辨
- 表头 `aria-sort` 状态（ascending/descending/none）
### Changed

- 速查浮层（? 键）核实已有并保持——本轮不动

## [1.26.0] - 2026-11-02

### Added

- 集市卡片源健康徽标（绿=索引正常 / 黄=超 30 天未刷新 / 红=读不出——浏览时不碰网络，只读本地缓存判断）
- 集市登记表带动作数与风险构成（buildIndex 摊开 actionCount/riskMix：买前看清几读几写几毁；旧登记表无该字段优雅降级）
- 安装成功提示带「查看插件主页」深链按钮——装完第一件事就是去看装了什么
- 插件主页来源行显示集市源仓库地址（market 安装时把集市 URL 记进来源文件）
- `zkit market info <集市名>`：单源详情——登记表逐插件列动作数/风险构成/已装标记；负例带「是不是想找 X」提示
- 集市空态升级为「教一步」引导（怎么把本仓库当集市、market.json 是什么）

## [1.25.0] - 2026-11-02

### Added

- web 插件桥新五条能力：`zkit.getActions()`（动作列表自建菜单）、`zkit.storage`（每插件 64KB KV 宿主代存，sandbox 里没有 localStorage）、`zkit.copy(text)`（走宿主剪贴板）、`zkit.onTheme(cb)`（主题/字号/语言变化即时推）、`zkit.onProgress(cb)`（run 阶段事件 started/done）
- 消息协议新增 storage/copy/theme/run:progress 四组消息（旧页面不认识自动忽略，协议兼容）
- demoweb 演示板扩到十张能力卡；文档 plugin-spec web 节同步五条新 API

## [1.24.0] - 2026-11-02

### Added

- `run --retry N`：只读动作失败后指数退避重试（1s/2s/4s，钳 0–5 次）；非只读动作拒绝该旗标——重试副作用动作等于放大风险
- `run --avg N`：连跑 2–10 次报 min/avg/max 耗时——给性能敏感的动作一个一行结论
- `audit --follow --json`：跟读流改为 JSONL（每行一个对象）；纯 `--json` 快照仍是一次性信封
- `stats --action <插件.动作>`：单动作视角——次数/成功率/p50/p95/最慢/最近一次执行
- `audit --export csv`：审计记录导出 CSV（与启动器日志页导出同口径：ts/decision/caller/plugin/action/ms/error）
- `market doctor`：全部集市源探活——index 读不出红✗、空登记表黄标、超 30 天未更新提示

## [1.23.0] - 2026-11-02

### Added

- 启动器：八个面板（日志/统计/体检/集市/监控/简报/性能/帮助）顶部一句话说明——每个面板自己解释自己
- 帮助中心「三分钟上手」清单：四步（跑首个动作/收藏/换主题/开监控），做一步勾一步，进度存本地
- 帮助中心「内置插件速查」：全部内置插件一句话用途+深链直达插件主页
- 帮助中心主题搜索框：按关键词即时过滤主题
- 统计面板「最近 7 天」一句话趋势（↑/↓/持平，周一起算）
- 监控/定时空态升级为「教一步」引导文案
- doctor 补齐最后两处无 hint 的问题行（设置项读不出/值不合法现在也带怎么办）

## [1.22.0] - 2026-11-02

### Added

- 启动器：设置抽屉新增「存储占用」只读统计（zerokit.* 键的字节数与键数，一眼看清本地数据体量）
- 启动器：结果页签超过 4 个时显示总数徽标，长页签栏不再数不清
- 启动器：详情页头部吸顶（滚动参数表时执行按钮始终可见）
- 启动器：#/perf 性能面板每 2 秒自动刷新（离开面板自动停）
- 启动器：批量执行整篮完成后浮条自动收起，只留汇总卡
- 启动器：固定页签时连同备注一起复制

### Fixed
- 批量执行自 v1.5.0 起每项都被服务端 403 拒绝（请求头名写错 `x-zk-token`，服务端校验 `x-zerokit-token`）——批量从未真正成功跑完过，本次修复并加回归断言
- 批量执行暂停/继续功能因 `shouldPauseBatch` 未导入在前端直接抛 ReferenceError 且被静默吞掉——已在 import 清单补齐并锁死

## [1.21.0] - 2026-11-02

### Added
- 装时快照统一：addFromDir（集市/git/本地目录）与 bundled 安装全部写 `.zk-integrity.json`（此前只有 toolpack unpack 写）——verify/doctor 复验覆盖从部分插件到全部
- 快照带 `at` 时间与 zerokit 版本（追溯装的时候是什么环境）
- `plugin add <目录> --replace`：显式升级（备份式替换，快照随之重建）
- doctor 供应链段显示复验覆盖计数（如「13/13 个插件复验通过」），无快照插件清零

### Fixed
- `plugin pack` 打包时把本机安装来源记录 `.zerokit-source.json` 一并打进 zip——unpack 后 verify 永远报「被删除」，属包装内容污染

## [1.20.0] - 2026-11-02

### Added

- `plugin update --dry-run`：升级前摊开完整 diff——新增/移除动作、参数增删、风险升级、执行体大换血警示，未落盘直接返回
- 升级确认前展示完整 diff（此前只有动作名增删；同名动作的风险升级 read→mutate→destructive 单列 ⚠ 警示）
- rug-pull 检测：同名动作执行体（run 命令）被整体替换 ≥60% 且 ≥2 个时提示「动作名没变、命令全换」
- `plugin history --plugin <id>`：只看单个插件的装/升/卸流水
- doctor 供应链段点名 `plugin.toml 被手改过`（与装时快照对照，改清单比改资源文件危险得多）
- `upgradeDiff` 家族三纯函数（fullUpgradeDiff/rugpullCheck/manifestDrift，src/core/update116.ts）

### Fixed

- 升级 diff 此前排在确认门之后（非交互环境永远看不到就要 --yes）——挪到确认之前，人看着 diff 决定

## [1.19.0] - 2026-11-02

### Added

- 安装成功摘要：装完立刻摊开「N 个只读、N 个会改动、N 个不可逆」与需留意的动作清单（CLI `plugin install`，集市与自带示例两条路径一致）
- `plugin history`：安装/升级/卸载流水（`logs/installed-history.json`，最近 200 条）
- 卸载预览：`plugin remove` 先列出将失去的动作数与反向依赖，并说明持久数据保留
- 市场搜索版本差：已装插件在 `market search` 结果里标 `✓ 已装同版` / `↑ 可升级`
- 升级后参数面提示与新版流水记录（`plugin update` 成功后）
- `upgradeDiff` 等六个安装体验纯函数（src/core/install115.ts）

### Fixed

- 自带示例插件（bundled）安装此前绕过风险确认，非交互环境直接装上——现与集市安装走同一道 `--yes` 门

## [1.18.0] - 2026-11-02

### Added

- 批量篮按动作分份：切换动作自动换篮，各动作篮子互不污染、回来还在
- 批量队列暂停/继续（跑完当前项后停）；行级状态悬停可见失败原因
- 批量清单双格式：`key=value` 与 `--key value` 旗标写法都认，引号含空格、`#` 注释、逐行报错带行号
- 批量导出复制行格式清单；导入支持从剪贴板直接读（动作不存在跳过计数）
- `zkit run --batch <file>` 从文件批量执行（同一套清单格式），逐项 `[N/M]` 进度、汇总行、有失败退出码 1

### Fixed

- 「顺序执行」按钮点击无效：事件监听把 Event 对象当第一参传入，`runBatch` 误入「重跑失败项」分支后因非数组提前返回——自第九十八轮签名扩展起就坏了，CDP 深挖暴露
- 批量浮条在浏览态加入篮子后不换篮：`Alt+点击` 仍写全局单份篮，与详情页换篮逻辑不一致

## [1.17.0] - 2026-11-01

### Added

- 日志页时间范围四档（全部/今天/最近 7 天/最近 30 天），与 CLI `--since` 同语义
- 日志导出 JSON（与 CSV 同筛选：时间范围/决策/插件/关键词全带上）
- `zkit logs --plugin <id>` 按插件过滤；`--since today|7d|30d` 时间范围，附命中统计行

### Changed

- 日志页 CSV 导出补齐时间范围与插件筛选——此前导出会漏掉这两项，导出的不是所见
- 审计筛选统一走 `filterAudit` 纯函数（UI/导出/CLI 同一套语义）

## [1.16.0] - 2026-11-01

### Added

- 搜索结果记忆化：同一搜索词直接命中缓存（列表版本失效），拼音打分不再每次全表重算
- 列表入场动画只在首进/切视图播放，搜索重排与筛选切换不再重放
- 运行状态轮询在非「运行中」视图只更新顶栏胶囊，不再重排隐藏面板

## [1.15.0] - 2026-11-01

### Added

- 搜索结果记忆化：同一搜索词直接命中缓存（列表版本失效），拼音打分不再每次全表重算
- 列表入场动画只在首进/切视图播放，搜索重排与筛选切换不再重放
- 运行状态轮询在非「运行中」视图只更新顶栏胶囊，不再重排隐藏面板
- 应用自更新检查：`zkit update --check|--apply`（GitHub Releases 渠道；apply 只下载安装包到临时目录并给安装指引，绝不静默替换）与 `--json` 机读形态
- 启动器新版本提示条：内核 `/api/update-check` + 前端 24h 节流（「稍后」三天后再提醒、✕ 本次会话不再弹），检查失败静默不打扰
- `doctor` 报告当前版本/最新版本一对（`app.current`/`app.latest`，latest 走 5 分钟缓存不拖慢体检）

## [1.14.0] - 2026-11-01

### Added

- 安装包瘦身：构建时剔除 node_modules 里的类型声明与源映射（`.d.ts`/`.map` 等，Node 22 类型擦除只读 `.js`），生产依赖树 48MB→26MB，安装包体积显著下降
- 桌面壳无 Node 引导页：检测不到 Node.js 时显示平台对应的安装命令（可点击复制）与官网链接，不再只是一行报错
- Node 版本过旧提示：找到 node 但低于 22.18 时给出当前版本、路径与升级命令
- 启动屏显示壳版本号（等待内核时不再是干等）

## [1.13.0] - 2026-11-01

### Added

- **桌面安装包**：Release 现在附带三平台安装包（macOS Apple Silicon dmg / macOS Intel dmg / Windows x64 NSIS exe），全部在 CI 流水线构建（tauri-action，SHA pin），不在本地打包上传。内核（src/web/plugins/生产依赖）随安装包分发，装完即用（仍需本机 Node ≥ 22.18）。

## [1.12.0] - 2026-10-31

### Added

- 错误知识库双语化：ERROR_BOOK 七类错误与兜底的标题/下一步建议支持语言表注入（classifyError(text, T)）；errorReport 报告头改英文（贴 issue 可搜索）；batchSummary 汇总与结果失败徽标双语；白名单净减 20 行。

## [1.11.0] - 2026-10-31

### Added

- 启动器 i18n 还债第七波：操作反馈（复制/保存/导出/打开/检查等 33 键）、面板标题（时间线/简报/监控）、按钮 title 与散点文案迁入语言表；白名单净减 47 行。

## [1.10.0] - 2026-10-31

### Added

- 启动器 i18n 还债第六波：帮助中心六主题、快捷键速查 17 条、页脚 title、散点文案迁入语言表；`data-i18n-title` 机制；修复从面板 hash 导航回列表态不收面板的缺陷。

## [1.9.0] - 2026-10-31

### Added

- 启动器 i18n 还债第五波：搜索「为什么命中」解释表、表格骨架（行数/小计/加载全部）、右键菜单、监控与定时弹窗、导入与对比反馈迁入语言表；whyLabel 支持语言表注入。

## [1.8.0] - 2026-10-31

### Added

- 启动器 i18n 还债第四波：详情页参数表单/历史区/趋势卡、结果操作区二十余按钮、⋯更多菜单、批量篮浮条、监控条全部迁入语言表；英文档详情页与结果区不再中英混排。

## [1.7.0] - 2026-10-31

### Added

- 启动器 i18n 还债第三波：设置抽屉链接、数据/配置档组、统计页、审计日志页、环境自检页文案全部迁入语言表，英文档这些页面不再中英混排；语言切换按钮改单语文案。

## [1.6.0] - 2026-10-31

### Added

- 第一百零二轮（i18n 还债第二波）：列表分组头悬停提示与筛选 chips、空态建议三件套（去集市/问 AI/试试这些）、最近执行/最近搜索标题、监控反馈五条（开启/停止/自动停/告警标题）迁入 I18N；白名单净减 6 行（1344→1338）。

## [1.5.0] - 2026-10-31

### Added

- 第一百零一轮（i18n 还债第一波）：命令面板 15 条命令迁入 I18N（稳定 id 匹配，切语言后历史命令仍可执行）；执行反馈系列（配置档/分栏/布局/字号/范围清除）、收藏反馈、搜索空态标题与指引迁入 I18N；硬编码白名单净减 27 行（1371→1344）。

## [1.4.0] - 2026-10-31

### Added

- i18n 体检工具 `scripts/i18n-scan.mjs`：扫描 web/ 硬编码中文，白名单显式记账（当前存量 1369 处，新增即挂 lint）
- i18n 扫描进 `lint.sh`：新增硬编码中文未登记即失败——负债只减不增的门闩
- 设置抽屉七大区（主题/强调色/字体/语言/AI/数据/分类清除/配置档）文案迁入 I18N 表，英文档完整渲染
- I18N 表区块在扫描器中整体豁免（表是中文文案的家，键对齐由 zh/en 键集断言把关）

## [1.3.1] - 2026-10-31

### Added

- 发布工具自愈：`START-HERE.md` 版本行加 `<!-- zk-version -->` 锚，`release-prep` 锚内替换，句式漂移不再挂 CI（此前连续三个版本挂过）
- `release-prep --check`：发布前第二道保险——锚存在、五处版本一致、CHANGELOG 无重复版本段
- `release-prep` 归档条目守卫与写盘复核升级为五处（含 START-HERE 锚内容）
- `check-docs` 新增锚完整性断言（开闭各一、锚内有版本号）

## [1.3.0] - 2026-10-31

### Added

- 启动器：批量执行实时进度——每项一行状态（排队/并行/完成/失败）+ 顶部「N 排队 / M 并行 / K 完成」计数，失败行点击进详情
- 启动器：批量完成写审计事件 `batch_done`（含各项 ok/ms），审计页可查
- 启动器：运行中面板在批量执行期间显示队列提示
- 启动器：批量条空队列时执行按钮禁用（双守卫）
- CLI：`zkit run --chain "插件.动作,插件.动作"` 跨插件顺序串跑——任一步失败即停；前一步输出经 `CHAIN_PREV` 环境变量传给下一步（插件在清单声明 `env_pass = ["CHAIN_PREV"]` 即可取到）

## [1.2.0] - 2026-10-31

### Added

- 结果表格：数值列人性化提示（整千毫秒→秒、1024 进制字节）与右对齐，同列最大值为底的迷你占比条
- 结果表格：首列连续同值段自动插小计行（段≥2 行且含数值列；>3 行给均值、短段给 Σ）
- 结果表格：右键单元格「只看『列 = 值』」一键等值过滤（小计行不参与）
- 结果区：双击结果标题写 ≤60 字会话注释（📝 徽标）；CSV 导出跟随当前筛选视图

## [1.1.0] - 2026-10-30

### Added

- 启动器：宽屏（>1080px）列表/详情双栏布局，分隔条可拖拽调节宽度（26%–60% 钳制）并记忆
- 启动器：布局三档预设（常规 38% / 宽列表 50% / 宽详情 30%），手动拖拽覆盖预设
- 启动器：双击列表项切换收藏（与星标按钮等价）；长按 Esc ≥600ms 清空搜索回列表态
- 启动器：Ctrl+= / Ctrl+- / Ctrl+滚轮三路统一调结果字号（小/中/大，记忆）
- 配置档：列表密度与布局（preset/pct）随快照走，换档连形态一起换
- 备份：`zerokit.layout.*` 键归入「外观与设置」组，导入导出覆盖布局

## [1.0.0] - 2026-10-30

### Added

- 首跑引导升级为四步：新增「仪表盘」一步（NetBar 一屏看全）；标题下加定位副标题「插件是能力包：一份清单，四个面」
- `zkit doctor` 首行输出版本号（与 package.json 同源；1.x 起附「1.0 稳定线：四面前」定位）

### Changed

- 1.0 收口：全站 25 处空态盘点——每处带 role=status 与下一步指引；README 快速开始链路（market add → search → install → doctor）新目录实测走通；START-HERE 版本号与断言数对齐

## [0.99.0] - 2026-10-30

### Added

- 失败结果卡升级：错误分类徽标（kind 直出）+「📋 复制报错」（分类+命令+环境三行+stderr 全文，贴 issue 一发入魂）
- stderr 折叠展示：默认末 5 行，点开全文（保留原始报错可搜索）
- 失败卡动作名近邻建议：「quick.ts2dat → 是不是想敲 quick.ts2date？」
- CLI 失败输出加分类前缀 `[kind] ⟐ 看起来是：…`（机器与人都能 grep）
- 失败卡上报分类到审计（`kind: fail-class`，fire-and-forget 不打断渲染）

## [0.98.0] - 2026-10-30

### Added

- 详情页「分享深链」升级：secret 字段永不进链接、空值不带、只带表单定义过的键（链接即表单）
- 结果区「📦 快照」导出 `.zkresult.json`：含插件/动作/版本/时间元数据，对方可导入回放
- 抽屉「导入快照」：选择 `.zkresult` 文件回放展示，外来快照标明来源与「重跑将在本机执行」
- 导入校验：非 zerokit 快照 / 缺 result / 坏时间戳各自报错拒绝
- 「调用方式」复制升级：命令块首行带注释 `# 插件名 · 动作名`
- 页面 `<meta name=zk-version>`：启动器壳向页面注入运行时版本（快照信封用）

## [0.97.0] - 2026-10-30

### Added

- `history --today / --plugin <id> / --action <插件.动作>`：执行历史过滤（可组合，`--json` 机读；过滤后 0 条有明确提示不静默）
- `stats` 概览行：总次数、成功率、最常用 top5、最慢 top5——数据早就有，就差摆出来
- 启动器日志页快捷过滤 chip：今天（本地零点锚定，与 CLI 同语义）+ 插件直达

## [0.96.0] - 2026-10-30

### Added
- `zkit which <插件> <动作>`：解析不执行——插件目录/风险/代入默认值后的完整命令行一屏看清
- `zkit env`：ZEROKIT_* 环境变量与数据目录一览（设没设、默认在哪、怎么重置）
- `zkit run --stdin-json`：从 stdin 读参数对象（`echo '{"text":"x"}' | zkit run quick b64 --stdin-json`），坏 JSON/数组/空输入拒绝
- `zkit history --csv`：执行历史导出 CSV（引号转义，直贴表格软件）
- 未知参数名给最近建议（`--tetx` → 「是不是想敲 text」）；`--help` 尾部补退出码语义（0 成功 / 1 失败 / 2 用法错误）；补全脚本覆盖新命令

- 首页仪表盘 `#/dash`：四宫格一屏看全——收藏磁贴（点击直达）/ 最近执行（跨动作 5 条）/ 监控状态 / 今日统计
- 顶栏「NetBar」按钮与命令面板「仪表盘」条目直达
- 三个空态分级引导（无收藏教收藏 / 无历史教跑第一条 / 无监控教开监控）

## [0.94.0] - 2026-10-30

### Added

- MCP 工具描述附健康徽标：最近审计的成功率（✓>90% / ⚠50-90% / ✗<50% / 新）与上次执行结果——AI 客户端选工具前知道「这个工具最近好不好用」
- MCP resources 面（规范原生）：`zerokit://plugins`（插件清单+风险构成）与 `zerokit://health`（体检摘要），只读，未知 uri 拒绝
- `zkit mcp dry-run --explain`：人话版——展开后的完整命令 + 风险含义 + 将写入哪里
- `_meta.server`：服务端版本与运行时长（uptimeSec），客户端不用试探
- 大表格结果摘要升级：「N 行 × M 列（列名…）+ 首行样本」，模型拿到形状而不是断头 JSON
- MCP 并发护栏：同一工具在途 >3 直接返回 busy + retry_after_ms（排队等于双双超时）
- 工具失败响应附 `retry_after_ms`（指数退避：1s 起、连败翻倍、上限 30s）

## [0.93.0] - 2026-10-30

### Added

- `zkit data inventory`：数据目录清单——每类的用途、条数、大小（人话，不是裸 ls），`--json` 机读
- `zkit data wipe --scope <类>`：分类清除（runs/settings/timers/cache/audit），预览先行，`--yes` 才动手
- `zkit data stats`：数据面统计（历史条数/设置数/定时器数/审计大小/最老记录时间）
- `zkit data export-scope --scope <类>`：分类导出清单（只导「有什么」不导内容——隐私面）
- 数据访问审计事件：`data:read` / `data:write` 进同一审计管道（caller 标 CLI/UI/MCP/watch）
- 启动器设置抽屉「分类清除」分组：执行历史/搜索历史/结果快照/定时任务四类，带条数徽标，清前确认

## [0.92.0] - 2026-10-30

### Added

- 插件依赖健康态：`zkit plugin deps <id>` 输出每个依赖的版本与满足状态（版本区间声明接口预留）
- `zkit doctor` 缺依赖报错带「受影响动作数」；新增图级检查——依赖成环直接报错并给出环路径
- `zkit plugin update` 升级顺序提示：被依赖的插件先升（拓扑序），反过来升会留下「新链旧环」窗口
- `zkit market lint` 对 `path:` 本地源提示不可分发（其它机器装不了）
- `plugin deps`/doctor 依赖检查升级为拓扑序与环检测双保险（安装前提示交叉依赖）

## [0.91.0] - 2026-10-30

### Added

- 开发者面板 `#/dev`：dev 链接插件的清单摘要、文件树、沙箱控制台（最近 30 条透传）与文件变更提示
- `plugin dev <目录> --web`：进入 Web 开发模式，提示宿主页地址与沙箱资源即改即生效
- `/api/dev/status`、`/api/dev/poll`：dev 插件探测（symlink）、清单摘要与文件树、变更 stamp 轮询
- Web 沙箱 console/error 经桥透传到开发者面板（`zk-dev-console` 事件，含 warn/error 分级）
- dev 链接下的执行审计标记 `source: dev`，与真实安装来源区分

## [0.90.0] - 2026-10-30

### Added

- 命令面板收录全部页面路由（16+ 条）与操作命令（切主题/切语言/导出备份/清搜索历史），每条带描述与快捷键徽标
- 面板分组展示：空查询按「页面 / 操作 / 动作与插件」分段；非空查询混排打分
- 数字快捷：面板打开时 1-9 直接选中对应序号条目
- Tab 补全：输入前缀唯一匹配时一键补全到完整条目名
- 最近使用记忆：页面与操作命令执行后排前（zerokit.cmdhist 保留 10 条）

## [0.89.0] - 2026-10-30

### Added

- `zkit doctor` 顶部新增三级汇总行（`✗N 项需处理 · ⚠N 项建议 · ✓N 项通过`），CLI 与 Web 同源同句
- 体检历史：每次全量体检摘要落 `~/.zerokit/logs/doctor-history.jsonl`（保留最近 50 条），Web 端展示最近 5 次趋势
- `zkit doctor --diff`：与上一次体检对比，只列新增 / 已解决 / 仍在
- 持续问题标记：同一问题连续出现时标 `⚠ 持续 N 次`（CLI 与 Web）
- `doctor --json` 新增 `summaryLine` / `history` / `diff` 字段

## [0.88.0] - 2026-10-30

### Added

- 失败输出补退出码语义：137/143（SIGKILL/TERM）、2（用法错）、128+n 信号段；未知码不硬猜
- 超时失败显示「实际 N s 撞上 M s 上限」对照与加档/查根因建议
- `history --failed` 每条失败附同动作最近 10 次成功率（偶发/必现一眼可辨）
- chain 失败输出断点位置：「整条链 N 步，断在第 K 步」
- 命令拼写建议升二级候选：首选 + 「也可能是：a / b」

## [0.87.0] - 2026-10-30

### Added

- `zkit data snapshot`：把可迁移配置（设置/授权/定时器/监控）打包成单文件 `.zksnap` 快照，secret 默认脱敏导出（`--with-secrets` 显式携带）
- `zkit data restore <file>`：恢复快照，已存在文件默认跳过（`--overwrite` 覆盖）；恢复前 `zkit data list` 可预览内容清单
- `zkit data diff <file>`：对比快照与当前数据目录（缺/多/改分组）；`zkit data path` 一行打印数据目录

## [0.86.0] - 2026-10-30

### Added

- **插件供应链安全（第八十一轮）**：`zkit plugin unpack --strict` 拒绝无完整性清单的包（默认警告放行，向后兼容旧包）；无签名包装完仍生成装时快照，`zkit plugin verify` 照常复验。
- `zkit doctor` 供应链完整性段：全量复验已装插件，被改动/被删文件的插件点名（`--json` 的 `integrity` 字段机读）；重装即可恢复可验证状态。
- `zkit list --brief` 每个插件带 `installedFrom`（来源类型+地址+日期）——「这个插件哪来的」不用翻数据目录。
- `zkit market list` 来源标签：`[本地]`（path 源）/`[git]`（远端仓库），market add 登记时记录。

## [0.85.0] - 2026-10-29

### Added

- **首次运行体验（第八十轮）**：`zkit welcome`——首次运行显示欢迎语、分级体检摘要（✗N 必须修 · ⚠N 建议 · ✓N 通过）、三步上手（装插件→跑 starter→起界面）、缺工具按平台给安装命令（win32 winget / macOS brew / Linux apt）；回访只报状态增量不重念三步；`--json` 机读（firstRun/summary/starterAction/missingTools/nextSteps）；starter 动作按平台推荐（win32→系统概况 / macOS→当前时间 / Linux→进程概览）；首次标记 `.welcomed` 落盘幂等。
- MCP 内建工具 `zerokit_welcome`：AI 客户端首次接入先调它拿环境摘要与上手路径（structuredContent 机读）；`zkit mcp tools` 列表与 server 同步含此内建项（`--risk`/`--plugin` 过滤时只列插件工具）。

## [0.84.0] - 2026-10-29

### Added

- **监控持久化（第七十九轮）**：监控配置与最近采样持久化到 `~/.zerokit/watch.json`（浏览器写、server `/api/watch` 透传）；页面刷新/重启后配置与 samples 恢复、趋势线不断档；停止记录（原因+时间）一并落盘。
- 监控告警升级：连续失败 ≥3 次时通知升级为告警，正文带前 3 条错误摘要；同动作 10 分钟去重窗口防刷屏。
- `zkit data export [文件]` / `zkit data import <文件> [--no-watch]`：监控配置随备份导出导入，信封兼容第二十轮 collectBackup 格式（监控在 `meta.watch` 分区）。

## [0.83.0] - 2026-10-29

### Added

- **定时器第二波（第七十八轮）**：`days` 日期档——`workdays`（周一~周五）或数字数组（`[1,4]` = 每周一、周四，0=周日）；`zkit timers catchup <key>` 一次性补跑错过的任务（幂等：同一天只补一次，`lastCatchupDay` 记账；`catchup = "skip"` 声明不补）；`zkit timers list --json` 机读格式（含 `nextFireHuman` 与 `missed`）；下次触发时间说人话（今天 09:00 / 明天 09:00 / 周三 09:00，跨周退回 M/DD 绝对日期）。
- 定时器 `run`/`catchup` 的执行结果进审计日志，与手动执行同一条时间线。

## [0.82.0] - 2026-10-29

### Added

- **MCP 面第二波（第七十七轮）**：`zkit mcp tools --plugin <id>` 按插件过滤（无过滤且超 30 个工具时提示缩窄）；`zkit mcp search <词>` 跨插件搜动作；`zkit mcp dry-run <key> --params '<json>'` 参数预演（占位符展开 + 缺参清单）；`zkit mcp allow --ttl 1h|1d|7d|30d|permanent` 授权有效期 + 授权后显示将执行的命令；`zkit mcp status` 看剩余时间；`zkit mcp revoke` 随时撤销。
- MCP CallTool 三个失败分支（tool-not-found / not-authorized / bad-params）全部带 `structuredContent.next_hint`——附近工具名、授权命令原文、dry-run 验证命令，客户端不翻文档就能自纠。
- MCP 授权存储统一：mcp.ts 私有的 mcp-allow.json 桥接 audit.ts 的 allow.json（同一套 ttlDays / -1 永久 / entryAlive 语义），旧文件首次读取自动迁移且迁移不缩权（旧授权给永久）。
- docs/reference/mcp.md 新增「AI 客户端协作（第二波）」节。

## [0.81.0] - 2026-10-29

### Added

- **插件运行沙箱（第七十六轮）**：`[[action]]` 三键声明——`sandbox = true` 钉死子进程工作目录在插件目录（cwd 声明失效，限制优先于便利）；`max_output = "10MB"` 限制 stdout/stderr 合计字节，超限强制结束并报「输出超过 max_output 上限」；`env_pass = ["VAR"]` 环境变量白名单，声明后子进程只看到安全基线（PATH/TMPDIR/HOME 等）+ 白名单变量 + 清单注入，宿主机其余环境变量（API key、代理串）一概不给。
- `zkit doctor` 新增沙箱摘要行（N 个动作目录钉死 / 限输出 / 限环境变量）。
- 插件体检新增 **L12**：声明了 `sandbox` 的动作若在 `env` 里写疑似敏感键（token/secret/password/api_key），警告改走 `[[setting]]` 掩码存储。

## [0.80.0] - 2026-10-29

### Added

- CLI 第七十五轮（结果再加工）：`zkit run` 新增 `--sort 列`（`-列` 降序，数字列数值序）/ `--pick a,b` / `--uniq 列`（保首见序）/ `--head N` / `--sum 列`（表尾 TOTAL 行）五个加工旗标，可组合按序应用；列不存在报错并附可用列清单；加工只影响显示输出，`--json`/`--quiet`/`--out` 拿原始数据

## [0.79.0] - 2026-10-29

### Added

- CLI 第七十四轮（输出与报告体验）：`run --format md|tsv`（Markdown/TSV 表格输出）、大 JSON 结果默认截断 30 行摘要（`--full` 展开；`--quiet`/`--json` 面向管道不受影响）、`--format` 独立旗标（不再与 `--out <file>` 抢解析）

## [0.78.0] - 2026-10-29

### Added

- 启动器第七十三轮（视觉与微交互）：暗色焦点环加发光晕、表格行悬停着色、页签栏溢出横向滚动（≥8 个不再换行）、按钮按压反馈（reduced-motion 下停位移）、暗色滚动条适配、正文链接降噪（悬停才下划线）、文本选中色跟随强调色、空态插画暗色降亮度

## [0.77.0] - 2026-10-29

### Added

- 启动器第七十二轮（上下文与智能默认）：详情页剪贴板感知（复制了网址/数字/路径/时间戳，进表单时建议「填入」对应字段，值定性优先于字段顺序）
- 参数历史 chips：每个字段显示最近 5 次取值（最近优先去重，secret 不显示），点击即回填
- 智能占位符：number 显最小值、url 显 https://、路径显 ~/、时间戳显示例值，不再是无提示的空白输入框
- 表单脏标记：改过的字段左边框高亮 + 标签缀「·改」，恢复默认一并清除
- 确认弹层参数摘要：destructive 确认前列出全部将使用的参数（secret 恒掩码、空值显「用默认」、超 60 字截断）

## [0.76.0] - 2026-10-29

### Added

- CLI：`history --failed` 只看失败记录，逐条附诊断建议（复用 suggest 规则表）。
- CLI：`run --env KEY=VAL` 临时环境变量注入（可多次，只在本次进程生效不落盘）。
- CLI：`plugin dev <目录> --open` 装好即自动验证（清单加载 + 首个只读动作实跑）；`--watch` 目录监听，存盘即重验（防抖 250ms）。
- CLI：`config --json`（无插件参数）机读输出全部插件设置项（secret 恒掩码）。
- CLI：`bench [--quick]` 子命令暴露 scripts/bench.mjs（--quick 只测三条冷启动路径）。
- CLI：`mcp tools --risk <read|mutate|destructive>` 按风险过滤工具列表。

## [0.75.0] - 2026-10-29

### Added

- 启动器：结果区操作连续性——`j`/`k` 选行后 `Enter` 复制整行（TSV）、`X` 导出 CSV、`M` 导出 Markdown、`Ctrl+1..8` 直达结果页签。
- 启动器：动作详情页「上次执行」区新增**重跑**按钮——用上次参数一键再跑（记录里有参数快照才显示）。
- 启动器：结果表格右键菜单——复制单元格 / 整行 / 整表（TSV）。
- 启动器：常用组合建议——历史里做完这个动作最常接着做的动作，在详情页给「接着跑」直达（共现 ≥2 次才显示）。

### Fixed

- 启动器：「上次执行 / 回看 / 分享卡」此前取的是**最旧**一条记录（历史数组首位才是最新），时间与内容都可能对不上。

## [0.74.0] - 2026-10-29

### Added

- 列表分组头版本与动作数徽标化（比纯文字分隔更扫得快）
- 动作行悬停显示参数摘要 tooltip（参数名/类型/必填一行看全，不点进去就知道要填什么）
- 列表态 `[` / `]` 键快速过滤：只看带参数/无参数动作（再按同键回全部）
- 列表态 `.` 键打开当前激活项详情
- 列表排序模式 `m`/`r` 键切换：插件序（默认）/最近使用（按执行时间降序，没跑过的按原序垫底）
- 列表密度三档 `d` 键循环：紧凑（藏描述一屏多看）/舒适/宽松（描述两行）

## [0.73.0] - 2026-10-29

### Added

- `zkit run --jq <路径>`：轻量点路径查询（`.data.ip`、`.items[0].name`、中文键都支持），未命中退出码 1 并说明原因
- `zkit run --out <file>`：结果直接落文件（JSON 两空格格式化、文本写原文），可与 `--jq` 组合
- `zkit list --json --brief` 输出补 `actions` 数与 `riskMix` 风险构成，脚本消费不再二次查询
- `zkit config` 无参数显示全部插件设置状态总览（N/M 已设置 + 缺项标注）
- `zkit history --tail N` 快捷参数
- `zkit plugin new` 新增 `--author` 与 `--description`，生成的清单直接带作者行与一句话简介

## [0.72.0] - 2026-10-29

### Added

- 执行中可停止：runBtn 变「■ 停止」按钮、`Ctrl+.` 全局中断，`/api/stop` 端点杀在途子进程（结果标 `stopped`，审计记 `reason=stopped`）
- destructive 动作 CLI 双重确认：y/N 之外要求输入动作 id 本身，输错即取消
- 同动作并发护栏：同一动作在途时拒绝新执行（防双击/多标签页重入），提示等结束或停止
- `zkit doctor` 新增「N 个动作未声明 timeout（吃默认 60 秒）」警告，附清单写法提示
- 插件 timeout 声明贯通：`RunOptions.signal` 中断外层 http 请求走 `AbortSignal.any` 与超时组合

## [0.71.0] - 2026-10-29

### Added

- 结果页签栏无障碍三件套：role=tablist/tab/tabpanel + 左右方向键切换（焦点随重画回落修复）
- 浮层焦点圈禁（focus trap）：设置抽屉 Tab 循环留在浮层内，Esc 关闭后焦点回触发按钮
- `scripts/a11y-scan.mjs` 静态扫描器（图标按钮 aria-label/页签 aria-selected/对比表 caption/模态 role 五类反模式），进 lint.sh 门禁

### Fixed

- 第二十三轮以来新增的模态缺 role="dialog"（批量补齐）；页签 ✕/✎、篮子 ✕ 等纯符号按钮补 aria-label
- prefers-reduced-motion 停动画补漏（cell-changed 闪、监控倒计时环过渡、页签/呼吸灯过渡）
- 标签页标题播报去重（announceTitle 单一出口，值没变不重复触发读屏）

## [0.70.0] - 2026-10-29

### Added

- 结果分享三路：⧉ 分享 MD（含执行信息折叠头的单文件 Markdown）、⧉ 分享 HTML（内联样式单文件，双击浏览器直接看，无外链）、⧉ 复制分享（Markdown 进剪贴板，超 50KB 自动截断标注）
- CLI `zkit run <插件> <动作> --share <文件>`：执行完直接落分享文件，扩展名 .md/.html 分流
- 分享元数据头：插件/动作/时间/耗时/结果状态；secret 参数在头里自动掩码（••••）

## [0.69.0] - 2026-10-29

### Added

- 剪贴板历史面板 `#/clip`：滚动保留最近 20 条（本地 localStorage 不上报），可写回、单条删、清空
- 剪贴板内容识别：时间戳 / URL / IP / JSON / 路径 / Base64 / 数字七类，识别依据随建议展示
- 贴入即搜：`Ctrl+Shift+V` 读剪贴板并按识别结果推荐动作（时间戳→时间戳转换、JSON→格式化等），一键直达详情并预填
- 剪贴板历史去重：相同内容只留最新（时间戳更新挪队首）；超 500 字符截断保存并标注总长

## [0.68.0] - 2026-10-29

### Added

- 定时任务持久化：配置写 `~/.zerokit/timers.json`（原子写），启动器刷新/重启后自动恢复注册表与节奏——「定时」不再随页面消失。
- 新命令 `zkit timers list / pause / resume / remove / run`：CLI 与启动器共享同一份任务状态；`run` 立即执行一次（走 runner、进审计日志），不重置节奏。
- 下次触发推算 `nextFireTime`：错过整段对齐节奏不连环补、执行窗口外顺延到窗口开点（支持跨午夜窗口）、暂停返回空。
- `doctor` 孤儿检测：timers.json 引用的插件已卸载时在报告与 `--json` 输出里点名。
- 启动器 `POST /api/timers`（upsert/pause/resume/remove）与 `GET /api/timers`——UI 与 CLI 的状态一致性由同一文件保证。

## [0.67.0] - 2026-10-29

### Added

- 插件包完整性落地：`plugin pack` 产出 `MANIFEST.sha256`（逐文件 sha256sum 风格清单 + 包级总哈希），`pack` 输出 `sha256-…` 完整性指纹。
- `plugin unpack` 安装前逐文件校验，任何不匹配拒绝安装并点名被改文件；`--no-verify` 兜底老流程。
- 安装成功写装时快照 `.zk-integrity.json`；新命令 `zkit plugin verify <id>` 对照快照复验，装后被偷改/删除的文件逐一暴露。
- 清单自身被改或被删按「包损坏」处理（总哈希对不上清单正文）。
- 集市条目新可选字段 `integrity`：安装时随来源快照存档，供审计对照（目录源 path: 无哈希可校，可缺省）。

## [0.66.0] - 2026-10-29

### Added

- 「能力类型」进清单：动作新键 `ui` / `ui_height` / `ui_min_height` / `ui_summary`——安装前可见「带交互界面」徽标，web 动作首帧高度声明式配置（缺省 360，桥 resize 仍可覆盖，首帧不再闪烁）。
- `plugin lint` 新规则 L11：声明 `ui` 却没有 `render = "web"` 动作给 warn；web 动作未显式声明 ui 给 info。
- `zkit plugin doc` 带界面动作输出「🖥 带交互界面——<ui_summary>（初始高度 Npx）」说明段。
- `doctor`：带 UI 的插件若含 http 动作，提示「界面需要联网才能出数据」。
- uTools 适配层：`cmds` 的 `window` 类型自动置 `ui = true`（要窗口的就是带 UI）。

## [0.65.0] - 2026-10-29

### Added

- uTools 兼容层：`img` 唤起翻译为图片文件匹配（不再只警告）；`window` 唤起与多余正则落进搜索关键字并给健康警告。
- uTools 运行时垫片：`db.put` 补全 `_rev` 冲突语义（重复 `_id` 不带 `_rev` 返回 conflict，防止数据被悄悄覆盖）；`copyText` 支持 macOS（pbcopy）与 Linux（wl-copy/xclip/xsel）；`redirect` 降级为 no-op 并留提示；`getWindowSize` 返回固定合理值。
- 插件元数据新增 `logo` 字段（uTools logo 与 zerokit 清单通用，路径防穿越）；`platform` 白名单不匹配当前平台时给加载警告。
- 新文档 `docs/reference/utools-compat.md`：逐 API 支持矩阵与移植指引。

## [0.64.0] - 2026-10-29

### Added

- 设计师走查十项：详情页执行分层（主按钮放大 + ⋯ 更多菜单收纳 10 个次要操作，一屏主按钮 3 个）
- 动效体系：视图切换淡入上移（200ms）、浮层 scale-in、列表项 stagger 渐入（前 10 项），prefers-reduced-motion 一键全停
- 顶栏状态胶囊：时间问候 + 在跑计数 + 监控计数，有东西在跑时呼吸灯
- 列表排版：动作名加粗、风险三色圆点（绿只读/黄需确认/红危险）、描述单行截断
- 执行反馈：执行中按钮脉冲、结果卡滑入
- 空态插画：纯 CSS 图形替代纯文字
- 窄屏重排：≤720px 操作区 sticky 底部（执行常驻）、顶栏按钮图标化

## [0.63.0] - 2026-10-29

### Added

- `scripts/bench.mjs` 扩充 CLI 冷启动（path/--help/list 各 10 次中位）与峰值 RSS 测量；性能基线表与预算（--help <300ms、list <500ms、RSS <150MB）写入项目账本，超预算回归算缺陷
- 大输入回归防护：virtualWindow/filterRows/resultQuery 补 10k 行用例（基线 2-3ms，防 O(n²) 退化）
- 拆解结论入账本：冷启动 84ms ≈ Node 17ms + amaro TS 即时转译 27ms + 模块图 40ms；懒加载收益上限 30ms，不改错误时序

## [0.62.0] - 2026-10-28

### Added

- `test-all` 失败详情全量列出并带 `[文件]` 前缀、每轮打印最慢 5 个测试文件；新增 `--shuffle` 随机顺序模式用于暴露测试间隐式顺序依赖
- `release-prep` 新增重复版本号守卫：目标版本段已存在时拒绝执行（防双段事故）；`rel55-smoke` 补 CHANGELOG 边界用例（游离条目/重复版本/归档不丢旧段标题）
- `distro-smoke` 的系统 unzip 探测改为跨平台判定（ENOENT 视为「无此工具」跳过，而非只在 `/usr/bin` 下找）
- `extras-smoke` 修复第四十七轮块计数器未定义的崩溃（改为统一 `results` 模式，汇总行移到文件末尾）与时区敏感断言（`parseHistoryHash` 对齐第五十五轮中文 key 语义）；`timeline54/extras` 在 UTC、America/New_York、Pacific/Kiritimati 三个时区下复验全绿
- CONTRIBUTING 新增「写测试的十条军规」（平台路径/时区锚定/断言反模式/自包含/优雅跳过——55+ 轮迭代踩坑精华）

## [0.61.0] - 2026-10-28

### Added

- 文档体系重组：docs/ 四层目录（guide 上手 / 概念 / reference 参考 / deep 深入）+ 导航页；新增十分钟上手、术语表、FAQ 扩编、架构一页图、动作速查表（13 插件 52 动作，从清单自动生成）；README 瘦身 335→226 行；CHANGELOG 历史归档（49 版入 docs/reference/changelog-archive.md，主文件 918→319 行）；check-docs 加导航页四层断言

## [0.60.0] - 2026-10-28

### Added

- 发布准备工具 scripts/release-prep.mjs：CHANGELOG 归档 + 版本号四处同步一步到位，归档前后三重自检（段标题/条目数/空壳），Cargo.lock 结构化定位 zerokit-desktop 段，--dry-run 干跑；终结连续两轮手搓归档事故
- 启动器三处修复：搜索历史 chip 点击后焦点回搜索框；#/timeline 进入浏览器历史（后退回列表）；#/history/<key> 中文键编码修复（decodeURIComponent + encodeURIComponent 对称）

## [0.59.0] - 2026-10-28

### Added

- 时间线与执行复盘页 #/timeline：按天分组（成败点状条/每天汇总/折叠记忆）、周对比卡（总数/失败率/耗时 vs 上周）、0–23 时段分布柱、Top 动作榜、空态引导
- 新纯函数 timelineDays / groupByHour / weekCompare / topActionsFlat（第五十四轮，issue #203）

## [0.58.0] - 2026-10-28

### Added

- 结果区信息密度：KV 空值灰 —、长文本截断（点击复制全文）、表格密度三档（紧凑/标准/宽松，记忆）、结果元信息（耗时/退出码/时间）钉底、列超 30 提示、数字列等宽右对齐
- 新纯函数 cellDisplay / tableDensity / kvCollapsed（第五十三轮，issue #200）

- 键盘流补全：F 键收藏切换、T 键标签面板（数字选已有标签）、结果区 Y/E 复制导出、Alt+↑↓ 批量篮内移位
- 键盘速查浮层（?）新增「键盘流」分节与 PgUp/PgDn、Home/End 提示；keyHelpList 键位表数据进 extras.js
- 批量篮浮条点击可聚焦（键盘移位操作对象 = 最近点过的篮内项）

## [0.56.0] - 2026-10-28

### Added

- 搜索零结果的「丢词建议」：多词全灭时提示去掉哪个词能救回多少项（suggestNext），一键重搜
- 搜索词 + 风险筛选 chip 的组合记忆（「磁盘 [safe]」整条进历史，点击还原词与筛选）
- 搜索态分组头可折叠/展开（与浏览态共用折叠状态）；命中词在描述里也高亮（此前只标题）
- 搜索结果计数徽标「X 项 · 来自 Y 个插件」；搜索框一键清空按钮（✕ 有内容才显示）
- 搜索历史 chips 单条删（✕）与上限 8 条；数字快捷选择在搜索态生效
- 新纯函数 `suggestNext` / `comboLabel`（web/extras.js）

## [0.55.0] - 2026-10-28

### Added

- 视觉体系变量化：字号三级阶梯（--fs-lg/md/sm）、间距四级（--sp-1~4）、过渡时长（--tr-fast/slow）取代零散 px
- 暗色主题次要文字对比度提升（#8b93a1→#99a1b0，4.6:1→7.3:1 过 WCAG AA）；危险操作专用语义色 --danger 与 .btn-danger
- 表格斑马纹（奇偶行微差底色）；暗色滚动条细化（webkit 定制，不再粗白条）
- 结果页打印样式：打印时隐藏顶栏/抽屉/按钮，只留结果（存档用）
- 新纯函数 `contrastRatio` / `typeScaleStep`（web/extras.js，对比度实测与字号阶梯）

## [0.54.0] - 2026-10-28

### Added

- 详情页历史分析卡：数值字段趋势 chip（最近 N 次均值/最好/最差）、耗时分布（P50/P95 一眼看）、失败率警示（最近 10 次失败 >30% 亮黄条）
- 「⇄ 与上次对比」：当前结果与上一次执行逐键 diff（复用结果页签对比视图）
- 收藏结果两两对比：#/saved 选两条同动作收藏，逐键 diff 黄行标差异
- 审计日志导出 CSV（只含元数据：时间/插件/动作/决策/耗时/退出码，输出正文不导——审计里可能有敏感串）
- 新纯函数 `runTrend` / `failureRate` / `durationStats`（web/extras.js，趋势/失败率/耗时分布）

## [0.53.0] - 2026-10-28

### Added

- 启动器失败卡片：执行失败按五类分类（超时/找不到程序/权限/非零退出/解析失败），给「下一步」建议与同参数一键重试按钮，原始错误默认折叠
- 常见错误知识库 `ERROR_BOOK`（web/extras.js）：UI / CLI / MCP 三面共用同一套分类与建议文案
- 批量执行失败不中断：失败项标红继续跑完，结束汇总「成功 N · 失败 M · 未跑 K」
- MCP 工具失败响应附「分类 + 下一步」（与 CLI 同源）；认不出的失败给非零退出兜底分类
- CLI `run` 失败输出统一走知识库（此前仅 suggest/diagnose 覆盖部分场景）
- 监控自动停止时面板显示失败原因摘要与最近 5 条失败样本（不再只说「已停」）
- 结果区失败态排版：长 stderr 等宽字体 + 限高滚动，不再撑破布局

（下一版攒着）

## [0.52.0] - 2026-10-28

### Added

- 设置抽屉：主题/语言/日志/自检/收藏/定时/简报/使用指南/监控面板统一收进右侧「☰ 设置」抽屉，顶栏只留执行类入口
- 命令面板（Ctrl+P）直达设置抽屉——键盘用户不必找 ☰
- 首屏骨架屏：列表数据到位前先画占位行，不再白屏一闪
- 空态文案分级：首次使用 / 无插件 / 搜索无结果三种情境不同指引
- 结果区高度自适应：短结果紧凑、长结果出滚动（compact/normal/scroll 三档）
- 窄屏断点 ≤720px：单列布局、抽屉全屏化，启动器在窄窗口可用

## [0.51.0] - 2026-10-28
### Added

- `zkit completion bash|zsh|fish`：三 shell 补全脚本（子命令 + 常用旗标 + run 的插件名补全）
- `zkit man`：终端命令参考全量文本（不引依赖；`man zkit` 可外部包一层）
- `zkit --version` / `-V` 短旗标（读 package.json 单一事实源）
- `zkit stats --since 7d`：时间窗过滤（与 audit 同一套格式 1h/30m/3d/2w）
- `zkit audit --follow`：跟读模式——新审计行实时打印（2s 轮询追加文件，Ctrl-C 退出）
- 退出码细分：用法错误（插件/动作不存在、参数不合法）= 2，执行失败 = 1——脚本好分流
- `scripts/check-docs.sh` 文档一致性巡检：内链存在性 + 版本号四处同步 + cookbook 命令漂移
- README 快速开始补三平台说明与 FAQ 链接

## [0.50.0] - 2026-10-28
### Added

- CLI 输出格式四选一：`zkit run ... --out table|json|yaml|csv`（table 给人看、其余给下游管道；中文列宽不歪）
- `--quiet`：只输出结果单行 JSON，头部装饰全免（脚本管道用）
- `--copy`：执行成功后把结果 JSON 复制到剪贴板（无剪贴板环境降级提示）
- `--watch N`：执行后每 N 秒轮询重跑，只打印逐键变化行（Ctrl-C 退出；间隔收敛 5~300 秒）
- `zkit last`：重跑最近一条成功命令；`--show` 只看不跑
- `zkit history [N]`：最近命令带时间戳；`--rerun N` 重跑第 N 条（历史落 `history.json`，上限 200 条，控制旗标不进重放参数面）
- `zkit im`：终端交互模式（↑↓ 选插件/动作、回车执行、/ 过滤、q 退出）；裸 `zkit` 在 TTY 下直达
- `zkit run <p> <a> --interactive`：参数逐项提示输入（必填标注、secret 掩码回显、默认值回车即用）
- `zkit list --health`：一屏插件健康状态（非零退出码=有异常）；`--json` 机读

## [0.49.0] - 2026-10-28

### Added

- 桥外观跟随：`render = "web"` 的页面在 context 里收到宿主外观（`dark` / `accent` / `fontScale` / `lang`），桥自动写 `--zk-accent` 变量与 `data-zk-dark` 标记，页面零配置跟上宿主皮肤
- 桥受控跳转：`zkit.openLink(url)` 只接受 http(s)，宿主弹确认后在系统浏览器打开——sandbox iframe 里本就开不了 `_blank`，现在有一条宿主把关的正路
- 桥错误上报：`zkit.reportError(err)` 把页面致命错误打到宿主状态行，白屏也看得见原因
- 消息协议收紧：宿主对未知 `type` 一律忽略不回执；协议全文（消息表 + 四条安全边界）进 `docs/plugin-spec.md` 的「web 动作消息协议」一节
- 演示插件 `demoweb`：一页演示桥的全部六项能力（上下文/外观/深链/受控跳转/自适应高度/错误上报），已进 `market.json`

## [0.48.0] - 2026-10-28

### Added

- 新示例插件 `convert`：进制/大小写/JSON 美化与压缩/Base64/URL 编解码/字节数/千分位八个转换动作 + `hex-flow` 组合动作（十六进制→十进制→千分位一步完成）
- 新示例插件 `snap`：系统自带工具截图（macOS screencapture / Windows PowerShell / Linux 工具探测），无显示器环境报错会说清补救路径
- 新示例插件 `typist`：SQL/Markdown/CI YAML/提交信息四类文本片段一键写剪贴板（平台写入复用 clipboard 插件的 clipio）
- 插件共享代码层 `plugins/_vendor/`：`zkit plugin bundled` 会一并拷贝；插件加载与孤儿检测跳过下划线目录

### Fixed

- `zkit health` 此前会把共享代码目录当成「清单有问题的插件」报出来（1 个加载失败）

## [0.47.0] - 2026-10-28

### Changed
- 列表交互收敛到 #list 单一事件委托监听器（此前每项 li/星标各自绑定，重渲即重挂）
- 收藏切换改为就地补丁（DOM 节点身份稳定，不再整表重建）；键盘导航只改前后两项属性（O(1)）
- 启动器源码可维护性：app.js 文件头地图（22 个域锚点）、extras.js 按域分节横幅；清理 14 个无引用样式类（8 个规则块）
- #/perf 面板新增「累计渲染次数」卡片；renderList 热点打 performance.mark 标签

## [0.46.0] - 2026-10-28

### Added

- CLI 显式授权 `zkit allow list/add/remove`：带 TTL 与过期清理
- `zkit audit --denied` 被拒记录 / `--since` 时间过滤
- 高危动作久未执行警示

## [0.45.0] - 2026-10-28

### Added
- 插件体检 `zkit plugin lint`：十级规则（L01–L10）error/warn/info 分级，error 退出码非零（CI 可用），`--json` 机读
- 插件文档生成 `zkit plugin doc`：从清单生成 Markdown 动作参考（参数表/风险/示例），`--json` 机读版供启动器与 AI 面用
- 六个内置插件全部通过自身 lint（零 error 零 warn，示范级）
- plugin-spec.md 新增「体检规则」一节（规则编号与文案对照表）

## [0.44.0] - 2026-10-28

### Added
- 表格首列冻结（sticky）：宽表横向滚动时关键字段不丢
- 宽表格左右滚动阴影提示（还有内容可滚时渐变提示）
- 表格行点击就地展开该行 JSON 详情（再点收起）
- 文本结果行号（CSS counter 计数，复制不带行号）
- 时间戳列自动识别与人性化：10/13 位数字（含数字串）且落在 2001–2099 转本地时间，列头标 ⏱
- 空结果归因：空数组显示「查了，没有匹配项」、null 显示「动作没有返回数据」、空对象显示「返回了空对象」——不再只有一句（空结果）
- 小屏断点（<760px）：结果卡字号降档、动作按钮单列铺满
- 备注（note）是长 Markdown（>3 个标题）时自动配目录，点击跳转；代码块里的井号不算标题
- 打印样式：Ctrl+P 只打结果卡（列表/侧栏全部隐藏）

## [0.43.0] - 2026-10-28

### Added

- 定时任务升级：新建弹窗带间隔档位（1/5/10/30/60 分钟快捷选择）+ 执行窗口（如 09:00-18:00，窗口外跳过并记 skipped）
- 错过补跑：页面重开后对错过的触发补跑一次（宽一个间隔，不连环补）
- 定时任务暂停/恢复（保留配置，恢复后按原间隔继续）
- 每任务最近 10 次执行历史（成功/失败/跳过）面板就地可看
- 面板显示下次触发相对时间（「3 分钟后」）
- 「现在跑一次」：手动触发不影响调度节奏
- 定时任务失败走系统通知（带错误摘要，授权时）
- 定时任务导出/导入 JSON（迁移机器，本机已有任务不覆盖）
- hashchange 补 #/timers 面板路由（此前只有 applyHash 有，从其它面板切过去不生效）

## [0.42.0] - 2026-10-28

### Added

- 结果区「给 AI」按钮：复制为 LLM 友好的 Markdown（表格/属性行 + 动作名 + 时间），直接粘进 AI 对话
- 「AI 上下文」按钮：打包当前结果 + 最近执行 + 插件清单成一段上下文，免去向 AI 重新描述环境
- 调用方式弹窗新增 MCP 配置段：mcpServers JSON 一键复制，贴进 Claude Desktop / Cursor 即接入
- 执行历史单条 curl 等价命令（token 用占位符，真令牌不进剪贴板）
- LLM 批处理 JSONL 导出：每行 {input, expected:null}，补上期望值即评测集
- 命令面板两个新命令：`> MCP 配置` / `> AI 上下文`
- 监控面板「趋势 MD」：采样序列导出 Markdown 趋势表（时间/值/变化）
- 外观面板「AI 辅助」隐私开关：关掉后所有 AI 相关按钮隐藏（本机界面不留 AI 痕迹）

## [0.41.0] - 2026-10-28

### Added

- 组合动作 / 设置项 / HTTP 动作三个演示插件进 bundled（demochain / demosettings / demohttp），新能力各有一个活示例
- `docs/cookbook.md`：十篇可照抄的做法（每篇 ≤30 行）
- 插件规范加「新能力速查」索引表：每个专题直达规范节与活示例
- 三个 demo 插件登记进 market.json 集市表

## [0.40.0] - 2026-10-28

### Added

- 命令与动作打错给模糊建议（`zkit plugn` → 「是不是想敲 plugin？」；编辑距离+前缀加权，差太远不瞎猜）
- 参数缺失时的错误输出附完整参数表（必填标注 + `--help` 指引）
- 执行失败输出自诊断：stderr 关键词（permission denied / ENOENT / ENOEXEC / 超时 / 依赖缺失）识别后给「下一步」处置
- `zkit doctor --fix`：自动清理装了一半的插件目录（无 plugin.toml 的残留）、确保数据目录结构齐全
- 半安装插件检测：doctor 列出无清单的插件目录（unpack 中断/手工拷贝残留）
- 参数里的异平台路径提前点破（mac 上给 `C:\...`、Windows 上给 `/usr/...`）

## [0.39.0] - 2026-10-28

### Added

- 插件第三十四轮十项——市场与分发（#143）
  - `zkit plugin pack <id>`：插件打包 zip（无新依赖——内置 zlib 手写 zip 读写）
  - `zkit plugin unpack <zip> [--replace]`：从 zip 装回；路径穿越防线（`..` 条目拒绝）
  - `pack --list-only`：只看进包文件清单不落盘
  - `zkit plugin publish-ready <id>`：上架检查（版本号/动作描述/risk 声明；装不上的清单走静态检查）
  - `zkit market lint [--file]`：market.json 登记表校验（id 查重/source 格式/path 死链）
  - `zkit plugin info <id>`：一页看全（版本/动作数/风险构成/设置项/最近使用）
  - `zkit plugin recommend <id>`：可粘贴的推荐语
  - `zkit market add` 健康检查：登记表有硬伤的集市源直接拒绝添加
  - （核实既有）升级 diff 预览：`plugin update` 已列新增/移除动作
  - distro-smoke 14 项断言（含系统 unzip 交叉校验、穿越攻击、坏表拒绝）

## [0.38.0] - 2026-10-28

### Added

- 启动器第三十三轮十项——内核可观测性与运维面（#140）
  - `zkit stats` 动作级耗时统计（次数/失败/P50/P95/最慢，来自审计日志）+ `--json`
  - `zkit logs --follow` 跟读审计日志（轮询 500ms，Ctrl+C 退出）
  - `zkit health` 一条命令概况（插件/最近错误/server 端口），异常退出码 1 供脚本用
  - `zkit audit --last N` 最近审计记录表格输出 + `--json`
  - server 新增无鉴权 `/api/health` 探活端点（app/version/uptime/pid）
  - 慢动作水位线：执行超 3s 的动作审计记录带 `slow: true`，stats 标 ⚠、audit 标 ⏱
  - `zkit gc` 清理 30 天前审计数据（默认预览，`--apply` 执行，`--days` 自定义）
  - doctor 汇总最近 24h 执行失败计数（人读行 + `--json.recentErrors`）
  - ops-smoke 10 项断言（临时目录自包含，覆盖全部新命令与端点）

### Fixed

- 审计写入丢行：CLI 路径 `audit()` 用 WriteStream 后主进程立刻 `process.exit`，
  数据还没落盘就被带走——实测 CLI 执行从来没进过审计日志（UI/MCP 因进程常驻
  而幸免）。改为 `appendFileSync` 同步追加，审计是低频单行写、代价可忽略。

## [0.37.0] - 2026-10-28

### Added

- 启动器第三十二轮十项——桌面壳与系统集成（#137）
  - 托盘菜单扩充（显示/设置/日志/退出）+ 双击托盘切换主窗口
  - 全局热键用户可配（~/.zerokit/desktop.json 的 `hotkey`，解析失败回退内置候选）
  - 窗口位置与尺寸记忆（logical 坐标，移动/缩放/隐藏即存，启动还原）
  - 壳内历史导航：Alt+←/→ 等价浏览器后退/前进
  - 外部链接一律交系统浏览器（壳只承载内核本地 UI，防丢壳）
  - `zkit desktop` 体检子命令（--json 机读；读壳配置摘要）
  - `zkit doctor` 与 `/api/doctor` 新增桌面壳状态字段
  - 桌面壳数据尊重 `ZEROKIT_HOME`（与内核同约定，隔离验证可用）
  - Rust 单测 2 项（热键解析边界、配置往返与旧格式兼容）
  - desktop-smoke 12 项断言（全量 764→776）

## [0.36.0] - 2026-10-28

### Added

- 启动器/内核第三十一轮十项——MCP 与 AI 协作面（#134）
  - MCP 工具描述模板化：参数说明（必填/默认值/敏感标注）与输出形状进描述
  - 大 JSON 结果摘要：超过 4KB 截为首段 + 字段统计，tokens 友好
  - 结果敏感字段自动脱敏：token/password/secret/api_key 等命名字段出口打码
  - 失败响应附补救提示：从错误文本推断可能原因与建议动作
  - 调用元数据透传：risk/耗时/插件版本进 structuredContent 的 `_meta`
  - `zkit mcp tools`：不启动 server 列全部工具与风险标记
  - `zkit mcp tools --json`：机读清单（供 AI 客户端文档生成）
  - `zkit mcp allow --list`：授权动作与授权时间可视化
  - MCP 会话内连续失败 3 次后响应附冷却建议（防 AI 疯狂重试）
  - 授权文件升级为 `{entries:[{key,at}]}` 带时间记录（旧纯数组格式自动迁移）

# 更新日志

本文件记录 zerokit 对使用者可见的变更。格式遵循
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.35.0] - 2026-10-28

### Added

- 启动器第三十轮十项——触屏与窄屏适配：
  - 触屏（pointer: coarse）工具按钮常显：⚙ 列显隐/页签 ✕✎ 不再 hover 才现，命中区加到 30px
  - 长按 500ms 合成 contextmenu：列复制/固定页签/结果菜单在触屏可达
  - 页签 ✎ 显式备注按钮（双击的触屏等价入口）
  - 触屏拖列宽（th 右缘热区 touchstart，与鼠标并行）
  - 窄屏（<720px）#stage 纵向堆叠、页签栏横滚、搜索框 15px 防 iOS 自动放大
  - 结果表包 .tbl-wrap 横向滚动容器（min-width 420px 保列宽下限，宽屏同样受益）
  - 批量篮 ✕ / 执行与返回按钮核实触屏可达（既有能力确认）

## [0.34.0] - 2026-10-28

### Added

- 启动器第二十九轮十项——性能与体感优化：
  - 搜索输入防抖 150ms + rAF 合帧（连续击键只重算最后一次）
  - 新增 `#/perf` 性能面板（列表项数 / 渲染耗时 / 搜索耗时三张指标卡 + 重新测量）
  - 大表（>500 行）只画首屏 200 行，一键「加载全部」；重画沿用表格 id，列显隐/筛选/全量加载状态不再丢失
  - 大 JSON（>256KB）复制走切片序列化，冻结帧让位给交互
  - `zkit list --json --brief`：机读精简输出（id/name/version/health）
  - `zkit doctor --json`：自检结果 JSON 输出（退出码不变）
  - `zkit config get` 单键读取（核实既有能力并补文档）

## [0.33.0] - 2026-10-28

### Added

- 启动器第二十八轮十项——国际化与文案体检：语言三档（跟随系统/中文/英文，外观面板点选或顶栏「中/EN」循环切换，全界面立即生效无需刷新）；偏好持久化（`zerokit.lang`，刷新/重启还原）；`<html lang>` 随语言同步（读屏软件发音正确）；页签相对时间本地化（中文「3 分钟前」/英文「3m ago」）；风险等级徽标双语（只读/Read-only、会改动/Writes、高风险/High risk）；顶栏模式标签 25 处硬编码迁移文案表（命令/Commands、集市/Market…）；页脚与顶栏静态节点走 `data-i18n` 标注；术语统一（四处「无命令」→「无动作」——清单里 command 字段指的就是动作）；文案表 zh/en 键严格对齐（62 键，测试断言）。

## [0.32.0] - 2026-10-28

### Added

- 启动器第二十七轮十项——搜索与发现的深度：搜索结果按插件分组显示（≥2 个插件时组头带计数）；命中解释徽标（「命中：动作名·拼音」，排序依据可见）；同义词弱路由（「看看内存」召回内存类动作，虚词「看看/帮我/查一下」自动剥离，含粘连形态）；搜索历史输入态常显（8 条点击回填）；历史动作深链 `#/history/<插件.动作>`（「上次那个」直达，动作被卸载时说明）；最近执行加权统一走 recencyBoost 纯函数；大小写保真高亮（查询 IP 高亮原文 IP 位置）。既有能力核实项：拼音全拼/首字母模糊搜索、空格分词 AND。

## [0.31.0] - 2026-10-28

### Added

- 启动器第二十六轮：插件生态体验
  - 插件主页统计卡三格（动作数+组合数 / 累计执行+最近使用 / 健康状态）
  - 主页动作搜索框（词 AND 匹配标题/id/描述/风险，与全局搜索独立）
  - 主页标签 chips（keywords 并集去重）
  - 插件对比：选两个插件对比动作数/风险构成/插件依赖（差异行高亮）
  - 依赖树视图（缩进树替代纯文本列表，未装标注）
  - 复制安装命令（集市插件 `zkit plugin install … --market …`，内置 `zkit plugin bundled`）
  - 集市更新徽标：主页头部「⬆ 可更新：vX → vY」（versionDiff 统一口径）
  - 已装插件清单导出 JSON（id/版本/来源/动作数，可分享）
  - 坏插件置顶红条：缺命令依赖的插件在列表页顶部显示原因与修复建议

## [0.30.0] - 2026-10-28

### Added

- 启动器第二十五轮：执行链路与批处理进阶
  - 批量篮排序（↑↓ 按钮调整执行顺序）、一键去重（同动作同参数判重）
  - 批量清单导出/导入 JSON（跨机器复制巡检清单）
  - 批量执行并发上限可设（1=串行，默认 3，记忆保存）
  - 批量失败项一键重跑（参数保持原样）
  - 手动链：动作执行成功后可「接着跑」下一步（只读动作候选，destructive 不进链）
  - 链占位符：下一步参数支持 `{result.data.字段}` / `{result.stdout}` 引用上一步结果（同 CLI chain 语义）
  - 链步骤条：结果卡上方显示 A ✓ → B ✓ 链路，点击回看每步结果
  - 执行历史带「用这些参数重跑」一键回填
  - 修复：Alt+点击加入批量篮后浮条不刷新（只有第一项可见）与首次点击无反馈两处缺陷

## [0.29.0] - 2026-10-28

### Added
- 启动器：命令面板 `>` 前缀命令模式——内置 12 个命令（监控/帮助/统计/日志/集市/自检/配置档/备份/批量/外观/简报/工作台），最近用过的命令置顶。
- 启动器：`;插件.动作` 快速执行语法——命令面板里直接输 `;sysinfo.overview` 跳详情页，不用先导航。
- 启动器：两段式 goto 跳转——按 `g` 后 600ms 内按 `l`/`h`/`s`/`m` 直达列表/帮助/统计/监控面板（详情页里也能用）。
- 启动器：结果区 `j`/`k` 键上下移表格行选中、`[`/`]` 环形切换结果页签。
- 启动器：`?` 键盘速查浮层——分组列出全部快捷键，Esc 关闭。
- 启动器：命令面板历史——↑ 在输入框顶部翻最近的命令与查询（去重、最近优先）。

## [0.28.0] - 2026-10-28

### Added
- 启动器：结果页签工作台——成功结果进入页签栏（最近 8 个，同动作重跑刷新当前页签），页签可切换/关闭，右键固定（固定不被挤出）。
- 启动器：页签备注——双击页签写一句备注（悬停可见），Alt+复制附带「// 备注（时间）」头。
- 启动器：结果查询框——表格上方支持子串词与数字比较（如 `size>100`），带 `'120 MB'` 前缀的数字串值也可比较。
- 启动器：页签对比视图——两个页签并排按键级 diff（黄色行标差异），一键切回。

## [0.27.0] - 2026-10-27

### Added
- 启动器：首次访问引导——第一次打开弹三步卡片（搜索 → 执行 → 看结果），可跳过、标记后永不再打扰。
- 启动器：使用指南页 `#/help`——搜索语法、执行与结果、监控、配置档、数据备份、安全防护六大主题的界内说明，每段带「去试用」深链直达；页脚新增入口。
- 启动器：空搜索建议——无结果时列出「试试这些」（只读动作直达），新用户不再面对死胡同。
- 启动器：风险等级说明条——非只读动作详情页顶部解释三档风险（只读/会改动/高风险）各是什么意思。
- 启动器：插件分组头悬停提示——动作数与风险构成（只读 N、会改动 M、高风险 K）一眼可见，兼作折叠说明。

## [0.26.0] - 2026-10-27

### Added
- 启动器：配置档（多环境切换）——外观面板新增「配置档」分组，一键在工作/个人等多套外观+收藏+参数记忆之间切换，立即生效不用重启。
- 启动器：以当前状态新建配置档——先把现在的外观、收藏、参数记忆、表格列设置存成一档，再起个名字。
- 启动器：配置档重命名与删除——重命名即时生效；删除时如果删的是当前档会先切回剩下的档，只剩一档时拒绝删除。
- 启动器：执行历史跨档共享——runs/最近执行/保存的结果是全局事实，不随档切换丢。
- 启动器：数据备份含配置档——第二十轮的导出/导入自然带上所有配置档数据。

## [0.25.0] - 2026-10-27

### Added
- 启动器：数据备份导出——外观面板新增「⬇ 导出数据」，把所有个性化数据（收藏、历史、参数记忆、外观设置、表格列显隐/列宽）打包成带版本与时间戳的 JSON 下载，文件名可预测（`zerokit-backup-YYYYMMDD-HHMMSS.json`）。
- 启动器：数据备份导入——「⬆ 导入数据」选 JSON 后先校验格式（非 zerokit 备份直接拒绝并说人话），再分组预览（收藏与标记 / 历史与参数 / 外观与设置 / 配置快照 / 表格列…）。
- 启动器：选择性导入——预览弹窗里按分组勾选，不要的类别不落盘。
- 启动器：合并策略新优先——对象数据按子键合并（备份覆盖同名子键，本地独有条目保留），不会静默丢掉用户现有数据；导入完成 toast 汇总应用/跳过项数。
- 启动器：外观面板新增「数据」分组——导出、导入、清除痕迹三个数据操作收进设置一处。

## [0.24.0] - 2026-10-27

### Added
- 启动器：危险参数值检测——参数含 `rm -rf`、系统目录、格式化磁盘、dd 直写等模式时执行前黄条警示（可继续，不硬拦）。
- 启动器：同动作限速——3 秒内第 3 次执行起弹确认框，防手抖连点与宏误触。
- 启动器：结果与日志默认脱敏——token / Bearer / 长十六进制串打码保留首尾 4 字符，🕶 按钮一键切换明文。
- 启动器：动作危险度提示卡——详情页风险等级横条（红/黄/绿）+ 历史失败率 + 平均耗时 + 「为什么危险」说明。
- 启动器：一键清除敏感痕迹——清除当前结果、运行历史数据与参数记忆（审计日志不受影响）。
- 启动器：审计日志自动清理提示——超 90 天的条目数在日志页头亮出（已自动清理 N 条）。
- 启动器：有监控或执行在跑时，关闭/刷新标签页触发浏览器挽留确认（beforeunload）。

## [0.23.0] - 2026-10-27

### Added
- 启动器：只读动作可设「监控」——按间隔自动重跑，倒计时环显示下次采样时间，翻页或切动作自动停。
- 启动器：监控的变更高亮——与上次采样逐格对比，变化的格子黄底 + 「↑↓ 数值（原 值）」标签。
- 启动器：数值字段的迷你趋势线（sparkline）——键值结果逐字段、表格结果在表头，最近 20 次采样。
- 启动器：停止条件——连续失败 N 次或结果命中指定串时自动停，防失控空转。
- 启动器：监控聚合面板 `#/watch`——所有在跑的监控一行一条：状态、间隔、采样/变更数、停止与 CSV 导出。
- 启动器：标签页标题显示在跑监控数（⏱N），切去别的标签页也不会忘。
- 启动器：变更才发系统通知（Notification 授权后），点击通知回到窗口。
- 启动器：监控采样可导出 CSV（时间、成败、数值列），外部绘图/记账可用。

## [0.22.0] - 2026-10-27

### Added
- 启动器：结果复制支持 `copy_template` 清单声明——插件可以定义复制模板（如查 IP 后复制成
  `ssh user@{result.data.ip}`），点「复制」得到可直接用的命令而不是一坨 JSON
  （`plugins/ip` 的 `public` 动作附带示例）。
- 启动器：按住 Shift 点「复制」= 复制美化缩进后的 JSON（不按则保持紧凑单行）。
- 启动器：结果导出新增 JSONL 格式（每行一个 JSON，`jq` / `ndjson` 友好），对象数组结果自动出现该按钮。
- 启动器：导出文件名改为可预测的 `插件-动作-时间戳.扩展名`（不再用随机后缀），导出后结果卡
  显示完整路径，并附「打开目录」按钮直接在系统文件管理器中揭示。
- 启动器：结果卡新增「编辑器打开」——把结果文本丢给外部编辑器（`ZEROKIT_EDITOR` 环境变量
  指定，如 `code --wait`；未配置时用平台默认），内容落 `~/.zerokit/exports/`。
- 启动器：终端模式新增键盘 `w` / `t` / `b`——换行开关 / 跳顶 / 跳底（焦点在输入框时不抢键）。
- 启动器：对象结果的 Markdown 导出改为「属性行」排版（`- **键**: 值`，嵌套缩进、数组连排），
  不再是两列表格——贴进 Issue / 文档更窄更好读。
- 启动器：后台执行完成的通知现在可点击——点击后聚焦窗口、滚到结果卡并高亮闪烁一下。

## [0.21.0] - 2026-10-27

### Added
- 结果表格筛选行：每列下方一个小输入框，空格分词多条件 AND 过滤，行数实时更新（第十六轮 #89）
- 结果表格列显示/隐藏：右上角 ⚙ 勾选要看的列，按表记忆
- 结果表格统计行（tfoot）：数字列给合计/均值/最小~最大，文本列给非空计数
- 单位列一键换算：识别 ms/s/B/KB/MB/GB/TB 列（>60% 命中），表头按钮换算（0.5 GB 不显示成 0.500 GB）
- 执行历史「合并视图」：最近两次表格结果按共同键列左连接拼成一张表，同名列加 _2 后缀，可继续排序/筛选/导出
- 右键列名复制整列（按住 Alt 去重）——配合表格的其它导出（CSV/TSV/MD/JSON）凑齐搬运套件
- 「复制 HTML 表」：带内联样式的表格 HTML，贴进邮件/富文本编辑器保留格式
- 合并视图等派生结果的来源说明（📌 顶在结果卡里）

## [0.20.0] - 2026-10-27

### Added

- 启动器：动作列表虚拟滚动——搜索结果超 60 条时只渲染视口内条目（上下各多留 6 条缓冲），上千条也不卡
- 启动器：执行历史分页——每页 50 条，页码可跳；搜索/筛选/文件切换时自动回到第 1 页
- 启动器：集市插件列表递增加载——先看前 30 个，点「加载更多」再展开，重新搜索时收回到前 30
- 启动器：详情页面包屑「全部 › 插件 › 动作」——插件段点击直达插件主页，比返回后再找快一步
- 启动器：浏览器后退/前进可用——详情页入栈，后退键一步步走回列表（并还原搜索词）
- 启动器：搜索词与风险筛选写进 URL（#/?q=…&filter=…）——刷新不丢、可直接分享筛好的视图
- 启动器：数字键 1-9 快速选中列表第 N 项（不直接执行，回车确认）——配合方向键键盘流
- 启动器：列表空态/加载态 role=status（读屏可感知）

## [0.19.0] - 2026-10-27

### Added
- 表单必填/数值即时校验：字段标红 + 行内错误提示，执行前拦下（第十四轮 #83）
- secret 字段「👁 眼睛」切换明文/掩码
- 多行参数（`multiline = true`）渲染 textarea 且随内容自动增高（上限 320px）
- 「恢复默认」按钮：一键清回清单默认值
- 历史参数重选：详情页顶部展示最近 3 组成功参数，点击回填
- 参数脏状态守卫：改过参数未执行就点返回会先确认，防误触丢参数
- URL 深链预填：`#/插件/动作?字段=值` 直接带参打开；主页 `?q=词` 即搜

## [0.18.0] - 2026-10-27

### Added
- 列表键盘流：roving tabindex（↑/↓ 移动、Enter 进入、只有选中项在 Tab 序里）
- 全局 `:focus-visible` 焦点环与 `.sr-only` 视觉隐藏类
- 图标按钮补 `aria-label`（星标、主题一键切换、批量条）
- 结果区 `aria-live=polite` + 屏幕阅读器播报（成功带耗时、失败带错误摘要）
- `prefers-reduced-motion`：系统「减弱动态效果」时停掉所有过渡动画
- Esc 栈：优先关闭最上层浮层（长单元格弹层 > 面板 > 页面），不再一按就退出页面
- 空态/加载态统一 `role=status`（18 处）

## [0.17.0] - 2026-10-27

### Added
- 启动器结果支持 `bars` 柱状图渲染：清单里 `render = "bars"` + `[{label, value}]` 或平行数组数据即画柱，负值红柱标 `below`，形状不对自动降级为默认渲染。
- 动作详情页新增耗时走势 sparkline：近 20 次执行画一条 SVG 折线（失败点标红），鼠标悬停看最高耗时。
- 结果头部统一毫秒展示（950 ms / 2.5 s / 2m05s）+ 「🐢 慢于平常」徽标：本次耗时超过该动作历史 P95（历史 ≥3 次才参与判断）才亮。
- 批量执行真正落地：Alt+点击入篮后「顺序执行」逐项跑完出汇总卡（成功 N / 失败 M / 总耗时，失败项可点开重跑）。v0.14.0 曾在界面放进执行篮但执行函数缺失，点击会报错，本版修复并补齐汇总。
- 命令面板（Ctrl+K）升级：打分排序（精确 > 前缀 > 子串 > 提示词 > 子序列）、直达插件主页 / 主题 / 定时 / 简报 / 收藏等页面。
- 表格长单元格省略显示（>48 字符截断加 …），点击弹出完整内容浮层；直方图悬停显示占比、条下显示次数。
- 结果对比支持「并排」开关：每行字段上下两排（旧值红 / 新值绿），「仅看变化」开关保留。

## [0.16.0] - 2026-10-27

### Added
- 结果表格列宽拖拽 + 记忆（按表保存到本机）
- 结果卡右键菜单：复制本行/复制表格 TSV/复制 Markdown 表/导出 CSV/复制 JSON
- 终端模式查看结果：等宽字体、深底、自动滚底
- JSON 结果折叠树（嵌套对象按键/数组项缩进，点击分支折叠）
- 结果内查找增强：Enter/Shift+Enter 逐个跳转，计数「N/M」
- 复制为 Markdown 表格（数字列右对齐语法）与 TSV（Excel 直接粘贴）
- CSV 导出补 BOM：Excel 双击打开中文不乱码
- __zerokit 导出 renderResult（CDP 自动化可直接驱动结果渲染）

## [0.15.0] - 2026-10-27

### Added
- 执行完成桌面通知（Notification API，后台跑长任务不再盯屏）
- 定时任务面板 #/timers（在跑的 interval 一览、一键停止）
- 失败动作一键重试（结果卡尾部「重试一次」）
- 收藏钉顶栏：前 5 个收藏动作显示为搜索框上方的快速访问条
- 每日简报页 #/brief（今日执行数/成败/平均耗时/最常用 top3）
- 结果自动保留最近 20 份/动作（trimRuns，此前仅 5 份）
- 插件更新检查：集市来源插件主页「检查更新」（只比版本号，不自动装）
- Ctrl/Cmd+K 全局聚焦搜索
- 空闲提示：30 分钟未操作时推荐最常用动作

## [0.14.0] - 2026-10-27

### Added
- 键盘分页（Home/End/PgUp/PgDn，8 行/页，纯函数 pageJump）
- 搜索权重可视化：详情页显示「为什么命中」（信号/分/权重表）
- 批量执行：Alt+点击多选 → 顺序执行 → 汇总报告（destructive 自动排最后）
- 历史任选两次对比（A/B 槽）
- 深链参数预填：#/插件/动作?字段=值 打开即填表单（只预填不自动执行）
- 分享链接带参数：复制可复现的完整深链
- 移动端布局适配（窄屏 ≤720px 可用）
- Alt+数字键快速打开前 9 条结果
- 统计页执行耗时直方图（对数桶）
- 修复：测试源码中的字面 U+FFFD（改为 fromCharCode，扫描器不再误报）

## [0.13.0] - 2026-10-27

### Added
- 界面双语（中/英）：框架级文案一键切换，动作/插件名保持作者原文（机器翻译只会制造困惑）
- 动作昵称：给任何动作起自己的叫法，搜索权重最高、列表里显示在原名旁
- 动作标签：自由打标（最多 8 个），可搜索、列表内联显示
- 长输出折叠：stdout 超过 60 行自动折叠，一键展开——翻日志不再刷屏
- 偏好快照 A/B：两组偏好（收藏/别名/昵称/标签/主题/快捷键）一键保存切换
- 上次结果回看：详情页显示最近一次执行状态与时间，可离线回看输出
- 高风险动作二次确认：destructive 动作需输入动作原名才能执行（10 秒内免重复）
- 界面字号三档（小/中/大）：外观面板即时切换

## [0.12.0] - 2026-10-27

### Added

- **启动器第七轮十项：协作与自动化**。单人体验六轮之后，这一轮开始解决「把能力交给别人」：

  - **深链二维码**：动作详情一键生成二维码（零依赖 SVG 生成器，离线），手机扫码直达。
  - **插件能力清单导出**：插件主页一键导出 Markdown 报告（动作/风险/依赖/设置），
    同事装之前先看这份就知道它会动什么。
  - **定时执行**：只读动作可设间隔自动跑（界面开着才执行——刻意不做后台守护，
    守护是服务的职责，不是启动器的）。
  - **执行队列可视化**：连续触发执行时显示「排队中」，不再像没反应。
  - **结果分享卡**：一键生成带成败/耗时/输出的摘要文本，复制到剪贴板。
  - **插件履历**：插件主页显示安装时间与来源。
  - **分享搜索直达**：`#/q=` 链接进来自动记入最近搜索，下次一点即回。
  - **统计页插件直达**：最活跃插件排行可点进插件主页。
  - **键盘焦点环**：Tab 导航有清晰的 focus-visible 描边。
  - **测试齐备**：新增 `test/qr-smoke.mjs`（7 项结构断言），全量 21 文件 / 558 断言。

  二维码生成器是纯函数模块（`web/qrcode.js`，ISO/IEC 18004 标准 byte 模式 1–5 版），
  不引入任何依赖；QR 结构用不变量单测（确定性/finder 存在/版本自适应/超长报错/中文）。

## [0.11.0] - 2026-10-26

### Added

- **启动器第六轮十项：让数据开口说话**。这一轮把使用数据从「数字」变成「图形」，把
  配置从「只能本机用」变成「可以带走」：

  - **执行趋势迷你图**：统计页近 7 天柱状图，成功蓝柱、失败红柱，一眼看出哪天翻车。
  - **小时热力图**：一天中什么时候在用，24 格按小时计数。
  - **标签页标题徽标**：有进程在跑时标题变「(N) zerokit」，切到别的标签页也不会忘。
  - **结果对比导出 Markdown**：两次结果的对比弹窗可直接导出，贴 issue 里就能用。
  - **动作详情复制 JSON**：一键复制动作定义（type/risk/params/steps），写文档、问 AI 都方便。
  - **快捷键速查动态化**：F1–F12 绑定实时列进速查弹窗，绑了什么一眼可见。
  - **空态插画文案升级**：搜不到时给 🔍 插画与「可能是太具体 / 还没装」的原因分析。
  - **偏好导出 / 导入**：收藏、备注、别名、标签、快捷键、主题一键备份成 JSON；
    换电脑前先导出，导入只认 `zerokit.` 开头的键（不碰其它站点数据）。
  - **每日 AI 日报**：统计页一键生成今日小结（次数/成功失败/平均耗时/最常用/失败提示），
    本地拼装、可复制，不联网、不花钱。
  - **测试齐备**：新增 3 项接口断言，全量 20 文件 / 551 断言。

  新增两个接口：`POST /api/prefs/export` / `POST /api/prefs/import`（只认 `zerokit.` 前缀，
  坏形状 400）；其余全部纯前端。

## [0.10.0] - 2026-10-26

### Added

- **启动器第五轮十项：越用越顺手**。这一轮不新增任何大接口，主打「让已经有的东西长在手上」：

  - **工作台会话恢复**：刷新页面后 AI 对话还在（服务端会话存续期内自动恢复转录），
    「新会话」随时清空重开。
  - **结果收藏夹 `#/saved`**：结果卡一键收藏，底部「收藏」入口集中翻看，可删除、可清空；
    只存本机。
  - **动作快捷键 F1–F12**：详情页「快捷键」给任意动作绑一个功能键，全局生效、随时直跑。
  - **剪贴板识别提示**：点「剪贴板」粘入内容后，识别出对应动作时置顶并提示「剪贴板识别为 X」。
  - **结果内查找**：结果卡内实时高亮搜索（Enter 跳下一个命中）。
  - **插件面板排序**：按名称 / 动作数 / 安装时间排序，偏好记住。
  - **执行备注**：给一次执行写一句话备注（本机保存），详情页角标显示。
  - **主题快切按钮**：头部 ☀/🌙 一键在深浅之间切换（`Ctrl+Shift+D`），不动三档配置。
  - **结果卡折叠**：长结果一键收起 / 展开，翻列表不被大结果淹没。
  - **测试齐备**：全量 20 文件 / 548 断言保持全绿。

  新增一个只读接口 `GET /api/chat/state`（工作台恢复用）；其余全部纯前端，数据只存本机。

## [0.9.0] - 2026-10-26

### Added

- **启动器第四轮十项：让插件「从 0 到 1」和「用了之后」都更顺**。这轮的两个关键词是
  **门槛**与**反馈**：把作者从 0 到 1 的路径搬进界面，把用户跑完之后的每一步都给出
  可见的反馈。

  - **新建插件**：插件面板点「新建插件」，答三个问题（id / 名字 / 语言）就生成能直接跑的
    最小骨架，**自动进入开发模式**——改文件即生效，不用碰终端。
  - **装前试跑**：集市预览里每个**只读动作**多一个「装前试跑」按钮，用临时目录里的代码
    **真跑一次**给你看结果；有副作用的动作明确标注「装后可用」，绝不偷偷执行。
  - **表格排序与千分位**：结果表格点列头即排序（数字列按数值、文本列按字典序，再点反向），
    数字自动千分位，大数字一眼可比。
  - **插件批量操作**：全选 + 一键「批量检查更新」，汇总「N 个已更新 / N 个已最新」。
  - **插件标签**：给插件打自定义标签（如「常用」「工作」），标签只存本机。
  - **动作别名**：给动作起个顺口的名字（如给「磁盘占用」起「磁盘」），在搜索框输入别名
    **直接命中**那个动作——你的词汇，你的入口。
  - **组合动作试走**：链路详情一键「试走一遍」，不执行、纯推演每步会引用谁、哪些参数
    是写死的——安装/修改清单后先走一遍再跑。
  - **结果对比**：同动作跑两次后可「与最新对比」，逐字段列出变化（旧值 → 新值）。
  - **导出 CSV / JSON**：结果一键导出，Excel / 脚本直接吃。
  - **全局统计页 `#/stats`**：总执行次数、成功率、平均耗时、最活跃插件、近 7 天趋势
    （成功/失败分色）。全部来自本机记录，不上传任何数据。

  新增两个接口：`POST /api/plugin/new`（复用内核 scaffold 的全部校验）、
  `POST /api/market/tryrun`（只放行 read 风险）。测试增至 20 文件 / **548 项断言**。

## [0.8.0] - 2026-10-25

### Added

- **启动器第三轮十项：把「管」搬进界面**。前两轮解决「看得见」，这一轮解决「不用开终端也能管」：

  - **MCP 授权面板**（`#/mcp`）：所有有副作用的动作一屏列出，一键允许 / 撤销 AI 调用；
    与 `zkit mcp allow` 共用同一份名单，改哪边都算数。
  - **插件配置编辑器**：详情页直接改设置项（secret 掩码回填、留空不改），保存后立即生效。
  - **确认弹窗升级**：高风险动作会先说清「会改动或删除数据，且不可自动撤销」，再让你看命令。
  - **组合动作链路图**：每一步的输入来自哪里、参数是什么，画成流程而不是一行文字。
  - **全局命令面板（Ctrl+P / Ctrl+K）**：键盘直达任何动作或页面，模糊匹配。
  - **空状态引导**：搜不到时给「清空 / 去集市 / 问工作台」三个可点建议，不再是死胡同。
  - **插件分享**：git 来源的插件一键复制 `zkit plugin add <url>`，发给同事就能装。
  - **高风险动作执行后的安心提示**：明说 zerokit 不猜怎么撤销，给审计日志入口与手工回退思路。
  - **快捷键速查新增「直达页面」**：所有深链接列成可点入口。
  - **键盘效率**：Home / End / PageUp / PageDown 在列表里可用了。

## [0.7.0] - 2026-10-25

### Added

- **启动器第二轮十项体验：把「看不见的东西」搬到眼前**。上一轮解决的是「顺手」，
  这一轮解决的是「不敢用」——命令到底会执行什么、上次失败为什么、缺的依赖怎么补，
  现在都能在界面上看见。

  - **外观面板**：主题三档（深色 / 浅色 / 跟随系统）+ **六套强调色**，点一下立刻生效、
    刷新后保持。强调色只改交互色，不动可读性。
  - **风险筛选与搜索历史**：列表顶部一排 chip（全部 / 收藏 / 只读 / 会改动 / 高风险）
    带实时计数；「最近搜索」把搜过的词留在本机，一点即回。
  - **命令预览**：执行前先在界面上看到**真正要跑的 argv**，密钥显示为 `******`，
    带占位符时提示「执行时才展开」。不用再靠脑补确认弹窗里那一行。
  - **审计日志页**：每次执行 / 被拒 / 失败都列出来，可按决策筛、按插件或错误搜，
    点开看命令行、退出码、耗时；时间按本机时区显示。
  - **环境自检页**：解释器、插件依赖、命令依赖、必填配置、组合动作引用，一页看完，
    每条问题都附**可复制的修复命令**；支持「重新检查」。
  - **插件使用统计**：插件面板顶部给出最常用动作排行（本机计数）、缺依赖与缺配置的
    汇总数，数字可点进对应插件——「哪里该修」不再靠翻文档。
  - **调用方式**：详情页直接给出这个动作在 CLI、MCP、深链里的三种调法，一键复制，
    方便把能力交给脚本或 AI 客户端。
  - **导出 Markdown**：结果一键导出为 Markdown（数组→表格、对象→两列、其余→代码块），
    带成功/失败、耗时与命令行，贴到 issue / 周报里就能用。
  - **最近执行**：首页直接列出跨插件最近 5 次执行，点一下回到那个动作，失败与耗时
    一眼可见。
  - 十项里有七项是纯前端（`web/extras.js` 的可单测纯函数 + localStorage，前缀
    `zerokit.`），命令预览 / 日志 / 自检新增三个**只读本机数据**的接口。

  `test/ui2-api-smoke.mjs` 覆盖三个新接口与插件载荷的聚合字段；全量测试增至
  20 个文件 / 531 项断言。

## [0.6.0] - 2026-10-25

### Added

- **启动器一次补齐十项日常体验**，全部纯前端、离线可用，不新增任何后端接口：

  - **主题**：深色 / 浅色 / 跟随系统三档，一键切换、刷新后保持；浅色不是简单反色，
    阴影、边框、强调色都单独调过。
  - **快捷键浮层**：`Ctrl + /` 随时唤出，七个常用操作一屏说清（`Ctrl+K` 聚焦搜索、
    `?` 进 AI 工作台等），底部常驻一行提示。
  - **动作收藏**：动作名右侧星标一点即收藏；空搜索时「收藏优先」置顶并显示计数。
    收藏只存在本机，不占服务端任何状态。
  - **搜索命中高亮**：标题里命中的词用暖色标出，一眼看出这条为什么会被搜到。
  - **结果工具条**：结果卡片右上角「复制 / 下载 / 再跑一次」——复制走剪贴板，
    下载用 `Blob` 导出，不落临时文件。
  - **参数记忆**：执行过的参数按动作记住（`secret` 字段不记），下次打开直接带入，
    旁边给「清除记忆」。
  - **执行历史**：详情页保留最近 5 次执行（时间、状态、耗时、「重跑」），不用翻终端。
  - **插件健康概览**：插件面板顶部统计卡（动作数 / 组合动作 / 缺命令依赖 /
    缺插件依赖 / 缺配置），有问题直接点名插件。
  - **插件主页**：每个插件有独立主页（`#/plugins/<id>`），动作按风险摊开，
    可一键跳去配置或返回列表。
  - **AI 工作台建议**：工作台空态给四个可直接点的中文任务（系统概况、公网 IP、
    剪贴板、文件搜索），不知道能问什么时有个起点。

  测试：`test/extras-smoke.mjs` 23 项纯函数断言（主题解析、高亮分段、收藏排序、
  参数记忆、历史上限、健康统计、建议列表），`webui-smoke` 增 3 项接线断言；
  十项均按功能逐张真机截图验证。

## [0.5.0] - 2026-10-25

### Added

- **启动器内置集市面板（`#/market`）。** 集市此前只活在终端里：想装什么得先切出去
  `zkit market add` / `search` / `install`，再回来刷新——「发现插件」这一步在门面上是空的。
  现在顶部「集市」直接列出已添加的集市（本地目录 / git 都认），支持跨集市搜索、刷新、
  移除；点「安装」先把插件的每个动作（id / 标题 / 风险 / **真实命令**）摊开，
  确认后才落地，可勾选连带补装插件依赖；已装条目显示「已装 vX」，不会重复装。
  确认令牌绑定「集市 + 插件 id」——预览的是 A、实际装的是 B 会被拒绝。

## [0.4.0] - 2026-10-24

### Added

- **插件依赖：`[requires] plugins` + 一键补齐。** 组合动作让插件之间开始互相引用，
  「装了 A 却没装 B」于是变成一种新失败——错误出现在执行到第 3 步时。现在可以在清单里
  声明对其它 zerokit 插件的依赖：安装/更新后立刻提示缺什么、给出可照抄的
  `zkit plugin install <id>`；加 `--with-deps`（界面里是安装预览里的勾选框）会从
  仓库自带示例或已添加的集市里递归补齐（最多 6 层、防环）。组合动作的跨插件引用
  会自动折算成依赖；卸载还有插件依赖的插件会被拒绝（`--force` 放行）；
  `zkit plugin deps` 看依赖树、`doctor` 把缺依赖算进自检失败。

  **边界是有意收窄的**：只搬 zerokit 插件目录，**不代装 node 模块 / pip 包、
  绝不执行任何安装脚本**——第三方包的 postinstall 就是任意代码执行，不能塞进
  插件的安装流程里。

### Fixed

- **`[requires]` 命令依赖此前从未生效。** 清单示例与文档写的都是顶层 `[requires]`，
  但解析器读的是 `[plugin]` 下的 `requires`，于是它永远是空对象：`proxy` 声明依赖
  python、`show` 里的依赖行、执行前的「python 没装」检查**全都是摆设**。
  现在顶层写法优先、`[plugin].requires` 作为兼容回退，并补了断言钉住这两种写法。

## [0.3.0] - 2026-10-23

### Added

- **插件设置项（`[[setting]]`）：装一次、长期生效的配置，四端共用一份。**
  插件可以声明端点、账号、API Key 这类配置项（`name` / `type` / `default` / `secret` /
  `enum`），值存 `~/.zerokit/settings/<插件id>.json`（0600、原子写）。插件里用
  `{setting.token}` 取用，或者读 `ZEROKIT_SETTING_TOKEN` 环境变量；`zkit config`
  提供 `list/get/set/unset`，密钥建议 `--stdin` 传入，启动器的插件面板里有同一份表单。

  安全语义是显式的：密钥**明文存储、不加密、不进钥匙串**（安全边界是操作系统账号），
  展示、确认框、审计日志一律只回 `******`，CLI 要看真值必须 `--reveal`；
  `secret` 项不允许有 `default`（避免跟着清单进 git）；必填项缺失或值非法时在**执行前**
  拒绝并给出修复命令，不会静默拿默认值跑；`{setting.x}` 引用了没声明的项，**安装清单时**
  就报错。

### Fixed

- **审计日志不再因数据目录不可写而让整次调用抛异常。** 此前写审计流失败（目录被删、
  权限变了）会让动作本身崩掉——审计是旁路记录，不该成为主链路的单点。现在写失败吞掉，
  `ZEROKIT_VERBOSE=1` 时在 stderr 留一行原因。
- **集市登记表里三个示例插件的版本号落后于清单**（`clipboard` / `ip` / `proxy`
  自报 1.1.0，集市里还是 1.0.0），已对齐，避免安装前看到的版本与装完的不一致。
- **`--password={pass}` 这类内联写法的密钥打码从未生效。** 确认框与审计里展示的 argv
  是**展开后**的字符串，而打码函数比对的是 `{pass}` 模板，于是真值原样出现在
  「将要执行的命令」里。现在 `buildArgv` 同时产出 `argv`（真值）与 `redacted`（掩码），
  界面/确认框/审计只拿后者，内联前缀写法也按值匹配打码。

## [0.2.0] - 2026-10-21

### Changed

- **CI 测试矩阵从「只在 windows-latest」放开到三个平台**
  （ubuntu / macos / windows，各跑 Node 22，另在 Linux 单独跑当前的 Node 24）。
  以前只测 Windows 的理由是插件深度绑定它——代价是平台债永远看不见：
  macOS 上那 3 个失败一直到有人手动跑才发现。插件层跨平台化完成后，
  测试断言也跟着按平台分支了，这里把矩阵放开。顺手把 Linux 剪贴板的
  真实路径覆盖上（CI 装 `xclip` + `xvfb`，套件在 `xvfb-run` 下跑）。

  给写测试的人的提醒：Linux 上剪贴板工具缺失时，套件断言那句「需要
  xclip/xsel」的安装提示，而不是静默跳过——红要红在环境上，
  不能红在看不见的地方。

### Fixed

- **`tsc --noEmit` 重新变干净，并且 CI 现在真的会跑它。**
  `package.json` 里一直有 `typecheck` 脚本、文档一直写着「tsc 干净」，
  但 CI 与本地 `lint.sh` **都没有执行过这条命令**，于是两个只有类型检查才
  看得见的错误在核心里躺了很久：

  - `src/core/proxy.ts`——`@types/node` 22 起 `Buffer` 是泛型的，`Buffer.slice()`
    给出 `Buffer<ArrayBufferLike>`，跟 `Buffer.concat()` 的 `Buffer<ArrayBuffer>`
    互不相容。运行期毫无差别，只有 `tsc` 会报 TS2322。
  - `src/core/scaffold.ts`——`ScaffoldResult.load` 声明成了 `PluginEntry`
    （要求 `dir` 字段），实际赋的是 `loadDir()` 的 `LoadResult`（没有 `dir`）。
    消费方从来只读 `.plugin` / `.errors` / `.warnings`，所以一直没出事。

  新增 `typecheck` job（固定 ubuntu，类型检查与平台无关），并把它接进
  `CI 总览` 的 `needs` / `R_*` / 汇总表三处。新增 `test/ci-smoke.mjs`
  断言这条接线不会再次断开——这类「配置漂移」跑产品代码是发现不了的：
  文档写着干净、测试全绿、CI 全绿，而真相是那条命令从来没人执行。

### Added

- **组合动作（`type = "chain"`）：把已有动作按顺序拼成新动作，不用写代码。**
  每一步引用一个已有动作（`<插件id>.<动作id>`，本插件写 `self.<动作id>`），
  上一步的 stdout 用 `{别名}`、结构化结果用 `{别名.data.字段}` 带进下一步的参数；
  整条链路还能声明 `template`，把结果拼成一句话。四个面自动派生：CLI 多一条
  `zkit run`、MCP 多一个工具、启动器多一张表单和链路详情、AI 工作台一次调用就能
  完成多步。

  安全边界不含糊：链路的 `risk` 必须 ≥ 每一步的 `risk`，运行时逐一比对、
  不够就 **fail-closed**（否则一条 `read` 链路就能偷跑 `destructive` 步骤、
  绕过确认闸门）；不支持嵌套与后台步骤；所有步骤**先静态校验再执行**——
  不会先写完文件、再告诉你第三步引用的插件没装。`zkit doctor` 也会提前指出
  链路里引用了没装的插件或不存在动作。

  示例：`sysinfo` 新增 `brief`——把「系统概况」和「最吃内存的进程」两步拼成一段播报。

- **http 动作与 AI 工作台走系统代理。** 以前设了 `http_proxy` 也没用：Node 内置
  fetch 会把 `proxy` 选项**静默丢弃**（实测代理指向一个根本不存在的端口，请求也
  照样直连成功），于是流量绕过代理直接打到目标站，而没有任何地方会报错。
  现在内核自带代理支持：
  - 认 `http_proxy` / `https_proxy` / `all_proxy`（大小写都认），也认
    `config.toml` 里新增的 `[proxy]` 段（`url` / `no_proxy` 两个键）；
  - `no_proxy` 优先级高于代理，支持逗号分隔的域名 / 后缀 / IP / `*`；
  - https 目标走 CONNECT 隧道，http 目标走代理转发（absolute-form 请求行）；
  - 代理地址里带 `user:pass` 时走 `Proxy-Authorization`，且密码不会泄进错误信息；
  - 错误信息分得清「代理连不上」「代理拒绝建隧道」「代理要认证（407）」
    「经代理等响应超时」，而不是笼统一句「请求失败」。

  没配代理时行为与改动前**完全一致**（走原生 fetch）。`plugin add` / `plugin update`
  走的是 `git`，本来就认代理，不受影响。

## [0.1.0] - 2026-10-12

首个公开版本。「一份 `plugin.toml` 同时派生四个面（CLI / MCP / 启动器 / AI 工作台）」
的完整闭环：内核与执行收口、插件集市、插件更新、uTools 兼容层、原生壳
（Tauri），以及从脚手架到开发模式再到转正发布的完整插件开发链路。
纯本地、纯离线、无构建步骤，293 项断言一条命令跑完。

### Added

- 插件脚手架与开发模式，写插件的门槛从「手写整份清单」降到「改生成的骨架」：
  - `zkit plugin new <id>`——生成带教学注释的最小可用骨架（`--runtime python`、
    `--web` 附富交互页面骨架），生成即校验，并当场打印这个插件在四个面
    （CLI / MCP 工具 / 启动器 / 工作台）的样子；
  - `zkit plugin dev <目录>`——开发模式：以链接（Windows junction / 类 Unix
    symlink）安装本地目录，改 `plugin.toml` 或脚本**即生效**，四个面下一次
    调用全部跟上；`zkit plugin remove` 只删链接、不碰源目录；dev 状态下
    `zkit plugin add <同一目录>` 自动转正为真实副本；`plugin update` 对
    dev 插件如实提示「改源码即生效」而不是瞎更新；
  - `zkit plugin validate <目录>`——对任意目录校验清单并摊开全部能力，
    不要求已安装。


- 插件自带的富交互页面（Web 面）：动作声明 `render = "web"` 并在插件目录放
  `web/index.html`，结果交给插件自己的页面渲染（沙箱 iframe）。HTML 自动注入
  `zkit` 桥——页面可读取执行上下文、调用本插件的其它动作；页面拿不到会话令牌，
  执行必须经宿主转发，确认策略无法绕过。CLI 新增 `zkit web <插件id>` 直达。
- `output = "html"` 落地：stdout 即 HTML 片段时，启动器在沙箱 iframe 里直接渲染。
- 示例插件 `sysinfo` 的「系统概况」动作改为 web 形态（自带仪表盘页面，可经桥刷新）。
- 示例插件跨平台：剪贴板历史（clipboard）在 macOS（pbpaste/pbcopy）与
  Linux（xclip/xsel，缺了给安装指引）完整可用——新增 node 版轮询器
  `watch.mjs`（与 `watch.ps1` 行协议一致），判活改用 `process.kill(pid, 0)`；
  `sysinfo` 的进程列表支持 BSD ps（macOS 按内存排序，应用名提取不再截断）。
- http 动作的网络错误在检测到代理环境变量时附一句说明（Node 内置 fetch
  不走 `http_proxy`/`https_proxy`，直连失败时提示先 `unset`）。
- 插件更新：安装时记录来源（git / 集市 / 自带 / 本地目录），`zkit plugin
  update [id]` 检查并更新——版本变化与**动作增删**摊开确认后替换安装（备份式，
  失败回滚；插件数据目录不受影响）。本地 HTTP 面同步提供 `/api/plugin/install`
  （能力摊开 + 确认令牌）、`/api/plugin/check`、`/api/plugin/update`。
- 启动器界面重做：浏览态动作**按插件分组**（组头显示名称/版本/动作数，可折叠），
  搜索态保持扁平；新增**「插件」管理面板**（`#/plugins`）——粘贴 git 地址或本地
  目录安装（能力摊开预览 + 确认）、检查更新（版本与动作增删）、两步确认卸载。
- 动作执行时给插件注入 `ZEROKIT_PLUGIN_DATA_DIR` / `ZEROKIT_HOME` 环境变量
  （`{data_dir}` 占位符的环境变量等价物）；`proxy` 示例的配置与日志迁到数据目录，
  老位置自动兼容沿用。
- GitHub 项目基建：CI（测试矩阵 / 工作流静态检查 / 提交规范 / 安全扫描）、
  Issue 与 PR 模板、Dependabot、自动打标、Stale 清理、OSSF Scorecard。
- 治理文件：LICENSE（MIT）、CONTRIBUTING、CODE_OF_CONDUCT、SECURITY、MAINTAINERS。

### Fixed

- `zkit ui --open` 在非 Windows 平台上崩溃（原来只会用 Windows 的
  `cmd /c start` 打开浏览器，且错误处理接不住失败）。

### Changed

- `proxy` 示例插件默认白名单从特定公司域名改为 `example.com` 模板值，
  版本升至 1.1.0；`clipboard` 升至 1.1.0。
- 示例插件 `jlc-proxy` 更名为 `proxy`，插件目录自包含
  （不再指向外部安装路径）。

## [1.69.0] - 2026-11-07


### Added

- `zkit why <报错原文>`——把报错翻译成「发生了什么 + 下一步敲什么」，与 Web 错误知识库同源（同一份 ERROR_BOOK，CLI 侧 createRequire 转发 import）；`--last` 直接解释最近一条失败记录；认不出诚实说 exit 1 并给排查方向；`--json` 机读 {kind,cause,next}。
- `zkit config <插件> env`——生成脚本里引用设置项的环境变量引导（bash `export` / `--shell fish` `set -x`），值恒掩码只给键名；`--json` 机读。
- `zkit logs --errors`（同义 `--failed`）——审计日志只列失败记录。
- 修复：审计日志里 `decision=allow` 但带 `error` 字段的记录此前显示绿色 ✓，现按失败红 ✗。

## [1.71.0] - 2026-11-07

### Added

- Web 端 .zshare 分享闭环：结果区新增「分享包」下载（与 CLI buildSharePack 同构，read 带结果）；设置抽屉「导入分享包」（选文件→校验→展示：动作/时间/来源环境/指纹/结果预览，「来自分享包」徽标视觉区分）；导入包可本机重放（read 直接跑、mutate 弹确认、destructive 显示拒绝原因不可点）；Web 端指纹走 WebCrypto SHA-256（与 CLI 同结果）；新增 `/api/share/import` 端点（校验+审计 share-import）；坏包拒绝文案与 CLI 同源。

## [2.7.0] - 2026-11-09

### Added

- 桌面壳与 CLI/启动器一致性巡检：托盘「打开设置」从跳回首页改为真正打开设置抽屉（openDrawer 挂 window 供壳 eval 调用）；热键对照表 docs/reference/desktop-keys.md（全局 Alt+Space 系 vs UI Ctrl 系分层审计原则——两层永不交叉）；Cargo/main.rs 补版本语义注释（壳号即内核号，release-prep 五处同步保证）。
