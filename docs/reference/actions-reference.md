# 动作速查表

全部内置插件 × 动作 × 风险档 × 参数。完整语义看 `zkit plugin doc <id>` 或[清单规范](plugin-spec.md)。风险档含义见[术语表](../guide/glossary.md)。


## clipboard · 剪贴板历史

记录剪贴板历史，可搜索、可把旧内容放回剪贴板，后台常驻监听

| 动作 | 风险 | 参数 | 说明 |
| --- | --- | --- | --- |
| `clipboard.list` | read | limit, full | 按时间倒序列出最近复制的文本，带序号、时间、长度和内容预览。 |
| `clipboard.search` | read | keyword, limit | 在历史里按关键词搜索，大小写不敏感。想找回前几天复制过的一段文字、一条命令时用这个。 |
| `clipboard.copy` | mutate | index | 把 list/search 里看到的那一条重新复制到剪贴板，之后在别处 Ctrl+V 就能粘出来。 |
| `clipboard.clear` | **destructive** | — | 删掉全部历史记录（包括磁盘上的 history.jsonl）。剪贴板里当前的内容不受影响，监听也不会停。 |
| `clipboard.watch-start` | mutate | pid_file, max_entries, max_length, interval_ms | 启动常驻监听，把之后复制的每条内容记进历史。它由 zerokit 托管，会出现在「运行中」里， |
| `clipboard.watch-stop` | mutate | pid_file | 停掉正在运行的剪贴板监听（连同它的轮询进程一起结束）。发现监听在跑但不想让它继续时用这个。 |

## convert · 编码转换台

进制/大小写/JSON 美化等八种常用转换，零依赖纯计算

| 动作 | 风险 | 参数 | 说明 |
| --- | --- | --- | --- |
| `convert.radix` | read | — | 在二进制、八进制、十进制、十六进制之间换一个数的进制。比如查 255 的十六进制、0xff 的十进制。 |
| `convert.case` | read | — | 把一段文本整个转成大写、小写，或每个单词首字母大写。 |
| `convert.json-pretty` | read | — | 把压缩成一行的 JSON 串摊开成带缩进的多行（或反过来压成一行）。校验失败会说清第几个字符出的问题。 |
| `convert.json-min` | read | — | 把多行 JSON 压成一行（去掉所有空白），给 URL 参数或日志用。 |
| `convert.b64` | read | — | 文本转 Base64，或 Base64 还原成文本（UTF-8 安全，中文没问题）。 |
| `convert.url` | read | — | 把文本里的特殊字符转成 %XX（给拼 URL 用），或把 %XX 还原。 |
| `convert.bytes` | read | — | 把 1073741824 这样的数字换成 1.0 GB 这样人能读的字节数（1024 进制）。 |
| `convert.digits` | read | — | 给大数字加千分位分隔（1234567 → 1,234,567）。 |
| `convert.hex-flow` | read | — | 演示组合：把十六进制数转十进制、再加千分位——chain 引用同插件的两个动作一步完成。 |

## demochain · 组合动作演示

演示链式组合动作：第一步取数，第二步用它的结果算

| 动作 | 风险 | 参数 | 说明 |
| --- | --- | --- | --- |
| `demochain.gen` | read | — | 链路第一步：返回 {value: 21}。单独也能跑。 |
| `demochain.double` | read | — | 把输入翻倍。组合动作的第二步素材。 |
| `demochain.pipeline` | read | — | 组合动作演示：跑 gen 拿 21，翻倍成 42。想看多步传值怎么写就看这个。 |

## demohttp · HTTP 动作演示

演示 HTTP 动作：取本仓库信息（内核发请求、走代理）

| 动作 | 风险 | 参数 | 说明 |
| --- | --- | --- | --- |
| `demohttp.repo` | read | — | GET GitHub API 拿 zerokit 仓库信息。HTTP 动作不需要脚本文件。 |

## demosettings · 设置项演示

演示用户设置与 secret：配置存本地、敏感值只走环境变量

| 动作 | 风险 | 参数 | 说明 |
| --- | --- | --- | --- |
| `demosettings.greet` | read | — | 读取用户设置并使用。看看设置怎么进动作、secret 怎么掩码。 |

## demoweb · 网页桥演示

演示 web 动作消息协议全家桶：上下文、外观跟随、深链执行、受控跳转、自适应高度、错误上报

| 动作 | 风险 | 参数 | 说明 |
| --- | --- | --- | --- |
| `demoweb.board` | read | — | 一页演示 zkit 桥的全部能力：执行上下文、宿主外观跟随、深链调本插件动作、受控开外部链接、自适应高度、错误上报。开发 |
| `demoweb.now` | read | — | 给演示板深链调用的只读动作：返回 ISO 时间戳。 |
| `demoweb.ping` | mutate | — | 演示写动作经桥调用时照常弹确认（页面代替不了用户点头）。 |

## filesearch · 文件搜索

给指定目录建一份文件名索引，之后按文件名或路径秒级查找，并可定位到文件

| 动作 | 风险 | 参数 | 说明 |
| --- | --- | --- | --- |
| `filesearch.index` | mutate | dirs, max | 递归遍历给定目录并为文件名建立索引，写入本插件的数据目录；已有索引会被整体替换。遍历会跳过 node_modules、. |
| `filesearch.search` | read | keyword, limit | 在已建好的索引里做不区分大小写的子串匹配，文件名命中的排在路径命中的前面。返回文件名、完整路径、大小和修改时间。想找某个 |
| `filesearch.status` | read | — | 显示索引里有多少文件、什么时候建的、覆盖哪些根目录、索引文件占多大，以及上次是否因达到上限而提前停止。想确认索引是否还是 |
| `filesearch.open` | mutate | path | 在文件管理器里打开该文件所在的目录并选中它。参数应先由 search 得到（或用绝对路径），路径不存在、不在索引里、或含 |

## ip · 出口 IP

查本机访问外网时用的公网 IP，零代码插件

| 动作 | 风险 | 参数 | 说明 |
| --- | --- | --- | --- |
| `ip.public` | read | — | 返回本机访问外网时使用的公网 IP 地址。想知道当前出口 IP、或者确认是否走了代理时用这个。 |

## proxy · 白名单代理

只放行白名单域名的本机出网代理（默认 example.com，用 allow-domain 加自己要的）

| 动作 | 风险 | 参数 | 说明 |
| --- | --- | --- | --- |
| `proxy.status` | read | — | 显示代理是否在运行、监听地址、允许的域名和端口、以及开机自启状态。想确认代理是否正常工作时用这个。 |
| `proxy.domains` | read | — | 列出代理当前允许访问的域名白名单。想知道哪些域名能通过代理时用这个。 |
| `proxy.start` | mutate | — | 在后台启动白名单代理。发现代理没在运行时用这个。 |
| `proxy.stop` | mutate | — | 停掉正在运行的白名单代理。 |
| `proxy.restart` | mutate | — | 重启白名单代理，用于让改动后的配置生效。 |
| `proxy.allow-domain` | mutate | domain | 把一个域名加入代理白名单，改完约 2 秒自动生效。需要放行新的站点时用这个。 |
| `proxy.auth` | **destructive** | user, password | 开启或修改代理的 HTTP Basic 认证用户名密码。改了之后所有走这个代理的客户端都要填上。 |

## quick · 小工具

认出你粘进来的东西：链接、时间戳、颜色、Base64 文本

| 动作 | 风险 | 参数 | 说明 |
| --- | --- | --- | --- |
| `quick.open-url` | mutate | url | 在默认浏览器里打开粘进来的网址。手上有个链接、不想先复制再切浏览器时用这个。 |
| `quick.ts2date` | read | ts | 把 10 位（秒）或 13 位（毫秒）的时间戳转成本地时间、UTC 和 ISO 格式。看到一串数字不知道是哪天时用这个。 |
| `quick.color` | read | hex | 把 #RRGGBB 或 RRGGBB 拆成 RGB 与 HSL，并给出一行色块预览。 |
| `quick.b64` | read | text | 把文本编成 Base64，或把 Base64 解回文本。自动判断方向。 |

## snap · 截图到文件

用系统自带工具截全屏/当前窗口，存到文件——不装任何第三方依赖

| 动作 | 风险 | 参数 | 说明 |
| --- | --- | --- | --- |
| `snap.full` | mutate | — | 把整个屏幕截下来存成 PNG。macOS 用 screencapture、Windows 用 PowerShell、Li |
| `snap.window` | mutate | — | 只截当前活跃窗口（macOS 支持；Windows/Linux 落到全屏）。保存位置和文件名自己指定。 |
| `snap.list` | read | — | 列出保存目录里最近的 PNG 文件（名字、大小、时间）。确认截图有没有成功时用。 |

## sysinfo · 系统信息

查看本机 CPU、内存、磁盘和占用最高的进程，只读，零依赖

| 动作 | 风险 | 参数 | 说明 |
| --- | --- | --- | --- |
| `sysinfo.overview` | read | — | 返回操作系统、CPU 型号与核数、内存占用、开机时长。想了解这台机器当前的整体状态时用这个。 |
| `sysinfo.top` | read | limit | 按内存占用倒序列出进程。排查机器变慢、内存吃紧时用这个。 |
| `sysinfo.disk` | read | — | 列出各磁盘的容量、剩余空间和已用比例。检查磁盘是不是快满了用这个。 |
| `sysinfo.watch` | mutate | — | 每秒打印一次内存与 CPU 负载，直到被结束。要看实时变化、或者想试试「运行中」面板怎么用时用这个。 |
| `sysinfo.brief` | read | — | 把「系统概况」与「最吃内存的进程」两步拼成一段话。演示 type = \ |

## typist · 文本片段台

常用文本模板（SQL/Markdown/YAML 骨架等）一键写入剪贴板，改两个占位就能用

| 动作 | 风险 | 参数 | 说明 |
| --- | --- | --- | --- |
| `typist.sql-select` | mutate | — | 生成一段带 JOIN/ORDER BY/LIMIT 的 SELECT 骨架写入剪贴板，表名和字段是占位符。写新查询不想手 |
| `typist.md-todo` | mutate | — | 生成一段 Markdown 任务清单模板（标题/负责人/截止/子任务）写入剪贴板。 |
| `typist.yaml-ci` | mutate | — | 生成一段两 job（lint+test）的 GitHub Actions YAML 骨架写入剪贴板。 |
| `typist.git-commit` | mutate | — | 生成约定式提交的信息模板（feat/fix/docs 三行候选 + 正文 Why）写入剪贴板。 |
| `typist.preview` | read | — | 不写剪贴板，直接把所有片段列出来看内容——先确认再写。 |
