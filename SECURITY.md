# 安全政策（Security Policy）

## 支持的版本

| 版本线 | 支持状态 |
|--------|---------|
| v2.x   | ✅ 完全支持（安全修复 + 缺陷修复） |
| v1.x   | ⚠️ 仅安全修复（至 v2.1.0 发布为止） |
| ≤ v0.x | ❌ EOL |

## 报告漏洞

**不要在公开 Issue 里描述可被利用的漏洞。**

- 渠道：GitHub Security Advisories（仓库 Security 标签 → Report a vulnerability），仅维护者可见
- 响应时限：48 小时内确认收到；7 天内给出评估（接受/不接受/需更多信息）
- 修复节奏：高危 7 天内出 patch；中低危随下一个 minor/patch

## 安全设计基线（本项目内建，非承诺）

- MCP annotations 视为不可信：有副作用的动作必须显式授权（`zkit mcp allow`）
- 插件声明沙箱钉目录/限输出/限 env；密钥只在数据目录、展示打码
- 数据目录可抛弃（`~/.zerokit/`），删掉即完全重置
- 红线与细节见 `docs/deep/security.md`
