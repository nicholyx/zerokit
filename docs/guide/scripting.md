# 脚本化与自动化

> 目标读者：把 zkit 接进 shell 脚本、cron、CI 的人。读完知道退出码怎么用、
> 密钥怎么传、并发怎么锁、定时怎么接。

## 退出码契约

```bash
zkit exit-codes   # 随时可查
```

| 码 | 含义 | 该重试吗 |
|----|------|---------|
| 0 | 成功 | — |
| 1 | 动作执行失败 | 值得（可能是瞬时） |
| 2 | 用法错 / 哨兵未触发 | **不要盲目重试**（重跑结果一样） |

哨兵（`--alert` 未触发）与参数错误共用 2：它们的共同点是「重跑不会改变结果」。

## 密钥走 stdin，不进 shell history

```bash
read -s TOKEN
echo "$TOKEN" | zkit run myplugin deploy --stdin token
```

`--stdin <参数名>` 读一行作为该参数的值。未声明的参数名、空 stdin 都是 exit 2。

## 执行控制

```bash
zkit run sysinfo overview --timeout 10        # 覆盖清单里的 timeout（秒）
zkit run myapi ping --retries 3 --retry-delay 5   # 失败自动重试（只重试执行失败）
zkit run myapi report --format '{{ms}}ms {{rows}}行 {{key}}'   # 轻模板输出
```

模板占位：`{{ms}}` 耗时、`{{rows}}` 行数、`{{ok}}` 布尔、`{{key}}` 动作全名。

## 并发锁

同一动作默认互斥：`~/.zerokit/locks/<插件>.<动作>.lock`。第二个实例自旋等待
（约 20 秒），超时退出并提示持有者。**超过 1 小时的陈锁视为可抢**（进程崩了
没清理的情况）。`--no-lock` 直闯（批处理自己保证不并发时用）。

## 定时任务

```bash
zkit cron add 心跳 -- run sysinfo overview --quiet
zkit cron list [--json]
zkit cron run          # 逐条执行，退出码取最差
zkit cron rm 心跳
```

登记后按提示把一行接进系统调度器（macOS/Linux crontab / Windows 任务计划
程序）。zkit 不自带守护进程——**调度交给 OS，执行交给 zkit**，职责干净。

## 组合：哨兵 + 告警 + cron

```bash
zkit cron add 磁盘哨兵 -- run sysinfo overview \
  --diff --alert '内存占用率>80' --notify-file ~/.zerokit/logs/alerts.log
```

每 10 分钟一次：基线对比 → 阈值判断 → 触发就落一行结构化告警。
