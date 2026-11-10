# web/app.js 拆分方案（第 241 轮预检，v4 清债第一轮）

> app.js 已 11273 行 / 249 个顶层函数——40+ 轮功能全堆一个文件。
> 直接拆会破坏 68 条 `app2.includes` 静态断言。本方案分五步，
> 每步只动一个功能域、断言同步改指向、全量绿后再走下一步。

## 依赖面（预检结论）

- webui-smoke 68 条 app2 断言，落点 Top：showServices(8) / showPalette(7) /
  showWatchPanel(6) / renderDevPanel(5) / runBatch(5) / openDetail(3) / renderLogs(3)
- **断言读的是「文本包含」不是「文件归属」**——拆走的函数只要仍被
  app.js import 且文本留在 web/ 目录任一 .js 里，改为读新文件即可。

## 五步拆分（每步一个 minor，独立 PR）

| 步 | 域 | 搬出函数（估） | 行数（估） | 断言改动 | 风险 |
|---|---|---|---|---|---|
| 1 | **键盘/快捷键** | keymap 相关 3 fn | ~150 | 0 条（无断言落点） | 最低 |
| 2 | **面板壳（show*/render* 壳）** | 70 fn 中的纯渲染壳 | ~2500 | ~30 条改读新文件 | 中 |
| 3 | **面板壳（show\*/render\* 壳）** | 70 fn 中的纯渲染壳 | ~2500 | ~30 条改读新文件 | 中 |
| 4 | **导出/分享** | export/copy/share | ~600 | ~6 条 | 中 |
| 5 | **其余按域归并** | 剩余大类 | ~3000 | 剩余 | 高（最后做） |

## 第一步试点（本轮 ⑤ 已完成）

键盘域最小（3 fn / 0 断言落点）——已搬 `web/keys.js`。
**试点修正了方案**：函数依赖 app 侧符号（setCount/esc/t/lang），
直接 import 会循环依赖——改为**注入式**（createKeys(ui) 工厂 +
app 侧惰性 getter __keys()）。后续四步同款：
1. 目标域函数搬新文件，改为工厂接收 { setCount, esc, t, lang, ... } 注入；
2. app.js 挂惰性 getter（避免顶层 TDZ）；
3. webui-smoke 断言改读新文件；
4. 全量绿 + `node --check` 双文件。

## 硬判据

1. 每步独立 PR + 独立 minor——不合并步。
2. 搬走的函数：app.js 只留 import；webui-smoke 断言改读新文件路径。
3. 全量断言数不降（3134 是底线，只增不减）。
4. `node --check` + tsc + lint 八审计线全过每一步。
