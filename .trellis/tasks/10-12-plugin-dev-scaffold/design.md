# 技术设计：plugin new / dev / validate

## 边界与不变量

- 内核无构建步骤、零新依赖：全部用 node 内置 `fs` / `path`。
- 「装之前摊开看」的信任边界不动：`new` 只在用户指定的工作目录生成文件，
  不碰插件目录；`dev` 是用户显式动作，且链接前校验。
- 「目录即插件、复制即迁移」不变：dev 链接只是安装的一种**形态**，
  `removePlugin` / `export` 等照常工作（见下面对 export 的取舍）。
- 所有面都从 `listPlugins()` 动态读清单（已核实 mcp.ts:72 / server.ts:70），
  dev 链接无需任何缓存失效逻辑。

## 链接的实现选型

`fs.symlinkSync(absSrc, dst, 'junction')`：

- Windows：junction（目录连接），**不需要**开发者模式/管理员权限；
- macOS/Linux：type 参数被忽略，创建普通 symlink；
- junction 要求绝对路径 → 传入前 `path.resolve`；
- `listPlugins` 的 `fs.statSync(dir).isDirectory()` 跟随链接 → 加载正常。

npm/pnpm 同款方案，成熟可靠。

**来源记录写源目录**而非链接旁：来源跟着插件本体（源目录）走，
再次 `dev` 时覆盖写，`remove` 后残留无害。副作用：往用户开发目录写一个
`.zerokit-source.json`（README/注释里说明可 gitignore）。
备选「链接旁放 `<id>.dev.json`」被否：`listPlugins` 目录遍历会把它当异物，
`removePlugin` 也不会清理它。

## 关键安全点：删除链接不伤源目录

`removePlugin` 现在是 `rmSync(dir, { recursive: true, force: true })`。
现代 Node 对 symlink/junction 只删链接本身，但**显式分支**更稳、可自证：

```ts
const st = fs.lstatSync(entry.dir);   // lstat：看链接本身，不跟随
if (st.isSymbolicLink()) fs.rmSync(entry.dir);   // 只删链接，无 recursive
else fs.rmSync(entry.dir, { recursive: true, force: true });
```

测试里专门断言：remove 后源目录原样存在。

`addFromDir` 的 dev 转正：进函数时检测 `dst` 是链接 → 直接删链接
（源目录就是本体，无「旧版本」可备份），再走正常复制路径。
不走备份式替换流程——那套是为「保住旧版插件」设计的，链接没有旧版语义。

## sources.ts 扩展

```ts
type SourceType = 'git' | 'market' | 'bundled' | 'dir' | 'dev';
interface PluginSource { /* 现有字段 */ path?: string; }  // dev 来源的开发目录
```

`readSource` 的类型白名单加 `dev`；`describeSource` 返回
`开发模式（链接到 <path>）`。向后兼容：旧来源文件无 `dev`，照旧解析。

`update.ts`：`checkUpdate` 与浅检查（列状态用）遇到 `dev` →
`available: false`，reason「开发模式：改源目录即生效；转正式安装用
`zkit plugin add <目录>`」。

## 脚手架（src/core/scaffold.ts 新文件）

- 模板用 TS 模板字符串内嵌（不搞模板目录——模板要跟代码版本走，
  且避免「生成模板的模板」这种递归）。
- node 模板：`plugin.toml`（注释式教学）+ `main.mjs`（读 argv、stdout 输出）；
  python 模板：`plugin.toml` + `main.py`（UTF-8，stdin/argv 语义与内核一致）。
- `--web`：追加 `web/index.html`（含 `zkit.ready` 桥的最小页），动作 `render = "web"`。
- id 规则与 manifest 校验对齐（实现时从 `schema.ts` 取实际规则，宁可提前拒绝
  也不要生成一个校验不过的骨架）。
- 生成后 `loadDir` 自校验 + 打印四面形态；**打印内容直接从生成的清单对象推导**
  （工具名 `<id>__hello` 等），不硬编码字符串——生成什么说什么。

## CLI 路由（src/cli.ts）

`cmdPlugin` 加三个子命令，usage 行同步；帮助文本顶部命令表补一行。
风格沿用现有：非交互环境无 TTY 时的行为——`new`/`validate` 只读安全无需确认；
`dev` 是安装类动作但对象是用户自己的本地目录（等价 `plugin add <本地目录>`，
现有 add 也不要求确认），不加确认。

## 测试设计（test/scaffold-smoke.mjs）

自包含：`mkdtempSync` 两个临时目录——ZEROKIT_HOME（插件目录）+ 工作目录
（生成/开发用），spawnSync `src/cli.ts` 子进程断言：

1. new 生成 + validate 通过 + 目录已存在时拒绝；
2. node/python/web 三种模板形状（文件齐全、校验通过）；
3. dev 链接 → `list` 可见；改源目录清单加动作 → `show` 反映（即改即生效）；
4. remove dev 插件 → 源目录完好（内容逐项比对）；
5. dev 状态 add 同目录 → 转正（目录变真实目录、来源 type=dir）；
6. update 对 dev 插件 → 提示开发模式、不 available。

不测 MCP 传输层（mcp-smoke 已覆盖 tools/list ← listPlugins 链路）。

## 兼容性

- 旧插件目录（无 dev 来源）全部路径不变；`readSource` 严格向后兼容。
- `lint.sh`（含 tsc）+ test-all 全绿；已知 3 个 macOS 平台性失败除外。
