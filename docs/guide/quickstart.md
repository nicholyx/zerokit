# 十分钟上手

目标：从零到「在启动器里跑通一个动作」，全程可验证。

## 0. 前置（1 分钟）

- Node ≥ 22.18（`node -v` 确认；低了先升级）
- 可选：Python 3.10+（只有示例插件 `proxy` 需要）

## 1. 拿到代码（1 分钟）

```bash
git clone https://github.com/nicholyx/zerokit.git
cd zerokit
```

**没有构建步骤**——克隆完就能跑，这是本项目的核心承诺之一。

## 2. 装示例插件（1 分钟）

```bash
node src/cli.ts plugin bundled
```

**验证点**：输出列出 clipboard / convert / quick / sysinfo 等插件，无报错。

## 3. 环境自检（1 分钟）

```bash
node src/cli.ts doctor
```

**验证点**：清单与环境两项都过。`python` 缺失只影响 `proxy` 插件，不是阻塞。

## 4. 命令行跑第一个动作（2 分钟）

```bash
node src/cli.ts run sysinfo.overview
```

**验证点**：输出一段 JSON——主机名、平台、CPU、内存。这就是一个「动作」。

再试一个带参数的：

```bash
node src/cli.ts run quick.b64 --text "你好 zerokit"
```

**验证点**：输出 Base64 编码结果。

## 5. 打开启动器（3 分钟）

```bash
node src/cli.ts ui --open
```

**验证点**：
1. 浏览器打开，左侧出现插件列表（第 2 步装的）
2. 搜索框打 `xtxx`（「系统信息」的拼音首字母）→ 列表过滤到系统信息类
3. 点「系统概况」→ 右侧详情 → 点「运行」→ 出结果卡

## 6. 做一件真事（2 分钟）

启动器搜索「时间戳」→「时间戳转成日期」→ 参数填 `1760000000` → 运行。

**验证点**：得到一个人类可读的日期和多格式对照表。

## 下一步

- 被 noun 绕晕 → [术语表](glossary.md)
- 想写自己的插件 → [插件清单规范](../reference/plugin-spec.md)
- 卡住了 → [常见问题](faq.md)
- 想看全部现成动作 → [动作速查表](../reference/actions-reference.md)
