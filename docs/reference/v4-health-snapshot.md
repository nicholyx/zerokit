# v4 线健康快照（323 轮初版，337 轮刷新至 v4.50.0——2026-11-20）

> v4 线快照：323 轮初版（36 轮定盘星），337 轮刷新（v4.50.0），348 轮刷新（v4.60.0）。
> 注：overview「已完成」清单自 v4 中期起未再逐轮追加行（插入守卫静默跳过——已知债务），
> 本快照承担 v4 线轮次清单职责。

## ① 技术基线指纹

| 指标 | 值 |
|---|---|
| 测试文件 | 197 个 |
| 断言基线 | 以 scripts/assertion-baseline.json 为准（3533 级——后续轮次自然增长，不在本页追数字） |
| 内建步 | 4 件套（pipe / export / read / stats 多列+window） |
| 组合拳回归 | 2 条（数据 combo321 / 协作 collabcombo322）+ 月度例跑清单（dep-hygiene） |
| lint 审计线 | 9 线（含 web-strict-check） |
| 发布链 | 手册模式全自动（runbook） |

## ② 测试主题分布（按文件名前缀归类）

| 主题 | 文件数 |
|---|---|
| 内核与其它（plugin/cli/run/core） | 130 |
| 数据工作流（zerocol/pipe/chain/dataflow/watch） | 19 |
| 协作面（mcp/broadcast/collab/presence） | 16 |
| UI/浏览器（ui/web/cdp/panel） | 12 |
| 稳定性（lint/perf/strict/platform） | 11 |

## ③ v4 线轮次清单（36 轮详单——增量见 v4-outlook 50/60 版本里程碑节）

> 路线图定稿：v4.5x 维护节奏（月度例跑/积压清零/烟测年检）；v5.0.0 三候选真实诉求触发（详见 v4-outlook「里程碑路线图定稿」）。

| 轮 | 版本 | 主题 |
|---|---|---|
| 288 | v4.0.0 | 起航：双主题排定（协作面/数据工作流/桌面冻结） |
| 289 | v4.1.0 | 多客户端广播（每会话独立 server——修 SDK 单 transport） |
| 290 | v4.2.0 | presence（joined/left + sessions 查询） |
| 291 | v4.3.0 | pipe 管道原语（stdout→stdin） |
| 292 | v4.4.0 | builtin.zerocol-export（columns 取值落盘） |
| 293 | v4.5.0 | 广播结果摘要（脱敏 + 4KB 分档） |
| 294 | v4.6.0 | builtin.zerocol-read（首行捷径 + 往返 checksum 全等） |
| 295 | v4.7.0 | watch 触发 chain（调度面） |
| 296 | v4.8.0 | 广播频控（节流 + 静默窗口 + presence 豁免） |
| 297 | v4.9.0 | v4 阶段复盘（双主题进度对照） |
| 298 | v4.10.0 | 广播过滤订阅（filterTools 前缀） |
| 299 | v4.11.0 | 协作锁（busy-locked 三路释放；顺带修 Chrome 158 logs.js 笔误） |
| 300 | v4.12.0 | 三百轮盘点（旅程摘要 + 下一百轮候选） |
| 301 | v4.13.0 | zerocol append 多行积累 |
| 302 | v4.14.0 | 管道 DSL 指南（data-pipelines.md） |
| 303 | v4.15.0 | 跨浏览器语法巡检（web-strict-check 第九线） |
| 304 | v4.16.0 | perf 阈值机器自适应（基线×2.5；修 Windows file:// ESM） |
| 305 | v4.17.0 | 平台判据手册（platform-pitfalls.md） |
| 306 | v4.18.0 | 市场安装计数（真实使用信号起步） |
| 307 | v4.19.0 | 协作指南（collaboration.md） |
| 308 | v4.20.0 | dataflow 实战插件（端到端示例入驻 market） |
| 309 | v4.21.0 | builtin.zerocol-stats（min/max/avg/count 内置化） |
| 310 | v4.22.0 | watch×dataflow 端到端闭环（/api/run fresh 坑） |
| 311 | v4.23.0 | UI 协作面板（#/collab 三块 + 快照） |
| 312 | v4.24.0 | 协作面板操作化（过滤编辑/锁释放） |
| 313 | v4.25.0 | updater 就绪度评估（冻结维持） |
| 314 | v4.26.0 | dataflow 注释升级（活教材跟上） |
| 315 | v4.27.0 | stats 多列（columns 分组） |
| 316 | v4.28.0 | stats 摘要进 watch（通知人话化） |
| 317 | v4.29.0 | v4 看板更新（四线全景刷新） |
| 318 | v4.30.0 | 双指南进主路径（START-HERE 三条路） |
| 319 | v4.31.0 | zerocol Windows 路径守护（静态审查 + 判据固化） |
| 320 | v4.32.0 | stats 窗口统计（window 最近 N 行） |
| 321 | v4.33.0 | 数据工作流组合拳回顾 |
| 322 | v4.34.0 | 协作面组合拳回顾 |
| 323 | v4.35.0 | v4 全量回归基线固化（本快照） |
