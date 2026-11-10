# v3 线发布链事故全回顾（第二百四十轮立）

> 201-239 轮全部发布链事故的判据索引——一次讲完，按主题分组。
> 每条事故在当轮 issue 验收记录有完整过程。

## 网络/依赖类

| 事故 | 轮次 | 判据 |
|---|---|---|
| NSIS CDN 504（actionlint/NSIS zip 下载挂） | 多轮 | `curl -r 0-100` 探针**连续 2 次 2xx**才 `gh run rerun`；语法是 `rerun --failed` |
| npmmirror 数据库故障击中 CI | 222/233 | `--registry` 只改元数据源不改 tarball URL——**lockfile resolved 必须重写官方源**；修复提交不走会被 squash 的 feature 分支 |
| lockfile 带入本机镜像 resolved | 222 | 本机 `npm config` 全局镜像会写进 lockfile——提交前扫 `registry.npmmirror` |

## Git 工作流类

| 事故 | 轮次 | 判据 |
|---|---|---|
| feature 分支修复被 squash 合并丢失 | 233 | **修 CI 的提交直接进 main**（或独立 PR），绝不走会被 squash 的 feature 分支 |
| rebase 修复链丢 release-prep 产物 | 233/233 | rebase 后必须 `release-prep --check` 复核五处版本与归档 |
| merge commit 不合约定式被 commit-msg 检查拦 | 233 | 修复链保持线性 cherry-pick，不产生 merge 提交 |
| CHANGELOG 归档提交丢失（tag 指向缺账本 commit） | 217/233 | release.yml 拒绝无账本版本（护栏本身是对的）；修复=手工归档+tag 重指 |

## 文档/护栏类

| 事故 | 轮次 | 判据 |
|---|---|---|
| 改 START-HERE 漏改 overview（计数漂移） | 220/221/222 连续三轮 | `node scripts/sync-counts.mjs` 自动同步（223 轮建）；guard146 报错自带一键修复引导 |
| sync-counts 计数漂移死锁 | 224 | `--force` 捕获非零退出仍按实际输出解析（guard146 红→test-all 非零→异常抛出） |
| CHANGELOG >12 段超限 | 218/233 | release-prep 自动归档最旧段；护栏照常工作不算事故 |
| FFFD U+FFFD 注入中文 | 多轮 | heredoc/python 写中文是高危操作——FFFD 扫描器八审计线兜底，提交前必扫 |

## tauri/release.yml 类

| 事故 | 轮次 | 判据 |
|---|---|---|
| tauri-action 失败把 Release 转 draft | v1.13 起已知 | 幂等重入 `gh release edit --latest` 对 draft 报 422——先 `--draft=false` 再 rerun-failed |
| 重跑残留旧版本名资产 | 217 | 重跑前删 stale release；资产名必须含当轮版本号再确认齐 |

## 元判据

1. **护栏抓到 = 护栏在工作**（不算护栏的锅）；修复要连判据一起落盘。
2. 同款事故第二次出现就必须机器化（sync-counts 即由此而来）。
3. 判据要可执行：「跑 X 命令」>「注意 Y」>「记住 Z」。
