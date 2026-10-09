---
name: oss-bootstrap
description: 把一个新项目（或只有代码的裸仓库）快速落实为符合主流规范的开源项目——CI、治理文件、Issue/PR 模板、仓库自动化、文档体系、看板与发布流程。当用户说「新建开源项目」「给项目加上 CI / 规范」「按热门开源项目的标准搭基建」时使用。项目已具备这些基建后，日常迭代请改用 maintain-loop skill。
---

# 开源项目 Bootstrap（oss-bootstrap）

把一个裸仓库变成结构完整的开源项目。zerokit 已完整走过一遍这条路
（2026-10-09 落地，参照 cc-analyzer 的实践按本仓库技术栈适配），本仓库的
`.github/`、`scripts/`、`CONTRIBUTING*.md` 就是成品。本 skill 把流程沉淀为
六个阶段，路径均相对本仓库根——既是本仓库的说明，也适用于下一个项目。

## 与 maintain-loop 的关系

- 本 skill：从 0 到 1 搭基建（只做一次，或大改时回来对照）
- `maintain-loop` skill：基建就位后，日常迭代的闭环（规划 → 实现 → 发布）

搭完基建后，一切开发工作都应切换到 maintain-loop 的流程。

## 第零步：先判断，再动手

1. **项目类型与工具链**：语言、构建工具、测试框架——决定 CI 里静态检查与测试的内容。
   常见映射：bash → shellcheck + bash -n；YAML → yamllint；Go → golangci-lint + go test；
   JS/TS → eslint + vitest/jest；Python → ruff + pytest。
   zerokit 的特殊性：**无构建步骤**（Node ≥22.18 原生跑 TS 源码），
   测试是 `node scripts/test-all.mjs`；插件深度绑定 Windows（PowerShell /
   explorer），CI 矩阵因此暂锁 windows-latest。
2. **仓库现状**：`gh repo view`、已有文件清单、是否 fork（fork 需要先在网页端脱离
   fork network，操作见记忆/文档，API 做不了）、已有 Secrets 与变量。
3. **权限**：`gh auth status` 确认 scopes（repo / workflow）；操作 Projects 看板需要
   `project, read:project` scope，缺失时请用户执行
   `gh auth refresh -s project,read:project`。
   `project, read:project` scope，缺失时请用户执行
   `gh auth refresh -s project,read:project`。

**不要一次性问用户一堆问题**。语言与现状自己判断；只有 LICENSE 选择（MIT / Apache-2.0 …）
和「是否已有用户/破坏性变更」这类真正属于用户的决定才需要确认。

**实施节奏**：按阶段推进，每个组件独立分支 + 独立 PR（小批量提交，CI 全绿再合并），
遵循 maintain-loop 的分支与合并规范。

---

## 阶段一：地基 —— CI 与提交规范

这是其他一切的前提：先让「每次改动都被自动检查」跑起来。

1. **CI 工作流**（参考 `.github/workflows/ci.yml`），骨架固定为：
   - 静态检查：actionlint（工作流自身的 YAML 之外能查出表达式/上下文错误）+ yamllint，
     版本固定（可复现）
   - 测试：`node scripts/test-all.mjs`（自包含、不联网、不花钱），矩阵按平台 × 大版本
   - 提交信息校验：Conventional Commits，脚本方式实现（参考 `scripts/check-commit-msg.sh`），
     同时校验区间内的提交与 PR 标题（squash 后标题即提交信息）
   - **ci-summary 汇总 job**：`needs: [全部检查]` + `if: always()`，把所有检查汇总成一个
     结果——分支保护规则只需要盯这一个 check，增删检查项不用改保护规则。
     汇总脚本自带「needs 集合 == 汇总表集合」的自证断言，漏改会自己红
2. **本地统一入口** `scripts/lint.sh`：一条命令跑完 CI 里**本地能跑**的那些静态检查，
   CI 与本地跑的是同一套，避免「本地能过 CI 不过」。本地根本验不了的（如 PR 标题——
   它在 PR 建立前不存在）就如实写「不在其中」，别为了凑齐清单硬接一个假绿进来。
3. **最小权限**：CI 声明 `permissions: contents: read`；需要写权限的工作流在各自文件里
   单独声明。所有 `run:` 块开头 `set -euo pipefail`，**Windows runner 上的 job 必须显式
   `shell: bash`**（shebang 在 pwsh 下不生效——本仓库踩过，见 maintain-loop）。

## 阶段二：治理文件与模板

| 文件 | 参考 | 要点 |
| --- | --- | --- |
| `LICENSE` | 根目录 | 用户选型；**纯许可证文本，不加附加段落**（否则 GitHub 无法识别，显示 NOASSERTION）；署名用项目名而非个人，维护者更替时版权稳定 |
| `CONTRIBUTING.md`（+中文版） | 根目录 | 流程、提交规范、本地检查入口、插件怎么写 |
| `CODE_OF_CONDUCT.md` | 根目录 | 简短行为准则即可 |
| `SECURITY.md` | 根目录 | 漏洞报告渠道 + 威胁模型——本项目把「插件会真实执行命令」「MCP 副作用动作默认拒绝」写清楚了，值得照做 |
| `MAINTAINERS.md` | 根目录 | 实际维护者名单 + 名单的同步位置 + 维护流程速查 |
| `CODEOWNERS` | `.github/` | 关键路径指定 reviewer（工作流、治理文件、插件清单） |
| Issue/PR 模板 | `.github/ISSUE_TEMPLATE/` | YAML forms 而非 markdown；Issue 至少分 bug / feature / docs 三类；config.yml 指向安全报告渠道并关闭空白 Issue |
| `.gitignore` | 根目录 | 语言惯例 + 编辑器目录 + 数据目录（`~/.zerokit/` 不在仓库里） |
| `CHANGELOG.md` | 根目录 | Keep a Changelog 格式，`[Unreleased]` + 固定六分类 |

## 阶段三：仓库自动化

参考 `.github/workflows/` 与 `.github/dependabot.yml`：

- **labeler.yml**：按改动路径自动给 PR 打标签（`pull_request_target`，因为它不 checkout
  PR 代码——**任何 checkout PR 代码的场景禁止用 `pull_request_target`**）
- **welcome.yml**：首次贡献者致意（同样 `pull_request_target` 不 checkout 代码）
- **stale.yml**：N 天无响应标 stale，再 M 天自动关闭；给高频使用的标签加 exempt
- **scorecard.yml**：OSSF 供应链安全评分，每周例行 + push 触发，README 加徽章
  （徽章要等首轮评分后才有数据，显示 empty 属正常）
- **dependabot.yml**：npm / cargo / github-actions 生态，每周一次，配 7 天 cooldown
  （新版本有 bug 或 tag 被改投恶意代码时，冷却期让它先暴露）。
  **major 升级要单独评估**——typescript 7（世代更替）与 @types/node（应对齐
  engines 最低支持版本）都属此类，ignore 规则见本仓库 dependabot.yml

### 供应链加固（对标 OSSF Scorecard）

| 加固项 | 做法 |
| --- | --- |
| Actions pin 到 commit SHA | `uses: actions/checkout@<40 位 SHA> # v7`——tag 可移动而 SHA 不可；注释保留版本，Dependabot 的 PR 照常更新 SHA |
| checkout 不留凭证 | 每个 checkout 加 `persist-credentials: false`——GITHUB_TOKEN 不残留在 runner 上 |
| 工作流安全扫描 | CI 加 **zizmor** job（容器按版本 pin，挂载 `:ro`），基线保持 0 findings；豁免集中在 `.github/zizmor.yml`，**每条豁免必须写明可验证的安全依据** |
| OSSF Scorecard | `ossf/scorecard-action`，结果发布到公开评分页并上传 code scanning；供应链安全从「自觉做得好」变成「有公开体检报告」 |
| 最小权限 | 每个工作流显式声明 `permissions`，绝不放任仓库默认（宽）权限 |

仓库标签体系补齐：在默认标签外建项目标签（ci / plugins / core / web / desktop /
dependencies / governance 等），`gh label create`。

## 阶段四：文档体系

- **README**：面向使用者。结构：这是什么 / 特性 / 快速开始 / 常见场景 / 项目结构 /
  文档索引 / 贡献 / 许可证。提到的每个命令真实存在、本地链接全部有效
- **START-HERE.md**：从零到跑通的三步指南（新人第一个看的文件）
- **docs/**：zerokit 现有 `overview.md`（初衷/已完成/待办/已知差距的诚实账本）、
  `plugin-spec.md`（怎么写插件）、`design.md`（为什么这么设计，含被否掉的方案）
- **CLAUDE.md / AGENTS.md**：AI 协作入口（硬规则、常见坑）与 Trellis 工作流挂接

文档与代码同步演进：改了行为不改文档，等于没有改。

## 阶段五：仓库设置（gh api / gh 命令）

这些不在代码里，要用 API 落实：

```bash
# 分支保护：要求「CI 总览」通过、严格同步最新、过期评审自动清除、
# 禁止 force push 与删除、必须解决所有对话
gh api repos/nicholyx/zerokit/branches/main/protection -X PUT --input - <<'JSON'
{ "required_status_checks": {"strict": true, "contexts": ["CI 总览"]},
  "required_pull_request_reviews": {"dismiss_stale_reviews": true, "required_approving_review_count": 0},
  "enforce_admins": false, "restrictions": null,
  "allow_force_pushes": false, "allow_deletions": false,
  "required_conversation_resolution": true }
JSON
```

注意 `contexts` 用的是**检查的显示名**（ci-summary job 的 `name:`），不是 job id；
单人维护的仓库 `required_approving_review_count: 0`——不要求别人审批，但 CI 仍是硬门禁。

- **Projects 看板 / Roadmap Issue**：路线图的单一事实来源，「计划中」每项链接到对应 Issue
- **里程碑**：首个 vX.Y.Z，把 Roadmap 条目挂上去
- 需要用户手动配置的（Secrets、变量、网页端开关）列一张清单告知，不要默默跳过

## 阶段六：验证与首个发布

1. **全流程演练**：开一个真实的小 PR（哪怕是文档），完整走一遍
   分支 → PR → CI → review → squash merge → Issue 自动关闭。
   基建只有在第一次真实使用时才算真正搭好。CI 首轮就红是常态——
   红了看日志修，每轮修复都是对基建的校准（本仓库首轮就修了三个）。
2. **首个 Release**：zerokit 的发布流程（tag 触发 release workflow）尚未建立，
   发布前先补这块，再走 CHANGELOG 归档 → 发布 PR → tag → 验证说明与产物。
3. 交接：向用户汇报搭建清单（建了什么、在哪、还差什么需要手动配置）。

---

## 搭建阶段的踩坑记录（与 maintain-loop 互补）

- **Windows runner 的 `run:` 块不认 bash shebang**：`#!/usr/bin/env bash` 在 pwsh 下
  被当注释，`set -euo pipefail` 成了 PowerShell 语句当场失败。Windows job 必须显式
  `shell: bash`（runner 自带 Git Bash）。
- **git 不保留 cp 过来的执行位**：脚本进 index 用
  `git update-index --chmod=+x <文件>`，否则 CI 调用时 Permission denied。
- **测试必须自包含**：依赖本机 `~/.zerokit` 已装插件的测试，在 CI 的全新 runner
  上必挂（mcp-smoke 的教训）。用 `ZEROKIT_HOME` 指向临时目录 + `plugin bundled`
  预装，结束清理。
- **性能断言在 CI runner 上不可复现**：「快 N 倍」这类阈值受机器影响，改成方向性
  断言（不劣化），倍数打印出来供人眼判断。
- **test-all 对部分失败的文件要打印 FAIL 详情**：只显示「4 / 10」的 CI 日志无从下手。
- **run-name 里的 `#`**：`run-name: 为 PR #${{ ... }}` 中 `#` 前有空格会被 YAML 当注释，
  表达式被吞掉。含 `#` 的行要加引号。
- **`set -u` 下空数组**：`"${arr[@]}"` 在部分 bash 版本展开成一个空字符串元素。
  遍历前先判 `${#arr[@]}`。
- **`pull_request_target` + checkout PR 代码** = 任意代码以可写 token 运行，绝对禁止。
- 所有用户输入（workflow_dispatch inputs 等）经 `env:` 中转进脚本，`${{ }}` 不直接写进
  `run:`——表达式注入。

## 完成标准

- [x] CI 覆盖静态检查、测试、提交规范，且有一个汇总 check
- [ ] 分支保护启用，且只依赖汇总 check
- [x] 治理文件齐全，LICENSE 能被 GitHub 识别
- [x] labeler / welcome / stale / scorecard / dependabot 全部就位且跑过至少一次
- [x] 供应链基线达标：所有 `uses:` pin 到 SHA、checkout 全部 `persist-credentials: false`、
      zizmor 0 findings（豁免有据）、Scorecard 工作流就位
- [x] 本地统一检查入口 `scripts/lint.sh` 就位
- [x] 一个真实 PR 从头到尾走通过（PR #5）
- [ ] 首个 Release 已发布（发布流程待建）
- [ ] 看板、Roadmap Issue、里程碑就位
- [x] 移交清单已告知用户

之后的一切迭代，切换到 `maintain-loop` skill。
