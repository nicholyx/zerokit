# 维护者

zerokit 的**版权归 zerokit 项目所有**，见 [`LICENSE`](LICENSE)——署名是
项目名而不是个人，这样维护者更替时版权归属保持稳定。

本文件记录**实际负责维护的人**，即提交、评审、发布这些事由谁来做。

| 维护者 | 邮箱 | 主要职责 |
| --- | --- | --- |
| [@nicholyx](https://github.com/nicholyx) | nicholyx@163.com | 项目发起人、仓库管理员（Admin） |

## 联系方式

- **Bug 与功能建议**：走 [Issue](https://github.com/nicholyx/zerokit/issues/new/choose)。
  不要直接私信——公开讨论能让遇到同样问题的人受益，也能留下可检索的记录。
- **安全漏洞**：按 [`SECURITY.md`](SECURITY.md) 的私有渠道报告，不要在公开 Issue 里贴。
- **合作、授权等事务**：通过上表邮箱联系。

## 维护者名单的同步位置

增删维护者时，以下几处需要一起改（缺一处就会出现「名单不一致」）：

- 本文件
- [`.github/CODEOWNERS`](.github/CODEOWNERS) —— GitHub 据此把评审请求路由到对应维护者
- [`package.json`](package.json) 的 `author`（如已声明）

## 维护流程速查

日常迭代遵循 [维护循环](CONTRIBUTING.zh-CN.md#工作流)：Issue → 分支 →
PR → CI 绿 → 合并。除此之外，维护者还要盯这些自动化：

| 自动化 | 位置 | 频率 |
| --- | --- | --- |
| Dependabot 依赖 PR | 依赖面板 | 每周一 |
| Stale 清理 | Issue / PR 列表 | 每天（60 天无动静标记，再 14 天关闭） |
| OSSF Scorecard 评分 | Security 标签页 | 每周六 |

Dependabot 的 PR 和普通 PR 走同一套流程：CI 绿了即可合并；它带来的
风险主要是「新版本有 bug」，冷却期（7 天）已经挡掉了大部分。
