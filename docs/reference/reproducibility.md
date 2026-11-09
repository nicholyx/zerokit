# 可复现构建

> 第二百一十四轮：锁文件与构建可复现性审计记录。护栏：`scripts/repro-check.mjs`（进 lint）。

## Node 面

- `package.json` engines：`>=22.18`——覆盖 CI 的 Node 22 与 24 两个版本
- `package-lock.json` 提交在库（npm ci 精确复现）
- CI（ci.yml）与本地均用 npm ci（不用 npm install——保证精确树）

## Rust 面（桌面壳）

- `apps/desktop/src-tauri/Cargo.lock` 提交在库（483 packages，含 zerokit-desktop 自身条目）
- cargo audit：本机未装（`no such command: audit`）——已知差距，装 rustup + cargo-audit 后可补扫描

## 审计断言（repro-check.mjs）

1. engines 存在且覆盖 CI Node 版本（防 CI Node 与 engines 脱节）
2. Cargo.lock 在库且含桌面壳条目
3. package-lock.json 在库且非空

## 已知差距

- cargo audit 未纳入 CI（需 Rust 工具链 + cargo-audit 子命令；装好后可在 desktop-installer job 加一步）
- Dependabot/Renovate 未启用（单维护者节奏下人工 npm outdated + cargo outdated 即可，v2 治理承诺不变）
