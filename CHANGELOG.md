# Changelog

## [Unreleased]

### Added

（下一版攒着）

## [3.52.0] - 2026-11-12

### Added

- MCP 探针体系收官文档（255-259 五轮体系单一参考）：docs/reference/mcp-probe.md——四入口清单（Web 直调/schema、#/mcp 面板、CLI probe）/五支撑端点/三使用场景（插件作者核对 schema、集成排障、CI 验证）/与 dry-run 边界表（probe 执行 vs dry-run 只看）/审计来源/三层防线 MCP 特化；v4-outlook MCP 深化条目销项（已完成探针体系+审计回流，剩余远程 MCP 与资源订阅）；docs 导航接入。

## [3.51.0] - 2026-11-12

### Added

- MCP 探针 CLI 面——zkit mcp probe（255-258 UI 三面的 CLI 对位）：不起 MCP 进程直调工具（插件__动作；--params '{}' 传参；--json 机读）；--schema 打印 inputSchema（256 轮 GET 的 CLI 对位）；错误三态同款（not-found/bad-params/not-authorized）；审计 caller=mcp-probe；用法表登记。MCP 深化五步弧线完成（255-259）：UI 直调→schema 预览→工具面板→资源面板→CLI probe——四面（CLI/启动器/MCP/桌面壳）现在都能不拉起 MCP server 核对工具面。

## [3.50.0] - 2026-11-11

### Added

- MCP 资源面板——zerokit:// 七资源 UI 化（MCP 深化第四步）：/api/mcp-resources GET（resources/list 同构清单）+ /api/mcp-resource?uri= 单资源读取（plugins/health/runs/audit/watch/timers 六实现，{key} 模板示例填充）；UI #/mcp 面板加「资源」tab（行点击展开 JSON——模型可读快照一屏核对）；OpenAPI 登记；I18N 四键；webui +2 断言；顺手修一个 ps-empty 漏 role=status 的 a11y 回归。

## [3.49.0] - 2026-11-11

### Added

- MCP 工具清单面板——tools/list UI 化（MCP 深化第三步）：/api/mcp-tools GET（name/title/inputSchema/annotations 全量——与 MCP tools/list 同构，52 工具实测）；UI #/mcp 面板（工具表：名称/插件·动作/风险/readOnly-destructive hints）；行点击展开 inputSchema + 「直调」按钮（串起 255/256 两轮——面板内完成看 schema→调→核 _meta 全链路）；命令面板「🔌 MCP 工具清单」入口；I18N 九键 zh/en；OpenAPI 登记；webui +2 断言。

## [3.48.0] - 2026-11-11

### Added

- MCP 探针工具清单联动——inputSchema 预览（MCP 深化第二步）：/api/mcp-probe GET（tool=插件__动作 → inputSchema/插件元数据/动作风险机读——toJsonSchema 复用）；UI 动作详情页「inputSchema」折叠按钮（模型实际看到的 JSON Schema——min/max/pattern/enum 透传核对，215 轮字段一屏可见）；未知工具 -32602 透传；OpenAPI 登记；webui +2 断言。

## [3.47.0] - 2026-11-11

### Added

- MCP 工具直调探针（v4 展望 MCP 深化第一步）：server /api/mcp-probe POST——进程内走 runner、MCP 信封语义响应（jsonrpc 2.0/content blocks/_meta/isError；错误透传 tool-not-found/bad-params/not-authorized 三态）；UI 动作详情页「MCP 调用」按钮（tools/call 语义直调、结果含 _meta 元数据）；授权策略同款（只读放行、副作用须 mcp allow）；Caller 类型扩展 mcp-probe 审计来源；OpenAPI 登记；webui +3 断言。

## [3.46.0] - 2026-11-11

### Added

- 三层防线文档化（拆分系列最终判据汇编）：app-split-plan 补篇——职责矩阵（L1 静态断言查文本 / L2 注入面契约查结构 / L3 CDP 运行时查行为，各层天然漏什么、为什么需要下一层）；各层抓出的真缺陷记录（L3 抓 26 处含九轮潜伏、L2 抓 251 轮漏网之鱼、L1 三行秒级回归不可替代）；通用化模板（双侧约定→L2、组合爆炸→L3、其余 L1）；一句话判据「存在性断言永远不能证明可达性」。v4 及后续大型重构的验收模板。

## [3.45.0] - 2026-11-11

### Added

- 域文件注入面契约静态断言（251 轮缺口类别的第二道防线）：test/domain-faces-smoke.mjs——括号平衡解析双侧键集（域文件解构键 ⊆ app 注入对象键，9 域全覆盖）+ 跨域引用须有注入依据；契约断言当场抓出一个真实缺口（market 的 exitMarket 解构了但 app 未注入——251 轮手工修复的漏网之鱼）+ 一个命名规范偏差（cdp-regression → cdp-smoke 对齐 -smoke.mjs 统计口径）；全量 134 文件 / 3155 断言。

## [3.44.0] - 2026-11-11

### Added

- CDP 面板回归进 CI（251 轮判据常态化）：test/cdp-regression.mjs——自管 server + headless Chrome 生命周期（端口自避）、12 面板逐个打开断言渲染、console/异常 = 0 硬断言；无 Chrome 环境优雅 skip（exit 0）；CI ubuntu 加 chromium 安装步；进 test-all（全量 133 文件 / 3137 断言含 CDP 3 条）。从此每个 PR 都做运行时验证。

## [3.43.0] - 2026-11-11

### Added

- 拆分后运行时回归与三层注入缺口修复（第 251 轮）：CDP 干净会话逐面板扫描（12 面板）发现并修复拆分系列的**运行时缺陷层**——静态断言全绿但 CDP 实测暴露 26 处注入缺口（getter 块嵌套坍塌：__batch 工厂体吞掉了后续 7 个 getter 声明；域文件解构与调用点漏配：mode/$/el/readJson/AUDIT_RANGES/exitMarket/exitStats/renderQuietSection/watchStopLog/accent 等）；全部桥接修复后 12 面板 CDP 零 console error、面板路由链完整恢复。**判据**：拆分类重构必须有「真实浏览器逐面板零错误」验收，静态断言不能替代运行时验证。

## [3.42.0] - 2026-11-11

### Added

- app.js 拆分系列收官（第 250 轮整五十里程碑）：renderTextView 补迁 panels.js（243 轮遗留——根因「参数解构的 { 被误当函数体起点」已解：提取器先括号平衡再定位函数体）；方案文档收官章（九步数据表：10 域文件/61 函数/-1852 行/44 条断言改动；三次判据升级：注入式→迭代验证式→整域内聚+状态桥接；明确 app.js 剩余 9421 行不再继续拆）。

## [3.41.0] - 2026-11-11

### Added

- app.js 拆分第九步——设置/主题/剪贴板域注入式迁出：5 个函数（applyTheme/applyAccent/applyFontScale/cycleTheme + showClipPanel）整域迁 web/themeclip.js（createThemeClip(ui) 工厂 + __tc() 惰性 getter）；零断言改动（主题断言锚在 extras 的 normalize/resolve 纯函数）；app.js 9442 行（九步累计 -1831）。

