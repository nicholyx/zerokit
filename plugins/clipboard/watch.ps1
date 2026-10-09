# 剪贴板轮询器：一个长期存活的 PowerShell 进程，在进程内部循环读剪贴板，
# 有变化就把内容作为一行 JSON 写到 stdout。
#
# ⚠ 本文件必须存成 **UTF-8 with BOM**，改完别用"UTF-8 无 BOM"保存回去。
# Windows PowerShell 5.1 没有 BOM 时会按系统 ANSI 代码页（中文机器是 GBK）读 .ps1，
# 下面这些中文注释会被解码成乱码字节，其中某些字节恰好是引号或反斜杠，
# 于是整个脚本报"表达式或语句中包含意外的标记"这种指向不明的语法错。
# （测试里有一条断言专门盯着这个 BOM。）
#
# 为什么是"一个常驻进程 + 进程内循环"，而不是"每次新起一个 powershell"：
#   Node 没有读 Windows 剪贴板的内置 API，每次要读都得 `powershell -Command Get-Clipboard`，
#   而**光启动 powershell 就要约 200ms**（实测 5.1 冷启动 180~260ms）。轮询意味着
#   每秒都要读一次，那条路等于每秒烧 200ms 的 CPU 和一次进程创建，完全不可用。
#   常驻进程把这笔开销摊成一次性，轮询本身只是一个 API 调用，几乎不耗 CPU。
#
# 为什么用 PowerShell 而不是自己编译 C#：本机 PowerShell 5.1 自带
# System.Windows.Forms，而 powershell.exe 默认就是 STA 线程
# （[Windows.Forms.Clipboard] 在 MTA 下会直接抛异常）。零编译、零依赖，够用。
#
# 这个脚本不认识"历史文件""去重条数"这些概念——它只负责"剪贴板变了，内容是这个"，
# 落盘的事交给 clipboard.mjs。这样纯逻辑可以脱离剪贴板单独测。
param(
  # 轮询间隔。400ms 是"复制完切过去就已经在那儿了"和"几乎不耗 CPU"之间的折中。
  [int]$IntervalMs = 400,
  # 父进程（clipboard.mjs 的监听进程）的 PID，用来防止变成孤儿进程
  [int]$ParentPid = 0,
  # 轮询多少次后退出；0 = 一直跑。给测试留的口子：用 1 可以让它"起来、立刻干净退出"。
  [int]$MaxIterations = 0
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

# 管道里的字节要是 UTF-8，否则中文在 Node 那侧会变成乱码（默认是控制台代码页 GBK）
[Console]::OutputEncoding = [Text.Encoding]::UTF8

function Read-ClipboardText {
  try {
    return [Windows.Forms.Clipboard]::GetText()
  } catch {
    # 别的进程正握着剪贴板时会抛异常。这**不等于**"剪贴板变空了"，
    # 所以用 $null 表示"这次没读到"，让调用方跳过这一轮而不是当成一次变化。
    return $null
  }
}

$lastSeen = Read-ClipboardText
if ($null -eq $lastSeen) { $lastSeen = '' }
# 启动时先"预热"：把当前剪贴板内容当作已经见过。
# 否则每次开机/重启监听，都会把上一轮残留在剪贴板里的旧内容再记一遍。
$lastRecorded = $lastSeen

$i = 0
while ($true) {
  Start-Sleep -Milliseconds $IntervalMs
  $i++

  # 每 12 轮（约 5 秒）确认一次父进程还活着。
  # Windows 上强杀父进程不会给子进程任何通知（没有 Unix 的 SIGHUP），
  # 没有这道检查，父进程一被强杀就会留下一个孤儿的 powershell 永远轮询下去。
  if ($ParentPid -gt 0 -and ($i % 12) -eq 0) {
    if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
  }

  # 这一段刻意写成嵌套判断而不是一串 continue：
  # continue 会跳过循环体**末尾**的退出判断，于是"剪贴板一直没变"时
  # -MaxIterations 永远不生效（脚本会一直转下去，测试里就是这么挂死 30 秒的）。
  # 嵌套写法保证不管这一轮有没有检测到变化，下面那句 break 都会被执行到。
  $t = Read-ClipboardText
  if ($null -ne $t -and $t -cne $lastSeen) {
    # 大小写敏感比较（-cne）："Hello" 和 "hello" 是两次不同的复制，都该记录。
    $lastSeen = $t

    # 空内容不进历史：清屏、复制图片/文件（GetText 拿不到文本）、
    # 以及别的程序写到一半被我们读到，都会是空串，记下来纯属噪音。
    if ($t.Length -gt 0 -and $t -cne $lastRecorded) {
      # 和"最近一条真正记下的"比，而不是和"最近一次读到的"比：
      # 上面那段"读到半截变空、下一轮又变回来"的抖动会让同一条内容被记两遍，
      # 拿最近一次**记录**去比就能把这种抖动挡掉。（落盘那一侧还会再比一次。）
      $lastRecorded = $t

      # 一行一条 JSON。用 ConvertTo-Json 而不是自己拼字符串：换行、引号、
      # 控制字符都由它正确转义，文本内容再离谱也不会破坏行协议。
      [Console]::Out.WriteLine(([pscustomobject]@{ text = $t } | ConvertTo-Json -Compress))
    }
  }

  if ($MaxIterations -gt 0 -and $i -ge $MaxIterations) { break }
}