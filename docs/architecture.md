# 架构：四个面与数据流

## 一份清单，四个入口

```
                 ┌───────────────┴───────────────┐
                 │  plugin.toml（插件清单，纯文本） │
                 └───────────────┬────────────────┘
                                 │ 加载/校验（risk 必填、参数表、依赖）
                 ┌──────────────┴───────────────┐
                 │          内核 src/core/        │
                 │  manifest · runner · registry  │
                 │  deps · pluginConfig · doctor  │
                 │  ops · audit · suggest · …     │
                 └──┬──────┬──────┬──────┬───────┘
                    │      │      │      │
        ┌───────────┘      │      │      └────────────┐
        ▼                  ▼      ▼                    ▼
   CLI（zkit run …）   MCP 服务   启动器（Web）     桌面壳（Tauri）
   src/cli.ts          src/mcp.ts  src/server.ts   apps/desktop/
```

四个面（CLI / MCP / 启动器 / 桌面壳）不重复实现任何逻辑——都调内核同一套运行器。

## 数据流：一次动作执行

1. **入口**收到请求（命令行参数 / MCP JSON-RPC / HTTP+令牌 / 桥消息）
2. **风险闸**：destructive 动作要确认；MCP 面还要求 `mcp allow` 显式授权（annotations 不可信，边界在运行器这侧）
3. **参数解析**：占位符（`{field}`、`{setting.x}`、`{别名.data.字段}`）填充 + 必填/类型校验
4. **runner** 起子进程（统一注入 `PYTHONIOENCODING=utf-8`），或按声明走 http/service
5. **输出解析**：声明 `output="json"` 的动作解析 stdout；大结果截断、secret 掩码
6. **审计落盘**：谁、什么参数、多久、成败 → `~/.zerokit/audit/`
7. **面渲染**：CLI 打印、启动器渲染成 KV/表格/图表、MCP 回 JSON-RPC result

## 关键设计承诺

- **没有构建步骤**：`node src/cli.ts` 直接跑 TS 源码（Node ≥22.18 原生类型擦除）。不引入 tsc/esbuild——新增能力先问「能不能不构建」。
- **数据目录可抛弃**：一切运行数据在 `~/.zerokit/`（或 `ZEROKIT_HOME`），删掉即完全重。
- **插件是纯文本清单**：新能力先问「能不能只靠 plugin.toml 表达」；要动内核必须说明为什么清单表达不了。
- **fail-closed**：组合动作风险取各步最高；MCP 副作用默认拒绝；未知命令给建议但不执行。

## 深入阅读

- 为什么这样设计（历史与被否掉的方案）：[设计取舍](deep/design.md)
- 清单全字段：[插件清单规范](reference/plugin-spec.md)
