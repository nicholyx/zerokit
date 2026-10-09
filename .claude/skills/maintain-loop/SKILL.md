---
name: maintain-loop
description: zerokit 项目的维护闭环流程——规划、实现、发布、继续规划的完整循环，以及踩坑沉淀的硬规则。当需要在项目中继续迭代（新功能、修缺陷、补文档）、发布新版本、盘点未完成事项，或有人说「继续」「走维护流程」「按开源流程开发」时使用。
---

# 维护闭环（maintain-loop）

本项目（zerokit，仓库 `nicholyx/zerokit`）按真实开源项目的方式维护：
小批量提交、PR 驱动、CI 门禁、Issue 追踪、里程碑与版本发布。

**单人主仓库开发**：从 `main` 切分支、开 PR、CI 全绿后 squash 合并，
Issue / 里程碑 / 发布都在同一仓库内完成。分支保护只盯「CI 总览」一个 check
（`required_approving_review_count: 0`，CI 是唯一硬门禁，管理员可直推——
但只用于修 CI 自身这类紧急情况，功能一律走 PR）。

**核心闭环**：`规划 → 实现 → 发布 → 继续规划`。每一轮迭代围绕一个主题，
走完一轮再开下一轮。下面是每个阶段的操作规范，以及踩过坑之后沉淀的硬规则——
**规则部分优先级最高**。

> 本 skill 假设项目基建（CI、治理文件、自动化）已就位。如果是**新项目**要从零落实
> 开源规范，先使用 `oss-bootstrap` skill 完成搭建，再回到这里进入日常迭代。

> **规则的分工**：`CLAUDE.md` 是 AI 协作的**单一入口**（每次会话自动加载）；
> 本 skill 是**执行细节与踩坑记录**，动手时按需加载。两处有重叠，所以
> **改流程规则时两边都要改**——流程与红线写进 CLAUDE.md，执行细节与新的
> 踩坑记录留在这里。Trellis 的任务管理（`.trellis/`）负责单任务的过程记录，
> 与本流程互补：Trellis 管「这个任务怎么做」，GitHub 管「做什么与合不合」。

开始前，若对本项目的设计不熟，先读 `docs/design.md`（为什么这么设计）与
`docs/overview.md`（项目账本）。

---

## 一、盘点现状（每轮开始与用户询问「还剩什么没做」时）

```bash
gh issue list --state open --json number,title
gh api repos/nicholyx/zerokit/milestones --jq '.[] | "\(.title): 完成 \(.closed_issues) / 待办 \(.open_issues)"' 2>/dev/null
gh release list
gh run list --branch main --workflow=ci.yml --limit 3
git status --short && git log --oneline -3
```

检查点：本地与远端是否一致、main 的 CI 是否绿、`[Unreleased]` 是否积压了未发布的改动
（积压即说明「发布」这一步欠着，优先补上——zerokit 尚无发布流程，见第五节）。

`docs/overview.md` 的「待办 / 已知差距」是项目层面的诚实账本，盘点时一并核对。

## 二、规划

1. **建里程碑**：`gh api repos/nicholyx/zerokit/milestones -f title="vX.Y.Z" -f state=open -f description="主题"`
2. **建 Issue**，每项一个，结构固定为：
   - **背景**：为什么（引用真实痛点，不写空话）
   - **期望**：做成什么样（带验收标准 checkbox）
   - **入手位置**：涉及哪些文件/函数
   - **难度**：简单 / 中等 / 中偏难，标注「适合首次贡献」
   - `--milestone "vX.Y.Z"`，打上 `enhancement` / `bug` / `documentation` 标签
3. **更新账本**：`docs/overview.md` 的待办与 README 路线图（如有）保持同步。

## 三、实现

- **一个 Issue 对应一个分支、一个 PR**。分支名 `feat/*`、`fix/*`、`docs/*`、`chore/*`。
- **动手前先核实 Issue 的前提**。前提不成立时，在 Issue 里留言说明并改写范围，
  而不是硬着头皮实现错误的目标。
- 实现中偏离 Issue 计划（如发现了更严重的相关缺陷），先起一个独立 Issue 记录，再决定顺序。

### 设计原则（本项目已确立的判断，新功能必须延续，详见 docs/design.md）

- **插件是纯文本清单，不改内核**：一份 `plugin.toml` 派生四个面
  （CLI / MCP / 启动器 / AI 工作台）。新能力先问「能不能只靠清单表达」；
  要动内核时说明为什么清单表达不了。
- **没有构建步骤**：`node src/cli.ts` 直接跑 TS 源码（Node ≥22.18 原生类型擦除）。
  不引入 tsc/esbuild/打包步骤——这是项目的核心承诺。
- **MCP annotations 不可信**：有副作用的动作默认拒绝、显式授权
  （`zkit mcp allow`）。MCP 规范明确要求客户端把 annotations 当不可信，
  不能指望 AI 客户端替我们把关——安全边界必须留在运行器这侧。
- **数据目录可抛弃**：一切运行数据在 `~/.zerokit/`，删掉即完全重置。
  不往仓库或用户主目录其它位置写东西。
- **Python 子进程统一 UTF-8**：内核注入 `PYTHONIOENCODING=utf-8`；
  插件要输出 GBK 得在清单里声明 `encoding = "gbk"`。

### 测试策略

- 全量测试：`node scripts/test-all.mjs`（自包含、不联网、不花钱），CI 跑同一命令。
- **测试不得依赖本机状态**：不依赖已装的插件、已建的数据目录——用
  `ZEROKIT_HOME` 指向临时目录 + `plugin bundled` 预装，结束清理
  （mcp-smoke 的教训：依赖本机 `~/.zerokit` 的测试在 CI 全新 runner 上必挂）。
- **macOS/Linux 上有 3 个已知平台性失败**（clipboard / filesearch / runner-smoke，
  见平台债 Issue）——这三个之外的新失败必须当回事。CI 矩阵暂锁 windows-latest。
- **每条 CI 断言先在本地复现**再提交，包括 `bash -e` 语义下的行为
  （GitHub Actions 的 `run:` 默认 errexit）。
- **断言不要匹配状态词本身**——要匹配带图标或数值的具体行，否则断言恒真。
- 改了插件清单（`plugin.toml`）要 `plugin remove <id>` + `plugin bundled` 重装再测
  （bundled 对已存在目录跳过，不会自动更新）。

### bash 编码硬规则（兼容 macOS 自带 bash 3.2）

- 禁用 `declare -A`、`mapfile`、`wait -n`、`tac`。去重用 `awk '!seen[$0]++'`，倒序用数组下标循环。
- `printf '%s'` **不输出结尾换行**，配 `while IFS= read -r` 会**丢掉最后一段**（read 遇 EOF 返回非零）。
  必须写 `printf '%s\n'`。
- **空数组的 `"${arr[@]}"` 遍历前必须判长度**。`set -u` 下 bash 3.2（macOS 自带）
  会抛 unbound variable，bash 4.4+ 才改掉——而 CI 用 bash 5，这类缺陷**只在本地暴露**。
- 判断成败禁止管道接 `tail`/`head`：`if cmd | tail -1; then` 判断的是 `tail`
  的退出码。用 `if out="$(cmd 2>&1)"; then`，输出打印放在判断**之后**。
- `$(cmd)` 的退出码就是 cmd 的退出码；命令替换是子 shell，里面改全局变量传不回父进程。

### 修改 YAML 工作流的工具选择

- **无结构的简单替换**（如换版本注释）→ 脚本批量安全。
- **涉及缩进/块结构的插入**（如给 step 加 `with:`）→ **逐个手工 Edit**。
  批量脚本会算错 `with:` 与 `uses:` 的层级关系弄坏 YAML。
  判断依据：修改对象是「字符」还是「结构」。
- 每次改完工作流，跑 `./scripts/lint.sh`（actionlint + yamllint + shellcheck + zizmor，
  与 CI 同源）。zizmor 基线 **0 findings**，豁免集中在 `.github/zizmor.yml`，
  每条有可验证的安全依据；新增 `uses:` 引用必须 pin 到 commit SHA（注释保留版本号），
  所有 checkout 保持 `persist-credentials: false`——这两条是供应链基线，别在后续改动中回退。

### 跨平台 workflow 的硬规则（zerokit 首轮 CI 就踩了第一条）

- **`run:` 里是多行 bash 脚本时必须显式写 `shell: bash`**。Windows runner 的
  默认 shell 是 pwsh，`#!/usr/bin/env bash` 被当注释、`set -euo pipefail` 被逐字当成
  PowerShell 命令执行，步骤当场失败。而 macOS 的默认 shell 恰好就是 bash——同一份
  工作流在 mac 上跑得好好的，让人以为没问题。
- **含非 ASCII 字符的 `.ps1` 必须存成 UTF-8 with BOM**（如未来引入）。
  Windows PowerShell 5.1 在没有 BOM 时按系统 ANSI 代码页读脚本，中文注释被
  误解码后报的是解析错误，与真正的问题隔着好几层。
- **`.bat` 保持 CRLF**（.gitattributes 已配置）：老版本 cmd 对 LF 的 bat 解析有问题；
  仓库里的 `start_proxy.bat` 是 GBK 编码的 Windows 文件，别用 UTF-8 工具「顺手修」它。

### 中文内容质量（高频踩坑）

- **每次编辑中文内容（代码注释、文档、Issue/PR 正文）后，全仓扫描 U+FFFD**：

  ```bash
  python3 -c "
  import pathlib
  bad=[str(p) for p in pathlib.Path('.').rglob('*') if p.is_file() and '.git' not in p.parts
       and 'node_modules' not in p.parts and 'target' not in p.parts
       and '.trellis' not in p.parts and chr(0xfffd) in p.read_text(encoding='utf-8', errors='ignore')]
  print(bad if bad else 'OK')
  "
  ```

  多轮迭代中反复出现「写入时混入替换字符」，这条必须执行，不要省。
- 排错文档保留**报错原文**（使用者拿报错搜索），并写明「什么情况下不该用这个方案」。
- **批量改中文文档用「按行索引」，别用长中文串做匹配锚点**。长句里混入一个替换字符
  就会静默匹配失败或匹配错位。更稳的做法：先用 `### 标题` 这类含 ASCII 的锚点定位，
  再按行号切片替换，写入前断言新内容不含 U+FFFD。
- **改完 Markdown 跑内链校验**（rglob 所有 md 的相对链接是否存在），文档与代码同步演进。

### 提交与 PR

- 提交信息遵循 Conventional Commits（校验脚本 `scripts/check-commit-msg.sh`，CI 会查
  PR 提交**和 PR 标题**；允许的类型表在脚本与 CONTRIBUTING.zh-CN.md，两边保持一致）。
  正文写**为什么**，不只是改了什么。
- 提交前本地跑 `./scripts/lint.sh`。它**不验提交信息规范**——标题在 PR 建立之前
  不存在，本地无从验证，仍要自己按规范写（可 `--message` 预检）。
- PR 正文结构：为什么 → 做了什么 → 关键取舍（含被否掉的方案）→ 如何验证。
- **CHANGELOG**：每个用户可感知的改动都要记入 `[Unreleased]`，分类固定为
  Added / Changed / Deprecated / Removed / Fixed / Security，不自创分类。
  修复类条目写清「此前错在哪、有什么后果」。
- **往 [Unreleased] 插条目，锚点必须校验在正确段落里**。`lines.index('### Added')`
  找的是全文件第一个——版本刚发布后 `[Unreleased]` 是空壳，第一个「### Added」在
  **上一个已发布版本**的段下，新条目会错插进已发布段。插入前断言
  「锚点行号 > [Unreleased] 行号 且 < 下一个 ## [ 行号」。
- **创建 PR / Issue 的正文写进临时文件，不要用嵌套 heredoc**。把
  `gh pr create --body-file - <<'EOF'` 放进 `$(...)`、同时外层又给循环加一个 heredoc 时，
  `-` 拿到的 stdin 会是空的——**PR 正文静默丢失**，`Closes #N` 一起消失。
  写成 `--body-file /tmp/pr-body.md`（先落盘）不会踩这个。

## 四、CI 与合并

- CI 全绿才合并：`gh pr checks <N>` 或 `gh pr view <N> --json statusCheckRollup`。
  分支保护只盯**「CI 总览」**这一个 check。
- 合并用 `gh pr merge <N> --squash --delete-branch`。
- 判断成败一律 `if out="$(cmd 2>&1)"`；merge / push 之后必须复核远端真实状态
  （`gh pr view N --json state`）。
- 分支保护拒绝合并、提示 not up to date：`git rebase main` 后
  `git push --force-with-lease`。

### CI 故障排查

- **test-all 挂了但 CI 日志看不到断言详情**：`scripts/test-all.mjs` 已改为对部分
  失败的文件打印 FAIL 行（截前 8 条）。如果还是看不到，本地单跑：
  `node scripts/test-all.mjs <文件名片段>`。
- **「CI 总览」job 卡 in_progress 而 run 汇总显示 success**：GitHub 状态不一致。
  `gh pr close <N> && gh pr reopen <N>` 重新触发即可恢复。
- **`gh run view --log` 的输出混着源码行**：过滤 `[36;1m`（ANSI 回显）再看实际输出。
- **网络抖动是常态**：`gh` / `git push` 失败就重试（5 次、间隔 5 秒）。
  注意非幂等操作的重复执行风险（见发布幂等）。
- **`gh` 只认 `origin`**：分支推在别的 remote 上时加 `--head <owner>:<branch>`。

## 五、发布

zerokit **尚无发布流程**（无 release workflow、未打过 tag）。首次发布前先补：

1. 建 `.github/workflows/release.yml`：`v*.*.*` tag 触发；发布说明至少含 CHANGELOG
   手写段（awk 提取版本段）+ GitHub 原生 `releases/generate-notes`（PR 清单与对比链接）；
   预发布版本（tag 含 `-`）不标 latest；**tag 过滤器末尾要加 `*`**，否则预发布 tag
   根本不触发工作流。zerokit 无构建产物（`npm install` 即用），首发不需要构建矩阵。
2. 版本号只有一处：根 `package.json`（`0.1.0`）。无 Tauri 三处同步的包袱。
3. 之后的流程：从最新 main 切 `chore/release-vX.Y.Z` → CHANGELOG 的 `[Unreleased]`
   归入 `[X.Y.Z] - 日期` → 发布 PR 走完整 CI → squash merge →
   **先查远端没有同名 tag** 再打标签推送。
4. `release.yml` 自动执行并创建 Release；验证 `gh release view vX.Y.Z`。

### 发布幂等

网络抖动时 `git push` 可能「显示失败、远端已成功」，重试会重复推送 tag →
触发两次发布工作流。**推送 tag 前先用 `git ls-remote --tags origin vX.Y.Z`
确认不存在**（应为空）。tag 打错时修复顺序：删远端 tag → 删错误 release →
确认 main 含归档提交 → 重推 tag → 验证 release 内容。

## 六、发布后：继续规划

- 更新 `docs/overview.md` 账本与 README 路线图：本轮条目勾选完成。
- 建下一版本里程碑与 Issue（回到第二节）。

---

## 红线（任何时候不得违反）

- `${{ }}` 表达式不直接写进 `run:`，一律经 `env:` 中转（表达式注入）
- `pull_request_target` 的工作流**绝不 checkout PR 代码**
- 不在日志中输出 Secret；用户本机路径、公司内网域名视同敏感数据，公开输出前先剔除
- 所有 `uses:` 保持 SHA pin、所有 checkout 保持 `persist-credentials: false`；
  zizmor 基线 0 findings，豁免必须有据
- 不提交生成产物（`node_modules/`、`~/.zerokit/` 运行数据、Rust `target/`）
- 不提交本机绝对路径（插件清单里出现 `D:/`、`/Users/...` 一票否决）
- Windows runner 上的 bash 步骤必须显式 `shell: bash`

## 快速命令参考

| 操作 | 命令 |
| --- | --- |
| 本地全量静态检查 | `./scripts/lint.sh` |
| 全量测试 | `node scripts/test-all.mjs`（可带文件名片段单跑） |
| 环境自检 | `node src/cli.ts doctor` |
| 起界面人工验证 | `node src/cli.ts ui --open` |
| 提交信息预检 | `./scripts/check-commit-msg.sh --message "..."` |
| 建里程碑 | `gh api repos/nicholyx/zerokit/milestones -f title=... -f state=open` |
| 合并 PR | `gh pr merge <N> --squash --delete-branch` |
| 发布 | tag `vX.Y.Z` 推送触发 release.yml（**待建**） |
| 乱码扫描 | 见「中文内容质量」一节的 python 命令 |
| Trellis 收尾 | `/trellis:finish-work`（记 journal、归档任务） |
