# 更新日志

本文件记录 zerokit 对使用者可见的变更。格式遵循
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Changed

- **CI 测试矩阵从「只在 windows-latest」放开到三个平台**
  （ubuntu / macos / windows，各跑 Node 22，另在 Linux 单独跑当前的 Node 24）。
  以前只测 Windows 的理由是插件深度绑定它——代价是平台债永远看不见：
  macOS 上那 3 个失败一直到有人手动跑才发现。插件层跨平台化完成后，
  测试断言也跟着按平台分支了，这里把矩阵放开。顺手把 Linux 剪贴板的
  真实路径覆盖上（CI 装 `xclip` + `xvfb`，套件在 `xvfb-run` 下跑）。

  给写测试的人的提醒：Linux 上剪贴板工具缺失时，套件断言那句「需要
  xclip/xsel」的安装提示，而不是静默跳过——红要红在环境上，
  不能红在看不见的地方。

### Fixed

- **`tsc --noEmit` 重新变干净，并且 CI 现在真的会跑它。**
  `package.json` 里一直有 `typecheck` 脚本、文档一直写着「tsc 干净」，
  但 CI 与本地 `lint.sh` **都没有执行过这条命令**，于是两个只有类型检查才
  看得见的错误在核心里躺了很久：

  - `src/core/proxy.ts`——`@types/node` 22 起 `Buffer` 是泛型的，`Buffer.slice()`
    给出 `Buffer<ArrayBufferLike>`，跟 `Buffer.concat()` 的 `Buffer<ArrayBuffer>`
    互不相容。运行期毫无差别，只有 `tsc` 会报 TS2322。
  - `src/core/scaffold.ts`——`ScaffoldResult.load` 声明成了 `PluginEntry`
    （要求 `dir` 字段），实际赋的是 `loadDir()` 的 `LoadResult`（没有 `dir`）。
    消费方从来只读 `.plugin` / `.errors` / `.warnings`，所以一直没出事。

  新增 `typecheck` job（固定 ubuntu，类型检查与平台无关），并把它接进
  `CI 总览` 的 `needs` / `R_*` / 汇总表三处。新增 `test/ci-smoke.mjs`
  断言这条接线不会再次断开——这类「配置漂移」跑产品代码是发现不了的：
  文档写着干净、测试全绿、CI 全绿，而真相是那条命令从来没人执行。

### Added

- **组合动作（`type = "chain"`）：把已有动作按顺序拼成新动作，不用写代码。**
  每一步引用一个已有动作（`<插件id>.<动作id>`，本插件写 `self.<动作id>`），
  上一步的 stdout 用 `{别名}`、结构化结果用 `{别名.data.字段}` 带进下一步的参数；
  整条链路还能声明 `template`，把结果拼成一句话。四个面自动派生：CLI 多一条
  `zkit run`、MCP 多一个工具、启动器多一张表单和链路详情、AI 工作台一次调用就能
  完成多步。

  安全边界不含糊：链路的 `risk` 必须 ≥ 每一步的 `risk`，运行时逐一比对、
  不够就 **fail-closed**（否则一条 `read` 链路就能偷跑 `destructive` 步骤、
  绕过确认闸门）；不支持嵌套与后台步骤；所有步骤**先静态校验再执行**——
  不会先写完文件、再告诉你第三步引用的插件没装。`zkit doctor` 也会提前指出
  链路里引用了没装的插件或不存在动作。

  示例：`sysinfo` 新增 `brief`——把「系统概况」和「最吃内存的进程」两步拼成一段播报。

- **http 动作与 AI 工作台走系统代理。** 以前设了 `http_proxy` 也没用：Node 内置
  fetch 会把 `proxy` 选项**静默丢弃**（实测代理指向一个根本不存在的端口，请求也
  照样直连成功），于是流量绕过代理直接打到目标站，而没有任何地方会报错。
  现在内核自带代理支持：
  - 认 `http_proxy` / `https_proxy` / `all_proxy`（大小写都认），也认
    `config.toml` 里新增的 `[proxy]` 段（`url` / `no_proxy` 两个键）；
  - `no_proxy` 优先级高于代理，支持逗号分隔的域名 / 后缀 / IP / `*`；
  - https 目标走 CONNECT 隧道，http 目标走代理转发（absolute-form 请求行）；
  - 代理地址里带 `user:pass` 时走 `Proxy-Authorization`，且密码不会泄进错误信息；
  - 错误信息分得清「代理连不上」「代理拒绝建隧道」「代理要认证（407）」
    「经代理等响应超时」，而不是笼统一句「请求失败」。

  没配代理时行为与改动前**完全一致**（走原生 fetch）。`plugin add` / `plugin update`
  走的是 `git`，本来就认代理，不受影响。

## [0.1.0] - 2026-10-12

首个公开版本。「一份 `plugin.toml` 同时派生四个面（CLI / MCP / 启动器 / AI 工作台）」
的完整闭环：内核与执行收口、插件集市、插件更新、uTools 兼容层、原生壳
（Tauri），以及从脚手架到开发模式再到转正发布的完整插件开发链路。
纯本地、纯离线、无构建步骤，293 项断言一条命令跑完。

### Added

- 插件脚手架与开发模式，写插件的门槛从「手写整份清单」降到「改生成的骨架」：
  - `zkit plugin new <id>`——生成带教学注释的最小可用骨架（`--runtime python`、
    `--web` 附富交互页面骨架），生成即校验，并当场打印这个插件在四个面
    （CLI / MCP 工具 / 启动器 / 工作台）的样子；
  - `zkit plugin dev <目录>`——开发模式：以链接（Windows junction / 类 Unix
    symlink）安装本地目录，改 `plugin.toml` 或脚本**即生效**，四个面下一次
    调用全部跟上；`zkit plugin remove` 只删链接、不碰源目录；dev 状态下
    `zkit plugin add <同一目录>` 自动转正为真实副本；`plugin update` 对
    dev 插件如实提示「改源码即生效」而不是瞎更新；
  - `zkit plugin validate <目录>`——对任意目录校验清单并摊开全部能力，
    不要求已安装。


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
- 启动器界面重做：浏览态动作**按插件分组**（组头显示名称/版本/动作数，可折叠），
  搜索态保持扁平；新增**「插件」管理面板**（`#/plugins`）——粘贴 git 地址或本地
  目录安装（能力摊开预览 + 确认）、检查更新（版本与动作增删）、两步确认卸载。
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
