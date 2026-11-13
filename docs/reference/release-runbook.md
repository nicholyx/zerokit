# 发布链操作手册（第 287 轮立，v3.79.0）

> 单一入口：从功能分支到三资产 Release 的标准五步 + 事故分类处置。287 轮以来的实录判据都在这里——发布出问题先查本表。

## 标准链五步

```bash
# 0. 前置：本地全绿
node scripts/test-all.mjs          # ≥ 基线（scripts/assertion-baseline.json）
bash scripts/lint.sh               # 八审计线
npm run contract                   # <1s（改过 API/注入面时必跑）

# 1. 功能 PR → CI 12 项全绿 → squash merge
bash scripts/release-chain.sh feature <PR号>

# 2. 版本准备（CHANGELOG 归档 + 五处版本号）
git checkout main && git pull
node scripts/release-prep.mjs <X.Y.Z> --write
node scripts/release-prep.mjs <X.Y.Z> --check    # 必须 ✓
node scripts/guard146.mjs                        # 必须 OK

# 3. 发布 PR → merge → tag
git checkout -b chore/release-v<X.Y.Z> && git add -A && git commit -m "chore(release): v<X.Y.Z>"
git push -u origin chore/release-v<X.Y.Z>
gh pr create --title "chore(release): v<X.Y.Z>" --body "..." --base main --head chore/release-v<X.Y.Z>
bash scripts/release-chain.sh release <X.Y.Z> <PR号>

# 4. 资产三件套（release.yml 自动：mac-arm64 dmg / mac-x64 dmg / win-x64 exe）
#    等到 assets=3 且名字含版本号

# 5. 收尾：关里程碑 / 路线图行 / 验收评论关 issue / main CI 绿 / 清端口
```

## 事故分类处置表（实录）

### 网络类

| 症状 | 判据 | 动作 |
|---|---|---|
| ubuntu apt 源 DNS 瞬态 | `Temporary failure resolving 'security.ubuntu.com'` | xclip/Chrome 步已 if-else 降级（258 轮）——若仍断查是否新增了未容错的 apt 步 |
| NSIS/rust CDN 504 | release job 挂在下载 | `curl -r 0-100` 探测两次 2xx 后 `gh run rerun <id> --failed` |
| npm registry 慢 | npm ci 挂 | 已全量 `--registry=https://registry.npmjs.org`（233 轮）；lockfile 已重写 |

### CI 类

| 症状 | 判据 | 动作 |
|---|---|---|
| cdp-smoke 一次性 flake | 12 面板偶差 1（900ms 等待边界） | `gh run rerun --failed`；复发则 cdp-smoke 面板等待 900→1200ms |
| 断言数下降（全绿但计数降） | 基线守卫 ⛔ 拦截 | **结构性丢失**（270 轮型）：`git stash` 对照基线跑；真删测试则 sync-counts --force 显式降 |
| 跨平台断言差 | win/linux 少 N 条 | 平台条件断言补占位 check（271 轮恒定计数判据） |
| 总览 job 显示 queued→failure 但实 job 全 success | GitHub 平台汇总异常 | 按实 job 结论判定并推进（262 轮实录） |
| rerun 报 already running | 上一 attempt 未收尾 | 等 2 分钟再 rerun |

### 发布类

| 症状 | 判据 | 动作 |
|---|---|---|
| tauri-action 失败把 Release 转 draft | release 页面显示 draft | `gh release edit <tag> --draft=false` 后 `gh run rerun --failed`（直接 --latest 会 422） |
| 资产名陈旧版本 | 旧 tag 的资产挂在新 release | 删 release 重跑 |
| 资产 30 分钟不齐 | 单平台 job 卡/取消 | 查 release.yml 各 job 状态；cancelled 的 rerun --failed |
| release-chain poll 卡 pending=1 | 第 12 项是另一 workflow | 直接查 ci.yml run 的 jobs 结论人工判定 |

## 幂等重入

- `gh run rerun <id> --failed` 只重跑失败 job——先确认失败是瞬态再 rerun。
- draft 修正顺序：**--draft=false 先于**任何其他 edit（422 的根源）。
- tag 已存在时重推：先删远端 tag 再 push（`git push origin :refs/tags/<tag>`）。

## 计数护栏联动（271 轮）

发布前 `test-all` 的断言数 **必须 ≥ assertion-baseline.json**。低于是结构性丢失（不是「测试少了」这么简单）——按上面 CI 类第 2 行处置。抬基线走 `node scripts/sync-counts.mjs`（只升）；降基线必须 `--force`（显式确认删测试）。

## 通用判据

- 推送前 `unset https_proxy http_proxy all_proxy`（代理仅本机用，绝不写进仓库）。
- 每个 background job 的输出要收尾（job_output 确认完成态）。
- 里程碑/issue/路线图/CHANGELOG 四件套缺一不可——忘记哪个看 overview.md 最后更新行。
