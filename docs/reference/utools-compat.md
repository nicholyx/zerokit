# uTools 插件兼容层：支持矩阵

> 面向想把存量 uTools 插件跑在 zerokit 上的人。结论先行：
> **「读输入 → 算 → 输出 → 存储 → 开外部程序」这条链路是通的**；
> 依赖 OS 级能力（活动窗口、模拟键鼠、粘贴进前台窗口）或 Electron 渲染进程的部分**没有复刻**，
> 调用时会抛出能看懂的错误，而不是 `undefined is not a function`。

## cmds 类型翻译

| uTools cmds 类型 | 翻译结果 | 说明 |
| --- | --- | --- |
| 关键字（字符串） | 关键字 | 原样进搜索关键字 |
| `regex:模式` | 正则匹配 | 多条正则时第一条进 match，其余并入关键字 |
| `over` | 划词匹配 | 选中文本作为 text 参数 |
| `files` | 文件匹配 | `fileType` 映射扩展名白名单（image/video/audio/file…） |
| `img` | 文件匹配 + 图片扩展名 | 语义等价于 files + image；「图片」进关键字 |
| `window` | 关键字 + 健康警告 | OS 级能力无法复刻；窗口名并入关键字供搜索 |
| 其它 | 警告并跳过 | 加载警告里能看到原因 |

## plugin.json 字段

| 字段 | 支持 | 说明 |
| --- | --- | --- |
| `pluginName` / `description` / `author` / `homepage` / `version` | ✅ | 直接进插件元数据 |
| `logo` | ✅ | 插件目录内相对路径（防穿越校验）或 http(s)/data URL |
| `platform` | ⚠️ | 白名单不含当前平台时给**警告**（不拒绝加载——动作也许还能跑） |
| `preload` / `features` | ✅ | preload 是运行入口；features 翻译成动作 |

## utools.* 运行时 API

### 输入与输出

| API | 支持 | 行为 |
| --- | --- | --- |
| `onPluginEnter(cb)` | ✅ | 回调收到 `{code, type, payload}` |
| `outPlugin()` | ✅ | 结束进程 |
| `hideMainWindow()` / `showMainWindow()` | ✅ | 无窗口，语义为空 |
| `redirect(plugin, code, payload)` | ⚠️ no-op | 返回 `false`，stderr 留一行「已跳过」提示 |
| `getWindowSize()` | ⚠️ 固定值 | 恒 `{width: 800, height: 600}`，让布局逻辑走完不崩 |
| `isDarkColors()` / `isDev()` / `getAppVersion()` | ✅ | 恒定值（false / false / "zerokit"） |
| `copyText(text)` | ✅ 三平台 | pbcopy（macOS）/ wl-copy·xclip·xsel（Linux）/ Set-Clipboard（Windows）；全都没有时返回 false |
| `shellOpenExternal(url)` / `shellOpenPath(p)` / `shellShowItemInFolder(p)` | ✅ | 走系统打开方式 |

### 存储

| API | 支持 | 行为 |
| --- | --- | --- |
| `dbStorage.setItem/getItem/removeItem` | ✅ | 按插件隔离的 JSON 文件 |
| `db.put(doc)` | ✅ 完整语义 | 必须有 `_id`；**重复 `_id` 不带 `_rev` 返回 `{ok:false,error:"conflict"}`**；带匹配 `_rev` 才覆盖，rev 递增 |
| `db.get(id)` / `db.remove(id)` / `db.allDocs()` | ✅ | 常规语义；remove 不存在返回 `{ok:false,error:"not found"}` |

### 明确不支持（调用抛可读错误）

`createBrowserWindow` / `createBrowserView` / `removeBrowserView` / `setBrowserView` /
`getCurrentWindow` / `getWindowType` / `isPinned` / `setExpendHeight` /
`readCurrentBrowserUrl` / `simulateKeyboardTap` / `getCursorScreenPoint` / `startDrag` /
`createNativeImage` / `setFeature` / `removeFeature` / `findAllDocuments`——
这些依赖 Electron 渲染进程或 OS 级能力，错误信息会写明缺的是什么。

## 常见问题

**纯界面型插件跑不出结果？**
是的。DOM 渲染没有对应实现，插件执行完没有任何输出时 runtime 会提示
「它可能只做界面渲染」。把逻辑抽成计算函数、用 `console.log` 输出 JSON 是最低成本的移植路径。

**db.put 返回 conflict 是不是坏了？**
不是，这是 uTools 本来的语义：防止两个动作悄悄互相覆盖数据。
先 `db.get` 拿 `_rev` 再带着 `_rev` put。

## 相关

- 兼容层实现：`src/core/utools.ts`（清单翻译）+ `src/core/utools-runtime.mjs`（运行时垫片）
- 测试：`test/utools-smoke.mjs`（44 项断言覆盖上表全部行为）
