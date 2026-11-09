# Changelog

## [Unreleased]

### Added

（下一版攒着）

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

