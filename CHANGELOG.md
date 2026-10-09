# 更新日志

本文件记录 zerokit 对使用者可见的变更。格式遵循
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 插件自带的富交互页面（Web 面）：动作声明 `render = "web"` 并在插件目录放
  `web/index.html`，结果交给插件自己的页面渲染（沙箱 iframe）。HTML 自动注入
  `zkit` 桥——页面可读取执行上下文、调用本插件的其它动作；页面拿不到会话令牌，
  执行必须经宿主转发，确认策略无法绕过。CLI 新增 `zkit web <插件id>` 直达。
- `output = "html"` 落地：stdout 即 HTML 片段时，启动器在沙箱 iframe 里直接渲染。
- 示例插件 `sysinfo` 的「系统概况」动作改为 web 形态（自带仪表盘页面，可经桥刷新）。
- GitHub 项目基建：CI（测试矩阵 / 工作流静态检查 / 提交规范 / 安全扫描）、
  Issue 与 PR 模板、Dependabot、自动打标、Stale 清理、OSSF Scorecard。
- 治理文件：LICENSE（MIT）、CONTRIBUTING、CODE_OF_CONDUCT、SECURITY、MAINTAINERS。

### Fixed

- `zkit ui --open` 在非 Windows 平台上崩溃（原来只会用 Windows 的
  `cmd /c start` 打开浏览器，且错误处理接不住失败）。

### Changed

- 示例插件 `jlc-proxy` 更名为 `proxy`，插件目录自包含
  （不再指向外部安装路径）。
