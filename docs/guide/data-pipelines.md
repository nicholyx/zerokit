# 数据管道指南（第三百零二轮立，v4.14.0）

> demochain 插件是活的教材——本指南的每个示例都来自它的真实动作，照抄就能跑。
> 面向想搭「取数 → 变换 → 落盘 → 积累」数据流的插件作者。

## 全链一图

```
取数（任意 read 动作）
   │ pipe = true（stdout → 下一步 stdin，291 轮）
   ▼
变换（任意动作，吃 stdin 出 stdout）
   │
   ▼ builtin.zerocol-export（columns 取值落盘，292 轮）
   │   mode = "append"（多行积累，301 轮）· rowsLimit（默认 1000）
   ▼
data_dir/*.zerocol.json（列式文件）
   │
   ▼ builtin.zerocol-read（294 轮）
   │   data.列名 取首行 · data._all 取全列 · data._rows 行数
   ▼
下游消费（另一个 chain / 报表动作）

调度层：watch 触发（295 轮）——数据变化时自动跑整条管道。
```

## 1. chain 基础：多步组合

```toml
[[action]]
id = "pipeline"
type = "chain"        # 组合动作：步骤按序执行
risk = "read"
template = "{second}" # 引用某步的结果渲染

[[action.step]]
use = "self.gen"      # 本插件的动作；跨插件写 "插件id.动作id"
as  = "first"         # 引用名：后续 {first.data.value} 取结果

[[action.step]]
use    = "self.double"
as     = "second"
params = { value = "{first.data.value}" }  # 上一步的值传参
```

规则：被引用动作要 `output = "json"`（结构化结果才能 `{alias.data.字段}`）；chain 不写 run；
risk 必须 ≥ 每一步。

## 2. pipe：stdout 直通 stdin

```toml
[[action.step]]
use  = "self.count-stdin"
as   = "counted"
pipe = true           # 上一步的 stdout 作为本步的 stdin
```

适用：文本流加工（数行数、过滤、转换）。错误传播：管道中任一步失败整链停。

## 3. 导出：builtin.zerocol-export

```toml
[[action.step]]
use = "builtin.zerocol-export"
as  = "saved"
params = {
  file = "my-data",              # 落 data_dir/my-data.zerocol.json
  mode = "append",               # 追加（默认 overwrite）
  rowsLimit = 1000,              # 行数上限（camelCase！kebab 不过参数名规则）
  columns = [
    { name = "value", type = "int",    from = "first.data.value" },
    { name = "chars",  type = "int",    from = "counted.data.count" },
    { name = "note",   type = "string", from = "first.stdout" },
  ]
}
```

`from` 路径：`别名.data.字段`（结构化结果）或 `别名.stdout`（原始输出）。
类型三选：int / double / string。换列声明追加时旧行新列补 null。

## 4. 读回：builtin.zerocol-read

**统计快捷方式（309 轮）**：`builtin.zerocol-stats` 直接出 min/max/avg/count——
`params = { file = "ts-data", column = "value", ops = "min,max,avg,count" }`，
结果 `{alias.data.stats.min}` 模板直取（int/double 列专用）。多列一次统计：`columns = "value,duration"` → 分组取 `{alias.data.stats.duration.min}`（315 轮；string 列多列形态静默跳过）。窗口统计：`window = 3` 只算每列最近 3 行——监控语义（异常恢复后告警可复位，320 轮）。

```toml
[[action.step]]
use = "builtin.zerocol-read"
as  = "back"
params = { file = "my-data" }

# 下游取值：
#   {back.data.value}   首行 value
#   {back.data._rows}   总行数
#   {back.data._all}    全列数组（JSON 表达）
```

## 5. 调度：watch 触发

动作详情页 → 「监控」→ 间隔与停止条件 → **触发管道** 填 `插件.chain动作`。
数据变化时自动执行整条链；面板 ⛓ 徽标显示最近触发成败。

## 5b. 定时积累实战（310 轮定稿——dataflow 插件）

```
详情页 → 监控 → 间隔 300 秒 → 触发管道填 dataflow.append-ts
```

数据变化时自动追加一行到 `ts-data`（rowsLimit=20 滚动窗口）；
随时跑 `dataflow.consume-detail` 看统计。注意两点：
- watch 的 chain 走 `/api/run`（UI server 的读缓存）——监控动作默认带 `fresh`，
  自己写客户端时 POST body 记得 `fresh: true` 才不会吃到 10s 缓存；
- `lastChainRun`（ok/ts/key）持久化在 watch.json，面板 ⛓ 徽标显示。

## 组合模式速查

| 模式 | 步骤 | demochain 实例 |
|---|---|---|
| 取数→变换→落盘 | gen → pipe count → export | `pipe-export` |
| 读回→回写（往返） | read → export | `pipe-roundtrip` |
| 定时积累 | watch(gen) → append export | watch 配 `pipe-append` |
| 读回再加工 | read → pipe → export | 自由组合 |

## 相关文档

- [协作指南](collaboration.md)（广播里跑管道——多人实时可见）
- [插件清单规范](../reference/plugin-spec.md)（chain/pipe/builtin 步字段）
- [v4 展望](v4-outlook.md)（数据工作流主题来龙去脉）
