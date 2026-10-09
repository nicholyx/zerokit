# CLAUDE.md

面向人的一手入口是 [`START-HERE.md`](START-HERE.md)（怎么跑起来）和
[`docs/overview.md`](docs/overview.md)（项目账本：初衷 / 已完成 / 待办）。
本文件只写 AI 助手干活时最常需要的事实。

## 项目结构

- `src/` —— 内核。`src/cli.ts` 是路由表（动内核行为从这进）；
  `src/core/` 是运行时、插件注册、MCP、服务托管。
- `plugins/` —— 示例插件。每个插件一份 `plugin.toml` 清单，
  改插件**不改内核代码**。`market.json` 是集市登记表。
- `web/` —— 启动器界面；`apps/desktop/` —— Tauri 原生壳（可选）。
- `test/` —— 冒烟测试，`node scripts/test-all.mjs` 全量跑。
- 数据目录在 `~/.zerokit/`（不在仓库里），删掉即完全重置。

## 硬规则

- **没有构建步骤**：`node src/cli.ts` 直接跑 TS 源码，别引入 tsc/esbuild。
  要求 Node ≥ 22.18。
- 测试全量跑：`node scripts/test-all.mjs`。注意 3 个测试文件目前
  在 macOS/Linux 上有平台性失败（clipboard / filesearch / runner-smoke
  的性能断言），CI 只在 windows-latest 上跑——在 mac 上跑出这几个
  失败不算你改坏了什么，但除此之外的失败必须当回事。
- 提交信息遵循约定式提交（`feat(plugins): ...`），CI 会校验；
  允许的类型表在 `scripts/check-commit-msg.sh` 和 CONTRIBUTING.zh-CN.md。
- 别提交：`node_modules/`、`~/.zerokit/` 运行数据、Rust `target/`。
- 用户可见的行为变更要往 `CHANGELOG.md` 的 `Unreleased` 段补一条。

## 改完之后

```bash
./scripts/lint.sh                  # 本地静态检查（与 CI 同源）
node scripts/test-all.mjs          # 测试
node src/cli.ts doctor             # 清单与环境自检
node src/cli.ts ui --open          # 起界面人工看一眼（UI 改动时）
```

日常迭代的完整闭环（规划 → 实现 → 发布）与踩坑硬规则见
`.claude/skills/maintain-loop/SKILL.md`；基建大改时对照
`.claude/skills/oss-bootstrap/SKILL.md`。

## 常见坑

- `plugin bundled` 装过的插件**不会自动更新**（目标目录存在即跳过）；
  改了 `plugins/` 下的清单后要 `plugin remove <id>` + `plugin bundled` 重装。
- Python 子进程统一按 UTF-8 处理（内核注入 `PYTHONIOENCODING`），
  插件要输出 GBK 得在清单里声明 `encoding = "gbk"`。
