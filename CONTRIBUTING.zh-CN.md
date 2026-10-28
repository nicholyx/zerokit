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

注意：CI 在 **ubuntu-latest、macos-latest、windows-latest** 三个平台上都跑
测试矩阵（各跑 Node 22，另在 Linux 上单独跑当前 Node 24），
`node scripts/test-all.mjs` 就是那条命令。自带插件已经跨平台。唯一依赖环境的是
Linux 的剪贴板——需要 `xclip` 和 X server，CI 两个都装（整个套件在
`xvfb-run` 下跑）；万一环境里没有，测试会断言那句「没装工具」的提示，
而不是静默跳过。改动了平台相关代码时，请在 PR 里注明你在哪个平台验证过。

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
完整规范见 [`docs/reference/plugin-spec.md`](docs/reference/plugin-spec.md)，
仓库自带的 6 个示例插件在 [`plugins/`](plugins/) 目录，
其中 `ip` 是零代码插件、`proxy` 演示接管已有工具。

新插件请放进 `plugins/<id>/`，并在 `market.json` 里登记，
然后 `node src/cli.ts plugin bundled` 装进数据目录测试。

## 报告安全问题

请通过
[GitHub Security Advisories](https://github.com/nicholyx/zerokit/security/advisories/new)
私下报告，不要开公开 Issue。项目的安全边界（插件会真实执行命令、
MCP 副作用动作默认拒绝）见 [`SECURITY.md`](SECURITY.md)。

---

## 写测试的十条军规（本仓 55+ 轮迭代踩坑精华）

1. **临时文件一律 `path.join(os.tmpdir(), ...)`**——`/tmp` 在 Windows 上不存在（mkdtempSync ENOENT -4058 曾在 CI 上炸过）。
2. **动态 import 本地路径必须 `pathToFileURL()`**——盘符路径直接给 import() 报 ERR_UNSUPPORTED_ESM_URL_SCHEME（踩过两次：第三十四、四十五轮）。
3. **「今天」不能用 `now - 3600_000` 造假**——CI 在 UTC 午夜后跑会跨天（本地过、CI 挂）。锚定到当天零点 `+1h/+2h`。
4. **周一锚定的周对比测试，样例日期要算准星期几**——`new Date(2026,9,26).getDay()` 先验证再写死（第五十四轮踩过）。
5. **断言不匹配状态词本身**——`out.includes('成功')` 会把「不成功」也判过；匹配带图标或数值的具体行。
6. **测试不得依赖本机状态**——已装插件、`~/.zerokit/` 数据都不许依赖；`ZEROKIT_HOME` 指临时目录 + `plugin bundled` 预装，结束清理。
7. **平台分流断言写「成功或带指引的失败」**——Linux CI 没显示器，截图工具 ENOENT 是合法路径，断言两种都收。
8. **超时测试用 deadline 循环而不是 sleep 死等**——`while (Date.now() < deadline)` 加早退，快机器不白等慢机器不误杀。
9. **外部工具不可用要优雅跳过**——`spawnSync` 的 `error.code === 'ENOENT'` 判「没这工具」，与「工具报错」分开处理。
10. **改断言前先问「是产品错了还是测试过期了」**——语义放宽（如第五十五轮中文 key）要同步改测试并注明轮次，不是把断言删了完事。

顺带一提：`node scripts/test-all.mjs --shuffle` 用随机顺序跑全量，用于暴露测试间的隐式顺序依赖——理论上每个测试都该自包含。
