# PRD：插件脚手架与开发模式（plugin new + plugin dev）

## 问题

写一个 zerokit 插件的现状路径：

1. 手工建目录，对照 `docs/plugin-spec.md` 手写 `plugin.toml`——TOML schema
   字段多（plugin/action/param/requires/service），新手第一次写几乎必然校验失败几次；
2. 迭代时改一行清单就要 `plugin remove` + `plugin add` 重装（安装是**复制语义**，
   CLAUDE.md 已记录此坑）；
3. 没有本地目录的独立校验入口（`zkit show` 只能看已装插件）。

这是「生态靠写插件门槛足够低」的最大缺口，与项目核心卖点直接冲突。

## 目标用户

- 第一次写插件的贡献者（主要）；`plugins/` 目录下示例插件的维护迭代（次要）。

## 需求

### R1 `zkit plugin new <id>` —— 脚手架

- 在指定父目录（默认 `./`）生成 `<id>/` 插件骨架，目录已存在则拒绝（不覆盖）。
- 可选 `--name <显示名>`（默认取 id）、`--runtime node|python`（默认 node）、
  `--web`（附带富交互页面骨架）、`--dir <父目录>`。
- 生成的 `plugin.toml` 带教学式注释（学示例插件的注释密度），含一个能跑的
  `hello` 动作（string 参数 `name`），清单必须直接通过现有校验。
- 生成后立即用现有 `loadDir` 校验；通过则打印**这个插件在四个面的形态**
  （CLI 命令 / MCP 工具名 / 启动器关键词 / 工作台工具）+ 下一步指引。
- 生成 ≠ 安装：不动插件目录，装不装由用户显式决定（保持信任边界）。

### R2 `zkit plugin dev <目录>` —— 开发链接

- 把本地开发目录**链接**进插件目录（而非复制）：junction/symlink，
  Windows 用 junction（免管理员权限），mac/linux 用 symlink。
- 链接前先校验目录清单可加载；失败如实报错不链接。
- 链接后改源目录的 `plugin.toml` / 脚本，四个面（CLI / MCP / 启动器 / 工作台）
  下一次请求即生效——MCP `tools/list` 与 Web `/api/plugins` 已确认是每次动态
  `listPlugins()`，无需改动。
- 来源记录写**源目录**的 `.zerokit-source.json`（`type: "dev"` + `path`），
  `zkit plugin update` 对 dev 插件如实提示「开发模式，改源码即生效」而不尝试更新。
- `zkit plugin remove` 卸载 dev 插件只删链接本身，**绝不能碰源目录**（安全断言）。
- dev 状态下 `zkit plugin add <同一目录>` = 转正：删链接换成真实复制
  （开发完成的自然出口）。

### R3 `zkit plugin validate <目录>` —— 独立校验

- 对任意目录跑清单校验并摊开能力（动作/参数/风险），不要求已安装。
- `plugin new` 的生成后校验复用同一条路径。

## 非目标

- 不做模板的交互式问答向导（参数式足够，向导是另一轮的事）。
- 不做文件监听/watch（四个面本来就动态加载，watch 无必要）。
- 不做多模板选择（进阶模板如 service/web 组合除 `--web` 外不做）。

## 验收标准

1. `zkit plugin new demo` 生成的骨架经 `zkit plugin validate` 通过，
   `zkit plugin dev` 后 `zkit list` 可见、`zkit run demo hello` 能跑出结果。
2. dev 链接下修改源目录清单（加动作/改参数），`zkit show demo` 反映变化，
   无需重装。
3. `zkit plugin remove demo` 后源目录完好无损。
4. `node scripts/test-all.mjs` 全绿（新增 `test/scaffold-smoke.mjs`，
   自包含临时 ZEROKIT_HOME，不依赖本机已装插件）；原有测试无回归。
5. `./scripts/lint.sh` 与 `tsc --noEmit` 干净。
6. 文档同步：`docs/plugin-spec.md` 快速上手、`docs/overview.md` 已完成区、
   `CHANGELOG.md` Unreleased。
