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
- 示例插件跨平台：剪贴板历史（clipboard）在 macOS（pbpaste/pbcopy）与
  Linux（xclip/xsel，缺了给安装指引）完整可用——新增 node 版轮询器
  `watch.mjs`（与 `watch.ps1` 行协议一致），判活改用 `process.kill(pid, 0)`；
  `sysinfo` 的进程列表支持 BSD ps（macOS 按内存排序，应用名提取不再截断）。
- http 动作的网络错误在检测到代理环境变量时附一句说明（Node 内置 fetch
  不走 `http_proxy`/`https_proxy`，直连失败时提示先 `unset`）。
- 插件更新：安装时记录来源（git / 集市 / 自带 / 本地目录），`zkit plugin
  update [id]` 检查并更新——版本变化与**动作增删**摊开确认后替换安装（备份式，
  失败回滚；插件数据目录不受影响）。本地 HTTP 面同步提供 `/api/plugin/install`
  （能力摊开 + 确认令牌）、`/api/plugin/check`、`/api/plugin/update`。
- 动作执行时给插件注入 `ZEROKIT_PLUGIN_DATA_DIR` / `ZEROKIT_HOME` 环境变量
  （`{data_dir}` 占位符的环境变量等价物）；`proxy` 示例的配置与日志迁到数据目录，
  老位置自动兼容沿用。
- GitHub 项目基建：CI（测试矩阵 / 工作流静态检查 / 提交规范 / 安全扫描）、
  Issue 与 PR 模板、Dependabot、自动打标、Stale 清理、OSSF Scorecard。
- 治理文件：LICENSE（MIT）、CONTRIBUTING、CODE_OF_CONDUCT、SECURITY、MAINTAINERS。

### Fixed

- `zkit ui --open` 在非 Windows 平台上崩溃（原来只会用 Windows 的
  `cmd /c start` 打开浏览器，且错误处理接不住失败）。

### Changed

- `proxy` 示例插件默认白名单从特定公司域名改为 `example.com` 模板值，
  版本升至 1.1.0；`clipboard` 升至 1.1.0。
- 示例插件 `jlc-proxy` 更名为 `proxy`，插件目录自包含
  （不再指向外部安装路径）。
