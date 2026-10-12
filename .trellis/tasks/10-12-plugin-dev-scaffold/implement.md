# 执行计划

## 顺序清单

1. [ ] `src/core/sources.ts`：SourceType 加 `'dev'`、`path?` 字段、
       readSource 白名单、describeSource 文案。
2. [ ] `src/core/registry.ts`：
   - `devLink(sourceDir)`：校验 → 建链接（junction/绝对路径）→ 写 dev 来源；
     已存在 dev 链接（同目录）幂等提示、异目录/真实目录报错；
   - `removePlugin`：lstat 检测链接 → 只删链接本身；
   - `addFromDir`：dst 是链接时先删链接再复制（dev 转正）。
3. [ ] `src/core/update.ts`：checkUpdate + 浅检查对 `dev` 的分流文案。
4. [ ] `src/core/scaffold.ts`（新）：node/python/web 模板 + `generatePlugin()`
      （返回生成文件清单与加载结果）；id 规则对齐 schema.ts。
5. [ ] `src/cli.ts`：`plugin new` / `plugin dev` / `plugin validate` 子命令
      + usage/帮助；new 打印四面形态（从生成的清单对象推导）。
6. [ ] `test/scaffold-smoke.mjs`（新）：design「测试设计」六组断言，
      自包含临时 ZEROKIT_HOME；`scripts/test-all.mjs` 注册。
7. [ ] 文档：`docs/plugin-spec.md` 快速上手（new → dev → 迭代 → 转正/导出）、
      `docs/overview.md` 已完成区、`CHANGELOG.md` Unreleased、
      `src/cli.ts` 顶部命令表。

## 验证命令

```bash
./scripts/lint.sh
node scripts/test-all.mjs          # 新文件全绿 + 无回归（3 个已知平台失败除外）
node src/cli.ts plugin new demo --dir /tmp/xx && node src/cli.ts plugin validate /tmp/xx/demo
node src/cli.ts plugin dev /tmp/xx/demo && node src/cli.ts run demo hello
node src/cli.ts ui --open          # 界面里确认 dev 插件可见、能跑（人工）
```

## 回滚点

- 每步一个约定式提交（feat(core): 来源类型 dev / feat(cli): 脚手架与开发模式 /
  test / docs），任何一步可独立 revert；分支上未合并前均可整枝丢弃。

## 审查门

- 实现 4/5 完成后：自查「删链接绝不伤源目录」的双处代码（removePlugin、
  addFromDir）；测试 6 完成后跑全量看回归。
