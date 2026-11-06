# scripts/ 目录说明

一句话说清每个脚本是干嘛的、什么时候跑。详细用法见各脚本头部注释。

| 脚本 | 一句话 | 什么时候跑 |
|------|--------|-----------|
| `lint.sh` | 静态检查全家桶（actionlint + yamllint + shellcheck + zizmor + plugin lint + i18n 扫描 + 文档巡检），与 CI 同源 | 每次提交前 |
| `test-all.mjs` | 全量测试跑测器；`<片段>` 只跑匹配文件、`--changed` 按 git diff 挑受影响测试（IMPACT_MAP）、`--shuffle` 随机顺序暴露顺序依赖 | 每次提交前；CI 跑同一命令 |
| `release-prep.mjs` | 发布准备：CHANGELOG 归档（带三重自检）+ 四处版本号同步 + 旧版本段自动搬归档；`--write` 落盘 | 每次发版（release 分支上） |
| `release-chain.sh` | 发布链一条龙：CI 轮询（12/11+MERGEABLE 捷径）→ merge 复核 → tag 双确认 → 资产等待；`feature <PR>` / `release <版本> <PR>` / `--dry-run` | 每次发版（feature PR 绿后 + release 分支就绪后） |
| `verify-remote.sh` | push 复核（远端 sha === 本地）与 tag 打前双确认 | push 后 / 打 tag 前 |
| `bench.mjs` | CLI 冷启动三路径耗时与峰值 RSS 基准（本机强相关，不进 CI） | 性能回归怀疑时 |
| `a11y-scan.mjs` | 前端五类无障碍反模式扫描（图标按钮无 label/tab 选中态/表格 caption 等） | lint.sh 自动跑 |
| `check-docs.mjs` | 文档巡检：内链存在性 + 相对路径层级 | lint.sh 自动跑 |
| `i18n-scan.mjs` | 硬编码中文扫描（白名单记账制，未登记的中文行报错） | lint.sh 自动跑 |

## 维护约定

- 新脚本落地时在这里补一行。
- `test-all.mjs` 的 `IMPACT_MAP`：新增测试文件时在对应源行补上自己的文件名片段——`--changed` 的精确性靠它。
