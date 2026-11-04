## [Unreleased]

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

