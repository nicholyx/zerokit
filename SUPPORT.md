# 支持（Support）

## 支持矩阵

| 版本线 | 缺陷修复 | 安全修复 | 文档 |
|--------|---------|---------|------|
| v2.x   | ✅ | ✅ | ✅ |
| v1.x（≥ v1.40） | ❌ | ⚠️ 至 v2.1.0 | 归档 |
| 更早   | ❌ | ❌ | EOL |

## 怎么获得帮助

1. `zkit doctor` —— 环境自检（解释器/依赖/配置），多数安装问题它直接给答案
2. `zkit doctor --json` —— 机读版，贴 Issue 用
3. [docs/](docs/README.md) —— 快速开始 / 术语表 / 深层设计
4. [FAQ](docs/guide/faq.md) —— 常见问题
5. 仍解决不了：开 Issue，附 `zkit doctor --json` 输出与 `zkit --version`

## 升级

- v2 线内：`git pull && zkit plugin bundled`（数据目录向前兼容）
- v1 → v2：数据目录完全兼容；见 CHANGELOG [2.0.0] 段的行为差异
