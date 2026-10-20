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
- 测试全量跑：`node scripts/test-all.mjs`。**三大平台都要全绿**——CI 已经
  在 ubuntu / macos / windows 上都跑（各 Node 22，Linux 另跑 Node 24），
  所以「在我机器上是绿的」不再是理由；本地跑出的任何失败都当回事。
  Linux 上剪贴板用例依赖 `xclip` + X server，缺了会断言那句安装提示
  （而不是静默跳过），要完整复现请 `xvfb-run -a node scripts/test-all.mjs`。
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
- **网络受限时先找本机代理，再谈重试**：`gh` / `git push` / `npm install` /
  抓网页卡住不动，多半不是服务挂了，而是没走代理。先看本机代理客户端
  （Clash / Surge / Mihomo / v2ray 之类）当前的本机监听端口，再用环境变量
  让命令走它：`https_proxy` / `http_proxy` / `all_proxy`。
  **端口、地址一律不写进仓库**——每台机器、每个代理客户端都不一样，写死只会
  让别人复制到一条走不通的命令。仓库里只描述「去本机找代理端口」这个动作，
  具体值由使用者在自己的环境里填。
