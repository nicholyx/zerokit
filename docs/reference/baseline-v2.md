# v2 基线指标快照

> 由 `scripts/baseline-snapshot.mjs` 生成。刷新方式：跑脚本 + `--write`。

| 指标 | 值 |
|------|-----|
| 版本 | 2.0.0 |
| 测量日期 | 2026-11-08 |
| CLI 冷启动 --help（5 次中位） | 99ms（预算 <300ms） |
| 测试规模 | 130 文件 / 3054 断言 |
| 内置插件 / 动作 | 13 个 / 52 个动作 |

## 性能预算（scripts/perf-guard.mjs 护栏，进 lint）

| 热路径 | 预算 |
|--------|------|
| highlightHtml 10k 项 ×5 | <10ms/次 |
| filterRows 10k 项 ×5 | <10ms/次 |
| CLI 冷启动 --help（5 次中位） | <300ms |
| O(n²) 参照实现（预算有效性自检） | 必须 >10ms 被抓 |

## 第二百零四轮优化记录（perf-guard 护栏下）

| 热路径 | 优化前 | 优化后 | 手段 |
|--------|--------|--------|------|
| filterRows 10k | 1.90ms | 1.67ms（-12%） | hay 构造 for-in 累加，省 Object.values+map+join 三次中间分配 |
| filterRows 50k | 13.3ms | 7.79ms（-41%） | 同上（规模放大后收益更显著） |
| highlightSegments/Html 10k | 1.15/1.79ms | 不变 | indexOf 扫描已最优，显式不动 |
| resultQuery cmpRe | 调用内编译 | 模块级常量 | 热路径零重编译 |
