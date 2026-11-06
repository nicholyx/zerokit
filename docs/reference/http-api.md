# HTTP API 参考

> `zkit ui` 起的本地 HTTP 面。默认只绑 `127.0.0.1`、校验 Origin（防 DNS rebinding）。
> 协议版本 **api:1**（错误信封 / OpenAPI / method 校验属于 api:1 契约，破坏性变更会升 2）。

## 三条铁律

1. **GET 只读免令牌**；POST 需要页面注入的会话令牌头 `X-ZeroKit-Token`
2. **错误响应统一信封** `{"ok":false,"error":"人话","hint":"补充"}`（成功响应不带 ok 字段，兼容旧消费者）
3. **方法不对返回 405 + Allow 头**（路径存在但方法错，比 404 诚实；未带令牌的 POST 仍先 403——不向未授权者泄露方法信息）

## 机读描述

```bash
curl -s http://127.0.0.1:<端口>/api/openapi.json   # OpenAPI 3.1 子集 + x-zerokit-api: 1
```

## 端点速查

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 探活+体检：version/api/uptimeSec/pid/plugins.installed/runningTasks/dataHomeBytes（无鉴权，监控脚本可直接用） |
| `/api/version` | GET | 版本与协议版本 `{app,version,api}` |
| `/api/openapi.json` | GET | 本文档的机读版 |
| `/api/plugins` | GET | 插件列表（健康卡） |
| `/api/ps` | GET | 运行中的托管进程与服务 |
| `/api/logs` | GET | 审计日志（`?limit=`） |
| `/api/doctor` | GET | 环境自检报告 |
| `/api/markets` | GET | 集市索引 |
| `/api/watch` | GET / PUT | 监控表读写 |
| `/api/timers` | GET / POST | 定时任务（POST op=upsert/pause/resume/remove） |
| `/api/timer-runs` | GET | 定时任务执行历史 |
| `/api/update-check` | GET | 应用更新检查 |
| `/api/ai` | GET | AI 就绪状态（就绪/缺什么/指引） |
| `/api/run` | POST | 执行动作（body: plugin/action/values） |
| `/api/stop` | POST | 停止执行（body: key，缺省停全部） |
| `/api/kill` | POST | 杀托管进程 |
| `/api/preview` | POST | 集市/目录安装预览 |
| `/api/market/*` | POST | 集市操作（add/install/preview/refresh/remove/tryrun） |
| `/api/plugin/*` | POST | 插件操作（check/install/new/remove/selfcheck/update；config 是 GET/POST） |
| `/api/mcp/allow` | GET / POST | MCP 白名单 |
| `/api/prefs/*` | POST | 配置导出/导入 |
| `/api/chat` | POST | AI 对话（SSE 流） |
| `/api/webstore` | POST | web 插件 KV 存储（按 pluginId 隔离） |

## 示例

```bash
# 探活（监控/cron 可直接用，不需要令牌）
curl -s http://127.0.0.1:28970/api/health

# 执行动作（令牌从页面 localStorage 或 DOM 拿）
curl -s -X POST http://127.0.0.1:28970/api/run \
  -H 'x-zerokit-token: <令牌>' -H 'content-type: application/json' \
  -d '{"plugin":"sysinfo","action":"overview"}'

# 方法错误得到什么
curl -s -X PUT http://127.0.0.1:28970/api/plugins
# → 405, allow: GET
# → {"ok":false,"error":"这个端点只接受 GET","hint":"Method Not Allowed"}
```

## 缓存与安全头

所有 API 响应带 `cache-control: no-store` 与 `x-content-type-options: nosniff`。
脚本消费方不要缓存 GET 结果（数据面随时变）。
