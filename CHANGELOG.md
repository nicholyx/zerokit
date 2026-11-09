# Changelog

## [Unreleased]

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

