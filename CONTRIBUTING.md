# Contributing Guide

Thanks for considering a contribution.

中文指南：[`CONTRIBUTING.zh-CN.md`](CONTRIBUTING.zh-CN.md)（内容更全，以它为准）。

## What this project is

zerokit is a **host-agnostic plugin runner**: a plugin is a plain-text
manifest (`plugin.toml`), and the same manifest derives four surfaces —
CLI / MCP / launcher / AI workbench. Start with
[`START-HERE.md`](START-HERE.md).

## Development environment

- **Node.js ≥ 22.18 (required)** — the project runs TypeScript source
  directly via Node's native type stripping. **There is no build step**;
  `node src/cli.ts` runs the source.
- git (optional, only for installing plugins from git repos)
- Python 3.10+ (optional, only for python-based plugins like `proxy`)
- Rust toolchain (optional, only for building the native desktop shell)

Install and verify:

```bash
npm install                  # dependencies (node_modules is not committed)
node src/cli.ts doctor       # self-check: Node version, deps, all manifests
node scripts/test-all.mjs    # full test suite: 9 files, 200+ assertions
```

## Local checks

Run before pushing:

```bash
node scripts/test-all.mjs    # the same command CI runs
```

Note: CI currently runs the test matrix only on **windows-latest** — some
bundled plugins have Windows-specific behavior (clipboard uses PowerShell,
filesearch uses `explorer /select`). Cross-platform support is work in
progress; if you touch platform-specific code, note in your PR which
platform you verified on.

## Workflow

1. Find (or create) an Issue describing the problem you're solving.
2. Branch from the latest `main`, e.g. `feat/port-forwarding` or `fix/mcp-allow`.
3. One Issue, one branch, one PR. Keep changes focused.
4. Run local checks before opening the PR.
5. The PR title follows the same commit convention (it becomes the commit
   message after squash merge, and CI validates it).

## Commit messages

The project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

CI validates both PR commits and the PR title via `scripts/check-commit-msg.sh`.
Allowed types: `feat` `fix` `docs` `ci` `chore` `refactor` `perf` `test`
`style` `revert` `build`. Scopes: `core`, `plugins`, `web`, `desktop`,
`ci`, `docs`.

## Pull requests

Please include:

- What changed and **why** (the diff already shows the "what"),
- How you verified it — concrete steps, not just "tests pass",
- Platform notes (which platform you verified on),
- The linked Issue (`Closes #12`).

Don't commit generated artifacts: `node_modules/`, `~/.zerokit/` runtime
data, Rust `target/`.

For user-visible changes, add an entry to the `Unreleased` section of
[`CHANGELOG.md`](CHANGELOG.md) under the appropriate heading
(Added / Changed / Deprecated / Removed / Fixed / Security).

## Writing plugins

Plugins don't require kernel changes — a `plugin.toml` manifest is all it
takes. See [`docs/plugin-spec.md`](docs/plugin-spec.md) for the full spec.
The six bundled examples live in [`plugins/`](plugins/): `ip` is
zero-code, `proxy` wraps an existing tool.

Put new plugins in `plugins/<id>/`, register them in `market.json`, then
`node src/cli.ts plugin bundled` to install into the data directory for
testing.

## Reporting security issues

Please report privately via
[GitHub Security Advisories](https://github.com/nicholyx/zerokit/security/advisories/new),
not public Issues. See [`SECURITY.md`](SECURITY.md) for the threat model.
