# 常见问题

## 安装与运行

**插件列表是空的？**
先跑 `node src/cli.ts plugin bundled`。示例插件在仓库的 `plugins/` 里，要装到数据目录（`~/.zerokit/`）才会出现。

**`git clone` / `npm install` / `gh` 卡住或超时？**
先看本机有没有在跑代理客户端（Clash / Surge / v2ray 之类），在它的设置里找到**本机监听端口**，再让命令走代理（`<端口>` 换成你自己的）：

```bash
export https_proxy=http://127.0.0.1:<端口>
export http_proxy=http://127.0.0.1:<端口>
export all_proxy=socks5://127.0.0.1:<端口>
```

项目本身不记录任何代理地址——每台机器端口不同，写死只会让别人复制到一条走不通的命令。

**跑 python 插件报找不到 python？**
Windows：`winget install Python.Python.3.13`（别从商店装，那个假的 `python.exe` 会被本项目主动跳过）。macOS：`brew install python`；Linux：系统包管理器装 python3。

**端口每次都不一样？**
`zkit ui` 默认随机端口（避免撞车）。要固定就 `--port 28970`。

## 数据与配置

**数据存在哪？**
全在 `~/.zerokit/`（Windows 是 `C:\Users\<你>\.zerokit\`）。删掉即完全重置，重开重建。含插件、设置、日志、审计。

**插件要填 API Key / 接口地址，配在哪？**
`zkit config <插件id>` 看表、`zkit config <插件id> set <项> <值>` 改；密钥用 `--stdin`（不进 shell 历史）。启动器「插件」面板有同一份表单。值存 `~/.zerokit/settings/`，权限 0600。

**换机器怎么把启动器的收藏/主题/参数带过去？**
启动器 → 设置抽屉 → 数据 → 导出，得到一个 JSON；新机器导入即可（按组勾选、合并新优先）。配置档也含在内。

## 插件开发

**改了 plugins/ 下的清单不生效？**
`plugin bundled` 对已存在目录跳过。`zkit plugin remove <id>` + `plugin bundled` 重装，或用 `zkit plugin unpack`（`--replace`）。

**插件加载失败说「缺 risk」？**
每个动作必须声明风险档（read / mutate / destructive），缺了连加载都过不了。`zkit plugin lint <目录>` 体检。

**Windows 上中文乱码？**
项目脚本输出统一 UTF-8，Python 子进程注入 `PYTHONIOENCODING=utf-8`。你的插件要输出 GBK 就在清单声明 `encoding = "gbk"`。

**能改哪个文件来动行为？**
插件相关的全在清单（`plugin.toml`），不用改内核；内核在 `src/`，路由表在 `src/cli.ts`。

## 更多

- 项目现状与已知差距：[项目账本](../reference/overview.md)
- 设计为什么这样定：[设计取舍](../deep/design.md)
