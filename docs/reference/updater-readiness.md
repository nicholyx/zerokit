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

结论：「下载→校验→结构完整」路径通。未实测「实际安装+启动」（避免破坏本机环境——留首个真实桌面用户时做）。

## 结论

**签名能力在位、配置缺席、解除成本约一轮**。维持冻结，等真实桌面用户诉求出现时按上面清单一键启用。
