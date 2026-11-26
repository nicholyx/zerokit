# 桌面 updater 就绪度评估（第三百一十三轮，2026-11-19）

> 300 轮盘点候选 2 的零成本预检：桌面冻结（288 轮起）的解除条件是「首个真实桌面用户诉求」。
> 本轮只核查签名链与产物链的**在位状态**并干跑验证，不实际改动 release.yml / tauri.conf.json。

## 三件套状态表

| 件 | 状态 | 说明 |
|---|---|---|
| 密钥链（插件签名 ed25519） | ✅ 可用 | `zkit keygen` 干跑通过：密钥对落 `~/.zerokit/keys/default.ed25519(.pub)`（0600）；export 自动签名实测（demochain.toolpack 带 sig，keyId 3ee8138e…）——282 轮链路完好 |
| tauri updater 配置 | ❌ 未启用 | tauri.conf.json 无 updater 段（createUpdaterArtifacts/pubkey/endpoint 均缺）——冻结是配置缺席不是配置损坏 |
| release.yml updater 产物 | ❌ 未启用 | 无 latest.json 生成步骤；tauri-action 已在位（action v1.0.0 pin），补 updater 只需 env TAURI_SIGNING_PRIVATE_KEY + conf 三行 |

## 解除步骤清单（触发条件满足时执行，预估一轮）

1. `tauri.conf.json` 加 `bundle.createUpdaterArtifacts: true` + `plugins.updater` 段（pubkey = `zkit keygen` 公钥内容；endpoint = GitHub Release latest.json 固定 URL）。
2. release.yml desktop-installer job 加 `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` env（密钥进 GitHub Secrets——不进仓库）。
3. tauri-action 自动产 latest.json + .sig；Windows NSIS/macOS dmg 均覆盖。
4. 首版发双通道观察一轮（updater 用户与全量安装包并存）。

## 风险

- **密钥保管**：updater 私钥泄露 = 可向所有桌面用户推任意包——必须 GitHub Secrets + 本地不留副本。
- **破坏现有安装包链**：启用的 PR 必须单发（不上混合改动），release 链失败按 18 轮判据排查（draft 422 等）。
- **签名对象不同**：插件签名（282，ed25519 toolpack）与 updater 签名（tauri minisign 格式）是两套——不要混用文档表述。

## 附：安装包烟测记录（第三百二十八轮，2026-11-20）

v4.40.0 aarch64.dmg 实测（macOS arm64 本机）：

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest 对齐 | ✅ be0b0156…（两侧一致） |
| hdiutil 挂载（只读） | ✅ /Volumes/zerokit |
| zerokit.app 结构（Info.plist/MacOS/Resources） | ✅ 全在位 |
| CFBundleIdentifier / 版本 | ✅ dev.zerokit.desktop / 4.40.0 |
| Resources 内嵌（web 面板 + plugins + src + node_modules） | ✅ |
| MacOS 二进制 | ✅ Mach-O 64-bit arm64 |
| 卸载清理 | ✅ detach + /tmp 清理 |

### 闭环验证：v5.6.0（第四百一十轮，2026-11-23——验收/工具发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致，release download 二次重试成功——assets 端点偶发 i/o timeout 与此前一致） |
| Info.plist | ✅ 5.6.0 |
| 包内对照 | 408/409 全为 test/ + scripts/ 改动——资源面预期无 diff（runner.ts 同构核对 ✓，399 语义） |

### 闭环验证：v5.30.1（第五百零二轮，2026-11-26——监控条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.30.1 |
| 包内对照 | 501 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.30.0（第五百轮，2026-11-26——五百轮关口发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.30.0 |
| 包内对照 | 499 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.29.0（第四百九十八轮，2026-11-26——监控条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.29.0 |
| 包内对照 | 497 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.28.0（第四百九十六轮，2026-11-26——监控条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.28.0 |
| 包内对照 | 495 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.27.0（第四百九十四轮，2026-11-26——监控条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.27.0 |
| 包内对照 | 493 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.26.1（第四百九十二轮，2026-11-26——监控条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.26.1 |
| 包内对照 | 491 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.26.0（第四百九十轮，2026-11-26——监控条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.26.0 |
| 包内对照 | 489 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.25.0（第四百八十八轮，2026-11-26——监控条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.25.0 |
| 包内对照 | 487 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.24.1（第四百八十六轮，2026-11-26——监控条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.24.1 |
| 包内对照 | 485 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.24.0（第四百八十四轮，2026-11-26——监控条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.24.0 |
| 包内对照 | 483 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.23.1（第四百八十二轮，2026-11-26——监控条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.23.1 |
| 包内对照 | 481 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.23.0（第四百八十轮，2026-11-26——第三周期启动发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.23.0 |
| 包内对照 | 479 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.22.1（第四百七十八轮，2026-11-26——第二周期终判发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.22.1 |
| 包内对照 | 477 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.22.0（第四百七十六轮，2026-11-25——监控条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ 3632ebce…（两侧一致） |
| Info.plist | ✅ 5.22.0 |
| 包内对照 | 475 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.21.1（第四百七十四轮，2026-11-25——监控条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.21.1 |
| 包内对照 | 473 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.21.0（第四百七十二轮，2026-11-25——监控条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.21.0 |
| 包内对照 | 471 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.20.1（第四百七十轮，2026-11-25——search 重试发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.20.1 |
| 包内对照 | 469 为 test 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓；test 属 npm 源码安装面随包分发） |

### 闭环验证：v5.20.0（第四百六十九轮，2026-11-25——监控条目发布轮 + search 抖动修复）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.20.0 |
| 发布链 | release PR 的 Windows CI 一次 mcp-smoke 37/38（二波③ search——collectTools 慢盘偶发一次 hits=0，同 run --json 独立调用即过）——PR #1378 加重试后 main（26502a8）全绿做健康证据 |
| 包内对照 | 468 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.19.1（第四百六十七轮，2026-11-25——监控条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.19.1 |
| 包内对照 | 466 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.19.0（第四百六十五轮，2026-11-25——周检条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.19.0 |
| 包内对照 | 464 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.18.1（第四百六十三轮，2026-11-25——监控条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.18.1 |
| 包内对照 | 462 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.18.0（第四百六十一轮，2026-11-25——监控条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.18.0 |
| 包内对照 | 460 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.17.1（第四百五十九轮，2026-11-25——预算加宽发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.17.1 |
| 包内对照 | 458 为 test 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓；test 属 npm 源码安装面随包分发） |

### 闭环验证：v5.17.0（第四百五十七轮，2026-11-25——新监控期条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.17.0 |
| 包内对照 | 456 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.16.4（第四百五十五轮，2026-11-25——新周期条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.16.4 |
| 包内对照 | 454 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.16.3（第四百五十三轮，2026-11-25——监控终判发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.16.3 |
| 包内对照 | 452 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.16.1（第四百五十轮，2026-11-25——监控条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.16.1 |
| 包内对照 | 449 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.16.0（第四百四十八轮，2026-11-25——监控条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.16.0 |
| 发布链 | release 分支 CI 一次 macos 平台面 cancelled（blob 不存在）——按 425 判据用 main run（4d4944b）全绿做健康证据，不无限 rerun |
| 包内对照 | 447 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.15.5（第四百四十六轮，2026-11-24——监控条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.15.5 |
| 包内对照 | 445 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.15.4（第四百四十四轮，2026-11-24——监控条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.15.4 |
| 包内对照 | 443 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.15.3（第四百四十二轮，2026-11-24——监控条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.15.3 |
| 包内对照 | 441 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.15.2（第四百四十轮，2026-11-24——监控条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.15.2 |
| 包内对照 | 439 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.15.1（第四百三十八轮，2026-11-24——监控条目发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.15.1 |
| 包内对照 | 437 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.15.0（第四百三十六轮，2026-11-24——周检发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.15.0 |
| 包内对照 | 435 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.14.1（第四百三十四轮，2026-11-24——changelog-add 规范化发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ 900aa009（前次误读）→ 实际以 digest 为准（两侧一致） |
| Info.plist | ✅ 5.14.1 |
| 发布链事故 | 立项时 release-prep 拒发——433 去重后「### Changed」与条目间残留双空行；changelog-add 加写入前规范化（防呆）+ 本体修正后一次通过 |
| 包内对照 | 433/434 为 chore/fix(scripts)——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.14.0（第四百三十一轮，2026-11-24——例行全查发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.14.0 |
| 包内对照 | 430 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.13.1（第四百二十九轮，2026-11-24——bcast 修正发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.13.1 |
| 包内对照 | 428 为 test/ 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓；test 属 npm 源码安装面，随包分发） |

### 闭环验证：v5.13.0（第四百二十八轮，2026-11-24——监控周期发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.13.0 |
| 包内对照 | 427 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.12.1（第四百二十六轮，2026-11-24——终判发布轮 + 归档修复）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.12.1 |
| 发布链事故 | 首次 PR #1267 **漏跑 release-prep**（CHANGELOG 无 5.12.1 版本段）→ release job 防呆「拒绝发布没有账本的版本」正确拦截 exit 1 → #1268 补归档 + 删 tag 重推 → 三资产齐 |
| 包内对照 | 426 全为 test/docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.12.0（第四百二十四轮，2026-11-24——容忍随包发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ 0f466ddd…（两侧一致） |
| Info.plist | ✅ 5.12.0 |
| 发布链 | arm64 job 一次 cancelled（**v5.47.0 起的已知偶发**——`gh run rerun --failed` 一次即绿），三资产齐 |
| 包内对照 | 423 为 scripts/docs 改动——资源面预期无 diff（runner.ts 数据面符号 16 处同构核对 ✓） |

### 闭环验证：v5.10.0（第四百二十轮，2026-11-23——双位数版本号发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.10.0（双位数——semver 按数值比较 5.10 > 5.9） |
| 包内对照 | 419 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.8.0（第四百一十八轮，2026-11-23——进度更新发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.8.0 |
| 包内对照 | 417 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.7.1（第四百一十五轮，2026-11-23——纯文档条目补发版）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ （两侧一致） |
| Info.plist | ✅ 5.7.1 |
| 包内对照 | 414 纯 docs 改动——资源面预期无 diff（runner.ts 数据面符号同构核对 ✓） |

### 闭环验证：v5.7.0（第四百一十三轮，2026-11-23——审计发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ 05c5b5c2…（两侧一致） |
| Info.plist | ✅ 5.7.0 |
| 包内对照 | 412 为 docs 改动——资源面预期无 diff（runner.ts 数据面符号 16 处同构核对 ✓；zerokit-source.json 全树 0 个——405 治理持续有效） |

### 闭环验证：v5.5.0（第四百零七轮，2026-11-23——红线治理发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ a0330354…（两侧一致） |
| Info.plist | ✅ 5.5.0 |
| **包内 .zerokit-source.json** | ✅ 全树 0 个——405 红线违规文件此前因 distro 排除规则本就未进安装包（distro.ts:104/295 存量防护有效）；本轮修复的是**仓库面**（git 移除 + guard146 红线扩入库 JSON），安装包资源面无 diff 属预期 |

### 闭环验证：v5.4.0（第四百零四轮，2026-11-23——验收基建发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ 4e650689…（两侧一致） |
| Info.plist | ✅ 5.4.0 |
| 包内对照 | 403 为 scripts/ 改动（flaky-stats）——资源面预期无 diff（runner.ts 同构 5.3.0 核对 ✓，399 语义） |

### 闭环验证：v5.3.0（第四百零二轮，2026-11-23——复盘/护栏发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ adca9ec1…（两侧一致） |
| Info.plist | ✅ 5.3.0 |
| 包内对照 | 本轮全部为 docs/ + scripts/ 改动（400 复盘 / 401 护栏 / 命名规则）——**资源面 src/web/plugins 预期无 diff**；包内 runner.ts 与 5.2.0 同构（whereRaw/sortRaw/limitN 计 12 处不变）✓ |

### 闭环验证：v5.2.0（第三百九十九轮，2026-11-23——测试质量双修复发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ 0b5f299b…（两侧一致） |
| Info.plist | ✅ 5.2.0 |
| 包内对照 | 397/398 均为测试质量修复（scripts/ 与 test/ 不进安装包——资源面 src/web/plugins 无对应改动，属预期结构）；包内 runner.ts 含 398 涉及的 caller==='dev' 符号 ✓ |

### 闭环验证：v5.1.0（第三百九十五轮，2026-11-23——v5 线首个真实发版）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ 15355945…（两侧一致） |
| Info.plist | ✅ 5.1.0 |
| **包内 distinct(394)×4** | ✅ stats distinct 基数统计随包下发 |
| 版本号 | v5.1.0 = v5.0.0 后首个真实 release（391-393 三个纯文档轮的里程碑标题占号已澄清「未占用」） |

### 年检追加：v5.0.0（第三百九十二轮，2026-11-22——主版本进位安装包）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ 3a6cb9c9…（与 391 闭环一致——release 未变） |
| 挂载 + Info.plist | ✅ dev.zerokit.desktop / 5.0.0 / arm64 |
| limitN(390) 复核 | ✅ ×2（391 闭环一致） |
| HEAD 侧新滞后 | 无（391 闭环 PR 即最新——纯文档） |
| 清理 | ✅ |

### 闭环验证：v5.0.0（第三百九十一轮，2026-11-22——百 minor 大关）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ 3a6cb9c9…（两侧一致） |
| Info.plist | ✅ **5.0.0**（主版本号进位） |
| **包内 limitN(390)×2** | ✅ read limit 随包下发 |
| 版本号语义 | v5.0.0 = v4.99 后自然进位，非路线图 v5 大改（CHANGELOG 版本段头注明） |

### 闭环验证：v4.98.0（第三百八十八轮，2026-11-22——发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ 48a46549…（两侧一致） |
| Info.plist | ✅ 4.98.0 |
| **包内 sortRaw(387)×5** | ✅ read sort 行序控制随包下发 |

### 闭环验证：v4.95.0（第三百八十五轮，2026-11-22——发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ a530cbba…（两侧一致） |
| Info.plist | ✅ 4.95.0 |
| **包内 selectRaw(384)×2** | ✅ export select 随包下发 |

### 年检追加：v4.90.0（第三百八十二轮，2026-11-22）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ e7ba422a…（与 380 闭环一致——release 未变） |
| 挂载 + Info.plist | ✅ 4.90.0 / arm64 |
| 包内 378/379 | ✅ wsetR×2 / percolMap×4（380 闭环复核一致） |
| HEAD 侧新滞后 | 无（381 周检为纯文档轮——无代码改动） |
| 清理 | ✅ |

### 闭环验证：v4.90.0（第三百八十轮，2026-11-22——90 minor 整点发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ e7ba422a…（两侧一致） |
| Info.plist | ✅ 4.90.0 |
| **包内 378/379 改动** | ✅ wsetR（where 多值）×2 / percolMap（逐列 ops）×4——全部随包下发 |

### 闭环验证：v4.86.0（第三百七十六轮，2026-11-22——发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ 36ab6df0…（两侧一致） |
| Info.plist | ✅ 4.86.0 |
| **包内 mcp.ts where×4（374）** | ✅ zerokit_stats where/window 参数随包下发 |

### 闭环验证：v4.82.0（第三百七十二轮，2026-11-22——371 预期滞后闭环）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ d464242e…（两侧一致） |
| Info.plist | ✅ 4.82.0 |
| **statsObj(369)×4** | ✅ **_where 随包下发——371 年检「预期滞后」正式闭环** |

### 年检追加：v4.77.0（第三百七十一轮，2026-11-22）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ b6790580…（与 367 闭环验证一致——release 未变） |
| 挂载 + Info.plist | ✅ 4.77.0 |
| 包内 364-366 | ✅ whereS×5（366 在包——367 闭环已验） |
| **包内 369 _where** | ⏳ statsObj 0 处——369 发布于 v4.77.0 之后，**下次 release 随包下发**（预期滞后，非缺陷） |
| 清理 | ✅ detach + /tmp 清理 |

### 闭环验证：v4.77.0（第三百六十七轮，2026-11-22——发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ b6790580…（两侧一致） |
| Info.plist | ✅ 4.77.0 |
| **包内 364-366 改动** | ✅ __sigWin(365)×3 / whereS(366)×5 / tail(364)×7——窗口·切换·筛选三连全部随包下发 |

### 闭环验证：v4.72.0（第三百六十二轮，2026-11-22——发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ c4d533cd…（两侧一致） |
| Info.plist | ✅ 4.72.0 |
| **包内 runner.ts 数据面改动** | ✅ renameMap(359)×3 / whereRaw(360)×5 / p90(361)×5——358-361 四件套全部随包下发 |

### 闭环验证：v4.59.0（第三百五十四轮，2026-11-21——发布轮）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ b032887e…（新包） |
| Info.plist | ✅ 4.59.0 |
| **包内 web/watchtimers.js「数据集」行数** | ✅ **3 行 / trendHtml 3 处**——352「数据集 M 行」与 341 趋势段改动已随包下发（353 复检待验证项闭环） |

### 复检追加：v4.58.0（第三百五十三轮，2026-11-21——352 UI 改动后包内/HEAD 对照）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest | ✅ 0dd9a079…（与 349 轮一致——release 未变） |
| 挂载 + Info.plist | ✅ dev.zerokit.desktop / 4.58.0 |
| **包内 web/watchtimers.js vs main** | ⚠️ 包内「数据集」0 行 / main 3 行——352 的「数据集 M 行」改动**未进当前安装包**（v4.58.0 发布于 352 之前，符合预期）；下次 release 时这些改动随包下发 |
| MacOS 二进制 / Resources | ✅ arm64 / web+plugins+src 在位 |
| 清理 | ✅ detach + /tmp 清理 |

### 年检追加：v4.58.0（第三百四十九轮，2026-11-21）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest 对齐 | ✅ 0dd9a079…（两侧一致） |
| 挂载 + Info.plist | ✅ dev.zerokit.desktop / 4.58.0 |
| MacOS 二进制 | ✅ Mach-O 64-bit arm64 |
| Resources 内嵌（web/plugins/src） | ✅ |
| 清理 | ✅ detach + /tmp 清理 |

### 年检追加：v4.50.0（第三百三十九轮，2026-11-20）

| 检查项 | 结果 |
|---|---|
| sha256 与 release digest 对齐 | ✅ 5585dc28…（两侧一致） |
| 挂载 + Info.plist | ✅ dev.zerokit.desktop / 4.50.0 |
| MacOS 二进制 | ✅ Mach-O 64-bit arm64 |
| Resources 内嵌（web/plugins/src） | ✅ |
| 清理 | ✅ detach + /tmp 清理 |

结论：「下载→校验→结构完整」路径通。未实测「实际安装+启动」（避免破坏本机环境——留首个真实桌面用户时做）。

## 结论

**签名能力在位、配置缺席、解除成本约一轮**。维持冻结，等真实桌面用户诉求出现时按上面清单一键启用。
