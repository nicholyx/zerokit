# Changelog

## [Unreleased]

### Added

（下一版攒着）

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

## [3.15.0] - 2026-11-10

### Added

- guard146 计数同步自动化（根治连续三轮同款事故）：scripts/sync-counts.mjs 从 test-all 实际跑出的数字自动同步 overview/START-HERE 两处基线行；guard146 三条计数 FAIL 报错统一引导「跑 node scripts/sync-counts.mjs 自动修正」；CONTRIBUTING 增维护轮改计数流程。

## [3.14.0] - 2026-11-09

### Added

- 搜索拼音增强：scorePinyin 融合容错档——漏/错一个字母的近似前缀（编辑距离 ≤1，44/36 两档）排在所有精确命中之后；pinyinFuzzyScore 独立导出（可测）；romanize 内建 cache（8000 条）复用确认（⑤ 性能已有）；extras-smoke +1 断言（fuzzy 分档 + 精确不变）。
- 修复：CI npm ci 显式指定官方 registry——lockfile 里 110 条 resolved URL 是 npmmirror（本机全局 npm config 写入随 lockfile 提交），npmmirror 数据库故障时 CI 安装全挂。显式 --registry 覆盖 lockfile 的 resolved，CI 不再依赖第三方镜像可用性。

## [3.13.0] - 2026-11-09

### Added

- 总检页深化——历史趋势与导出：/api/health-snapshot GET 落盘 health-history.jsonl（保留 60 条）；/api/health-history GET 端点；UI dashboard 历史趋势区（最近 10 条快照表）；CLI zkit dashboard --history（文本历史）/--export 文件（当前快照 JSON 导出）；I18N dashHist 四键 zh/en。

## [3.12.0] - 2026-11-09

### Added

- 四面健康总检页（第 220 轮整轮里程碑）：/api/health-snapshot 端点（聚合 doctor/服务/缓存/插件）；UI #/dashboard 全景页（五瓷贴：版本/doctor/服务/缓存/插件，dash-tiles 复用）；CLI zkit dashboard（文本版全景）；命令面板「全景总检」顶置入口 + 抽屉链接；I18N dash220 十一键 zh/en。

## [3.11.0] - 2026-11-09

### Added

- 服务日志查看：startService stdout 落 LOG_DIR（bg.插件.服务.log，与 runner 后台动作同约定——日志有源可查）；zkit service logs 插件.服务 [--tail N]；/api/services/logs GET 端点；UI 面板每行「日志」按钮（抽屉展开尾部，再点收起）；无日志服务显示友好提示；I18N 三键 zh/en。

## [3.10.0] - 2026-11-09

### Added

- 服务生命周期安全收口：startService 补 run 命令来源校验（argv[0] 必须是已知工具或插件目录内路径——防越界命令）；/api/services/start 补审计（decision + reason，与 CLI stop 同语言）；UI 面板停止/重启按钮确认守卫；面板 5s 自动刷新运行状态。

