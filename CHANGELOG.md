# Changelog

## [Unreleased]

### Added

（下一版攒着）

## [3.27.0] - 2026-11-10

### Added

- 零命中词查看面与同义词表培育：开发者面板新增零命中词管理区（列表/单条删除 chip×/一键清空确认/空态友好提示）；副文案引导高频词进 SYNONYMS（web/extras.js）——零命中数据从收集→利用→可管理可培育；I18N zeroHits 七键 zh/en；webui +2 断言。

## [3.26.0] - 2026-11-10

### Added

- 零命中词消化闭环：suggestFromZeroHits 纯函数（拼音域编辑距离 ≤2——候选 label/py 形态匹配 full 与 initials 各一次，返回原文 top3）；0 命中时命令面板显示「你可能在找」chips（点击即填入重搜；无建议零打扰）；I18N zeroSuggestLabel zh/en；extras-smoke +2 断言（拼音域命中/top3 分档）。

## [3.25.0] - 2026-11-10

### Added

- 命令面板命中率反馈：paletteMatchLine 纯函数（命中数/候选总数——0 命中明示「无匹配」并引导换短词/拼音）；非空查询时 foot 显示命中率行（0 命中标红）；recordZeroHit 高频零命中词本地收集（去重保序上限 30、短词不收——为后续同义词表做数据）；extras-smoke +2 断言。

## [3.24.0] - 2026-11-10

### Added

- 审计导出与面板筛选同口径复核 + 文件名上下文化：CSV/JSON 导出走 filterAudit（113 轮既有）复核锁定（webui 断言）；CSV BOM + exportMime 令牌复核；导出文件名带筛选上下文（range/outcome 进文件名——多份导出不混淆）。

## [3.23.0] - 2026-11-10

### Added

- 审计面板时间范围筛选补「最近 1 小时」：AUDIT_RANGES 四档→五档（1h 滚动窗口——与 today 的自然日边界不同，排障窗口更贴身）；filterAudit 支持 1h 档；CLI zkit audit --since 既有（1h/30m/3d/2w/45s 五单位）复核打通；extras-smoke +2 断言（1h 命中排除/组合正交）；audit113 四档断言更新为五档。

## [3.22.0] - 2026-11-10

### Added

- 服务面板日志抽屉与下载：行内展开支持 tail 参数选择（30/100/全部）；下载完整日志按钮（.log 文件，exportMime txt）；server /api/services/logs 支持 tail=all（钳 5000 行防超大响应）；错误行高亮（error/fail/✗/exception 标红）；webui +2 断言。

## [3.21.0] - 2026-11-10

### Added

- 导入快照安全边界强化：parseZkresult 三重防线——大小上限 8MB（超限友好报错，先查长度再 JSON.parse 防卡死）、原型污染键剥离（__proto__/constructor/prototype 净化副本）、深嵌套深度钳制（12 层截断防爆栈）；extras-smoke +3 断言（超大/污染键/100 层深嵌套）。

## [3.20.0] - 2026-11-10

### Added

- result 分享页与 zkresult 双向往返：分享页（#/share/<id>）新增「导出 zkresult」按钮（buildZkresult 完整落盘 visCols/rows/at——对方可导入回放）；extras-smoke +1 往返等价断言（buildZkresult → parseZkresult 字段一致）。

## [3.19.0] - 2026-11-10

### Added

- CLI JSON 输出契约 v1：docs/contract/cli-json-v1.md 契约文档（doctor/list/ps/service/cache 五命令稳定字段表+消费者守则——v1 内不改名不删除，只加不改）；service list --json 机读输出补齐（pluginId/id/running/canStop/canStart）；contract-v1-smoke 新文件 8 断言（逐命令关键字段快照，破坏即红）；README/CONTRIBUTING 提及契约文档。

## [3.18.0] - 2026-11-10

### Added

- watch 面板体验补全：采样失败原因展示（watch-fail-reason 行内文本，截断 120 字）；三态徽标（⏱ 运行中/✗ 连续失败/⏸ 暂停）；面板改轮询间隔（输入框+确认，scheduleWatch 重启下轮生效+persistWatch 落盘重启保留）；webui +2 断言（接线/落盘）。

## [3.17.0] - 2026-11-10

### Added

- CLI 导出与 UI 对齐：audit --export csv 落文件加 UTF-8 BOM（Excel 中文兼容，stdout 保持纯文本供管道）；--out 无扩展名自动补 .csv；cli120-smoke +2 断言（BOM 字节核对/自动扩展名）。

## [3.16.0] - 2026-11-10

### Added

- 导出格式规范化：exportMime 五类映射（csv/json/md/txt/zkresult.json，未知兜底 octet-stream）进 extras；全站 15 处下载点字面 MIME 统一接令牌；CSV 全部加 UTF-8 BOM（Excel 中文不乱码）；watch CSV 文件名统一走 exportFilename（时间戳形态）；extras-smoke +1 断言（五类映射+边界）。

