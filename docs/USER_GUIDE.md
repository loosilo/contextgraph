# ContextGraph User Guide

This guide walks you through setting up ContextGraph as MCP servers and using them effectively with your AI coding agent.

## Prerequisites

- [Bun](https://bun.sh) v1.0 or later
- An MCP-compatible editor: Claude Code, Cursor, Windsurf, or similar

No API keys required. Everything runs locally.

---

## Part 1: Installation

### Install from source

```bash
git clone https://github.com/your-org/contextgraph.git
cd contextgraph
bun install
bun run build
```

Make the `ctx` CLI globally available:

```bash
bun link
```

Verify:

```bash
ctx --help
```

---

## Part 2: Starting the servers

ContextGraph runs as two separate MCP servers:

| Server | Port | Purpose |
|---|---|---|
| `contextgraph` | 3841 | Semantic search, memory, checkpoints |
| `blastradius` | 3842 | Dependency impact analysis |

### Start in the background

```bash
ctx start
```

The servers will start detached and persist across terminal sessions.

```
[contextgraph] HTTP MCP server listening on http://localhost:3841/mcp
[blastradius]  HTTP MCP server listening on http://localhost:3842/mcp
```

### Check status

```bash
ctx status
```

Sample output:

```
contextgraph  RUNNING  pid 12345  http://localhost:3841
blastradius   RUNNING  pid 12346  http://localhost:3842

Index stats:
  Chunks indexed:  1,240
  Memories stored: 18
  Files tracked:   87
```

### Stop the servers

```bash
ctx stop
```

### Using a different project root

By default the servers index `$PWD`. To point them at a specific project:

```bash
PROJECT_ROOT=/path/to/my/project ctx start
```

---

## Part 3: Connecting to your editor

### Cursor

1. Run `ctx start` (if not already running)
2. Run `ctx register --http`
3. Restart Cursor
4. Go to **Settings → Features → MCP** — both servers should appear

To verify manually, check `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "contextgraph": { "url": "http://localhost:3841/mcp" },
    "blastradius":  { "url": "http://localhost:3842/mcp" }
  }
}
```

### Claude Code (CLI)

Claude Code can use MCP servers via stdio transport (it manages the process lifecycle):

```bash
ctx register
```

This writes to `~/.claude/claude_desktop_config.json`. Restart Claude Code. You should see both tools available in the session.

Alternatively, you can configure HTTP transport in Claude Code using the same `url` format as Cursor.

### Windsurf

Add to your Windsurf MCP config file (usually `~/.codeium/windsurf/mcp_config.json`):

```json
{
  "mcpServers": {
    "contextgraph": { "url": "http://localhost:3841/mcp" },
    "blastradius":  { "url": "http://localhost:3842/mcp" }
  }
}
```

Then restart Windsurf.

### Manual / other editors

Any editor that supports the MCP HTTP transport (streamable HTTP, MCP SDK 1.x) can connect using:

```
POST http://localhost:3841/mcp   (contextgraph tools)
POST http://localhost:3842/mcp   (blastradius tools)
```

---

## Part 4: Indexing your project

Before you can search or analyze your code, you need to build the index.

### Via the agent

Open a chat in your editor and ask:

```
Use the index_project tool to index this codebase.
```

The agent will call `index_project` with the configured `PROJECT_ROOT` and report back how many files were indexed.

### Via the CLI

```bash
ctx index /path/to/your/project
```

### Re-indexing

The index is incremental. Run `index_project` again at any time — only changed files are re-processed. For a full rebuild after a large refactor, you can delete `.contextgraph/index.sqlite` and re-run.

---

## Part 5: Using the tools

### `search_context` — find relevant code

```
Search for how the authentication middleware validates tokens
```

The agent translates your natural language into an embedding query, retrieves semantically similar chunks, and returns them ranked by relevance. Results improve as you use `expand_chunk` to signal which results were useful.

**Parameters:**
- `query` — what to look for (natural language)
- `limit` — number of results (default: 10)
- `contextFile` — if provided, boosts results from files near this file in the dependency graph

### `set_context` — tell the agent your focus

```
Set context: I'm working in packages/core/src/scorer.ts
```

This seeds the structural scoring signal so that search results favor code that is close (in the import graph) to your current file.

### `start_task` — begin a tracked session

```
Start a task: refactor the scoring pipeline to support pluggable rankers
```

Records a goal in the memory store. Use `get_checkpoint` later to recall where you left off.

### `save_learning` — persist insights

```
Save this learning: the BM25 reranker uses k1=1.5, b=0.75 — don't change these without benchmarking
```

Learnings are stored with embeddings and recalled automatically when you ask questions related to the same topic.

### `recall` — surface stored knowledge

```
What do we know about the embedding pipeline?
```

The agent calls `recall` with an embedding of your question and returns the most relevant stored learnings.

### `audit_memories` — prune stale knowledge

```
Audit memories and mark any that are no longer relevant to the current codebase
```

Checks each stored learning against the current index. Marks memories as stale if they no longer match any code with a cosine similarity above 0.4.

### `save_checkpoint` / `get_checkpoint` — session state

At the end of a long session:

```
Save a checkpoint summarizing what we did and what's left to do
```

At the start of the next session:

```
Get the latest checkpoint and remind me where we left off
```

### `analyze_impact` — blast radius before a change

```
Before I modify packages/core/src/graph.ts, analyze its blast radius
```

Returns:
- Direct dependents (depth 1)
- Transitive dependents (depth 2+)
- Test files affected
- Risk score (low / medium / high / critical)

### `safe_to_change` — quick risk check

```json
{
  "file": "packages/core/src/db.ts",
  "risk": "high",
  "score": 72,
  "affected": 23,
  "direct": 5
}
```

### `rebuild_graph` — after large refactors

```
Rebuild the dependency graph
```

Re-traces all imports from scratch. Useful after moving files, renaming modules, or updating tsconfig path aliases.

---

## Part 6: Embedding backends

### Local (default)

No setup needed. Uses a deterministic Random Projection algorithm over TF-IDF bag-of-words (256 dimensions). Results are meaningful within a single project and require no network access.

### Ollama (recommended for quality)

```bash
# Install Ollama: https://ollama.com
ollama pull nomic-embed-text
EMBEDDING_BACKEND=ollama ctx start
```

`nomic-embed-text` produces significantly better semantic similarity than the local backend. Recommended if you can run Ollama.

### OpenAI

```bash
OPENAI_API_KEY=sk-... ctx start
```

When `OPENAI_API_KEY` is present in the environment, ContextGraph automatically switches to `text-embedding-3-small`. Override with `EMBEDDING_BACKEND=local` to force local even when the key is set.

---

## Part 7: Data and privacy

All data is stored locally in `.contextgraph/index.sqlite` inside your project directory (or the directory configured via `PROJECT_ROOT`). Nothing is sent to any external service unless you configure `EMBEDDING_BACKEND=openai`.

The SQLite database contains:
- Code chunks (text, file path, line numbers)
- Embedding vectors
- File metadata (mtime, size)
- Dependency graph edges
- Memories and learnings
- Session checkpoints
- Query interaction logs (for feedback boost)

You can inspect or delete the database at any time:

```bash
# View stats
sqlite3 .contextgraph/index.sqlite "SELECT count(*) FROM chunks;"

# Delete everything and start fresh
rm .contextgraph/index.sqlite
```

---

## Part 8: Troubleshooting

### Servers won't start

Check if the ports are already in use:

```bash
lsof -i :3841
lsof -i :3842
```

If something else is using those ports, stop it or use different ports:

```bash
PORT=4841 ctx start   # only changes contextgraph port — set BLASTRADIUS_PORT separately
```

### Tools not appearing in editor

1. Confirm servers are running: `ctx status`
2. Confirm config was written: `cat ~/.cursor/mcp.json`
3. Restart the editor (many MCP clients only load config on startup)
4. Check the editor's MCP/tools panel for error messages

### Search returns poor results

1. Make sure the project is indexed: ask the agent to run `index_project`
2. Try `set_context` to anchor results to your current file
3. If using the local backend, consider switching to Ollama for better embeddings

### Stale dependencies in blast radius

Run `rebuild_graph` after:
- Moving or renaming files
- Changing tsconfig `paths` aliases
- Adding new barrel exports (`index.ts` files)

---

## Part 9: Uninstalling

```bash
ctx stop
bun unlink   # remove the global ctx command
rm -rf /path/to/contextgraph   # remove the repository

# Remove editor configs (optional)
# ~/.cursor/mcp.json — remove the contextgraph and blastradius entries
# ~/.claude/claude_desktop_config.json — same
```
