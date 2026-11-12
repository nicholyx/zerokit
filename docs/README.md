# zerokit 文档导航

按「上手 → 概念 → 参考 → 深入」四层组织，按需取用。

## 上手（guide/）

| 文档 | 内容 | 什么时候看 |
| --- | --- | --- |
| [十分钟上手](guide/quickstart.md) | 从 clone 到跑通第一个动作 | 第一次接触本项目 |
| [项目故事](guide/story.md) | 为什么做、关键决策、走过的弯路、里程碑年表 | 想理解「为什么是现在这样」 |
- [维护模式判据](guide/maintenance-patterns.md) —— 三类维护轮型与选型启发
- [v3 事故全回顾](guide/v3-incident-index.md) —— 发布链事故判据索引
- [v4 展望](guide/v4-outlook.md) —— 候选方向议题池（[272 轮全条目对账](guide/v4-outlook.md#第-272-轮全条目对账2026-11-13v3640)：三方向 46%，服务编排 100%）
| [术语表](guide/glossary.md) | 内核/插件/动作/风险档/集市……都是什么 | 被名词绕晕时 |
| [常见问题](guide/faq.md) | 安装/平台/插件排错 | 卡住了先翻这里 |

## 概念（顶层）

| 文档 | 内容 | 什么时候看 |
| --- | --- | --- |
| [架构](architecture.md) | 四个面（CLI/MCP/启动器/桌面壳）与数据流 | 想理解整体设计 |

## 参考（reference/）

| 文档 | 内容 | 什么时候看 |
| --- | --- | --- |
| [动作速查表](reference/actions-reference.md) | 全部内置动作 × 风险 × 参数 | 找「有没有现成的」 |
| [插件清单规范](reference/plugin-spec.md) | plugin.toml 全字段 | 写插件前必读 |
| [uTools 兼容矩阵](reference/utools-compat.md) | 逐 API 支持表 + 移植指引 | 想跑存量 uTools 插件 |
| [v2 基线指标](reference/baseline-v2.md) | 冷启动/测试规模/插件数基线（脚本生成） | 评估性能回归 |
| [依赖清单](reference/dependencies.md) | 每个依赖一行「为什么需要」+ 依赖规则 | 评审新依赖 / 供应链巡检 |
| [桌面壳热键对照](reference/desktop-keys.md) | 全局热键 vs UI 快捷键分层表 + 审计原则 | 改热键/排冲突前必读 |
| [可复现构建](reference/reproducibility.md) | lockfile/engines/Cargo.lock 审计记录 + 已知差距 | 构建问题排查 |
- [MCP 探针体系](reference/mcp-probe.md) —— 四入口核对工具面：不拉起 MCP server
- [服务编排体系](reference/service-orchestration.md) —— requires/拓扑启动/健康探针/逆序关停
| [Cookbook](reference/cookbook.md) | 十篇实战配方 | 照抄解决常见任务 |
| [项目账本](reference/overview.md) | 已完成/待办/已知差距 | 想知道项目现状 |

## 深入（deep/）

| 文档 | 内容 | 什么时候看 |
| --- | --- | --- |
| [设计取舍](deep/design.md) | 为什么没有构建步骤、为什么 MCP annotations 不可信 | 想挑战设计前先读 |

---

另有两个仓库根文档：[START-HERE.md](../START-HERE.md)（怎么跑起来）、[CHANGELOG.md](../CHANGELOG.md)（每版改了什么）。
