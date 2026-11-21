# 平台差异判据手册（第三百零五轮立，v4.17.0）

> 本项目 CI 三平台（ubuntu/macos/windows × Node 22/24）。历史上多次「本地绿、CI 炸」——
> 根因几乎都是平台差异。这里汇总已确认的判据，写跨平台代码前过一遍。

## Windows（最高危）

| 坑 | 判据 | 修复 | 战役 |
|---|---|---|---|
| **动态 import 裸路径** | `await import(path.join(...))` 在 Windows 报 ERR_UNSUPPORTED_ESM_URL_SCHEME（`C:\` 不是合法 URL scheme） | 一律 `pathToFileURL(path.join(...)).href` | 304 轮 perf-guard extras.js 三连 |
| **/tmp 不存在** | 测试硬编码 `path.join('/tmp', ...)` 或 `path.sep+'tmp'` → ENOENT | 一律 `os.tmpdir()` | 303 轮 webstrict303 |
| **CRLF** | 文本断言按字符数比对时 \r\n 多 1 字符 | 断言容忍 ±1 或先 `.replace(/\r/g, '')` | 291 轮 pipe 计数 |
| **路径分隔符** | 正则写死 `/` 或 `\\` 会漏一半平台 | `path.sep` 或双平台正则 | — |
| **execFileSync 跑 .ts/.mjs** | 相对路径 + 非项目根 cwd 会找不到模块 | 传绝对路径 + 显式 `cwd: ROOT` | 304 轮活体断言 |

## Chrome / 浏览器（跨版本严格度）

| 坑 | 判据 | 修复 | 战役 |
|---|---|---|---|
| **getter 误用当 setter** | `X.get(k) = v` 语法合法（MemberExpression 赋值）但语义错误——store 永不更新 → 静默失效 | `.set(k, v)`；`scripts/web-strict-check.mjs` 语义正则已拦 | 299 轮 logs.js 两日排障 |
| **语法炸弹跨版本** | Chrome 156 容忍的写法 158 可能严格（反向也存在） | cdp-smoke 异常捕获带 URL+堆栈首帧（299 升级）；本地单版本不够，三平台 CI 是唯一防线 | 299 轮 |
| **网络等待** | 固定 sleep 在慢 runner 不足 | 轮询（条件满足即退，封顶 8-10s） | 298 轮 bcastfilter |

## CDP / headless Chrome（341-342 烟测战役换来的）

| 坑 | 判据 | 修复 | 战役 |
|---|---|---|---|
| **DevTools host 校验** | Chrome 111+ 的 `/json/*` 端点校验 Host 头，Node fetch 发 `127.0.0.1` 会被拒（返回 200 + HTML 假响应——状态码不报错更迷惑） | fetch URL 用 `localhost` 不用 `127.0.0.1` | 342 |
| **target 类型漂移** | headless=new 的 json/list 首个 target 可能是 `browser_ui`（Omnibox）而非 `page` | 按 `webSocketDebuggerUrl` 含 `/devtools/page/` 挑，不按 type | 341 |
| **冷启动竞态** | spawn chrome 后立即 json/list 可能空转全失败 | 重试循环（20×800ms）+ json/new PUT 兜底 + 残实例 pkill | 341 |
| **代理劫持回环** | Node fetch 若走代理（env 或系统），127.0.0.1 请求被代理截获返回 HTML | 测试进程顶部删 proxy env；CDP fetch 一律 localhost | 341 |
| **降级一致性** | CI 无 Chrome 时降级源码级断言——**断言数必须与本地 CDP 版一致**，否则基线护栏拦截（3513<3517 差 4 实战） | 降级路径补齐同数断言 | 342 |

## 配置同步 / 工具面（342-347 战役补遗）

| 坑 | 判据 | 修复 | 战役 |
|---|---|---|---|
| **持久化只写不读** | restoreWatches 定义了却从未被调用——79 轮的 watch.json 持久化只写不读，重启页面监控全丢 | 接通进 load() boot 链；写侧字段（chain/lastChainRun）读侧必须同步重建 | 342 |
| **恢复条目被翻页误杀** | boot 时无 detail 上下文 → 恢复的监控首轮 tick 即 stopWatch | `__restored` 首轮宽限标记 | 342 |
| **ops 白名单与功能脱节** | stats ops 加 "top" 但白名单过滤没同步——opsHasTop 恒 false，新功能静默走旧报错 | **ops 白名单必须与功能同步扩展**；新 op 加白名单才算落地 | 345 |
| **typecheck 假绿** | `npm run typecheck` 在 node_modules 无 typescript bin 时静默通过（command not found 但 exit 0） | 本地跑之前先 `npm install --no-save typescript`；CI typecheck job 才是真防线 | 345/347 |

## 通用

- Node ≥ 22.18（项目硬规则）；`execFileSync(process.execPath, [...])` 在三平台行为一致。
- `loadavg()` Windows 恒 `[0,0,0]`——perf-guard 304 自适应在 Windows 退化为纯 300 硬线，正常。
- Python 子进程 UTF-8：内核注入 `PYTHONIOENCODING`（插件声明 GBK 除外）。

## 防线层次

1. **本地 lint**：`scripts/web-strict-check.mjs`（第九审计线）——静态可判模式前置拦截。
2. **本地全量**：`node scripts/test-all.mjs`。
3. **三平台 CI**：唯一能暴露跨版本/跨平台差异的防线（「在我机器上是绿的」不是理由）。
