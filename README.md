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
```

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

完整字段说明见 [docs/plugin-spec.md](docs/plugin-spec.md)。

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

> 项目层面的完整账本（初衷 / 已完成 / 待办 / 已知差距）见
> **[docs/overview.md](docs/overview.md)**。下面只是速览。

已完成并**实测通过**：

- [x] 内核：清单解析与校验、参数四投影、依赖自检、执行收口、审计
- [x] CLI 面（含分级确认、非交互环境 fail-closed）
- [x] MCP 面：工具自动生成、annotations、AI 侧授权白名单
- [x] 启动器 UI（模糊搜索、键盘导航、参数表单、结果渲染）
- [x] AI 工作台（多 provider 模型层、工具卡片、副作用先审批、拒绝后回填给模型）
- [x] 插件集市（git 仓库 + 索引文件；安装前摊开全部能力审查；目录穿越防护）
- [x] **启动器内置集市**（`#/market`）：添加/刷新/移除集市、跨集市搜索、能力摊开预览、
      一键安装（可勾选连带补装插件依赖）——发现插件不用记地址，也不用切终端
- [x] Tauri 原生壳（全局热键 Alt+Space、托盘、无边框窗口、失焦自动隐藏）
- [x] **拼音与首字母匹配**（打 `dl` 出「代理」、`xtxx` 出「系统信息」）——纯前端本地计算
- [x] **内容智能匹配**：粘链接就出「打开链接」、粘时间戳就出「转成日期」，回车即用
- [x] **最近使用**：空输入时常用动作排前面（纯本地 localStorage）
- [x] **运行中管理**：看正在跑的进程与服务、随时结束（`zkit ps` / `zkit kill` / 界面面板）
- [x] **组合动作**：`type = "chain"` 把已有动作按顺序拼成新动作，`{别名.data.字段}` 在步骤间传结果——零代码的第二种用法，四个面自动派生
- **启动器第二轮体验**：外观面板（主题 + 六套强调色）、风险筛选与搜索历史、执行前命令预览、审计日志页、环境自检页、插件使用统计、三种调用方式、结果导出 Markdown、首页最近执行
- **新建插件 / 装前试跑**：界面里答三个问题生成插件骨架（自动开发模式）；集市预览里的只读动作可装前真跑一次
- **越用越顺手**：AI 会话刷新不丢、结果收藏夹与执行备注、动作快捷键 F1–F12、结果内查找、插件面板排序、主题快切、结果卡折叠
- **结果反馈**：表格点列头排序 + 千分位、结果导出 CSV/JSON、两次结果逐字段对比、全局统计页 `#/stats`
- **效率**：插件批量检查更新、插件自定义标签、动作别名（搜索框直达）、组合动作试走推演
- **启动器第三轮**：MCP 授权面板（一键 allow/revoke）、插件配置编辑器、确认弹窗说人话、组合动作链路图、Ctrl+P 命令面板、空状态引导、插件分享安装命令、高风险动作回退指引、深链直达页、Home/End/PageUp/PageDown
- [x] **十项启动器体验**：深/浅/跟随系统主题、`Ctrl + /` 快捷键浮层、动作收藏置顶、
      搜索命中高亮、结果「复制/下载/再跑一次」、参数记忆（密钥不记）、最近 5 次执行、
      插件健康统计卡、插件主页、AI 工作台任务建议——全部纯前端，偏好只存本机
- [x] **插件依赖**：`[requires] plugins` 声明对其它插件的依赖，安装/更新后提示缺失并可 `--with-deps` 补齐；
      卸载前拦反向依赖，`doctor` 提前发现。只搬插件目录，**不代装第三方包、不执行安装脚本**
- [x] **插件设置项**：`[[setting]]` 声明「装一次、长期生效」的配置（端点/账号/API Key），
      `{setting.x}` 与 `ZEROKIT_SETTING_*` 双通道；`zkit config` 与启动器面板共用一份存储，密钥只回掩码
- [x] **速度**：冷启动 706→315 ms（AI SDK 延迟加载）；node 插件动作 176→34 ms
      （worker 线程，插件声明 `runtime = "worker"` 开启）；
      python 动作 476→22 ms（**常驻解释器**，声明 `runtime = "host"` 开启，21 倍）
- [x] **uTools 插件兼容层**：带 `plugin.json` 的存量插件丢进插件目录即可用，自动翻译
      `features[].cmds`（关键字 / `regex:` / 划词 / 文件），同时获得 CLI + MCP + 启动器四个面
- [x] 示例插件：`sysinfo`（只读零依赖）、`ip`（**零代码**）、`proxy`（接入已有工具）、
      `quick`（内容智能匹配）、`clipboard`（剪贴板历史 + 常驻监听）、`filesearch`（文件名索引）

测试（都不联网、不花钱）：

| 测试 | 覆盖 |
|---|---|
| `test/mcp-smoke.mjs` | 用裸 JSON-RPC 客户端验证 MCP 面（不依赖 SDK 自证）※需带参数 |
| `test/workbench-smoke.mjs` | agent 循环、审批挂起、拒绝回填、未配密钥时的提示 |
| `test/market-smoke.mjs` | 集市添加/搜索/审查/安装、目录穿越拒绝、重复安装 |
| `test/market-ui-smoke.mjs` | 集市面板 API：添加/搜索/预览摊开、确认令牌（缺/错/串用）、安装、重复安装、刷新/移除、会话令牌 |
| `test/extras-smoke.mjs` | 十项体验的纯函数：主题解析、高亮分段、收藏排序、参数记忆与冲突、历史上限、健康统计、建议列表 |
| `test/pinyin-smoke.mjs` | 拼音转换、六档打分、单字母不放宽、两万次评分耗时 |
| `test/runner-smoke.mjs` | spawn/worker/常驻宿主三条路径结果必须一致、确实更快、不适用时干净退回、后台动作托管与结束 |
| `test/match-smoke.mjs` | 内容嗅探与 match 命中判定（url / 正则 / 文件 / 文本） |
| `test/utools-smoke.mjs` | uTools 插件的识别与翻译、`cmds` 六型映射、真跑一个插件、对 DOM 插件的报错是否说人话 |
| `test/clipboard-smoke.mjs` | 剪贴板历史的去重/上限/截断/搜索，监听进程的起停与重复启动拒绝 |
| `test/filesearch-smoke.mjs` | 文件名索引的排除规则、搜索排序、`open` 的越权拒绝 |
| `test/ui2-api-smoke.mjs` | 命令预览 / 审计日志 / 环境自检三个只读接口，以及插件载荷的使用统计字段 |
| `test/chain-smoke.mjs` | 组合动作：步骤间引用与模板、风险/嵌套/后台/缺插件/取不到值等失败路径、CLI show/run/doctor |
| `test/deps-smoke.mjs` | 插件依赖：清单解析与校验、依赖树/反向依赖、add/install 的 --with-deps、卸载拦截、doctor |
| `test/settings-smoke.mjs` | 插件设置项：清单校验、0600 存储与原子写、默认值/必填/枚举、占位符与环境变量注入、密钥打码与 `--reveal`、`zkit config` 的 list/get/set/unset |

一条命令跑完全部（它会自动补上 mcp-smoke 需要的参数）：

```bash
node scripts/test-all.mjs
```

另外 `node scripts/bench.mjs` 会量一遍启动与执行的各环节耗时（优化前先量，别拍脑袋）。

还没有的：

- [ ] 复刻 uTools 的 **OS 级能力**（读活动窗口、模拟键鼠、粘贴进任意前台窗口）。
      兼容层只覆盖无界面的那部分；纯界面插件跑不出结果，会明确报错而不是静默失败
- [ ] 插件签名与来源校验（现在信任边界靠"装之前摊开全部能力给人看一遍"）

## 设计取舍

- **内核无 UI 依赖**，可以独立当天花板使用。UI 只是它的两个消费者——即使以后换 UI 框架，
  内核价值不受影响。
- **执行只有一个收口**（`src/core/runner.ts`），所以安全策略只在一处实现、一处审计，
  加第四个面（比如给别的工具调的 HTTP API）成本极低。
- **不假装是沙箱。** 白名单只管得住直接启动的程序名，管不住它自己 spawn 的子进程、
  读的配置文件、发起的网络请求。真实隔离只能靠 OS 级方案。

MIT