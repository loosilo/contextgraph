# ContextGraph

> Long-term memory and change-impact analysis for AI coding agents — runs entirely on your machine, no API keys required.

[![npm](https://img.shields.io/npm/v/@loosilo/contextgraph-cli)](https://www.npmjs.com/package/@loosilo/contextgraph-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/protocol-MCP-purple)](https://modelcontextprotocol.io)

ContextGraph gives AI agents in **Claude Code**, **Cursor**, and other MCP-compatible editors two superpowers:

- **Semantic memory** — search your codebase by meaning, persist learnings across sessions, resume tasks from where you left off
- **Blast radius analysis** — before touching any file, know exactly what depends on it and how risky the change is

Everything is stored locally in a SQLite database (`.contextgraph/index.sqlite`). Nothing leaves your machine unless you opt into OpenAI embeddings.

---

## Install

Requires [Bun](https://bun.sh).

```bash
bunx @loosilo/contextgraph-cli setup
```

Or install globally to get the `ctx` command:

```bash
bun install -g @loosilo/contextgraph-cli
ctx setup
```

`ctx setup` walks you through indexing your project and registering the MCP servers with your editor.

---

## Setup for Claude Code

### Automatic (recommended)

```bash
ctx register
```

This writes the MCP server config to `~/.claude/claude_desktop_config.json`. Restart Claude Code and the tools will be available immediately.

### Manual

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "contextgraph": {
      "command": "bunx",
      "args": ["@loosilo/contextgraph-mcp"],
      "env": {
        "PROJECT_ROOT": "/path/to/your/project"
      }
    },
    "blastradius": {
      "command": "bunx",
      "args": ["@loosilo/blastradius-mcp"],
      "env": {
        "PROJECT_ROOT": "/path/to/your/project"
      }
    }
  }
}
```

### Index your project

In a Claude Code session:

```
index this project
```

Claude will call `index_project` and confirm how many files and chunks were indexed. You only need to do this once — re-indexing is incremental and only processes changed files.

### Using it

After setup, just talk to Claude naturally:

```
start a task: add rate limiting to the /api/auth endpoint
```
```
before I refactor scorer.ts, check its blast radius
```
```
search for how we handle token expiry
```
```
save this learning: auth middleware runs before rate limiting in all routes
```
```
get my last checkpoint — what was I working on?
```

Claude will automatically pick the right tool (`start_task`, `analyze_impact`, `search_context`, `save_learning`, `get_checkpoint`) based on what you ask.

---

## Setup for Cursor

Cursor connects to ContextGraph over HTTP, so the servers need to be running in the background.

### 1. Start the servers

```bash
ctx start
```

This launches both servers:
- `contextgraph` on `http://localhost:3841`
- `blastradius` on `http://localhost:3842`

### 2. Register with Cursor

```bash
ctx register --http
```

This writes to `~/.cursor/mcp.json`. Open **Cursor Settings → MCP** to confirm both servers appear. If not, restart Cursor.

### Manual config

Add to `~/.cursor/mcp.json`:

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

### 3. Index your project

In a Cursor chat:

```
index this project
```

### Using it in Cursor

Same natural language as Claude — Cursor's agent will call the right MCP tools automatically:

```
what files touch the payment flow?
```
```
is it safe to change db.ts right now?
```
```
remember that we decided to keep auth stateless — no sessions
```
```
pick up from my last checkpoint
```

### Keep servers running

Add `ctx start` to your shell profile or system startup so servers are always available when Cursor opens:

```bash
# in ~/.zshrc or ~/.bashrc
ctx start --silent 2>/dev/null
```

---

## CLI reference

```
ctx setup                  Guided setup: index project + register with editors
ctx start                  Start both MCP servers in the background
ctx stop                   Stop both MCP servers
ctx status                 Show server status and index stats
ctx register               Write stdio MCP config (Claude Code)
ctx register --http        Write HTTP MCP config (Cursor / Windsurf)
ctx index [path]           Index or re-index a project
ctx blast <file>           Show blast radius for a file from the terminal
ctx memory list            List all stored learnings
ctx memory recall <topic>  Find learnings relevant to a topic
ctx memory delete <id>     Delete a learning by ID
ctx memory audit           Flag learnings that no longer match any code
ctx checkpoint save <msg>  Save a session snapshot
ctx checkpoint get         Show the latest checkpoint
ctx checkpoint list        List all checkpoints
ctx instructions           Print the recommended system prompt snippet
```

---

## What the tools do

### contextgraph server

| Tool | What to say | What it does |
|---|---|---|
| `start_task` | "start a task: ..." | Recalls relevant memories + pulls code context in one shot |
| `search_context` | "find code related to ..." | Semantic search ranked by meaning, graph proximity, and recency |
| `expand_chunk` | "show me the full implementation of ..." | Fetches a full chunk and logs feedback to improve future results |
| `set_context` | "I'm working on auth.ts" | Boosts search results for files near the current one in the import graph |
| `save_learning` | "remember that ..." | Persists an insight with optional tags, survives across sessions |
| `recall` | "what do we know about ..." | Retrieves learnings by semantic similarity |
| `audit_memories` | "clean up stale memories" | Flags learnings that no longer match any indexed code |
| `save_checkpoint` | "save a checkpoint: ..." | Snapshots open tasks and session summary |
| `get_checkpoint` | "what was I working on?" | Returns the latest checkpoint |
| `index_project` | "index this project" | Crawls and embeds the codebase, only re-processes changed files |

### blastradius server

| Tool | What to say | What it does |
|---|---|---|
| `analyze_impact` | "what depends on X?" / "blast radius of X" | Full dependency tree with depth, test files, and risk score |
| `safe_to_change` | "is it safe to change X?" | Quick JSON: risk level, score (0–100), affected file count |
| `rebuild_graph` | "rebuild the dependency graph" | Re-traces all imports after large refactors or tsconfig changes |

---

## Embedding backends

**Local (default)** — zero setup, works offline. Uses Random Projection TF-IDF (256-dim). Good enough for most projects.

**Ollama** — better quality, still fully local:

```bash
ollama pull nomic-embed-text
EMBEDDING_BACKEND=ollama ctx start
```

**OpenAI** — best quality, requires an API key:

```bash
OPENAI_API_KEY=sk-... ctx start
```

Set `OPENAI_API_KEY` in your environment and ContextGraph switches automatically.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PROJECT_ROOT` | current directory | Project to index |
| `EMBEDDING_BACKEND` | `local` | `local` \| `ollama` \| `openai` |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `nomic-embed-text` | Ollama embedding model |
| `PORT_CG` | `3841` | contextgraph HTTP port |
| `PORT_BR` | `3842` | blastradius HTTP port |

---

## How it works

```
┌─────────────────────────────────────────┐
│         Your Editor / Agent             │
│     (Claude Code, Cursor, etc.)         │
└──────────────┬──────────────┬───────────┘
               │ MCP          │ MCP
    ┌──────────▼──────┐  ┌────▼────────────┐
    │  contextgraph   │  │  blastradius    │
    │  stdio or :3841 │  │  stdio or :3842 │
    └──────────┬──────┘  └────┬────────────┘
               └──────┬───────┘
                      │
             ┌────────▼────────┐
             │  SQLite index   │
             │ .contextgraph/  │
             │  index.sqlite   │
             └─────────────────┘
```

**Indexing:** Files are parsed into semantic chunks (functions, classes, sections). Each chunk is embedded and stored alongside a dependency graph of all imports.

**Search:** Queries are ranked by three signals — semantic similarity (65%), structural proximity in the import graph (20%), and file recency (15%) — then re-ranked with BM25 and boosted by past expand interactions.

**Memory:** Learnings and checkpoints live in SQLite and are recalled by embedding similarity. `audit_memories` flags ones that no longer match any code.

**Blast radius:** Reverse BFS from the target file, collecting dependents at each depth. Risk score factors in dependent count, test file impact, and whether the file is a known core file.

---

## Packages

| Package | Description |
|---|---|
| [`@loosilo/contextgraph-cli`](https://www.npmjs.com/package/@loosilo/contextgraph-cli) | `ctx` CLI — server management, indexing, memory, checkpoints |
| [`@loosilo/contextgraph-mcp`](https://www.npmjs.com/package/@loosilo/contextgraph-mcp) | MCP server for semantic search and memory |
| [`@loosilo/blastradius-mcp`](https://www.npmjs.com/package/@loosilo/blastradius-mcp) | MCP server for dependency impact analysis |
| [`@loosilo/contextgraph-core`](https://www.npmjs.com/package/@loosilo/contextgraph-core) | Core library (indexing, scoring, graph, memory) |

---

## License

[MIT](LICENSE)
