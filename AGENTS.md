<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

## Open-Source Workflow

本仓库按真实开源项目维护：Issue → 聚焦分支 → 约定式提交 → PR →
CI 全绿（只盯「CI 总览」）→ squash merge。

- 流程规则与硬规则的**单一入口**：[`CLAUDE.md`](CLAUDE.md)
- 日常迭代闭环与踩坑记录：`.claude/skills/maintain-loop/SKILL.md`
- 基建搭建手册（大改时对照）：`.claude/skills/oss-bootstrap/SKILL.md`
- 新功能选题：`/next-feature`
- 提交前本地检查：`./scripts/lint.sh`；全量测试：`node scripts/test-all.mjs`

Trellis（`.trellis/`）负责单任务的过程记录（PRD / journal / 归档），
与 GitHub 流程互补：Trellis 管「这个任务怎么做」，GitHub 管「做什么与合不合」。
