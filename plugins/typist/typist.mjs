#!/usr/bin/env node
/**
 * typist 插件：常用文本片段写剪贴板。
 * 平台写入复用 clipboard 插件沉淀的 clipio（../clipboard/clipio.mjs）——
 * 这正是 vendor 精神的第二种形态：直接借用邻居插件的成熟模块。
 */
import { ok, err, lines } from '../_vendor/zkutil.mjs';

const [,, cmd, ...args] = process.argv;

const SNIPPETS = {
  'sql-select': `-- 骨架：改表名与字段即可
SELECT
  t.id,
  t.name,
  t.created_at
FROM {{表名}} AS t
LEFT JOIN {{关联表}} AS r ON r.id = t.{{外键}}
WHERE t.{{条件列}} = {{值}}
ORDER BY t.created_at DESC
LIMIT 50;`,
  'md-todo': `## {{任务标题}}

- 负责人：{{who}}
- 截止：{{YYYY-MM-DD}}

- [ ] 拆解需求
- [ ] 实现
- [ ] 自测（截图/输出）
- [ ] 复核`,
  'yaml-ci': `name: ci
on:
  push: { branches: [main] }
  pull_request:
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: {{lint 命令}}
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: {{test 命令}}`,
  'git-commit': `feat({{scope}}): {{一句话说做了什么}}

{{为什么：动机与上下文，正文写 Why 而不是 What}}

（备选头）fix({{scope}}): ...
（备选头）docs({{scope}}): ...`,
};

try {
  if (cmd === 'preview') {
    const name = args[0] ?? '';
    if (name) {
      if (!SNIPPETS[name]) throw new Error(`没有片段 "${name}"，可选：${Object.keys(SNIPPETS).join(' / ')}`);
      ok({ name, text: SNIPPETS[name] });
    } else {
      ok({ names: Object.keys(SNIPPETS), previews: Object.fromEntries(Object.entries(SNIPPETS).map(([k, v]) => [k, `${lines(v).length} 行，首行：${lines(v)[0]}`])) });
    }
  } else if (SNIPPETS[cmd]) {
    const text = SNIPPETS[cmd];
    // 平台剪贴板：动态 import 邻居插件的 clipio（避免启动时全量加载）
    const { clipboardIO } = await import('../clipboard/clipio.mjs');
    const r = clipboardIO().write(text);
    if (!r.ok) throw new Error(`写入剪贴板失败：${String(r.error).slice(0, 200)}`);
    ok({ name: cmd, chars: text.length, lines: lines(text).length, copied: true });
  } else {
    err(`未知子命令：${cmd}（可用：${Object.keys(SNIPPETS).join(' / ')} / preview）`);
    process.exitCode = 1;
  }
} catch (e) {
  err(e?.message ?? e);
  process.exitCode = 1;
}
