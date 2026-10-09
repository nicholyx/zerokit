# 插件清单规范（plugin.toml）

一份 `plugin.toml` 同时定义四件事：**人看到的界面、终端敲的命令、AI 客户端看到的工具、
以及 Web 表单**。加一个参数，四个面同时多出来。

- [目录与发现](#目录与发现)
- [\[plugin\] 段](#plugin-段)
- [\[requires\] 段](#requires-段)
- [\[\[action\]\] 段](#action-段)
- [\[\[action.param\]\] 段](#actionparam-段)
- [\[\[service\]\] 段](#service-段)
- [占位符](#占位符)
- [输出与渲染](#输出与渲染)
- [风险等级](#风险等级)
- [三种插件形态](#三种插件形态)
- [四个面怎么派生](#四个面怎么派生)
- [校验规则](#校验规则)
- [完整示例](#完整示例)

---

## 目录与发现

插件就是一个目录，放在 `~/.zerokit/plugins/<任意名字>/`，目录里必须有 `plugin.toml`。

```
plugins/jlc-proxy/
  plugin.toml        必需。唯一的声明文件
  proxy.py           任意语言、任意文件；也可以完全没有代码
  web/index.html     可选。富交互网页形态
  icon.svg           可选
```

**目录即插件，复制即迁移。** 也可以打包成单个 `.toolpack` 文件（`zkit plugin export`）。

## \[plugin\] 段

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | ASCII，`^[a-z0-9][a-z0-9._-]{0,63}$`。用作目录名、CLI 名、MCP 工具名前缀 |
| `name` | ✅ | 显示名，可以中文 |
| `version` | | 默认 `0.0.0` |
| `summary` | | 一句话说明。给搜索和模型路由用，**建议写** |
| `description` | | 长说明 |
| `keywords` | | 字符串数组。同时供模糊搜索和模型判断 |
| `author` / `homepage` / `license` | | 元信息 |
| `runtime` | | `spawn`（默认，起子进程，最通用）、`worker`（node 快 5 倍）、`host`（常驻解释器，python 快 21 倍）。见下 |

### `runtime = "worker"`：让 node 插件快 5 倍

默认每个动作起一个子进程，而**起进程本身就是大头**：这台机器上 `node` 裸启动约
116~193 ms。worker 线程省掉整个进程创建，实测 **176 ms → 34 ms（5.2 倍）**。

```toml
[plugin]
runtime = "worker"    # 只对「用 {node} 跑一个 .js/.mjs 文件」的动作生效
```

**代价**：worker 不能单独设工作目录（`process.chdir` 是进程级的），所以脚本里的
**相对路径不再指向插件目录**。要定位自己的文件请用 `{plugin_dir}` 或
`import.meta.dirname`：

```js
import path from 'node:path';
const here = import.meta.dirname;              // ✅ 对
const data = fs.readFileSync('./data.json');   // ❌ worker 下会找不到
```

不满足条件时（不是 node、不是 .js 文件、脚本不存在）会自动退回子进程，
不会因此失败。所以开它是安全的，只是要注意上面那条相对路径的约定。

> 其它语言（python 等）用不上 worker——它是 Node 特有的。它们走下面的 `host`。

### `runtime = "host"`：让 python 插件快 21 倍

```toml
[plugin]
runtime = "host"      # 只对「用 {python} 跑一个 .py 文件」的动作生效
```

`host` 是一个**常驻解释器**：脚本在同一个 python 进程里被反复执行，所以解释器
启动和 `import` 的成本只付一次。实测 `proxy.py status` 从 **476ms → 22ms**。

原理是「同一个进程里反复 exec」：每次执行用全新的 `globals`（模块级变量不跨调用串味），
但 `sys.modules` 保留（这正是快的来源）。执行前会把脚本所在目录放进 `sys.path[0]`，
所以插件 `import` 自己的同级模块和 `python script.py` 行为一致。

**代价得说清楚**，所以它是显式选择而不是自动优化：

- 模块级状态在多次调用之间**会保留**（`import` 的模块是同一个）
- 脚本**不能读 stdin**（那条通道被协议占了）
- 不能用 `os.write(1, ...)` 直接写文件描述符（会污染协议）
- `os.chdir` 会改变宿主的工作目录（每次调用前会重新 `chdir` 回去）

只适合**无状态的一次性任务**。常驻宿主会出现在「运行中」里（可查看、可结束），
空闲 5 分钟自动退出。一次性的 CLI 调用不会启用它——那种场景宿主的冷启动反而更慢。

不满足条件时同样自动退回 `spawn`。

> `id` 为什么必须是 ASCII：MCP 规范要求工具名匹配 `^[A-Za-z0-9._-]{1,128}$`，
> 而工具名是 `<id>__<action id>` 拼出来的。中文请放 `name`。

```toml
[plugin]
id       = "jlc-proxy"
name     = "白名单代理"
version  = "1.0.0"
summary  = "只允许访问 jlcops.com / jlcerp.com 的出网代理"
keywords = ["代理", "proxy", "网络", "白名单"]
```

## \[requires\] 段

声明外部依赖。缺失时 zerokit 会**在运行前**给出可操作的安装指引，而不是让命令以莫名其妙的方式失败。

```toml
[requires]
python = ">=3.10"
git    = "*"
```

已知会自动给出安装命令的有 `python` / `node` / `git` / `docker`。
定位时会**跳过微软商店的占位程序**并实际验证能跑（这是从真实的坑里总结的：
Windows 上 `python.exe` 可能只是个会弹商店的空壳）。

## \[\[action\]\] 段

一个动作 = 启动器里一条命令 = 一个 CLI 子命令 = 一个 MCP 工具。

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 字符集同插件 id。会拼进工具名 |
| `title` | | 显示名，默认取 `id` |
| `description` | | **写给人和模型两个人的**。是模型判断「什么时候该用我」的唯一依据 |
| `type` | | `exec`（默认）或 `http` |
| `run` | exec 必填 | **argv 数组**，不是字符串 |
| `shell` | | 默认 `false`。开了才用 shell 拼字符串，风险等级会被强制提升为 `destructive` |
| `url` / `method` / `headers` / `body` | http 必填 `url` | |
| `output` | | `text`（默认）/ `json` / `markdown` / `table` / `file` / `html` |
| `render` | | 各端渲染提示。默认由 `output` 推导 |
| `risk` | ✅ | `read` / `mutate` / `destructive` |
| `timeout` | | 秒，默认 60 |
| `cwd` | | 工作目录，相对插件目录；绝对路径也支持（用于接管已有工具） |
| `env` | | 追加给子进程的环境变量 |
| `encoding` | | 子进程输出的编码，默认 `utf8`。老工具输出 GBK 时用它 |
| `background` | | 默认 `false`。动作拉起长期运行的进程时设为 `true`：不等它退出，进程由内核托管，会出现在「运行中」里并可随时结束 |

**为什么 `run` 是数组**：参数作为数组元素直接传给子进程，**不做字符串拼接**，
从根上消除参数注入。这是同类项目（mcp-shell-server、cli-mcp-server）的共同做法。

```toml
[[action]]
id          = "status"
title       = "查看代理状态"
description = "显示代理是否在运行、监听地址、允许的域名端口、开机自启状态。想确认代理是否正常工作时用这个。"
run         = ["{python}", "proxy.py", "status"]
output      = "text"
risk        = "read"
```

## \[\[action.param\]\] 段

写在动作下面（写 `[[action.params]]` 也行，两种都收）。

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | ✅ | `^[a-zA-Z_][a-zA-Z0-9_]*$`。要能同时当 JSON Schema 属性名和 CLI flag |
| `type` | | `string`（默认）/ `integer` / `number` / `boolean` / `path` / `enum` |
| `description` | | 会进 MCP 的 `inputSchema.description`，是模型判断传什么的依据 |
| `required` | | 默认 `false` |
| `default` | | 默认值 |
| `enum` | type=enum 必填 | 候选值数组 |
| `short` | | CLI 短名，例如 `d` → `-d` |
| `secret` | | 敏感值，会在审计日志和确认框里打码 |

```toml
[[action]]
id          = "allow-domain"
title       = "添加允许域名"
run         = ["{python}", "proxy.py", "config", "domain", "add", "{domain}"]
risk        = "mutate"

  [[action.param]]
  name        = "domain"
  type        = "string"
  required    = true
  description = "要允许的域名，例如 example.com（含所有子域）"
```

## \[action.match\]：内容智能匹配（可选）

声明「**用户手里是什么东西**」时这个动作该自动出现——不看用户打了什么字。
粘一个链接进来，「打开链接」自己就冒出来；粘一串 10 位数字，「时间戳转日期」自己就冒出来。

```toml
[[action]]
id          = "open-url"
title       = "用浏览器打开这个链接"
description = "在默认浏览器里打开粘进来的网址。"
run         = ["{node}", "quick.mjs", "open-url", "{url}"]
output      = "text"
risk        = "mutate"

  [[action.param]]
  name        = "url"
  type        = "string"
  required    = true
  description = "要打开的网址"

  [action.match]
  type   = "url"
  fills  = "url"       # 命中后把内容填进哪个参数（必须是本动作声明过的）
  label  = "链接"       # 展示用标签，可选
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `type` | ✅ | `url` / `files` / `regex` / `text` |
| `fills` | ✅ | 命中后把内容填进哪个参数。写错了会被校验拦下 |
| `pattern` | type=regex 必填 | 正则（会被校验是否合法） |
| `extensions` | | type=files 时的扩展名白名单，例如 `["png","jpg"]`，留空表示任意文件 |
| `label` | | 展示用标签，例如"链接"。不写按 type 取默认 |

命中后：该动作在启动器里**置顶**并标记「智能匹配」，你按回车时内容会**自动填进
`fills` 指定的参数**，不用再复制粘贴一遍。

判定全部在浏览器里做（`web/match.js`，纯函数，可以脱离浏览器直接测）。能认出来的
内容类型：链接、IP、时间戳（秒/毫秒）、颜色、邮箱、JSON、文件路径。

> 注意 `text` 类型对**任何非空文本**都命中，等于永久置顶，慎用。
> `files` 类型在没有真实文件路径（比如浏览器里拖拽拿不到绝对路径）时不会触发——
> 它只认真实文件，不会因为输入框里恰好有字就误跳出来。

## \[\[service\]\] 段（可选）

声明插件的常驻服务，让它在「运行中」（`zkit ps` / 界面上的运行中面板）里能被看见和管理。

有些插件的守护进程会**脱离 zerokit 独立运行**——比如自己 fork 一个后台进程然后退出，
或者干脆是别的程序（甚至用户手动）启动的。光靠管子进程看不见它们，所以需要声明
「用什么办法能判断它在不在跑」。

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 字符集同动作 id |
| `title` | | 显示名 |
| `description` | | 说明 |
| `port` / `pidFile` | ✅ 二选一 | 判断依据。至少在给一个，否则没法知道它在不在跑 |
| `stop` | | 停止命令（argv 数组）。不给就按检测到的 PID 直接结束 |
| `cwd` / `env` | | 停止命令的工作目录与环境变量 |

```toml
[[service]]
id          = "proxy"
title       = "白名单代理服务"
description = "只允许访问 jlcops.com / jlcerp.com 的出网代理"
port        = 28888
stop        = ["{python}", "proxy.py", "stop"]
cwd         = "D:/software/proxy"
```

**检测走系统事实**（谁在监听这个端口 / 这个 PID 还活着），不信任插件自报，
所以手动启动的、别的程序启动的，一样看得见。

`port` 和 `pidFile` 的区别：`port` 最通用（能拿到端口就一定有个进程）；
`pidFile` 适合不监听端口的后台任务，但需要插件自己维护这个文件。

## 占位符

`run`、`url` 里的 `{名字}` 会被替换。**清单是模板，值来自参数或内置变量**。

内置变量：

| 占位符 | 值 |
|---|---|
| `{python}` / `{node}` / `{git}` | 定位到的解释器/命令的**绝对路径**（找不到就算失败，不会静默用 PATH） |
| `{plugin_dir}` | 插件目录的绝对路径 |
| `{data_dir}` | 插件私有的持久化目录（跨更新保留） |
| `{home}` | zerokit 数据根目录 |
| `{kit}` | zerokit 自身的安装根目录（用来定位随内核分发的辅助脚本，例如 uTools 兼容层的运行时） |

参数占位符用参数名，例如 `{domain}`。

两条细则：

- 若一个元素**整体**就是 `{可选参数}` 且该参数没给值，**整个元素会被丢掉**，
  而不是传一个空字符串进去——这样可选参数能自然地影响命令行形态。
- 元素内部的部分替换（如 `--days={days}`）也支持，仍然只影响单个 argv 元素。

## 输出与渲染

约定：成功时把结构化内容写到 **stdout**，退出码 `0`；失败非 `0`，错误写 **stderr**。

- `output = "json"` 时，stdout 必须是合法 JSON，zerokit 会解析后交给各端渲染成表格/键值表。
- 输出超过 **1 MiB** 会截断，完整内容落盘到 `~/.zerokit/data/artifacts/`，
  并把路径一并返回（MCP 规范没有定义大输出的截断或分页，只能自己处理）。

编码：Windows 上 Python 往管道写默认用系统代码页（中文机器是 GBK）。
zerokit 对 python 解释器会自动注入 `PYTHONIOENCODING=utf-8`；其它语言输出非 UTF-8 时，
在动作里声明 `encoding` 即可。

## 风险等级

`risk` 是**必填**的，不是装饰。副作用常常超出接口名所示（"查询订单"内部可能带消息推送和写盘），
所以必须由作者显式声明。

| 等级 | 确认策略 | MCP annotations |
|---|---|---|
| `read` | 直接执行，不问 | `readOnlyHint: true`、`idempotentHint: true` |
| `mutate` | 首次确认并记住 | `destructiveHint: false` |
| `destructive` | **每次都确认**，不支持记住 | `destructiveHint: true` |

MCP 面上还有一层独立的默认拒绝：**只读动作默认放行，有副作用的动作必须先在终端里
`zkit mcp allow <插件>.<动作>` 显式授权**。理由是 MCP 规范明确要求客户端把 annotations
当作不可信——不能指望 AI 客户端替我们把关。

## 三种插件形态

**1. 零代码（`type = "http"`）** —— 最常见的"调个接口"根本不需要写代码：

```toml
[[action]]
id     = "public"
title  = "查公网 IP"
type   = "http"
url    = "https://api.ipify.org?format=json"
output = "json"
risk   = "read"
```

**2. 跑本地命令（`type = "exec"`）** —— 任意语言，通过 stdout 交流。

**3. 带网页（可选 `web/index.html`）** —— 需要富交互时用，启动器会打开页面而不是结果卡片。

**4. uTools 插件（零改造接入）** —— 见下一节。

## uTools 插件兼容

目录里有 `plugin.json` 且带 `pluginName` / `features` 的，会被**自动识别**并就地翻译成
zerokit 的清单（只读，不写你的目录）。丢进插件目录即可，不需要先转格式。

翻译的是 uTools 那份干净的部分——`features[].cmds`：

| uTools `cmds` 写法 | 翻成 | 说明 |
|---|---|---|
| `"关键字"` | 关键字 | 进搜索索引，**自动支持拼音首字母** |
| `"regex:^\\d+$"` | `regex` 匹配 | 直接搬正则 |
| `{ "type": "over" }` | `text` 匹配 | 划词/选中文本 |
| `{ "type": "files" }` | `files` 匹配 | `fileType: image` 会转成扩展名白名单 |
| `{ "type": "img" }` | 仅关键字 | 我们没有图片输入，会给出警告 |
| `{ "type": "window" }` | 不支持 | 依赖 OS 级能力，会给出警告 |

运行时由 `src/core/utools-runtime.mjs` 提供 `utools.*` 全局。**复刻的是无界面也能完成的那部分**：

- 生命周期：`onPluginEnter` / `onPluginReady` / `onPluginOut` / `outPlugin` / `hideMainWindow`
- 输出：`showNotification` / `showMessageBox` —— 映射到 **stdout**（CLI 直接看到、启动器渲染成结果卡片、MCP 客户端拿到文本）
- 存储：`dbStorage`（get/set/remove）、`db`（put/get/remove/allDocs）→ 落在插件的 `{data_dir}`
- 系统：`shellOpenExternal` / `shellOpenPath` / `copyText` / `getPath` / `isWindows|MacOS|Linux`
- 降级：`setSubInput` 系列（没有 UI，退化成"直接给值并走一遍回调"）

**明确没有的**（被调用时抛的是"这依赖 uTools 本体"这种能看懂的错）：

- 一切 Electron 窗口/视图：`createBrowserWindow` / `getCurrentWindow` / `redirect` …
- OS 级能力：`simulateKeyboardTap` / `getCursorScreenPoint` / 读活动窗口
- **渲染进程**：没有 `document` / `window` 的 DOM。碰到 `document.body.innerHTML = …`
  这类写法会得到一个说清楚原因的错误，而不是静默失败或 `undefined is not a function`

代价要说白：**纯界面型的 uTools 插件在这里跑不出结果**。适配层服务的是"命令型"插件
（读输入 → 算 → 给结果），这也是能映射到 CLI / MCP 的那一类。

另外，翻译出来的动作 `risk` 一律是 `mutate`——跑的是第三方插件的任意代码，
默认"首次执行需确认"是唯一诚实的默认值。

## 四个面怎么派生

| 面 | 从同一份声明派生出的东西 |
|---|---|
| 启动器 / Web | 关键词命中 → 动作列表 → **按参数生成表单** → 按 `render` 渲染结果卡片 |
| CLI | `zkit run <插件> <动作> --<参数> <值>` |
| MCP | 工具 `<插件id>__<动作id>`，`inputSchema` 自动生成，`description` 直接取清单 |

参数投影是同一份声明的四种形态：`toJsonSchema` / `toCliFlags` / `toFormFields` / 值转换。
所以「给 AI 用」不是额外开发，而是免费副产品。

## 校验规则

`zkit doctor` 会检查所有插件的清单。常见错误：

- `id` 里有大写或中文 → 只允许小写字母、数字、`.`、`_`、`-`
- 动作缺 `risk` → 必须显式声明
- `run` 写成了字符串而不是数组 → 数组才是安全的形式
- `run` 里用了 `{python}` 但本机没装 → 运行时给出安装指引
- `type = "enum"` 但没给 `enum` 候选值
- 参数名以数字开头

## 完整示例

```toml
[plugin]
id       = "jlc-proxy"
name     = "白名单代理"
version  = "1.0.0"
summary  = "只允许访问 jlcops.com / jlcerp.com 的出网代理"
keywords = ["代理", "proxy", "网络", "白名单"]
license  = "MIT"

[requires]
python = ">=3.10"

[[action]]
id          = "status"
title       = "查看代理状态"
description = "显示代理是否运行、监听地址、允许的域名端口、开机自启状态。确认代理是否正常时用这个。"
run         = ["{python}", "proxy.py", "status"]
output      = "text"
risk        = "read"

[[action]]
id          = "allow-domain"
title       = "添加允许域名"
description = "把一个域名加入白名单，改完约 2 秒自动生效。需要放行新站点时用这个。"
run         = ["{python}", "proxy.py", "config", "domain", "add", "{domain}"]
output      = "text"
risk        = "mutate"

  [[action.param]]
  name        = "domain"
  type        = "string"
  required    = true
  description = "要允许的域名，例如 example.com（写主域名即包含它的所有子域）"

[[action]]
id          = "auth"
title       = "设置代理认证"
description = "开启或修改代理的 HTTP Basic 认证用户名密码。改完所有走这个代理的客户端都要填上。"
run         = ["{python}", "proxy.py", "config", "auth", "basic", "{user}", "{password}"]
output      = "text"
risk        = "destructive"

  [[action.param]]
  name        = "user"
  type        = "string"
  required    = true
  description = "认证用户名"

  [[action.param]]
  name        = "password"
  type        = "string"
  required    = true
  secret      = true
  description = "认证密码"
```

写完自查：

```bash
zkit doctor                    # 清单校验 + 依赖自检
zkit show jlc-proxy            # 看生成的 MCP 工具名和 inputSchema
zkit run jlc-proxy status      # 直接跑一次
zkit mcp serve                 # 确认 AI 侧也能看到这些工具
```