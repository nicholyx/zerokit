# zerokit

[![CI](https://github.com/nicholyx/zerokit/actions/workflows/ci.yml/badge.svg)](https://github.com/nicholyx/zerokit/actions/workflows/ci.yml)
[![OSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/nicholyx/zerokit/badge.svg)](https://securityscorecards.dev/viewer/?uri=github.com/nicholyx/zerokit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> 一份清单，四个面：**启动器 / CLI / MCP / Web**。不绑定宿主的插件集市。

zerokit 解决的问题是：**你为某个工具写的扩展，被锁死在那个工具里了**。
uTools 的插件是 JS 调 `utools.*` 私有 API，DeepSeek Harness 的插件是 npm 包，
它们都只能在自己的客户端里跑。zerokit 的插件是一份**纯文本清单**，同一份清单同时派生：

| 面 | 从同一份声明派生出的东西 |
|---|---|
| **CLI** | `zkit run <插件> <动作> --参数 值` |
| **MCP** | 工具 `<插件id>__<动作id>`，`inputSchema` 自动生成，任何 AI 客户端可直接调用 |
| **启动器** | 关键词命中 → 动作列表 → 参数表单 → 结果卡片 |
| **AI 工作台** | 同一批动作变成模型的工具，对话式调用，副作用动作先弹确认 |
| **Web** | 动作声明 `render = "web"` 时，结果交给插件自带的 `web/index.html` 渲染（沙箱 iframe + postMessage 桥，`zkit web <插件id>` 直达） |

所以「给 AI 用」不是额外开发，而是免费副产品。复制一个插件目录（或一个 `.toolpack`
单文件），能力就整体搬到了任何地方——终端、启动器、Claude Code、Cursor、VS Code 都行。

启动器和 AI 工作台是**同一个窗口的两种模式**：输入框里直接打字是命令模式，
以 `?` 开头切到工作台。两者共用同一份插件清单，所以在工作台里能用的工具，
和 Claude Code / Cursor 里能用的完全一致。

## 快速开始

要求：**Node ≥ 22.18**（直接跑 TS 源码，无构建步骤）；三平台均可（macOS / Linux / Windows）。
Windows 上建议 Git Bash 或 WSL；PowerShell 也能跑，但示例命令按 bash 写。

```bash
git clone <this-repo> && cd zerokit
npm install

node src/cli.ts market add .           # 把本仓库当集市加进去（仓库自带 market.json）
node src/cli.ts market search          # 看看有什么
node src/cli.ts plugin install sysinfo # 安装（会先把它的全部能力摊开给你看）
node src/cli.ts doctor                 # 环境自检（依赖、插件清单）
node src/cli.ts run sysinfo overview   # 跑一个动作
node src/cli.ts ui --open              # 打开启动器：顶部「集市」标签可直接浏览、预览、安装
                                       # （工作台在搜索框打 ? 开头）
eval "$(node src/cli.ts completion bash)"   # 顺手开 shell 补全（也有 zsh / fish）
```

装不上 / 跑不起来先看 [START-HERE 的常见问题](START-HERE.md#六常见问题)；
完整命令参考终端里 `node src/cli.ts man`。

装好之后可以把 `zkit` 链接到全局：

```bash
npm link        # 之后直接用 zkit / zkit-mcp
```

### 界面

```bash
zkit ui                 # 启动本地界面（默认随机端口，只绑 127.0.0.1）
zkit ui --open          # 顺便打开浏览器
```

浏览器里是一个键盘优先的启动器：模糊搜索、↑↓ 选择、回车执行、按参数声明自动生成的表单、
按 `render` 类型渲染的结果卡片。输入框里打 `?` 切到 AI 工作台。

搜索支持**拼音与首字母**：打 `dl` 出「代理」、`xtxx` 出「系统信息」、`daili` 也认。
这一层完全在前端本地算，不联网也不经过服务端；汉字表是生成期产物
（`node scripts/gen-pinyin.mjs`，运行时不引任何依赖）。

也可以套上原生壳（全局热键 Alt+Space、托盘、无边框窗口）：

```bash
cd apps/desktop/src-tauri && cargo run
```

## 接入 AI 客户端

```bash
zkit mcp config                  # 打印各家客户端的配置片段
zkit mcp config cursor --write   # 直接写入（会先备份原文件）
zkit mcp serve                   # 手动以 stdio 方式跑起来看看
```

支持的客户端：Claude Desktop / Claude Code / Cursor / Windsurf / VS Code (Copilot) / Cline。
注意各家配置**只是事实标准、不是规范**——比如 VS Code 用的是 `servers` 键而不是
`mcpServers`，且每项要多一个 `"type": "stdio"`。zerokit 已按客户端分别处理。

**安全默认**：MCP 侧**只读动作默认放行，有副作用的动作必须先显式授权一次**：

```bash
zkit mcp allow proxy.allow-domain     # 授权这一个动作
zkit mcp allow                            # 看已授权哪些
```

理由是 MCP 规范明确要求客户端「必须把 `annotations` 当作不可信」——不能指望 AI 客户端
替我们把关，所以默认拒绝（fail-closed）。

## 写一个插件

插件 = 一个目录 + 一份 `plugin.toml`，放任何语言都行；**最简单的插件一行代码都不用写**：

```toml
[plugin]
id       = "ip"                 # ASCII，用作目录名 / CLI 名 / MCP 工具名前缀
name     = "出口 IP"            # 显示名，可中文
version  = "1.0.0"
summary  = "查本机访问外网时用的公网 IP"
keywords = ["ip", "公网", "网络"]   # 同时供模糊搜索和模型路由

[[action]]
id          = "public"
title       = "查公网 IP"
description = "返回本机访问外网时使用的公网 IP。想知道当前出口 IP 时用这个。"
type        = "http"            # 零代码：只发一个请求
url         = "https://api.ipify.org?format=json"
output      = "json"
risk        = "read"            # read / mutate / destructive（必填）
```

需要写代码时用 `run`，注意是**数组**而不是字符串：

```toml
[[action]]
id          = "allow-domain"
title       = "添加允许域名"
description = "把一个域名加入白名单，约 2 秒自动生效。需要放行新站点时用这个。"
run         = ["{python}", "proxy.py", "config", "domain", "add", "{domain}"]
output      = "text"
risk        = "mutate"

  [[action.param]]
  name        = "domain"
  type        = "string"
  required    = true
  description = "要允许的域名，例如 example.com（含所有子域）"
```

加一个参数，四个面同时多出来：CLI 多了 `--domain`，MCP 的 `inputSchema` 多了这个属性，
启动器和 Web 多了这个表单字段。

### 三个必须理解的字段

- **`description` 是写给人和模型两个人的。** 它既是启动器的搜索词来源，又是 MCP 里
  决定模型选不选这个工具的唯一信号。写清「做什么 / 什么时候用 / 返回什么」。
- **`risk` 是必填的，不是装饰。** 副作用常常超出接口名所示（"查询订单"内部可能带消息推送
  和写盘）。它同时决定确认策略（`read` 放行 / `mutate` 首次确认并记住 / `destructive`
  每次确认）和 MCP 的 `readOnlyHint`/`destructiveHint` 标注。
- **`run` 是 argv 数组，默认不经 shell。** 参数作为数组元素直接传入，不做字符串拼接，
  从根上消除参数注入。确实需要管道时才加 `shell = true`，此时风险等级会被强制提升为
  `destructive`。

完整字段说明见 [docs/reference/plugin-spec.md](docs/reference/plugin-spec.md)。

## 命令一览

```
zkit list / ls              列出插件与动作
zkit show <插件> [动作]     详情（含生成的 MCP 工具名、JSON Schema、依赖自检）
zkit run <插件> <动作>      执行；--json 输出结构化结果，--yes 跳过确认
zkit doctor                 自检环境、依赖、插件清单
zkit ui                     启动器 / 工作台界面

zkit ps                     看正在运行的东西（托管的进程 + 插件声明的服务）
zkit kill <进程id|插件.服务> 结束一个；kill all 全部结束

zkit market add <地址|目录> 添加集市（集市 = 一个 git 仓库 + 根目录 market.json）
zkit market search [词]     在集市里找插件
zkit market refresh         拉取最新索引
zkit market index [目录]    把一个插件目录生成为集市索引
zkit plugin install <id>    从集市安装（先摊开全部能力再确认）
zkit plugin add <目录|git>  从本地目录或 git 仓库安装
zkit plugin update [插件]   列出来源与可更新状态；带插件 id 检查并更新
zkit plugin export <插件>   打包成单个 .toolpack
zkit plugin import <文件>   从 .toolpack 安装

zkit mcp serve|config|allow MCP 对接
zkit logs [denied]          看审计日志
```

## 数据都在一个目录里

`~/.zerokit/`（可用 `ZEROKIT_HOME` 改）：

```
config.toml         zerokit 自身的设置（含 [ai] 段的模型 provider 与密钥）
plugins/            插件目录，一个子目录就是一个插件
logs/audit.log      所有调用（谁在什么时候执行了什么、结果如何）
logs/denied.log     被拒/失败的，便于快速排查
data/<插件>/        插件私有数据，跨更新保留
data/artifacts/     超大输出的落盘位置
marketplaces.json   已添加的集市
cache/market/       集市索引的本地缓存
installed/<插件>.json  安装时的清单快照（用于发现装后被偷改）
approvals.json      界面与 CLI 里记住的确认
mcp-allow.json      已授权给 AI 调用的有副作用动作
```

**复制这个目录 = 搬走整套配置和插件。**

## 当前进度

> 项目层面的完整账本（初衷 / 已完成 550+ 项 / 待办 / 已知差距）见
> **[docs/reference/overview.md](docs/reference/overview.md)**；每一版改了什么看
> [CHANGELOG](CHANGELOG.md)；全部现成动作看[动作速查表](docs/reference/actions-reference.md)。

核心能力（均已实测通过，v0.2.0 → v0.93.0 共八十八轮迭代）：

- 内核 + 四个面（CLI / MCP / 启动器 / 桌面壳）+ 插件集市 + AI 工作台
- 启动器 70+ 项体验（拼音搜索、键盘流、监控、备份、配置档、双语、视觉微交互……）
- 插件开发闭环（脚手架 / lint 十级体检 / 文档生成 / pack 分发）
- 发布工具化（release-prep 自检归档）与三平台 CI

测试：`node scripts/test-all.mjs`（46 个文件 1409 项断言，不联网、不花钱）。
基准：`node scripts/bench.mjs`。

还没有的：OS 级能力（读活动窗口/模拟键鼠）、插件签名与来源校验——详见账本「待办」。

## 设计取舍

- **内核无 UI 依赖**，可以独立当天花板使用。UI 只是它的两个消费者——即使以后换 UI 框架，
  内核价值不受影响。
- **执行只有一个收口**（`src/core/runner.ts`），所以安全策略只在一处实现、一处审计，
  加第四个面（比如给别的工具调的 HTTP API）成本极低。
- **不假装是沙箱。** 白名单只管得住直接启动的程序名，管不住它自己 spawn 的子进程、
  读的配置文件、发起的网络请求。真实隔离只能靠 OS 级方案。

MIT