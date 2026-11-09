# CLI JSON 输出契约 v1（第二百二十七轮起）

> 承诺：标注 **稳定** 的命令与字段，v1 生命周期内不改名、不删除、不改类型；
> 只允许「新增可选字段」。破坏性变更必须升 v2 并在 CHANGELOG 声明。
> 标注 *实验* 的字段随时可能变——脚本不要依赖。

## 契约命令与稳定字段

### `zkit doctor --json`
| 字段 | 类型 | 稳定性 |
|---|---|---|
| `ok` | boolean | 稳定 |
| `summary.plugins` | number | 稳定 |
| `summary.actions` | number | 稳定 |
| `summary.errors` | number | 稳定 |
| `summary.warnings` | number | 稳定 |

### `zkit list --json`
| 字段 | 类型 | 稳定性 |
|---|---|---|
| `[].id` | string | 稳定 |
| `[].name` | string | 稳定 |
| `[].version` | string | 稳定 |
| `[].actions` | number | 稳定 |

### `zkit ps --json`
| 字段 | 类型 | 稳定性 |
|---|---|---|
| `processes[].id` | string | 稳定 |
| `processes[].running` | boolean | 稳定 |
| `services[].pluginId` | string | 稳定 |
| `services[].id` | string | 稳定 |
| `services[].running` | boolean | 稳定 |

### `zkit service list --json`（第二百二十七轮补）
| 字段 | 类型 | 稳定性 |
|---|---|---|
| `services[].pluginId` | string | 稳定 |
| `services[].id` | string | 稳定 |
| `services[].running` | boolean | 稳定 |
| `services[].canStop` | boolean | 稳定 |
| `services[].canStart` | boolean | 稳定 |

### `zkit cache stats --json`
| 字段 | 类型 | 稳定性 |
|---|---|---|
| `total` | number | 稳定 |
| `hits` | number | 稳定 |
| `misses` | number | 稳定 |

## 非契约命令

`dashboard`、`audit`、`timers`、`market` 等命令的输出按「人看优先」演化，
不进 v1 契约——需要稳定 JSON 时先开 issue 讨论。

## 消费者守则

- jq 管道只引用「稳定」列的字段。
- 缺字段视为「该版本没有这个信息」，不要当成错误。
- 升级 zerokit 后 CI 断言挂了：先查本文档的 CHANGELOG 变更记录，再看是不是引用了 *实验* 字段。
