# Changelog

All notable changes to ContextGraph are documented here.

---

## [0.1.9] — 2026-04-25

### Fixed
- Internal `@loosilo/*` dependencies now use `^` (caret) ranges in published packages, preventing Bun cache misses during global install.

---

## [0.1.8] — 2026-04-25

### Added
- `cograph update` command — upgrades the CLI to the latest version via `bun install -g`.
- Automatic update check: after any command, cograph checks npm once per 24 hours and prints a notice if a newer version is available. The check is non-blocking and cached in `~/.cache/cograph/version.json`.

---

## [0.1.7] — 2026-04-25

### Fixed
- `cograph register` now calls `claude mcp add --scope user` instead of writing to `~/.claude/claude_desktop_config.json`. Claude Code CLI reads MCP config from `~/.claude.json`; the desktop config file is kept as a fallback for the Claude Desktop app only.
- `cograph register --http` now only writes Cursor config (`~/.cursor/mcp.json`); HTTP mode is Cursor/Windsurf-only.

---

## [0.1.6] — 2026-04-24

### Fixed
- MCP servers now start correctly after a global npm install. The CLI resolves MCP package paths via `createRequire` instead of hardcoded monorepo-relative paths.
- MCP packages (`@loosilo/contextgraph-mcp`, `@loosilo/blastradius-mcp`) are now explicit dependencies of the CLI so their paths are always resolvable.
- Restored missing `bunPath` variable in `cmdRegister` that caused `ReferenceError` on `cograph register`.
- `cmdStatus` made async to support `bun:sqlite` dynamic import.
- Moved `createRequire` import to top-level (was incorrectly inside a function).

---

## [0.1.5] — 2026-04-23

### Fixed
- MCP servers now accept a `--http` flag to switch between stdio (Claude Code) and HTTP (Cursor) transport modes. Previously the entry point always started in stdio mode.

---

## [0.1.4] — 2026-04-23

### Fixed
- Removed `--outdir` from CLI and MCP build scripts — it conflicts with `--compile` in Bun.
- Set `noUncheckedIndexedAccess: false` in root tsconfig to fix `Object is possibly 'undefined'` errors on array indexing.
- Fixed `onsessioninitialized` callback type in both HTTP server files.
- Added `zod` as an explicit dependency to both MCP packages.

---

## [0.1.3] — 2026-04-22

### Changed
- CLI command renamed from `ctx` to `cograph`.
- All packages renamed to `@loosilo/*` org scope:
  - `@loosilo/contextgraph-core`
  - `@loosilo/contextgraph-mcp`
  - `@loosilo/blastradius-mcp`
  - `@loosilo/contextgraph-cli`
- README and USER_GUIDE rewritten with focus on npm install flow and Claude Code / Cursor setup.

---

## [0.1.2] — 2026-04-21

### Added
- Initial public release.
- `cograph index` — indexes TypeScript, JavaScript, Python, and Markdown files into a local SQLite database.
- `cograph start / stop / status` — manages MCP servers as background HTTP processes.
- `cograph register` — writes MCP config for Claude Code (stdio) and Cursor (HTTP).
- `cograph memory` — list, recall, delete, and audit learnings.
- `cograph checkpoint` — save and restore session snapshots.
- `cograph blast` — blast radius analysis and risk scoring for any file.
- `cograph instructions` — prints a system-prompt snippet to auto-trigger MCP tools.
- Local TF-IDF embedding backend (no API key required).
- Ollama and OpenAI embedding backends.
- MCP tools: `search_context`, `index_project`, `set_context`, `expand_chunk`, `start_task`, `save_learning`, `recall_learnings`, `audit_memories`, `save_checkpoint`, `get_checkpoint`, `list_checkpoints`, `delete_learning`, `analyze_impact`, `safe_to_change`, `rebuild_graph`.
