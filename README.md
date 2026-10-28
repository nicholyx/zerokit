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
- [x] **界面双语（中/英）**、动作昵称/标签、长输出折叠、偏好快照 A/B、高风险动作输名确认、字号三档（v0.13.0 第八轮十项）
- [x] **可发现性与效率**：权重可视化、批量执行、A/B 对比、深链预填/分享、移动端、Alt+数字直开、耗时直方图（v0.14.0 第九轮十项）
- [x] **专业工具感**：表格列宽拖拽记忆、右键菜单、终端模式、JSON 折叠树、查找跳转计数、MD/TSV 复制、CSV BOM（v0.16.0 第十一轮十项）
- [x] **第十二轮（v0.17.0）· 数据可视化与命令面板**：bars 柱状图、耗时 sparkline、「慢于平常」P95 徽标、批量执行落地（含汇总卡）、命令面板打分排序与页面直达、表格长单元格省略+展开、直方图占比悬停、diff 并排开关、统一毫秒展示。
- [x] **第十三轮（v0.18.0）· 可访问性与键盘流**：列表 roving tabindex 键盘流、全局焦点环、图标按钮 aria-label、结果区 aria-live 播报、prefers-reduced-motion、Esc 浮层栈、空态 role=status。
- [x] **第十四轮（v0.19.0）· 表单与输入体验**：必填/数值即时校验、secret 眼睛、多行 textarea 自动增高、恢复默认、历史参数重选、脏状态确认、URL 深链预填与 ?q= 即搜。
- [x] **第十五轮（v0.20.0）· 大数据量与导航**：列表虚拟滚动（>60 条只渲染视口）、执行历史分页、集市递增加载、详情页面包屑、浏览器后退栈、搜索词与筛选写进 URL、数字键 1-9 快选。
- [x] **第十六轮（v0.21.0）· 数据与结果的二次加工**：表格筛选行（空格分词 AND）、列显示/隐藏 ⚙、统计行（Σ·x̄·范围）、单位列一键换算（KB↔MB↔GB）、跨记录合并视图（左连接）、右键复制列（Alt 去重）、复制 HTML 表、派生结果来源说明。
- [x] **第十七轮（v0.22.0）· 导出与外部对接**：复制模板 `copy_template`（查 IP 复制成 ssh 命令）、Shift 点复制=美化 JSON、导出 JSONL、可预测导出文件名+「打开目录」按钮、「编辑器打开」（ZEROKIT_EDITOR）、终端模式 w/t/b 键盘、对象结果 Markdown 属性行排版、通知点击聚焦结果卡。
- [x] **第十八轮（v0.23.0）· 监控与自动化**：只读动作定时自动重跑（监控）、变更高亮（↑↓/原值标签）、数值趋势 sparkline（KV 逐字段/表格表头）、停止条件（连续失败 N 次/命中串）、监控聚合面板 `#/watch`、标签页标题 ⏱N、变更系统通知（点击回窗）、采样 CSV 导出。
- [x] **第十九轮（v0.24.0）· 安全与危险操作防护**：危险参数值检测（rm -rf/系统目录/格式化/dd 黄条警示）、同动作 3 秒限速确认、结果与日志默认脱敏（token/长 hex 打码可切换）、动作危险度提示卡（风险横条+失败率+为什么危险）、一键清除敏感痕迹、审计日志 90 天自动清理提示、监控在跑时关页挽留（beforeunload）。
- [x] **第二十轮（v0.25.0）· 数据备份与迁移**：个性化数据（收藏/历史/参数记忆/外观设置）一键导出 JSON、导入校验+分组预览+选择性导入、合并策略新优先（不丢本地独有数据）、外观面板「数据」分组。
- [x] **第二十一轮（v0.26.0）· 多环境与配置档**：外观+收藏+参数记忆多套独立配置一键切换、以当前状态新建、重命名/删除（最后一份拒绝删）、执行历史跨档共享。
- [x] **第二十二轮（v0.27.0）· 帮助与上手引导**：首访三步引导（跳过即永不再扰）、使用指南页 #/help（六大主题+去试用深链）、空搜索建议（试试这些）、非只读动作风险说明条、分组头悬停提示。
- [x] **第二十三轮（v0.28.0）· 结果工作台**：结果页签（最近 8 个、固定📌、备注、对比视图⇄黄行 diff）、表格查询框（子串+数字比较）。
- [x] **第二十四轮十项：命令与快捷键进阶**——`>` 命令模式（12 命令+最近置顶）、`;插件.动作` 快速执行、两段式 goto（g+l/h/s/m）、j/k 表格行选中、`[`/`]` 切结果页签、`?` 键盘速查、面板历史 ↑ 翻（v0.29.0，#113）
- [x] **第二十五轮十项：执行链路与批处理进阶**——批量篮排序/去重/清单导出导入、并发上限（1=串行~8）、失败项一键重跑、手动链「接着跑」（{result.data.字段} 占位符传值）、链步骤条回看、历史参数一键回填（v0.30.0，#116）
- [x] **第二十六轮十项：插件生态体验**——主页统计卡三格/动作搜索框/标签 chips、插件对比（风险构成差异表）、依赖树、复制安装命令、集市更新徽标、已装清单导出、坏插件置顶红条（v0.31.0，#119）
- [x] **第二十七轮十项：搜索与发现的深度**——搜索结果分组（组头带计数）、命中解释徽标（命中：动作名·拼音）、同义词弱路由+虚词剥离（「看看内存」直达）、搜索历史输入态常显（8 条）、#/history/<插件.动作> 深链、最近执行加权 recencyBoost、大小写保真高亮；核实项：拼音全拼/首字母、空格分词 AND（v0.32.0，#122）
- [x] **第二十八轮十项：国际化与文案体检**——语言三档（跟随系统/中文/英文，面板点选或顶栏循环切换，立即生效）、偏好持久化、html lang 同步、页签相对时间本地化（3 分钟前/3m ago）、风险徽标双语、模式标签 25 处迁文案表、data-i18n 静态标注、术语统一（无命令→无动作）、文案表 zh/en 62 键对齐断言（v0.33.0，#125）
- [x] **性能与体感优化（第二十九轮，v0.34.0）**——搜索防抖+rAF、#/perf 指标面板、大表窗口化（>500 行只画 200 + 加载全部）、大 JSON 切片序列化、`zkit list --json --brief`、`zkit doctor --json`、`zkit config get` 单键
- [x] **触屏与窄屏适配（第三十轮，v0.35.0）**——pointer:coarse 按钮常显、长按合成右键、✎ 备注按钮、触屏拖列宽、窄屏单栏+页签横滚、结果表滚动容器（#131）
- [x] **MCP 与 AI 协作面（第三十一轮）**——MCP 工具描述带参数说明、结果摘要与脱敏、失败补救提示与连击冷却、`zkit mcp tools` 清单（#134 → v0.36.0）
- [x] **桌面壳与系统集成（第三十二轮，v0.37.0）**——托盘菜单/双击、热键可配、窗口记忆、Alt+←→导航、外链走系统浏览器、`zkit desktop` 体检、doctor 联动（#137）
- [x] **内核可观测性与运维面（第三十三轮，v0.38.0）**——`zkit stats` 耗时统计（P50/P95）、`logs --follow` 跟读、`zkit health`、`audit --last`、`/api/health` 探活、慢动作水位线、`zkit gc` 审计清理、doctor 24h 错误计数；修复审计写入丢行（#140 → v0.38.0）
- [x] **插件市场与分发（第三十四轮，v0.39.0）**——`plugin pack/unpack`（零依赖 zip）、`publish-ready` 上架检查、`market lint`、`plugin info/recommend`、`market add` 源健康检查（#143 → v0.39.0）
- [x] **错误预防与自愈（第三十五轮，v0.40.0）**——打错命令/动作给建议、缺参数附参数表、失败自诊断「下一步」、`doctor --fix`、异平台路径检测
- [x] **结果呈现最后一公里（第三十九轮，v0.44.0）**——首列冻结 / 行详情 / 行号 / 时间戳人性化 / 空结果归因 / 打印样式（#158 → v0.44.0）
- [x] **插件开发体验闭环（第四十轮，v0.45.0）**
- [x] **安全审计与权限收口（第四十一轮，v0.46.0）**
- [x] **渲染性能与可维护性（第四十二轮，v0.47.0）**——事件委托单监听器 / 收藏就地补丁（DOM 身份稳定）/ 键盘导航 O(1) / 文件地图与分节导航 / 死样式清理（#167 → v0.47.0）——`zkit allow` 显式授权带 TTL / `audit --denied` / `--since` / 久未执行警示（#164 → v0.46.0）——`plugin lint` 十级体检 / `plugin doc` 文档生成 / 内置插件零告尾示范（#161 → v0.45.0）
- [x] **第四十三轮（v0.48.0）· 插件生态第二波**
- [x] **第四十四轮（v0.49.0）· web 插件面进阶**
- [x] **第四十五轮（v0.50.0）· CLI 人体工学**——--out 四格式/--quiet/--copy/--watch 轮询/last/history/im 交互/--interactive 参数提示/list --health（#176）——桥协议成文+外观跟随+受控跳转+错误上报+demoweb 演示（#173）——新示例插件 convert（八转换+组合流水线）/ snap（系统工具截图）/ typist（片段写剪贴板）；插件共享代码层 plugins/_vendor/（#170）
- [x] **第四十六轮 v0.51.0（CLI 收口与开发者体验）**：`completion bash/zsh/fish` 补全、`man` 命令参考、`--version`、`stats --since`、`audit --follow` 跟读、退出码细分（用法=2）、`check-docs.mjs` 文档巡检（issue #179）
- [x] **第四十七轮 v0.52.0（启动器信息架构与首屏）**：设置抽屉统一管理入口、命令面板直达抽屉、首屏骨架屏、空态三级文案、结果高度自适应、≤720px 窄屏断点（issue #182）
- [x] **第四十八轮 v0.53.0（错误信息与失败体验）**：失败卡片（五类分类+下一步建议+同参数重试+原文折叠）、`ERROR_BOOK` 三面共用知识库、批量失败不中断（✓/✗/∅ 汇总）、MCP 失败附分类、监控停止带原因摘要、长错误限高滚动（issue #185）
- [x] **第四十九轮 v0.54.0（结果对比与历史分析）**：详情页历史分析卡（趋势 chip/P50·P95/失败率警示）、与上次对比、收藏两两对比、日志导出 CSV、`runTrend`/`failureRate`/`durationStats` 纯函数（issue #188）
- [x] **定时与调度（第三十八轮，v0.43.0）**——间隔档位 / 执行窗口 / 错过补跑 / 暂停恢复 / 执行历史 / 导出导入
- [x] **AI 协作面（第三十七轮，v0.42.0）**——给 AI 复制 / AI 上下文打包 / MCP 配置一键复制 / curl 等价命令 / LLM 评测 JSONL / AI 辅助隐私开关
- [x] **文档与示例体系（第三十六轮，v0.41.0）**——chain/setting/http 三个 demo 插件、cookbook 十篇照抄做法、规范「新能力速查」索引
- [x] **自动化与粘性**：完成通知、定时任务面板、失败重试、收藏快速条、每日简报、更新检查、Ctrl+K（v0.15.0 第十轮十项）
- [x] **内容智能匹配**：粘链接就出「打开链接」、粘时间戳就出「转成日期」，回车即用
- [x] **最近使用**：空输入时常用动作排前面（纯本地 localStorage）
- [x] **运行中管理**：看正在跑的进程与服务、随时结束（`zkit ps` / `zkit kill` / 界面面板）
- [x] **组合动作**：`type = "chain"` 把已有动作按顺序拼成新动作，`{别名.data.字段}` 在步骤间传结果——零代码的第二种用法，四个面自动派生
- **启动器第二轮体验**：外观面板（主题 + 六套强调色）、风险筛选与搜索历史、执行前命令预览、审计日志页、环境自检页、插件使用统计、三种调用方式、结果导出 Markdown、首页最近执行
- **新建插件 / 装前试跑**：界面里答三个问题生成插件骨架（自动开发模式）；集市预览里的只读动作可装前真跑一次
- **越用越顺手**：AI 会话刷新不丢、结果收藏夹与执行备注、动作快捷键 F1–F12、结果内查找、插件面板排序、主题快切、结果卡折叠
- **数据可视化**：近 7 天趋势图、小时热力图、标签页徽标、每日 AI 日报（本地拼装）、偏好一键备份/恢复
- **协作与分享**：深链二维码（零依赖生成器）、插件能力清单导出 Markdown、结果分享卡、分享搜索直达
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
| `test/qr-smoke.mjs` | 二维码生成器结构断言（确定性 / finder / 版本自适应 / 超长报错 / 中文） |
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