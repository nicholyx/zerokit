# 从这里开始

zerokit 是一个**不绑定宿主**的插件运行器：插件是一份纯文本清单（`plugin.toml`），
同一份清单同时派生出四个面——**CLI / MCP / 启动器 / AI 工作台**。
所以「给 AI 用」不是额外开发，而是免费副产品。

> 更完整的东西：`README.md`（怎么用）、`docs/overview.md`（初衷 / 已完成 / 待办）、
> `docs/plugin-spec.md`（怎么写插件）、`docs/design.md`（为什么这么设计）。

---

## 一、环境要求

| | 必须要吗 | 说明 |
|---|---|---|
| **Node.js ≥ 22.18** | **必须** | 项目直接用 Node 原生的 TypeScript 类型擦除，**没有构建步骤**，`node src/cli.ts` 就是跑源码。<br>查版本：`node -v`。不够就装：Windows `winget install OpenJS.NodeJS.LTS`；macOS `brew install node`；Linux `nvm install 22` |
| git | 可选 | 只有从 git 仓库装插件（集市）时用 |
| Python 3.10+ | 可选 | 只有示例插件 `proxy` 需要；其余插件不需要 |
| Rust 工具链 | 可选 | 只有编译**原生桌面壳**时需要；用浏览器界面不需要 |

`node_modules` 没有随包发过来（它是装出来的，不是源码），所以**第一步必须是 `npm install`**。

---

## 二、启动（三步）

```bash
cd zerokit

# 1) 装依赖（第一次必须做）
npm install

# 2) 把仓库自带的示例插件装进去（否则插件列表是空的）
node src/cli.ts plugin bundled

# 3) 看看装了什么
node src/cli.ts list
```

### 起界面

```bash
node src/cli.ts ui --open
```

会打印一个 `http://127.0.0.1:<随机端口>` 并打开浏览器（只绑本机，不对外）。
也可以固定端口：`node src/cli.ts ui --port 28970 --open`。
停止就是 `Ctrl+C`。

---

## 三、确认它是正常的

按顺序跑这几条，都对上就说明环境没问题：

```bash
# 1. 环境自检：Node 版本、外部依赖、所有插件清单是否有问题
node src/cli.ts doctor

# 2. 跑一个只读动作（零依赖，纯本地计算）
node src/cli.ts run sysinfo overview

# 3. 跑一个联网动作（不需要的话可以跳过）
node src/cli.ts run ip public

# 4. 界面上：直接打字 xtxx 或 daili，应该能看到拼音/首字母匹配
```

`doctor` 里如果提示 `python` 缺失，**不影响其它插件**——只有 `proxy`
（那个接管已有工具的示例）需要它。

---

## 四、可选：接给 AI 客户端当 MCP 工具

```bash
node src/cli.ts mcp config                  # 打印各家客户端该填什么
node src/cli.ts mcp config cursor --write   # 直接写进配置（会先备份原文件）
```

支持 Claude Desktop / Claude Code / Cursor / Windsurf / VS Code (Copilot) / Cline。

**安全默认**：只读动作默认放行；**有副作用的动作必须先显式授权一次**：

```bash
node src/cli.ts mcp allow                   # 看已授权哪些
node src/cli.ts mcp allow sysinfo.watch     # 授权某一个
```

这是刻意的——MCP 规范明确要求客户端「必须把 `annotations` 当作不可信」，
不能指望 AI 客户端替我们把关，所以默认拒绝。

---

## 五、可选：原生桌面壳（全局热键 + 托盘）

需要 Rust 工具链（`winget install Rustlang.Rustup` 然后重开终端）。

```bash
cd apps/desktop/src-tauri
cargo run
```

第一次编译要几分钟。起来之后是**无边框窗口**，按全局热键开关（候选顺序
`Alt+Space` → `Ctrl+Alt+Space` → `Alt+Z`，用第一个没被系统占用的，终端会打印实际注册到哪个），
点走自动隐藏，关闭窗口 = 隐藏而不是退出（右键托盘图标可以真退出）。

---

## 六、常见问题

**插件列表是空的？**
第 2 步 `plugin bundled` 没做。示例插件在仓库的 `plugins/` 里，需要装到数据目录才会出现。

**数据存在哪？**
全在 `~/.zerokit/`（Windows 是 `C:\Users\<你>\.zerokit\`）。**删掉这个目录等于完全重置**，
重开一次会重建。里面包括装好的插件、配置、日志、审计记录。

**跑 python 插件报找不到 python？**
Windows：`winget install Python.Python.3.13`。注意微软商店会塞一个假的
`python.exe` 占位程序，这个项目会主动跳过它，所以别从商店装。
macOS：`brew install python`；Linux：用系统包管理器装 python3 即可。

**端口每次都不一样？**
`zkit ui` 默认随机端口（避免撞车）。要固定就 `--port 28970`。

**Windows 上中文乱码？**
项目的脚本输出统一按 UTF-8 处理，Python 子进程会注入 `PYTHONIOENCODING=utf-8`。
如果你自己写的插件要输出 GBK，在清单里声明 `encoding = "gbk"`。

**能改哪个文件来动行为？**
插件相关的全在清单里（`plugin.toml`），不用改内核代码；内核代码在 `src/`。
路由表在 `src/cli.ts`。

---

## 七、这个项目现在是什么状态

内核、四个面、插件集市、原生壳、uTools 插件兼容层都已跑通，各有测试
（`node scripts/test-all.mjs`，9 个文件 200+ 项断言，不联网、不花钱）。

已知的缺口和明确不做的事，都列在 `docs/overview.md` 的「待办」和「已知差距」两节里——
那份是诚实的账本，建议看一眼再判断这个项目值不值得用。