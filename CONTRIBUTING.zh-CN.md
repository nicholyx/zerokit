# 贡献指南

感谢你考虑为本项目做贡献。

English guide: [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 这个项目是什么

zerokit 是一个**不绑定宿主**的插件运行器：插件是一份纯文本清单
（`plugin.toml`），同一份清单同时派生出四个面——CLI / MCP / 启动器 /
AI 工作台。上手请先读 [`START-HERE.md`](START-HERE.md)。

## 开发环境

- **Node.js ≥ 22.18（必须）**——项目直接用 Node 原生的 TypeScript 类型擦除，
  **没有构建步骤**，`node src/cli.ts` 就是跑源码。
- git（可选，仅从 git 仓库装插件时用）
- Python 3.10+（可选，仅 `proxy` 这类 python 插件需要）
- Rust 工具链（可选，仅编译原生桌面壳时需要）

安装并验证：

```bash
npm install                  # 装依赖（node_modules 不随仓库分发）
node src/cli.ts doctor       # 环境自检：Node 版本、外部依赖、所有插件清单
node scripts/test-all.mjs    # 全量测试：9 个文件 200+ 断言，不联网、不花钱
```

## 本地检查

推送之前跑：

```bash
node scripts/test-all.mjs    # 全量测试（CI 会跑同一命令）
```

改了工作流（`.github/workflows/`）或 `.github` 下的 YAML 时，
本地可以用 yamllint 先过一遍（CI 有独立 job）：

```bash
yamllint -c .yamllint .github/
```

改了提交信息规范相关的脚本时：

```bash
bash -n scripts/check-commit-msg.sh    # 语法检查
./scripts/check-commit-msg.sh --message "feat: 测试一下"
```

注意：CI 目前只在 **windows-latest** 上跑测试矩阵——示例插件里有
Windows 专属行为（clipboard 用 PowerShell、filesearch 用
explorer `/select`）。跨平台适配是进行中的工作，改动了平台相关
代码时请在 PR 里注明你在哪个平台验证过。

## 工作流

1. 找一个（或创建一个）Issue 描述你要解决的问题。
2. 从最新的 `main` 切出聚焦的功能分支，例如
   `feat/port-forwarding` 或 `fix/mcp-allow`。
3. 一个 Issue 对应一个分支、一个 PR。改动保持聚焦。
4. 开 PR 之前跑完本地检查。
5. PR 标题同样遵循提交规范（squash 合并后标题会成为提交信息，
   CI 会校验它）。

## 提交信息规范

项目遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<类型>(<范围>): <描述>
```

CI 会校验 PR 中的提交信息与 PR 标题（`scripts/check-commit-msg.sh`）。
允许的类型如下——请保持此表与脚本一致：

| 类型 | 用途 |
| --- | --- |
| `feat` | 面向用户的新能力 |
| `fix` | 缺陷修复 |
| `docs` | 仅文档 |
| `ci` | 工作流 / CI 配置变更 |
| `chore` | 不触及源码与测试的维护性改动 |
| `refactor` | 既不修 bug 也不加功能的代码变更 |
| `perf` | 性能优化 |
| `test` | 补充或修正测试 |
| `style` | 格式 / 空白调整，不改变含义 |
| `revert` | 回滚此前的提交 |
| `build` | 构建系统或依赖变更 |

范围（scope）描述改动区域，例如 `core`、`plugins`、`web`、`desktop`、
`ci`、`docs`。

```
feat(plugins): proxy 插件支持按正则放行域名
fix(core): 修 ui --open 在非 Windows 平台崩溃
docs: 补 START-HERE 的环境要求说明
```

## Pull Request

请包含：

- 改了什么，以及**为什么**（diff 已经说明了「改了什么」），
- 如何验证的——写具体操作，不要只写「测试通过」，
- 平台相关的注意事项（你在哪个平台验证过），
- 关联的 Issue（用 `Closes #12` 的写法）。

不要提交生成产物：`node_modules/`、`~/.zerokit/` 的运行数据、
Rust `target/`。

改动对使用者可见时，请在 [`CHANGELOG.md`](CHANGELOG.md) 的 `Unreleased`
段落按固定分类（Added / Changed / Deprecated / Removed / Fixed / Security）
补一条说明。

## 写插件

插件不需要改内核代码——一份 `plugin.toml` 清单就够了。
完整规范见 [`docs/plugin-spec.md`](docs/plugin-spec.md)，
仓库自带的 6 个示例插件在 [`plugins/`](plugins/) 目录，
其中 `ip` 是零代码插件、`proxy` 演示接管已有工具。

新插件请放进 `plugins/<id>/`，并在 `market.json` 里登记，
然后 `node src/cli.ts plugin bundled` 装进数据目录测试。

## 报告安全问题

请通过
[GitHub Security Advisories](https://github.com/nicholyx/zerokit/security/advisories/new)
私下报告，不要开公开 Issue。项目的安全边界（插件会真实执行命令、
MCP 副作用动作默认拒绝）见 [`SECURITY.md`](SECURITY.md)。
