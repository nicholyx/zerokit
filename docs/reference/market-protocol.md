# market 安装源协议（v1，第二百八十一轮公开化）

> 集市 = 一个 git 仓库 + 根目录 `market.json`。本文是第三方源的完整规范：
> 字段语义、校验规则、协议版本约定。

## 源清单格式（market.json）

```json
{
  "name": "my-market",
  "description": "可选的一句话说明",
  "protocol": 1,
  "plugins": [
    {
      "id": "my-plugin",
      "name": "我的插件",
      "summary": "给人和搜索看的说明（建议 ≥6 字）",
      "version": "1.0.0",
      "tags": ["标签"],
      "source": "git:https://github.com/user/repo#path:plugins/my-plugin",
      "actionCount": 3,
      "riskMix": { "read": 2, "mutate": 1 }
    }
  ]
}
```

## 字段语义

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | ✅ | 集市名（install 时 `-m` 指定用） |
| `description` | | 一句话说明 |
| `protocol` | | 协议版本（缺省=1）。**大版本不认识时 zerokit 拒绝添加**——老客户端不会装错新源 |
| `plugins[].id` | ✅ | 插件 id（集市内唯一） |
| `plugins[].name` | | 显示名 |
| `plugins[].summary` | | 建议 ≥6 字（lint warning） |
| `plugins[].version` | | x.y.z 格式 |
| `plugins[].source` | ✅ | `path:`（本地，限源仓库机器）或 `git:`（可分发） |
| `actionCount` / `riskMix` | | `zkit market index` 生成时自动摊开 |

## 校验规则（add 时全跑，硬伤拒绝添加）

- JSON 可解析、`name` 存在、`protocol` 为正整数且 ≤ 本机支持
- 每条：`id` 必有且不重复、`source` 必有且以 `path:`/`git:` 开头
- `path:` 源在源仓库本机做存在性检查（plugin.toml 必须在）
- warning 级：`plugins` 空、name/summary/version 缺或弱——不阻断

## 生成与注册

```bash
zkit market index [目录]        # 扫描目录生成 market.json
zkit market add <git地址|目录>  # 注册源（多源并存于 ~/.zerokit/marketplaces.json）
zkit market list                # 已注册源
zkit market refresh [名]        # 拉最新索引
zkit plugin install <id> [-m 集市名]
```

## 协议演进约定

- 小改（加可选字段）不动 `protocol`——老客户端忽略新字段。
- 破坏性改动（字段语义变/必填新增）升 `protocol` 大版本；zerokit 拒绝比自己新的版本并提示升级。

## 签名（第 282 轮，ed25519 最小链）

`.toolpack`（plugin export 产物）可携带 ed25519 签名：

```bash
zkit keygen                      # 生成密钥对（私钥 0600 ~/.zerokit/keys/，公钥同目录 .pub）
zkit plugin export <id>          # 有私钥时自动签名（sig 段：algo/keyId/sig）
zkit plugin import <文件>        # 包带 sig 且本机 keys/ 有对应公钥 → 强校验（篡改拒绝）
```

- **keyId** = 公钥 SPKI DER 的 sha256 前 16 hex——人可核对的指纹。
- **校验范围**：files（名→sha256）+ plugin 元信息，canonicalJson（键排序无空格）。
- **兼容**：无 sig 包 / 本机无对应公钥 = 原行为不变（信任用户 keys/ 里有的签名者）。
- 签名段本身不入被签 payload（防自指）。

## 发布通道（第 283 轮——脚手架到上架一条龙）

```bash
zkit plugin new <id>                  # 脚手架
zkit plugin publish-check <目录>      # 发布前组合检查（清单可加载/risk/版本/签名密钥/index 干跑）
zkit plugin add <目录>                # 装入本地
zkit plugin publish-ready <id>        # 上架自查（过 → 打印发布通道三步指引）
zkit keygen                           # 签名密钥（一次性）
zkit market index <父目录>            # 生成/更新源清单
zkit plugin export <id>               # 打 .toolpack（自动签名）
# market.json 提交到 git 仓库 → 用户 zkit market add <仓库>
```
