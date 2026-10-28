# 术语表

读文档、写插件、看 issue 之前，先把这十几个词对齐。

## 核心对象

- **内核（kernel）**：`src/` 下的运行时。负责加载插件、执行动作、提供四个面。内核不包含任何具体功能——功能全在插件里。
- **插件（plugin）**：一个目录 + 一份 `plugin.toml` 清单。可以零代码（纯清单声明），也可以带任意语言的脚本。装在 `~/.zerokit/plugins/` 下。
- **动作（action）**：插件里的一个可执行单元。有 `id`、风险档、参数表。CLI 里写作 `插件id.动作id`（如 `sysinfo.overview`）。
- **组合动作（chain）**：`type = "chain"` 的动作，按步骤依次执行其它动作，步骤间用 `{别名.data.字段}` 传值。风险取各步最高档（fail-closed）。
- **服务（service）**：插件声明的常驻进程（有 start/stop），由内核托管生命周期。

## 风险与安全

- **风险档（risk）**：`read`（只读）/ `mutate`（改本地状态）/ `destructive`（不可逆或删除）。写插件时每个动作必须声明，缺了连加载都过不了。
- **fail-closed**：拿不准就当更危险的档处理。组合动作的风险、MCP 副作用默认拒绝，都是这个原则。
- **MCP 授权（mcp allow）**：有副作用的动作对 AI 客户端默认拒绝，需要 `zkit mcp allow <key>` 显式授权。MCP 规范明确 annotations 不可信，边界必须留在运行器这侧。

## 分发

- **集市（market）**：插件登记处。`market.json` 是本仓库自带的集市；也可以添加本地目录或远程 URL 作为额外源。
- **打包（pack）**：`zkit plugin pack` 把插件目录打成 zip；`unpack` 装回。路径穿越（`../`）会被拒绝。
- **_vendor**：插件间共享代码的目录约定（下划线开头，不是插件，`plugin bundled` 会跟着拷贝）。

## 数据与个性化

- **数据目录（ZEROKIT_HOME）**：默认 `~/.zerokit/`。插件、设置、日志、审计全在里面，删掉即完全重置。
- **设置项（[[setting]]）**：插件声明的持久配置，存 `~/.zerokit/settings/<id>.json`，secret 只回掩码。
- **配置档（profile）**：启动器的外观/收藏/参数记忆分档，切换立即生效，跨档共享执行历史。
- **监控（watch）**：只读动作的定时重跑 + 变更 diff 高亮 + 停止条件（连续失败/命中串）。

## 执行面

- **四个面**：同一份插件清单派生的四种入口——CLI（`zkit run`）、MCP（AI 客户端）、启动器（Web UI）、桌面壳（Tauri）。
- **审计（audit）**：每次执行的记录（谁/什么/多久/成败），`zkit ops audit` 查看，`gc` 清理过期。
