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

## 通用

- Node ≥ 22.18（项目硬规则）；`execFileSync(process.execPath, [...])` 在三平台行为一致。
- `loadavg()` Windows 恒 `[0,0,0]`——perf-guard 304 自适应在 Windows 退化为纯 300 硬线，正常。
- Python 子进程 UTF-8：内核注入 `PYTHONIOENCODING`（插件声明 GBK 除外）。

## 防线层次

1. **本地 lint**：`scripts/web-strict-check.mjs`（第九审计线）——静态可判模式前置拦截。
2. **本地全量**：`node scripts/test-all.mjs`。
3. **三平台 CI**：唯一能暴露跨版本/跨平台差异的防线（「在我机器上是绿的」不是理由）。
