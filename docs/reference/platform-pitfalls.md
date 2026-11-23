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

## 测试分层 / 巡检判据（371-374 战役补遗）

| 判据 | 内容 | 战役 |
|---|---|---|
| **预期滞后显式记录** | 年检发现改动未随包时显式记 ⏳（发布时序所致非缺陷）——下次 release 闭环转 ✅，updater-readiness 留对照轨迹 | 371→372 |
| **权威面与保险分离** | 同一能力的多层测试中，权威面（断言最全）做硬门禁；重复保险层（探针类）3 连败降级为提示不阻塞——保险抖动不该卡发布链 | 373 |
| **304 pathToFileURL 三度实战** | 本地 mac 全绿 ≠ 三平台绿——新测试文件写 `await import` 必查 pathToFileURL（358/360 两轮栽过） | 358/360 |

## 配置同步 / 工具面（342-347 战役补遗）

| 坑 | 判据 | 修复 | 战役 |
|---|---|---|---|
| **持久化只写不读** | restoreWatches 定义了却从未被调用——79 轮的 watch.json 持久化只写不读，重启页面监控全丢 | 接通进 load() boot 链；写侧字段（chain/lastChainRun）读侧必须同步重建 | 342 |
| **恢复条目被翻页误杀** | boot 时无 detail 上下文 → 恢复的监控首轮 tick 即 stopWatch | `__restored` 首轮宽限标记 | 342 |
| **ops 白名单与功能脱节** | stats ops 加 "top" 但白名单过滤没同步——opsHasTop 恒 false，新功能静默走旧报错 | **ops 白名单必须与功能同步扩展**；新 op 加白名单才算落地 | 345 |
| **typecheck 假绿** | `npm run typecheck` 在 node_modules 无 typescript bin 时静默通过（command not found 但 exit 0） | 本地跑之前先 `npm install --no-save typescript`；CI typecheck job 才是真防线 | 345/347 |

## CHANGELOG 锚点误插（405 轮事故——308 老坑复发）

| 坑 | 表现 | 对策 | 战役 |
|---|---|---|---|
| **Fixed 段正则取全文第一个** | 写 Fixed 条目时 `re.search(r'### Fixed\n\n')` 匹配到**已发布版本**的 Fixed 段——条目静默插进旧版本 | 写 Unreleased 条目前先 `s.find('[Unreleased]')`，锚点行号必须 > Unreleased 行号且 < 下一个 `\n## [`；或者直接先定位 Unreleased 段再段内找段头 | 405（308 同款复发） |

## CI 抖动五源清单（397 归因四源 + 408 补第五源）

| 抖动源 | 表现 | 对策 | 战役 |
|---|---|---|---|
| **CDP 冷启动/残例竞态** | dashsignal326 / panelsmoke341 偶发 NO-EL、target 不可达 | 起例前 pkill 残例；`readyState` 轮询门控替代固定 sleep；`/devtools/page/` 选 target；fetch 用 localhost | 341/342/363/387 |
| **stdio 探针竞速** | welcome80 MCP 探针 rc=1（3 次重试仍败） | 保险层探针 3 连败降级为提示——权威面（mcp-smoke 38 断言）才做硬门禁 | 373 |
| **退出码时序** | diag83「SIGKILL 语义」process.exit(137) 抖动 | 断言失败重试一次 | 383 |
| **纯函数/过滤时间预算** | perf-guard「filterRows ×5 <10ms」、extras「10k AND <50ms」在 runner 高载时误伤 | 失败时重测取较优 + load 3 次采样中位豁免；**真退化（两次都超）仍硬失败** | 397 |
| **跨请求节流竞态** | bcastfilter298：两次 tool-call 间隔测试等 2600ms，CI 慢机实际间隔可缩到 <2000ms（默认节流窗）→ demochain 广播被丢弃、B 永远收不到 | 节流相关测试的等待 > 窗口 +50% 余量（2600→3200ms） | 408 |

### 入库现场残留审计（412 轮——405 红线治理的全仓复核）

全仓 `git ls-files` 扫 `/Users/liangyuxiang`、`installedAt`、`D:\`：命中全部为**合法引用**——代码里的安装现场逻辑（sources/registry/update 的 installedAt 运行时写入，落用户数据目录不入库）、文档/帮助文案里的 Windows 示例路径（filesearch 的 `D:\work,E:\downloads` 是教用户怎么填参数）、判据文档引用（CHANGELOG/dep-hygiene 的 405 事故记录）。**真违规 0 处**。405 的「guard146 红线扩入库 JSON」保持现状——它按「字符串值以 /Users 等开头」判定，不会误伤帮助文案；`.zerokit-source.json` 已 gitignore 兜底。结论：本机现场残留已清零，无新增处置。

### 数据验收（403 轮——统计口径固化）

用 `node scripts/flaky-stats.mjs <ISO时间>` 统计（**严格按 createdAt 切分**——本轮实证：人工按行序 awk 切分会误判，`gh run list` 只保证整体倒序，锚点 commit 不在窗口内就整段算错；我第一遍把 397 之前的 4 个失败误算成「之后」）。

| 时点 | 样本 | 失败 | 失败率 |
|---|---|---|---|
| 397 治理前（基线） | 106 run | 9 | **8.5%** |
| 397 治理后（403 轮记录时） | 8 run | 0 | 0%（**样本不足，不终判**） |
| 408 修复后（411 轮中判） | 19 run（其中 b98d562 失败 1 次——发生于 408 修复 merge 之前，修复后 0 失败） | 1（修复前）/ 0（修复后） | 5.3%→修复后 0%（**仍 <40 run，未终判**；趋势与「四源已修+第五源当轮修」一致） |
| 414 轮更新 | 23 run | 1（仍为 408 修复前的 b98d562——**修复后连续 0 失败**） | 4.3%（整体含修复前样本；修复后子样本 0%） |
| 417 轮更新 | 27 run | 1（仍为 408 修复前的那一次——**修复后连续 0 失败**） | 3.7%（已逼近 <3% 终判线；408 修复后子样本 0%） |
| 419 轮更新 | 30 run | 1（仍为 408 修复前的那一次——**修复后连续 0 失败**） | 3.3%（逼近 <3% 终判线；差 10 run 满 40） |

**待办（411 轮更新）**：满 40 个 run 后重跑 `node scripts/flaky-stats.mjs 2026-11-22T19:36:10Z` 终判——对照 8.5% 基线。当前趋势：397 四源修复后唯一一次失败（b98d562）即第五源，408 当轮修复后 0 失败——方向与治理一致，等样本自然积累。

**通用判据**：平台抖动类失败「先重试再降级」——重试一次仍败才算真失败；降级只用于重复保险层，权威面永不降级。时间预算断言在 CI 上必须有 load 豁免或重测，否则 10% 的失败率会让人习惯性忽略红灯。

## 通用

- Node ≥ 22.18（项目硬规则）；`execFileSync(process.execPath, [...])` 在三平台行为一致。
- `loadavg()` Windows 恒 `[0,0,0]`——perf-guard 304 自适应在 Windows 退化为纯 300 硬线，正常。
- Python 子进程 UTF-8：内核注入 `PYTHONIOENCODING`（插件声明 GBK 除外）。

## 防线层次

1. **本地 lint**：`scripts/web-strict-check.mjs`（第九审计线）——静态可判模式前置拦截。
2. **本地全量**：`node scripts/test-all.mjs`。
3. **三平台 CI**：唯一能暴露跨版本/跨平台差异的防线（「在我机器上是绿的」不是理由）。
