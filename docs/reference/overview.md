# 项目总览：初衷、现状与待办

> 这份文档回答三个问题：**当初为什么要做**、**现在做到了什么**、**还差什么**。
>
> 和另外两份文档的分工：`design.md` 记录**为什么这么设计**（连同被实测推翻的直觉），
> `plugin-spec.md` 是**怎么写插件**的规范。这份是项目层面的账本。
>
> 最后更新：2026-10-30（第八十九轮，v0.94.0）

## 性能基线（第五十八轮建立，2026-10-28，Apple M4 / Node 22）

| 指标 | 基线 | 预算 |
|---|---|---|
| `zkit --help` 冷启动（10 次中位） | 79ms | <300ms |
| `zkit list`（13 插件） | 83ms | <500ms |
| `zkit path`（最薄命令） | 84ms | <300ms |
| node -e 纯启动基线 | 17ms | — |
| 峰值 RSS `zkit list` | 91.5 MB | <150MB |
| 峰值 RSS `node -e` 基线 | 31.6 MB | — |
| 启动器首屏（内核冷启动→首页响应） | 79+16ms | <800ms |
| 拼音表加载 | 2ms / 83KB | <50ms |
| filterRows 10k 行 AND 搜索 | 2.4ms | <50ms |
| resultQuery 10k 行数字比较 | 2.8ms | <50ms |

拆解结论：冷启动 84ms 中约 17ms 是 Node 自身、约 27ms 是 amaro（TS 即时转译器）初始化——「无构建步骤」的设计承诺的固有代价，剩余 ~40ms 是模块图 import。RSS 差值 60MB 同源（amaro + 15 个 core 模块）。**懒加载改造评估：收益上限约 30ms，不值得为此改错误时序**（动态 import 会把模块级错误延迟到子命令执行时才暴露）。超预算的回归算缺陷。复测：`node scripts/bench.mjs`（BENCH_N 环境变量调次数）。

---

## 一、初衷

### 起因

uTools 开始收费了。想找一个替代品，找了一圈发现真正的问题不在收费，而在**插件被锁死在宿主里**：

| 工具 | 插件形态 | 后果 |
|---|---|---|
| uTools | JS 调 `utools.*` 私有 API，跑在 Electron 渲染进程里 | 只能在 uTools 里跑 |
| DeepSeek Harness | npm 包 | 只能在它里面跑 |
| Claude Code / Agent Skills | 提示词 + 脚本目录 | 只能在那个 agent 里跑 |

同一件事（"把一段文字转成大写"）在三个工具里要写三遍，而且每份都搬不走。
**你为某个工具写的扩展，被锁死在那个工具里**——这是要解决的问题。

### 目标

由此定下四条，后面对每个功能取舍的判断都回到这四条：

1. **插件不绑定宿主。** 插件是一份**纯文本清单**（`plugin.toml`），内核无 UI 依赖。
   同一份清单同时派生出四个面：

   | 面 | 从同一份声明派生出的东西 |
   |---|---|
   | CLI | `zkit run <插件> <动作> --参数 值` |
   | MCP | 工具 `<插件id>__<动作id>`，`inputSchema` 自动生成，任何 AI 客户端可调用 |
   | 启动器 | 关键词命中 → 动作列表 → 参数表单 → 结果卡片 |
   | AI 工作台 | 同一批动作变成模型的工具，对话式调用，副作用动作先弹确认 |

   所以「给 AI 用」不是额外开发，而是免费副产品。

2. **纯本地、纯离线。** 不要云服务、不要账号、不要遥测。本地 HTTP 服务可以（界面要用），
   但它只绑 `127.0.0.1`。同步将来也只走**用户自己的存储**，不回到中心化。

3. **快。** 不是"够用就行"的快：启动要快，打开插件要快。这条直接决定了后面
   常驻宿主、worker 线程、拼音表生成期固化这些工作——**先测量，再优化**，
   不拍脑袋（`node scripts/bench.mjs`）。

4. **能管理，而不是一堆快捷方式。** 启动了 3 个插件的服务，就要能看见"现在开着哪几个"、
   能随时结束。这是启动器和"快捷方式集合"的分界线，也是 uTools 做得好的地方。

5. **复制即迁移。** 插件的存储形态就是配置文件的形态：复制一个插件目录
   （或一个 `.toolpack` 单文件），整套能力就搬到了任何地方——符合"VSCode 插件 +
   配置"那种直觉。

### 参照与取舍

调研了 uTools、Flow Launcher、PowerToys Run、Keypirinha、Wox 2、Raycast、Alfred
以及 MCP 规范原文。三个结论（详见 `design.md`）：

- **不抄 uTools 的 API，抄它的清单结构。** `utools.*` 里几乎每个方法都是 Electron 的
  一两行封装，复刻没有价值；但它的 `plugin.json` / `features[].cmds` 设计得很干净，
  直接翻译就能吃到存量插件生态。
- **运行模型抄 Wox 2（插件独立进程），不抄 PowerToys Run（同进程加载 DLL）。**
  一个插件崩了不该带走全部。
- **只有 Raycast 把"能力类型"写进了清单**，这一条后来部分借鉴（见"待办"）。

---

## 二、已完成

### 内核

| 能力 | 说明 |
|---|---|
| 清单解析与校验 | `plugin.toml` 是全系统唯一事实来源；错在哪、怎么改，校验阶段就说清 |
| 参数四投影 | 同一份参数声明 → JSON Schema / CLI flags / 表单字段 / argv，加一个参数四个面同时多出来 |
| 执行收口 | **所有面都经 `src/core/runner.ts`**，安全策略只在一处实现、一处审计 |
| 参数不拼字符串 | `run` 是数组，参数作为 argv 元素直接传入，从根上消除参数注入 |
| 依赖自检 | `[requires]` 在**运行前**给出可操作的安装指引；跳过微软商店的假 `python.exe` 桩程序 |
| 审计日志 | 全部调用落盘；**被拒/失败单独一份**，方便快速排查 |
| 风险等级 | `read` / `mutate` / `destructive` 必填，决定确认策略与 MCP annotations |
| 组合动作 | `type = "chain"`：把已有动作按顺序拼成新动作，`{别名.data.字段}` 在步骤间传结果；零代码的第二种用法，四个面自动派生 |
| 插件依赖 | `[requires] plugins`：安装/更新后提示缺失、`--with-deps` 从自带/集市补齐、卸载前拦反向依赖、`doctor` 提前发现；只搬插件，不装第三方包 |
| 插件设置项 | `[[setting]]` 声明「装一次、长期生效」的配置（端点 / 账号 / API Key）：`{setting.x}` 与 `ZEROKIT_SETTING_*` 双通道、必填缺失 fail-closed、密钥只回掩码 |

### 四个面

- **CLI**：`list / show / run / doctor / config / ps / kill / logs / path` + 插件与集市的装卸。
  分级确认（只读放行 / 会改动首次确认并记住 / 高风险每次都问），
  **非交互环境 fail-closed**（没有 `--yes` 就拒绝）。
  `config` 管插件设置项（`set/get/unset`，密钥走 `--stdin` 不进 shell 历史）。
- **MCP**：工具自动生成、`annotations` 标注、**独立的 fail-closed 授权白名单**
  （只读默认放行，有副作用的必须先 `zkit mcp allow` 显式授权一次）。
  已按各家客户端的实际格式分别处理（VS Code 用 `servers` 而不是 `mcpServers`）。
- **启动器**：模糊搜索、拼音与首字母（打 `dl` 出「代理」）、键盘优先导航、
  按参数声明生成表单、按 `render` 渲染结果卡片、**最近使用**、**内容智能匹配**、
  剪贴板按钮、深链接（`#/q=`、`#/ps`、`#/plugins`、`#/market`、`#/workbench?q=`）。
  浏览态（空搜索）动作**按插件分组**——插件多了也是一份一份的，不会一锅粥；
  搜索态保持扁平（找的是那条动作）。
  组合动作在列表里标「组合 N 步」、详情页摊开链路每一步，参数表单只收链路自己的参数。
  搜索框下面一排**风险筛选**（只读 / 会改动 / 高风险，带实时计数）与「最近搜索」；
  执行前有**命令预览**（密钥打码）、执行后结果可**导出 Markdown**；详情页给出 CLI / MCP /
  深链三种**调用方式**。首页直接列**最近执行**，失败与耗时一眼可见。
  底部还有**审计日志**与**环境自检**两个页面

  **新建插件**在插件面板里完成（生成骨架 + 自动开发模式）；集市预览支持**装前试跑**
  只读动作；结果表格可排序、数字千分位、可导出 CSV/JSON、可做两次**结果对比**；
  插件可打**标签**、批量检查更新；动作可起**别名**直达；`#/stats` 是全局使用统计。
  动作详情可生成**深链二维码**（零依赖 SVG 生成器，`web/qrcode.js`）；插件主页可导出
  **能力清单 Markdown**；结果可生成**分享卡**；只读动作支持**界面内定时执行**；
  统计页最活跃插件可点进主页。
  统计页有**近 7 天趋势**（成功/失败分色）与**小时热力图**；偏好可**导出/导入**（只认
  `zerokit.` 前缀）；有**每日日报**一键生成（本地拼装）。有进程在跑时标签页标题带徽标计数。
  **工作台会话**在页面刷新后自动恢复；结果可**收藏**（`#/saved` 集中翻看）、写**执行备注**；
  动作可绑 **F1–F12 快捷键**全局直跑；结果卡支持**内查找**与**折叠**；
  插件面板可排序；头部 ☀/🌙 主题快切。

  管理动作也进了界面：**MCP 授权面板**（`#/mcp`，与 `zkit mcp allow` 同一份名单）、
  详情页的**插件配置编辑器**、确认弹窗的风险说明、组合动作的**链路图**、
  `Ctrl+P` **命令面板**（键盘直达任何动作或页面）、空状态的可点建议、
  git 来源插件的**一键分享安装命令**。审计日志与自检页前者按允许/拒绝/失败筛、可搜索、可展开；
  后者把解释器、命令依赖、插件依赖、必填配置、组合动作引用一次摊开，每条问题都带
  可复制的修复命令。插件面板顶部有**使用统计**（最常用动作排行 + 缺依赖/缺配置汇总）。
  日常体验也补齐了：深/浅/跟随系统主题、`Ctrl + /` 快捷键浮层、动作收藏置顶、
  搜索命中高亮、结果「复制/下载/再跑一次」、参数记忆与「清除记忆」、最近 5 次执行历史、
  插件健康统计卡、插件主页（`#/plugins/<id>`）、AI 工作台的中文任务建议——
  **全部纯前端、离线可用**，偏好只存本机 localStorage，不给服务端加状态。
- **插件面板**：版本、来源、可更新状态一目了然；粘贴 git 地址或本地目录
  安装（能力摊开预览 + 确认令牌）、检查更新（版本与动作增删）、两步确认卸载；
  **设置项就地编辑**（密钥输入框、默认值提示、保存后立即生效）。
- **AI 工作台**：多 provider（Claude 官方 SDK + OpenAI 兼容）、agent 循环、
  工具调用卡片、**副作用动作先弹确认**、拒绝后把理由回填给模型、SSE 流式。
  工作台吃自己的狗粮：它调用的工具就是 CLI 和 MCP 里那些。

### 插件自带的富交互页面（Web 面）

- 动作声明 `render = "web"` + 插件目录放 `web/index.html`，结果就不再用内置卡片，
  而是交给插件自己的页面渲染。CLI `zkit web <插件id>` 起界面直达。
- 内核托管 `/p/<插件id>/`（就是插件的 `web/` 目录，防目录穿越），HTML **自动注入桥**：
  页面里直接 `zkit.ready(...)` 拿执行上下文、`zkit.run(...)` 调本插件的其它动作。
- 安全模型是这条路径的立身之本：页面跑在 `sandbox="allow-scripts"` 的 iframe 里
  （opaque origin），**拿不到会话令牌、fetch 不了宿主 API**——执行只能经
  postMessage 桥由宿主转发，`mutate` / `destructive` 的确认弹窗照常生效，绕不过。
- 轻量兄弟：`output = "html"` 表示 stdout 就是 HTML 片段，沙箱 `srcdoc` 直接渲染，
  连 `web/` 目录都不用建。
- 演示：`sysinfo` 的「系统概况」动作就是这个形态（仪表盘页面还能经桥刷新、查占用最高的进程）。

### 「运行中」——看得见、管得住

- 托管进程（`background = true` 的动作）持久化到 `running.json`，
  **跨进程可见**：界面起的进程，终端里 `zkit ps` 也看得见、也能结束。
- 插件可在清单里**声明服务**（`[[service]]`，用端口或 pid 文件判断在不在跑）。
  检测走系统事实而不是信任插件自报，所以**手动启动的服务也照样被看见**。
- 结束优先用插件声明的 stop 命令（它知道怎么优雅退出），不行再按 PID 杀。

### 速度（都是实测，不是估算）

| 场景 | 优化前 | 优化后 | 手段 |
|---|---|---|---|
| 冷启动 | 706 ms | **315 ms** | AI SDK 延迟加载（启动器大多数时候用不到） |
| node 插件动作 | 176 ms | **34 ms** | worker 线程，插件声明 `runtime = "worker"` |
| python 插件动作 | 476 ms | **22 ms** | 常驻解释器，插件声明 `runtime = "host"` |
| 判活一次 | 229~1208 ms | **0.06 ms** | `process.kill(pid, 0)` 取代 tasklist |

两条加速路都要求插件**显式声明**，因为它们改变了语义（worker 不能单独设工作目录；
host 保留模块缓存、不能读 stdin）。形态不匹配时自动退回子进程。
原则是：**能安全加速的直接做，会改变语义的让作者显式选择并把代价写清楚。**

### 分发与迁移

- **插件脚手架与开发模式**：`zkit plugin new <id>` 生成带教学注释的骨架
  （生成即校验，并打印它在四个面的样子）；`zkit plugin dev <目录>` 以链接方式
  安装开发目录——改清单即生效，CLI / MCP / 启动器 / 工作台下一次调用全部跟上，
  `remove` 只删链接不碰源目录，`add <同一目录>` 一键转正；`zkit plugin validate`
  随手校验任意目录。写插件的闭环从「手写整份清单」变成「改生成的骨架」。
- **插件集市** = 一个 git 仓库 + 根目录一个 `market.json`。添加/搜索/刷新索引。
  启动器有「集市」面板（`#/market`）：添加/刷新/移除集市、跨集市搜索、把要装的插件的
  全部能力摊开预览、确认后安装；已装条目直接标「已装 vX」，不会重复装。
  安装令牌绑定「集市 + 插件 id」，换一个目标就失效。
- 安装前把插件的**全部能力摊开给人看**（每个动作的真实命令 + 风险等级），
  非交互环境没有 `--yes` 就拒绝。
- **更新**：安装时记录来源（git / 集市 / 自带 / 本地目录），`zkit plugin update`
  从来源处检查版本与动作增删，确认后替换安装（备份式、失败回滚，插件数据
  目录不受影响）。没有来源记录的如实说「无法自动更新」，不瞎猜。
- 单文件打包 `.toolpack`，导出/导入；导入时防目录穿越。
- 仓库自带 6 个示例插件：`sysinfo`、`ip`（零代码）、`proxy`（接管已有工具）、
  `quick`（内容智能匹配）、`clipboard`（剪贴板历史 + 常驻监听）、`filesearch`（文件名索引）。

### uTools 插件兼容层

带 `plugin.json` 的存量插件**丢进插件目录即可用**，自动翻译 `features[].cmds`
（关键字 / `regex:` / 划词 / 文件 / **图片**，`window` 唤起与多条正则会落进关键字并给健康警告），
翻译完就同时拿到 CLI + MCP + 启动器 + 工作台四个面。
运行时垫片提供 `utools.*` 全局：`db` 带完整 `_rev` 冲突语义（不带 `_rev` 重复 put
返回 `{ok:false,error:"conflict"}`）、`copyText` 三平台写剪贴板（pbcopy / wl-copy·xclip·xsel /
Set-Clipboard）、`redirect` 为 no-op 返回 `false` 并留提示、`getWindowSize` 返回固定合理值、
`logo` 进插件元数据（防路径穿越）、`platform` 白名单不匹配给警告。逐 API 的支持矩阵见
[`docs/reference/utools-compat.md`](utools-compat.md)。

**边界要说白**：复刻的是「无界面也能完成」的那部分（读输入、算、输出、存储、开外部程序）。
uTools 的护城河其实是 **OS 级能力**（读活动窗口、模拟键鼠、粘贴进任意前台窗口）
和 Electron 渲染进程，**那些没有对应实现**——被调用时抛的是"这依赖 uTools 本体"
这种能看懂的错，而不是 `undefined is not a function`。所以纯界面型插件跑不出结果。

### 原生壳

`apps/desktop`（Tauri v2）：全局热键、托盘、无边框窗口、失焦自动隐藏。
壳只负责拉起内核并保持 stdin 管道（stdin 一关内核就退出，避免孤儿进程）。

### 质量

- 57 个文件、**1615 项断言**，一条命令跑完：`node scripts/test-all.mjs`（不联网、不花钱）。
- `tsc --noEmit` 干净——**而且 CI 真的在跑它**（`typecheck` job）。
  曾经这里写着"干净"但没有任何地方执行这条命令，于是两个只有类型检查才看得见的
  错误在核心里躺了很久（`proxy.ts` 的 Buffer 泛型不兼容、`scaffold.ts` 的类型混用）。
  `test/ci-smoke.mjs` 现在会断言它与 CI 的接线没断。
- 两个刻意的做法：MCP 面用**裸 JSON-RPC 客户端**验证（不拿 SDK 自证）；
  性能优化前后都跑 `scripts/bench.mjs`。

---

## 三、待办

### 近期：补全体验上的缺口

- [x] **第十二轮启动器十项（v0.17.0，#77）。** bars 柱状图渲染、耗时 sparkline、
      「慢于平常」P95 徽标、批量执行落地（勘误：v0.14.0 的批量执行只有入篮 UI，
      执行函数缺失）、命令面板打分排序与页面直达、表格长单元格省略+展开浮层、
      直方图占比悬停、diff 并排开关、统一毫秒展示。顺带修了结果对比按钮
      「禁用索引颠倒」的老 bug（最新一次在队首而非队尾）。
- [x] **zerokit 插件之间的依赖。** `[requires] plugins` 落地：默认只报告缺失与补装命令，
      `--with-deps` 显式补齐（自带示例优先、其次集市），卸载时拦反向依赖，
      `doctor` 提前发现，组合动作的跨插件引用会自动折算成依赖（#38）。
      第三方包（node 模块 / pip）仍然不代装——见文末「明确不做」。
- [x] **「能力类型」写进清单。**（v0.66.0 第六十一轮：ui/ui_height/ui_min_height/ui_summary 四键 + L11 + doc 界面段 + doctor 联网提示，#225）
- [ ] **常驻宿主目前只覆盖 Python。** node 侧靠 worker（34ms）已经够快，
      其它语言（如果将来要支持）还没有对应方案。
- [x] **uTools 兼容层补关键字以外的检索维度。**（v0.65.0 第六十轮完成：`img` 翻译成
      图片文件匹配、`window` 与多正则落关键字并给健康警告，见 #222）

- [x] **第十三轮启动器十项（v0.18.0，#80）。** 列表 roving tabindex
- [x] **第十四轮启动器十项（v0.19.0，#83）。** 表单即时校验、secret 眼睛、textarea 自动增高、恢复默认、历史参数重选、脏状态守卫、URL 深链预填。
- [x] **第十五轮启动器十项（v0.20.0，#86）。** 列表虚拟滚动、执行历史分页、集市递增加载、详情页面包屑、浏览器后退栈、列表状态写进 URL、数字键快选。
- [x] **第十六轮启动器十项（v0.21.0，#89）。** 表格筛选行、列显示/隐藏、统计行、单位列换算、跨记录合并视图、右键复制列、复制 HTML 表、派生结果来源说明。
- [x] **第十七轮启动器十项（v0.22.0，#92）。** 复制模板 copy_template、Shift 复制美化 JSON、JSONL 导出、可预测文件名+打开目录、编辑器打开、终端模式键盘、Markdown 属性行、通知点击聚焦。
- [x] **第十八轮启动器十项（v0.23.0，#95）。** 只读动作监控（定时重跑+倒计时环+翻页自停）、变更高亮 diff、数值 sparkline、停止条件（失败 N 次/命中串）、`#/watch` 聚合面板、标签页标题 ⏱N、变更系统通知、采样 CSV 导出。
- [x] **第十九轮启动器十项（v0.24.0，#98）。** 危险参数值检测（rm -rf/系统目录/格式化/dd 直写黄条警示）、同动作 3 秒限速确认、结果与日志默认脱敏（token/长 hex 打码、🕶 切换明文）、动作危险度提示卡（风险横条+失败率+为什么危险）、一键清除敏感痕迹、审计日志 90 天清理提示、监控在跑时 beforeunload 挽留。
- [x] **第二十轮启动器十项（v0.25.0，#101）。** 数据备份导出（全部 zerokit.* localStorage 键打包 JSON、文件名可预测）、导入校验（非 zerokit 备份拒绝）、分组预览（收藏与标记/历史与参数/外观与设置/配置快照/表格列）、选择性导入（按组勾选）、合并新优先（对象子键合并保本地独有）、导入完成汇总 toast、外观面板「数据」分组（导出/导入/清除痕迹收拢）。
- [x] **第二十一轮启动器十项（v0.26.0，#104）。** 配置档（新建/切换/重命名/删除）、以当前状态新建、切换立即生效（外观+收藏+参数记忆+表格列就地重绘）、隐式默认档兜底、删除当前档自动切换、执行历史跨档共享、备份含配置档、面板「配置档」分组。
- [x] **第二十二轮启动器十项（v0.27.0，#107）。** 首访三步引导（可跳过永不再扰）、使用指南页 #/help（六大主题+去试用深链+页脚入口）、空搜索「试试这些」只读动作直达、非只读动作风险说明条、插件分组头悬停提示（动作数+风险构成）、折叠提示、快捷键速查保留 Ctrl+/、帮助函数全静态断言、extras-smoke +7、全量 684/684。
- [x] **第二十三轮启动器十项（v0.28.0，#110）。** 结果页签工作台（8 个、同动作重跑刷新、✕关闭、右键📌固定不被挤出）、页签标题动作名·相对时间、双击写备注（title 显示）、Alt+复制带备注头、表格上方结果查询框（子串+数字比较 size>100、数字串值）、⇄两页签对比视图（键并集黄行 diff）；resultTabTitle/tabEvict/resultQuery/resultCompare/withNoteHeader 五纯函数进 extras.js，extras-smoke 145→157、全量 696/696。
- [x] **第二十四轮启动器十项（v0.29.0，#113）。** 命令面板 `>` 命令模式（12 内置命令+最近命令置顶）、`;插件.动作` 快速执行、两段式 goto（g 后 l/h/s/m）、结果表格 j/k 行选中、`[`/`]` 切页签、`?` 键盘速查浮层、面板历史 ↑ 翻（命令+查询合并去重）；COMMAND_LIST/quickRunKey/gotoTarget/cycleTabIndex/pushHistory 五纯函数进 extras.js，extras-smoke 157→165、全量 731/731。
- [x] **第二十五轮启动器十项（v0.30.0，#116）。** 批量篮排序（↑↓）/一键去重/清单导出导入 JSON、并发上限（1=串行~8，记忆）、失败项一键重跑、手动链「接着跑」（只读候选，{result.data.字段}/{result.stdout} 占位符传值，同 CLI chain 语义）、链步骤条回看每步、执行历史「用这些参数重跑」一键回填；chainFill/batchDedup/chunkWindows/parseBatchList 四纯函数进 extras.js，extras-smoke 165→173、全量 731/731。
- [x] **第二十六轮启动器十项（v0.31.0，#119）。** 插件主页统计卡三格（动作/组合、执行+最近使用、健康）、动作搜索框、标签 chips、插件对比模态（动作数/风险构成/依赖差异行）、依赖树、复制安装命令、集市更新徽标、已装清单导出、坏插件置顶红条；pluginCompare/versionDiff/depTreeLines/filterPluginActions/pluginTags/pluginStatCards/installedList/installCommand 八纯函数进 extras.js，extras-smoke 173→183、全量 731/731。
- [x] 第二十七轮十项：搜索与发现的深度——分组+命中解释+同义词弱路由+历史深链（v0.32.0，#122）
- [x] 第二十八轮十项：国际化与文案体检——语言三档+持久化+html lang+相对时间/风险徽标双语+术语统一，文案表 62 键对齐（v0.33.0，#125）
- 第二十九轮（v0.34.0）：性能与体感优化——搜索防抖+rAF 合帧、#/perf 指标面板、大表窗口化+加载全部、大 JSON 切片序列化、list --json --brief / doctor --json / config get 单键（Issue #128）
- 第三十轮（v0.35.0）：触屏与窄屏适配——工具按钮触屏常显、长按合成右键、✎ 备注按钮、触屏拖列宽、窄屏单栏+页签横滚、结果表滚动容器（Issue #131）
- 第三十一轮（v0.36.0）：MCP 与 AI 协作面——工具描述模板化（参数说明/输出形状）、大结果摘要、敏感字段脱敏、失败补救提示、`_meta` 元数据透传、`zkit mcp tools` 与 `--json`、`allow --list` 授权时间、连击冷却（Issue #134）
- 第三十二轮（v0.37.0）：桌面壳与系统集成——托盘菜单扩充、热键可配、窗口几何记忆、Alt+←/→ 历史导航、外部链接拦截、`zkit desktop` 体检（Issue #137）
- 第三十三轮（v0.38.0）：内核可观测性与运维面——`zkit stats` 耗时统计、`logs --follow`、`zkit health`、`audit --last`、`/api/health` 探活、慢动作水位线、`zkit gc`、doctor 24h 错误计数；修复审计写入丢行（Issue #140）
- 第三十四轮（v0.39.0）：插件市场与分发——`plugin pack/unpack` zip 打包安装（零依赖 zip 实现+穿越防线）、`publish-ready` 上架检查、`market lint` 登记表校验、`plugin info/recommend`、`market add` 源健康检查（Issue #143）
- 第三十五轮（v0.40.0）：错误预防与自愈——命令/动作模糊建议（编辑距离+前缀加权）、参数缺失附参数表、失败输出「下一步」自诊断（五类 stderr 关键词）、`doctor --fix` 清半安装残留、异平台路径提前点破（Issue #146）
- 第三十九轮（v0.44.0）：结果呈现最后一公里——首列冻结/横滚阴影/行 JSON 详情/行号/时间戳人性化/空结果归因/小屏断点/MD 目录/打印样式、extras-smoke +10（223/223）、全量 883/883（Issue #158）
- 第四十二轮（v0.47.0）：渲染性能与可维护性——事件委托单监听器 / 收藏就地补丁（节点身份稳定）/ 键盘导航 O(1) / perf 渲染计数与 performance.mark / app.js 文件地图 + extras.js 分节导航 / 14 个死样式类清理、extras-smoke 223→228（+5，其中 4 项为对齐第二十七轮停用词语义的修正）、全量 27 文件 925/925（Issue #167）
- 第四十三轮（v0.48.0）：插件生态第二波——示例插件 convert（八个转换动作 + hex-flow 组合流水线）/ snap（系统自带工具截图，跨三平台，无显示器时报错带补救路径）/ typist（SQL/Markdown/CI/提交信息四类片段写剪贴板）；插件共享代码层 plugins/_vendor/（bundled 一并拷贝、加载与孤儿检测跳过下划线目录）；修复 health 把 _vendor 当坏插件的误报；eco43-smoke 28 项、全量 29 文件 1012/1012（Issue #170）
- 第四十四轮（v0.49.0）：web 插件面进阶——桥消息协议成文（消息表+四条安全边界进 plugin-spec）；外观跟随（context 带 appearance，桥写 --zk-accent/data-zk-dark，页面零配置跟上宿主皮肤）；受控跳转 zkit.openLink（仅 http(s)+宿主确认）；错误上报 zkit.reportError（白屏也看得见）；未知 type 一律忽略；演示插件 demoweb（六项能力一页）；webui-smoke 84→93、全量 29 文件 1012/1012（Issue #173）
- 第四十五轮（v0.50.0）：CLI 人体工学——输出格式四选一（--out table/json/yaml/csv）/ --quiet 单行 JSON / --copy 复制结果 / --watch N 轮询打 diff / zkit last 重跑最近 / zkit history 带时间戳与 --rerun / zkit im 交互模式（裸 zkit 直达）/ run --interactive 逐参提示 / list --health 健康一屏；新 src/core/cliX.ts（历史/格式化/diff/菜单纯函数）；cli45-smoke 32 项、全量 29 文件 1012/1012（Issue #176）
- 第四十六轮（v0.51.0）：CLI 收口与开发者体验——zkit completion 三 shell 补全 / man 命令参考 / --version 与 -V / stats --since 时间窗 / audit --follow 跟读 / 退出码细分（用法错误=2）/ check-docs 文档巡检（纯 node：内链+版本号四处同步+cookbook 命令漂移）/ README 快速开始补全；cli46-smoke 16 项、全量 30 文件 1012/1012（Issue #179）
- 第四十七轮（v0.52.0）：启动器信息架构与首屏——设置抽屉（主题/语言/日志/自检等统一收纳）、命令面板直达抽屉、首屏骨架屏、空态三级文案、结果高度三档、≤720px 窄屏断点；navGroups/emptyState/skeletonRows/resultHeightTier/viewportMode 纯函数；webui-smoke 断言随 IA 更新、全量 30 文件 1012/1012（Issue #182）
- 第四十八轮（v0.53.0）：错误信息与失败体验——失败卡片（五类分类/下一步建议/同参数重试/原文折叠）、ERROR_BOOK 知识库三面共用（UI/CLI/MCP）、批量执行失败不中断（✓ N · ✗ M · ∅ K 汇总）、监控自动停带原因摘要与最近失败样本、长 stderr 限高滚动；err48-smoke 16 项、全量 31 文件 1028/1028（Issue #185）
- 第四十九轮（v0.54.0）：结果对比与历史分析——详情页历史分析卡（数值趋势/耗时分布/失败率>30%警示）、⇄ 与上次对比（复用 resultCompare）、收藏结果两两对比、日志 CSV 导出（仅元数据）；hist49-smoke 13 项、全量 32 文件 1041/1041（Issue #188）
- 第五十轮 v0.55.0：主题与视觉打磨——字号/间距/过渡阶梯、暗色对比度 AA、斑马纹、--danger、滚动条、打印样式（contrastRatio/typeScaleStep）
- 第五十一轮 v0.56.0：搜索体验深化——丢词建议/组合记忆/搜索态折叠/desc 高亮/计数徽标/清空按钮/历史单条删（suggestNext/comboLabel）
- 第六十六轮（v0.71.0）无障碍回归：rtabs tablist/tab/tabpanel+方向键 roving（重画焦点回落修复）、抽屉 focus trap（Tab 圈禁/Esc 回焦点）、模态 role=dialog 批量补、图标按钮 aria-label、tfilter aria-label、对比表 caption、标题播报去重、reduced-motion 补漏、a11y-scan.mjs 进 lint 门禁、a11y66-smoke 21 项、全量 1319/1319（Issue #240）
- 第六十七轮（v0.72.0）安全基线第三轮：执行中停止按钮+Ctrl+.（/api/stop 杀在途进程、结果标 stopped、审计 reason=stopped）、destructive CLI 双重确认（输动作 id）、同动作并发护栏、doctor 未声明 timeout 警告、AbortSignal.any 组合外部中断与超时、safety67-smoke 20 项、全量 44 文件 1339/1339（Issue #243）
- 第六十五轮（v0.70.0）结果导出与分享：⧉ 分享 MD/HTML 单文件（内联样式无外链）+复制分享文本（50KB 截断标注）、CLI --share 落盘、元数据头 secret 掩码、share65-smoke 17 项、全量 1298/1298（Issue #237）
- 第六十四轮（v0.69.0）剪贴板工作流：#/clip 历史面板（20 条去重/截断/写回/清空）、classifyClip 七类识别、Ctrl+Shift+V 贴入即搜+建议卡直达预填、clip64-smoke 24 项、全量 1281/1281（Issue #234）
- 第六十三轮（v0.68.0）定时任务持久化：timers.json 原子写+UI 恢复、zkit timers list/pause/resume/remove/run、nextFireTime 窗口推算（跨午夜/不连环补）、doctor 孤儿检测、/api/timers 桥、timers-smoke 22 项、全量 1257/1257（Issue #231）
- 第六十二轮（v0.67.0）插件包完整性：MANIFEST.sha256 逐文件清单+包级总哈希、unpack 装前校验（--no-verify 兜底）、.zk-integrity.json 装时快照、plugin verify 装后复验、集市 integrity 字段、signing-smoke 18 项、全量 1235/1235（Issue #228）
- 第六十一轮（v0.66.0）「能力类型」进清单：ui/ui_height/ui_min_height/ui_summary 四键、L11 lint 规则、doc 界面说明段、doctor 联网提示、uTools window→ui、utools-smoke 44→45+lintdoc-smoke 29→33、全量 1217/1217（Issue #225）
- 第六十轮（v0.65.0）uTools 兼容层补全：img 唤起→图片文件匹配、window/多正则→关键字+健康警告、db.put _rev 冲突语义、copyText 三平台、redirect/getWindowSize 降级、logo/platform 元数据、docs/reference/utools-compat.md 支持矩阵、utools-smoke 37→44、全量 1212/1212（Issue #222）
- 第五十九轮（v0.64.0）设计师走查十项：执行分层主按钮+⋯菜单、视图/浮层动效、列表 stagger、顶栏状态胶囊、risk-dot 排版、执行反馈动画、暗色三层、空态插画、窄屏 sticky、webui-smoke 93→113、全量 1198/1198（Issue #219）
- 第五十八轮（v0.63.0）性能压舱石：bench.mjs 冷启动+RSS 测量、性能预算（--help<300ms/list<500ms/RSS<150MB）、10k 大输入防护、release-prep 重复版本守卫、全量 1178/1178（Issue #215）
- 第五十七轮（v0.62.0）测试体系深化：假绿修复（extras-smoke 中段崩溃被汇总掩盖 21 项没跑）、--shuffle、失败摘要+最慢 top5、CONTRIBUTING 十条军规、全量 1174/1174（Issue #212）
- 第五十二轮 v0.57.0：键盘流与无鼠标操作——F 收藏/T 标签/Y·E 结果键/Alt+↑↓ 篮内移位/速查浮层合流（keyHelpList）
- 第五十三轮 v0.58.0：结果区信息密度——空值 —/长文截断/密度三档/元信息钉底/等宽数字（cellDisplay/tableDensity/kvCollapsed）
- 第五十四轮 v0.59.0：时间线与执行复盘——#/timeline 页（timelineDays/groupByHour/weekCompare/topActionsFlat）
- **第五十五轮（v0.60.0）发布工具化**：`scripts/release-prep.mjs` 归档+四处版本号同步一步到位（三重自检/结构化 Cargo.lock/干跑模式）；`plugin lint` 进 lint.sh；启动器三修（chip 焦点/timeline 后退/中文 key 深链）
- **第五十六轮（文档体系重组）**：四层目录 + 导航页 + quickstart/glossary/faq/architecture/actions-reference + README 瘦身 + CHANGELOG 归档 + check-docs 导航断言
- 第四十六轮 v0.51.0（CLI 收口与开发者体验）：shell 补全三件套、man 命令参考、--version 短旗标、stats --since 时间窗、audit --follow 跟读、退出码细分（用法=2/失败=1）、check-docs.sh 文档巡检、README 快速开始矩阵（issue #179）
- 第四十一轮（v0.46.0）：安全审计与权限收口——`zkit allow list/add/remove`（TTL 30 天默认、过期清理、插件级撤回连带提示）/ `audit --denied` / `audit --since 1h|30m|3d|2w` / 高危动作 7 天未执行警示、新 test/audit-smoke.mjs 37 项、全量 27 文件 920/920（Issue #164）
- 第四十轮（v0.45.0）：插件开发体验闭环——`plugin lint` 十级体检（L01–L10、error/warn/info、CI 退出码、--json）/ `plugin doc` 文档生成（Markdown + --json 机读）/ 六内置插件零 error 零 warn 示范 / plugin-spec.md 体检规则对照表、新 test/lintdoc-smoke.mjs 29 项、全量 26 文件 883/883（Issue #161）
- 第三十八轮（v0.43.0）：定时与调度——新建弹窗（档位快捷+执行窗口）、错过补跑（一次不风暴）、暂停/恢复、每任务最近 10 次历史、下次触发相对时间、现在跑一次、失败通知带摘要、导出/导入 JSON、hashchange 补 #/timers 路由、extras-smoke +14（213/213）、全量 844/844（Issue #155）
- 第三十七轮（v0.42.0）：AI 协作面——结果「给 AI」Markdown 复制、AI 上下文打包、调用方式弹窗 MCP 配置段（mcpServers 一键复制）、执行历史 curl 等价命令（token 占位符）、LLM 评测 JSONL 导出、命令面板 copy-mcp/copy-ctx、监控趋势 MD、外观面板 AI 辅助隐私开关（no-ai 全隐藏）、webui-smoke +9（82/82）、extras-smoke +8（199/199）、全量 830/830（Issue #152）
- 第三十六轮（v0.41.0）：文档与示例体系——chain/setting/http 三个 demo 插件（demochain 组合动作 21→42 roundtrip、demosettings secret 掩码、demohttp HTTP 动作）、docs/cookbook.md 十篇照抄做法、plugin-spec「新能力速查」索引表、market.json 登记 9 插件、scaffold-smoke +6（31/31）、全量 821/821（Issue #149）
  （↑/↓/Enter，只有选中项在 Tab 序里）、:focus-visible 焦点环、图标按钮
  aria-label（星标/主题/批量条）、结果区 aria-live=polite + sr-only 播报、
  prefers-reduced-motion 停动画、Esc 栈先关最上层浮层、18 处空态 role=status、
  webui-smoke 新增 9 项 a11y 断言（全量 604/604）。

### 中期：能力边界上的大件

- [ ] **OS 级能力**（读当前活动窗口、模拟键鼠、粘贴进任意前台窗口）。
      这是 uTools 真正的护城河，也是"选中一段字就能唤起"这类体验的前提。
      要做得先想清楚权限模型——它能做到的事和恶意软件没有区别。
- [x] **插件签名与来源校验——内容完整性先落地。**（v0.67.0 第六十二轮：MANIFEST.sha256 打包清单、安装校验、装时快照与 `plugin verify` 复验、集市 integrity 字段存档，#228。真签名链——密钥与身份——仍在待办。）
      集市是个集中化的单点，将来要么做签名，要么做"来源可追溯 + 变更可见"。
- [x] **跨平台收尾。** 示例插件 2026-10 已在 macOS 上逐一实测（clipboard 的
      pbpaste/pbcopy 路径、sysinfo 的 BSD ps、filesearch 的 `open -R` 都已工作）；
      http 动作走系统代理已完成（#20）；CI 矩阵已放开到
      ubuntu / macos / windows 三平台（#3），Linux 上装 `xclip` + `xvfb`
      让剪贴板的真实路径也被测到。**剩余**：没有人在真 Linux 桌面上手工用过
      这套东西——CI 覆盖的是断言，不是「用起来顺不顺」。

### 明确不做（不是遗漏，是有意留的口子）

- **不做中心账号体系与云端同步。** 同步只走用户自己的存储（还没实现，但方向确定）。
- **不做插件数量上限。** uTools 免费版只能装 10 个插件——这正是要做替代品的理由之一。
- **不做 OS 级沙箱。** 白名单只管得住直接启动的程序名，管不住它自己 spawn 的子进程、
  读的配置文件、发起的网络请求。真实隔离只能靠 OS 级方案，这里不假装是沙箱。
- **不代装第三方包、不执行安装脚本。** 依赖补齐只在 zerokit 插件之间搬目录；
  `npm install` / `pip install` 的 postinstall 就是任意代码执行，交给人自己做。

---

## 四、已知差距（诚实清单）

这些是"文档说了但实现没跟上"，或者"实现了但边界和直觉不同"的地方，
集中记在这里，避免读文档的人被误导：

| 项 | 实际情况 |
|---|---|
| 云端同步 / 多设备 | **未实现**，且不做中心化方案 |
| macOS / Linux | 6 个示例插件 2026-10 在 macOS 上逐一实测通过；CI 已在三平台跑全量测试，但**没有人在真 Linux 桌面手工用过**——CI 覆盖断言，不覆盖手感 |
| http 动作 + 系统代理 | **已支持**。`http_proxy`/`https_proxy`/`all_proxy` 与 `config.toml` 的 `[proxy]` 段都认，`no_proxy` 优先。http 目标经代理转发，https 目标走 CONNECT 隧道。之所以要内核自带：Node 内置 fetch 会把 proxy 选项**静默丢弃**（设了代理也照样直连），那条路走不通 |
| uTools 纯界面插件 | 跑不出结果，会给明确报错 |
| 插件依赖 | zerokit 插件之间：默认报告缺失，`--with-deps` 显式补齐（递归 6 层、防环），卸载拦反向依赖。**第三方包（node 模块 / pip）不代装、绝不执行安装脚本** |
| 大输出 | 超过 1 MiB 会截断，完整内容落盘到 `~/.zerokit/data/artifacts/` 并返回路径 |
| 插件设置项里的密钥 | **明文存储**（0600），不加密、不进系统钥匙串；安全边界是操作系统账号。展示与日志只回 `******`，CLI 要读真值需显式 `--reveal`。换机器请整体搬 `~/.zerokit/` 或重新填 |

---

## 五、一句话现状

内核、四个面、集市、原生壳、uTools 兼容层都已经跑通并各有测试。
**速度这块从"欠账"变成了明确优势**（python 动作 21 倍、node 动作 5 倍）。
**最大的能力缺口是 OS 级能力**——它决定了能不能做到 uTools 那种"选中即唤起"的手感，
也决定了纯界面型 uTools 插件能不能接得住。
- 第六十八轮（v0.73.0）CLI 人体工学第二轮：--jq 轻量路径查询（中文键/下标/未命中 exit 1）、--out 落文件（可与 --jq 组合）、list --brief 补 actions+riskMix、config 无参总览、history --tail、plugin new --author/--description、cli68-smoke 19 项、全量 45 文件 1373/1373（Issue #246）

- 第六十九轮（v0.74.0）启动器信息密度与浏览效率：分组头徽标化、参数摘要 tooltip、[/] 带参无参过滤、. 键开详情、m/r 最近使用排序、d 键密度三档、extras-smoke +10、全量 45 文件 1373/1373（Issue #249）
- 第七十轮（v0.75.0）启动器操作连续性：结果区 j/k/Enter 复制行、X/M 导出、Ctrl+数字页签、重跑按钮、右键菜单、共现建议 coActions/flattenRuns、lastRun 索引修复（unshift 语义首位最新）、extras-smoke +6、全量 45 文件 1373/1373（Issue #252）
- **第七十一轮（CLI 工作流进阶）**：history --failed 附诊断、run --env 临时注入、plugin dev --open/--watch 存盘即验、config --json 机读、bench 子命令、mcp tools --risk 过滤（Issue #255，v0.76.0）
- **第七十二轮（上下文与智能默认）**：剪贴板感知建议、参数历史 chips、智能占位符、表单脏标记、确认弹层参数摘要（Issue #258，v0.77.0）
- **第七十三轮（视觉与微交互）**：暗色焦点光晕、表格行悬停、页签栏横向滚动、按钮按压反馈、滚动条/链接/选中色/空态插画主题适配（Issue #261，v0.78.0）
- **第七十四轮（CLI 输出与报告）**：`--format md|tsv`、大 JSON 默认截断摘要 `--full` 展开、`--format` 独立旗标（Issue #264，v0.79.0）
- **第七十五轮（结果再加工）**：run 五加工旗标 `--sort`（-列 降序）`/--pick/--uniq/--head/--sum`，只影响显示不改原始数据，列不存在报错附可用列（Issue #267，v0.80.0）
- **第七十六轮（插件运行沙箱与资源限制）**：`sandbox`（目录钉死）/`max_output`（输出字节上限，超限 SIGKILL）/`env_pass`（环境变量白名单）三键；doctor 沙箱摘要、L12 体检（Issue #270，v0.81.0）
- **第七十七轮（MCP 面第二波）**：tools `--plugin` 过滤+超量提示、mcp search 跨插件搜索、dry-run 参数预演、allow `--ttl` 有效期+status 剩余时间、revoke 撤销、失败响应 structuredContent 带 next_hint、授权存储统一 allow.json（Issue #273，v0.82.0）
- **第七十八轮（定时器与监控第二波）**：days 工作日/每周档、catchup 错过补偿（幂等）、timers --json、人话下次触发时间、执行进审计（Issue #276，v0.83.0）
- **第七十九轮（监控持久化与告警升级）**：watch.json 持久化（浏览器写/server 透传）、刷新恢复 samples 续传、失败告警升级+10 分钟去重、data export/import（meta.watch 分区）（Issue #279，v0.84.0）
- **第八十轮（首次运行体验）**：`zkit welcome` 首访欢迎+分级体检摘要+三步上手+平台缺工具安装命令、回访增量、--json 机读；MCP 内建 zerokit_welcome 工具（Issue #282，v0.85.0）
- **第八十一轮（插件供应链安全）**：unpack --strict 拒未签名包（默认警告放行）、doctor 供应链完整性段全量复验点名被改插件、list --brief 带 installedFrom 来源追踪、market list 来源标签（Issue #284，v0.86.0）
- **第八十四轮（健康体检面整合）**：doctor 三级汇总行（CLI/Web 同源同句）、体检历史 doctor-history.jsonl 保留 50 条、--diff 三向对比（新增/已解决/仍在）、持续问题标记（⚠ 持续 N 次）、--json 补 summaryLine/history/diff、Web 端最近 5 次趋势、doctor84-smoke 14 项（Issue #293，v0.89.0）
- **第八十五轮（命令面板与工作台进阶）**：面板收录 16+ 页面路由与 7 条操作命令（带快捷键徽标）、空查询分组展示、1-9 数字直选、Tab 补全、最近使用置顶（cmdhist 10 条）；修 Ctrl+P 被日志/自检等页面 mode 分支挡掉的真实缺陷、palette85-smoke 20 项（Issue #296，v0.90.0）
- **第八十六轮（Web 插件开发者体验）**：开发者面板 #/dev（清单摘要/文件树/沙箱控制台/变更提示）、`plugin dev --web`、/api/dev/status+poll、桥透传 console、审计标 source:dev、devweb86-smoke 16 项（Issue #299，v0.91.0）
- **第八十七轮（插件依赖健康与升级安全）**：`plugin deps` 健康态（版本+满足接口）、doctor 缺依赖带受影响动作数+图级成环检查（环路径直报）、`plugin update` 拓扑序升级提示、`market lint` path 本地源不可分发提示、安装前交叉依赖提醒、deps87-smoke 17 项（Issue #302，v0.92.0）

- 第八十九轮（v0.94.0）：MCP 面第三波——工具健康徽标（审计成功率进描述）、resources 面（plugins/health 只读资源）、dry-run --explain、_meta.server 版本+uptime、表格形状摘要、并发护栏 busy+retry_after_ms、失败指数退避（Issue #308）
