# ContextGraph

> Smart context management and blast-radius analysis for AI coding agents — no API keys required.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-black)](https://bun.sh)
[![MCP](https://img.shields.io/badge/protocol-MCP-purple)](https://modelcontextprotocol.io)

ContextGraph is a pair of [Model Context Protocol (MCP)](https://modelcontextprotocol.io) servers that give AI coding agents — Claude Code, Cursor, Windsurf, and others — long-term memory and change-impact awareness for your codebase.

It runs **entirely on your machine**, uses **zero external services by default**, and persists a semantic index of your project in a local SQLite database.

---

## What it does

**`contextgraph` MCP server** — semantic memory across sessions:
- `search_context` — find relevant code chunks by meaning, not just text match
- `set_context` — tell the agent what file/function you are working on
- `start_task` — begin a tracked work session with a goal
- `save_learning` — persist insights that survive across sessions
- `recall` — surface stored learnings relevant to current work
- `audit_memories` — prune stale memories automatically
- `save_checkpoint` / `get_checkpoint` — snapshot and resume task state
- `index_project` — build the semantic index over your project files

**`blastradius` MCP server** — dependency impact analysis:
- `analyze_impact` — show all dependents of a file, depth, and risk score
- `safe_to_change` — quick JSON risk assessment for a given file
- `rebuild_graph` — refresh the dependency graph after large refactors

---

## Quickstart

### 1. Install

```bash
# Requires Bun (https://bun.sh)
git clone https://github.com/your-org/contextgraph.git
cd contextgraph
bun install
bun run build
bun link   # makes `ctx` available globally
```

### 2. Start the MCP servers

```bash
ctx start
```

This launches both servers in the background:
- `contextgraph` on `http://localhost:3841`
- `blastradius` on `http://localhost:3842`

Check they are running:

```bash
ctx status
```

### 3. Register with your editor

**Cursor / Windsurf / other editors (HTTP transport — recommended):**

```bash
ctx register --http
```

This writes entries to `~/.cursor/mcp.json` (and `~/.claude/claude_desktop_config.json`).

**Claude Code (stdio transport — editor manages the process):**

```bash
ctx register
```

Restart your editor. The MCP servers will appear in the tools panel.

### 4. Index your project

Open a chat with your AI agent and run:

```
Use the index_project tool to index this codebase.
```

You're ready to go.

---

## Installation options

### Option A: Global CLI (recommended)

```bash
bun install --global .   # from the repo root
```

### Option B: Run directly

```bash
# stdio (editor spawns the process)
bun run packages/mcp-contextgraph/src/index.ts
bun run packages/mcp-blastradius/src/index.ts

# HTTP (long-running, shared across editors)
bun run packages/mcp-contextgraph/src/http.ts
bun run packages/mcp-blastradius/src/http.ts
```

### Option C: npx/bunx (no install)

```bash
bunx contextgraph start
```

---

## Configuration

All configuration is done via environment variables — no config files needed.

| Variable | Default | Description |
|---|---|---|
| `PROJECT_ROOT` | `process.cwd()` | Root of the project to index |
| `PORT` | `3841` / `3842` | HTTP server port |
| `EMBEDDING_BACKEND` | `local` | `local` \| `ollama` \| `openai` |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `nomic-embed-text` | Ollama embedding model |
| `OPENAI_API_KEY` | _(unset)_ | If set, switches backend to `openai` automatically |

### Embedding backends

**Local (default)** — zero setup, zero cost, works offline. Uses deterministic Random Projection of TF-IDF vectors (256-dim). Semantic similarity is meaningful within a project but not cross-project.

**Ollama** — higher quality embeddings with a local model:

```bash
# Install Ollama: https://ollama.com
ollama pull nomic-embed-text
EMBEDDING_BACKEND=ollama ctx start
```

**OpenAI** — best quality, requires API key:

```bash
OPENAI_API_KEY=sk-... ctx start
```

---

## Editor setup

### Cursor

After `ctx start && ctx register --http`, open **Cursor Settings → MCP**. You should see `contextgraph` and `blastradius` listed. If not, restart Cursor.

Manual config in `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "contextgraph": {
      "url": "http://localhost:3841/mcp"
    },
    "blastradius": {
      "url": "http://localhost:3842/mcp"
    }
  }
}
```

### Claude Code (CLI)

```bash
ctx register   # writes stdio config to ~/.claude/claude_desktop_config.json
```

Or add manually to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "contextgraph": {
      "command": "bun",
      "args": ["run", "/path/to/contextgraph/packages/mcp-contextgraph/src/index.ts"],
      "env": { "PROJECT_ROOT": "/your/project" }
    },
    "blastradius": {
      "command": "bun",
      "args": ["run", "/path/to/contextgraph/packages/mcp-blastradius/src/index.ts"],
      "env": { "PROJECT_ROOT": "/your/project" }
    }
  }
}
```

### Windsurf / other MCP-compatible editors

Use the HTTP config (same as Cursor above). Any editor that supports the MCP HTTP transport will work.

---

## CLI reference

```
ctx start              Start both MCP servers in the background
ctx stop               Stop both MCP servers
ctx status             Show server status and index statistics
ctx register           Write stdio MCP config for Claude Code
ctx register --http    Write HTTP MCP config for Cursor / Windsurf
ctx index [path]       Index a project (default: current directory)
```

---

## Architecture

```
┌─────────────────────────────────────────────┐
│              Your Editor / Agent             │
│         (Claude Code, Cursor, etc.)          │
└──────────────┬───────────────┬──────────────┘
               │ MCP           │ MCP
    ┌──────────▼───────┐  ┌────▼────────────┐
    │  contextgraph    │  │   blastradius   │
    │  :3841 (HTTP)    │  │   :3842 (HTTP)  │
    │  or stdio        │  │   or stdio      │
    └──────────┬───────┘  └────┬────────────┘
               │               │
               └───────┬───────┘
                       │
              ┌────────▼────────┐
              │  ContextGraph   │
              │      core       │
              │                 │
              │  SQLite index   │
              │  .contextgraph/ │
              │  index.sqlite   │
              └─────────────────┘
```

### How the index works

1. **Parse** — TypeScript/JavaScript files are parsed with a full AST (via `@typescript-eslint/typescript-estree`). Python and Markdown use regex chunkers. Each function, class, interface, and section becomes a chunk.

2. **Embed** — chunks are embedded using the configured backend (local Random Projection by default). Embeddings are stored in SQLite alongside the chunks.

3. **Graph** — imports between files are traced (with tsconfig path alias resolution and barrel export following) to build a dependency graph stored in the `graph_edges` table.

4. **Score** — at query time, results are ranked by a three-signal score:
   - Semantic similarity (cosine, 65%)
   - Structural proximity in the dependency graph (20%)
   - Recency of last file modification (15%)
   - BM25 re-ranking pass on top candidates
   - Feedback boost from `expand_chunk` interactions

5. **Remember** — learnings, task goals, and checkpoints are stored in the `memories` table and recalled via embedding similarity. Stale memories are flagged by `audit_memories`.

---

## Example interactions

After setup, you can talk to your AI agent naturally:

```
# Start a task
"Start a task: implement rate limiting for the /api/auth endpoint"

# Check before changing a core file
"Before I change packages/core/src/scorer.ts, analyze its blast radius"

# Search for context
"Search for how authentication tokens are validated"

# Save a learning
"Save this learning: the graph distance BFS uses bidirectional search to cap at maxHops=6"

# Resume after a break
"Get the latest checkpoint and summarize what we were working on"
```

See [`examples/`](examples/) for full scenario walkthroughs.

---

## Development

```bash
bun install
bun test packages/core/src/__tests__/   # run all 118 tests
bun run build                            # build all packages
```

The monorepo uses Bun workspaces:

```
packages/
  core/            shared logic (indexing, scoring, graph, memory)
  mcp-contextgraph/  context + memory MCP server
  mcp-blastradius/   blast radius MCP server
  cli/             ctx command-line tool
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

[MIT](LICENSE) — © 2024 ContextGraph contributors
