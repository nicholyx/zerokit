# Cookbook——十篇可以照抄的做法

每篇 ≤30 行、拿来就能跑。先装示例插件对照看更直观：
`zkit plugin bundled && zkit list`。完整字段参考 [plugin-spec.md](plugin-spec.md)。

## 目录

1. [第一个插件（零代码：只发一个 HTTP 请求）](#1-第一个插件)
2. [脚本动作：让 stdout 变成结构化结果](#2-脚本动作)
3. [用户配置：设置项与 secret](#3-设置项与-secret)
4. [把两个动作拼成一个（组合动作）](#4-组合动作)
5. [声明插件依赖别的插件](#5-插件依赖)
6. [让 HTTP 请求走代理](#6-http-走代理)
7. [后台动作（服务托管）](#7-后台动作)
8. [给动作配富交互页面](#8-web-渲染)
9. [风险分级与破坏性操作](#9-风险分级)
10. [打包分发到集市](#10-打包分发)

---

## 1. 第一个插件

整个插件可以**一个脚本都不写**（见 `plugins/ip/`）：

```toml
[plugin]
id = "myip"
name = "出口 IP"
version = "0.1.0"
summary = "查本机公网 IP"
keywords = ["ip", "网络"]

[[action]]
id = "public"
title = "查公网 IP"
description = "返回当前出口 IP。"
type = "http"
url = "https://api.ipify.org?format=json"
output = "json"
render = "keyvalue"
risk = "read"
```

放 `~/.zerokit/plugins/myip/plugin.toml`，`zkit run myip public` 即可。

## 2. 脚本动作

stdout 输出 JSON，四个面（CLI/MCP/启动器/AI 工作台）自动结构化：

```toml
[[action]]
id = "hello"
title = "打个招呼"
risk = "read"
run = ["{python}", "main.py"]
params = [
  { name = "name", type = "string", description = "称呼", default = "世界" },
]
```

```python
import json, os
name = os.environ.get("ZEROKIT_PARAM_NAME", "世界")
print(json.dumps({"greeting": f"你好，{name}！"}, ensure_ascii=False))
```

参数经 `ZEROKIT_PARAM_<大写名>` 注入（secret 参数绝不进命令行）。

## 3. 设置项与 secret

```toml
[[setting]]
name = "api_token"
title = "API 令牌"
type = "string"
secret = true
description = "敏感值只回掩码，用户用 --stdin 写入"

[[action]]
id = "fetch"
risk = "read"
run = ["{python}", "main.py"]
```

```bash
zkit config myplug set api_token --stdin   # 不落 shell 历史
zkit run myplug fetch
```

脚本里 `os.environ["ZEROKIT_SETTING_API_TOKEN"]` 拿值；回显只给 `te***`。
活示例：`plugins/demosettings/`。

## 4. 组合动作

把已有动作按序拼成新能力，不写代码（活示例 `plugins/demochain/`、`plugins/sysinfo/` 的 `brief`）：

```toml
[[action]]
id = "pipeline"
type = "chain"
risk = "read"
template = "拿到 {first.data.value}，翻倍后是 {second.data.doubled}"

[[action.step]]
use = "self.gen"
as  = "first"

[[action.step]]
use    = "self.double"
as     = "second"
params = { value = "{first.data.value}" }
```

要点：被引用动作要 `output = "json"`；chain 动作**不写 run**；
`risk` 必须 ≥ 每一步（fail-closed）。

## 5. 插件依赖

```toml
[requires]
plugins = ["sysinfo"]   # 装这个插件时自动带上 sysinfo
```

`zkit plugin add ./myplug --with-deps` 递归补装；卸载时反向依赖会被拦下。

## 6. HTTP 走代理

内核发请求时读 `http_proxy` / `https_proxy` / `all_proxy` 环境变量，
或在 `~/.zerokit/config.toml` 里长期配置：

```toml
[proxy]
url = "http://127.0.0.1:7890"
no_proxy = ["localhost", "192.168.*"]
```

> 为什么内核自己发：Node 内置 fetch 会静默丢弃 `proxy` 选项——设了也直连。
> 见 `src/core/proxy.ts`。

## 7. 后台动作

```toml
[[action]]
id = "watch"
risk = "mutate"
background = true
run = ["{node}", "watch.mjs"]
stop = ["{node}", "watch.mjs", "stop"]
```

启动器「运行中」面板能看到、能一键停；退出时内核兜底回收。

## 8. Web 渲染

给动作配一个富交互页面（沙箱 iframe，只能经 postMessage 通信）：

```toml
[[action]]
id = "report"
risk = "read"
render = "web"
run = ["{node}", "report.mjs"]
```

页面放 `web/index.html`；脚手架 `zkit plugin new myplug --web` 直接生成骨架。

## 9. 风险分级

```toml
risk = "read"         # 只读，直接跑
risk = "mutate"       # 改动但可恢复，执行前确认一次
risk = "destructive"  # 不可逆，必须 --yes / 显式确认
```

MCP 侧还有第二道闸：有副作用的动作默认拒绝，`zkit mcp allow <插件>.<动作>` 显式授权。

## 10. 打包分发

```bash
zkit plugin pack ./myplug              # 生成 myplug-0.1.0.zerokit.zip
zkit publish-ready ./myplug            # 发布体检（清单/风险/命名）
zkit plugin unpack myplug-0.1.0.zerokit.zip   # 对端安装（拒绝路径穿越）
```

包是纯 zip（内核手写打包，零新依赖）；集市登记见 `market.json` 的
`market lint` 检查。
