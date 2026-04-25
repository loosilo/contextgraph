# ContextGraph User Guide

## Table of contents

1. [Installation](#1-installation)
2. [Claude Code setup](#2-claude-code-setup)
3. [Cursor setup](#3-cursor-setup)
4. [Indexing your project](#4-indexing-your-project)
5. [Everyday usage](#5-everyday-usage)
6. [Memory and checkpoints](#6-memory-and-checkpoints)
7. [Blast radius](#7-blast-radius)
8. [Embedding backends](#8-embedding-backends)
9. [CLI reference](#9-cli-reference)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Installation

Requires [Bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`).

**Global install (recommended):**

```bash
bun install -g @loosilo/contextgraph-cli
```

This gives you the `ctx` command everywhere. Run `ctx --version` to confirm.

**No-install (try it first):**

```bash
bunx @loosilo/contextgraph-cli <command>
```

---

## 2. Claude Code setup

Claude Code uses **stdio transport** — it spawns the MCP servers as child processes, so you don't need to run anything in the background.

### Automatic

```bash
ctx register
```

This writes MCP server entries to `~/.claude/claude_desktop_config.json`. Claude Code picks up config changes on the next session.

### Manual

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "contextgraph": {
      "command": "bunx",
      "args": ["@loosilo/contextgraph-mcp"],
      "env": {
        "PROJECT_ROOT": "/absolute/path/to/your/project"
      }
    },
    "blastradius": {
      "command": "bunx",
      "args": ["@loosilo/blastradius-mcp"],
      "env": {
        "PROJECT_ROOT": "/absolute/path/to/your/project"
      }
    }
  }
}
```

> **Tip:** If you work across multiple projects, omit `PROJECT_ROOT` and set it per-project using a `.env` file or by passing it at the start of each session.

### Verify

Open a Claude Code session and type:

```
what MCP tools do you have access to?
```

You should see `search_context`, `analyze_impact`, and the rest listed.

---

## 3. Cursor setup

Cursor uses **HTTP transport** — the servers run as background processes and Cursor connects to them over localhost.

### Step 1 — Start the servers

```bash
ctx start
```

Output:

```
contextgraph  started  http://localhost:3841
blastradius   started  http://localhost:3842
```

Check they are running:

```bash
ctx status
```

### Step 2 — Register with Cursor

```bash
ctx register --http
```

This writes to `~/.cursor/mcp.json`. Open **Cursor Settings → MCP** to confirm both servers appear. If they don't show up, restart Cursor.

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

### Keep servers running across reboots

Add `ctx start --silent` to your shell profile:

```bash
# ~/.zshrc or ~/.bashrc
ctx start --silent 2>/dev/null
```

### Verify

In a Cursor chat:

```
what MCP tools do you have?
```

---

## 4. Indexing your project

Before the agent can search your code, it needs to build the index. This only needs to happen once — subsequent calls are incremental and only process changed files.

### From the editor

In Claude Code or Cursor chat:

```
index this project
```

The agent calls `index_project` and reports back:

```
Indexed 142 files, 1 847 chunks.
```

### From the terminal

```bash
ctx index /path/to/project
# or from within the project:
ctx index
```

### What gets indexed

- TypeScript and JavaScript (full AST parsing — functions, classes, interfaces, methods)
- Python (regex chunker — functions, classes)
- Markdown (section chunker — headings)
- All other text files are indexed as a single module chunk

Ignored automatically: `node_modules`, `.git`, `dist`, `build`, `__pycache__`, `*.min.js`, binary files.

### Re-indexing

Run `index_project` or `ctx index` any time after significant changes. It is safe to run repeatedly.

---

## 5. Everyday usage

You don't need to remember tool names. Just talk to the agent and it picks the right tool.

### Starting a task

```
start a task: implement webhook signature verification for Stripe events
```

The agent calls `start_task`, which:
1. Searches for relevant memories from past sessions
2. Pulls the most relevant code chunks
3. Returns everything combined, ready for you to start coding

### Searching for code

```
how does session expiry work in this project?
```
```
find where we validate incoming webhook payloads
```
```
show me anything related to rate limiting
```

These trigger `search_context`. Results are ranked by semantic similarity, import graph proximity to your current file, and recency.

### Telling the agent where you are

When you open a file to edit it:

```
I'm working on src/auth/middleware.ts
```

This calls `set_context`, which boosts search results for files nearby in the import graph — so if you search for "token validation" while working on the auth middleware, results from files that import or are imported by that middleware rank higher.

### Expanding a result

If search returns a summary of a chunk and you want the full code:

```
show me the full implementation of that validateToken function
```

This calls `expand_chunk`, which also logs that you found it relevant — improving future search results for similar queries.

---

## 6. Memory and checkpoints

### Saving a learning

Whenever you discover something important about the codebase, save it:

```
remember that all database writes go through the repository pattern — never direct Prisma calls from controllers
```
```
save this: the auth middleware runs before rate limiting in every route
```
```
note: the payment service uses idempotency keys, always pass one
```

Learnings are stored with embeddings and retrieved automatically in future `start_task` calls when relevant.

### Recalling learnings

```
what do we know about the payment service?
```
```
recall anything about our database conventions
```

### Auditing stale learnings

After a major refactor, some saved learnings may no longer match the code:

```
audit my memories and flag anything stale
```

The agent checks each learning against the current index and marks ones with no matching code as stale.

### Managing from the terminal

```bash
ctx memory list                    # see all learnings
ctx memory recall "rate limiting"  # search by topic
ctx memory delete <id>             # remove a specific one
ctx memory audit                   # flag stale ones
```

### Checkpoints

Save your progress at the end of a session:

```
save a checkpoint: implemented webhook verification, still need to add tests and update the API docs
```

Resume next time:

```
get my last checkpoint
```

From the terminal:

```bash
ctx checkpoint save "added rate limiting to auth routes, tests passing"
ctx checkpoint get
ctx checkpoint list
```

---

## 7. Blast radius

Before changing any file, especially a shared utility or core module, check its blast radius first.

### From the editor

```
what's the blast radius of src/db/client.ts?
```
```
is it safe to change the scorer module?
```
```
analyze the impact of modifying the auth middleware
```

**`analyze_impact`** returns:

```
## Blast Radius: src/db/client.ts
Risk: HIGH (72/100)

Direct dependents (8):
- src/repositories/user.ts
- src/repositories/payment.ts
...

Transitive dependents (23):
- src/controllers/auth.ts (depth 2)
...

Test files affected (4):
- src/__tests__/user.test.ts
...
```

**`safe_to_change`** returns a quick summary:

```json
{ "risk": "high", "score": 72, "affected": 31, "direct": 8 }
```

### From the terminal

```bash
ctx blast src/db/client.ts
```

### After large refactors

If you move files or change `tsconfig.json` path aliases, rebuild the graph:

```
rebuild the dependency graph
```

---

## 8. Embedding backends

### Local (default)

No setup required. Uses Random Projection TF-IDF (256-dim). Semantic similarity works well within a project. Runs fully offline.

### Ollama

Better embedding quality, still fully local:

```bash
# Install Ollama: https://ollama.com
ollama pull nomic-embed-text
EMBEDDING_BACKEND=ollama ctx start
```

### OpenAI

Best quality. Set your API key and ContextGraph switches automatically:

```bash
OPENAI_API_KEY=sk-... ctx start
```

> Switching backends requires re-indexing the project since embeddings are not compatible across backends.

---

## 9. CLI reference

### Server management

| Command | Description |
|---|---|
| `ctx start` | Start both MCP servers in the background |
| `ctx stop` | Stop both servers |
| `ctx status` | Show server status, ports, and index stats |
| `ctx register` | Write stdio MCP config (Claude Code) |
| `ctx register --http` | Write HTTP MCP config (Cursor / Windsurf) |

### Indexing

| Command | Description |
|---|---|
| `ctx index [path]` | Index or re-index a project (default: cwd) |

### Memory

| Command | Description |
|---|---|
| `ctx memory list` | List all stored learnings |
| `ctx memory recall <topic>` | Find learnings by semantic similarity |
| `ctx memory delete <id>` | Delete a learning by ID |
| `ctx memory audit` | Flag learnings that no longer match the code |

### Checkpoints

| Command | Description |
|---|---|
| `ctx checkpoint save <message>` | Save a session snapshot |
| `ctx checkpoint get` | Show the latest checkpoint |
| `ctx checkpoint list` | List all checkpoints |

### Analysis

| Command | Description |
|---|---|
| `ctx blast <file>` | Show blast radius and risk score for a file |

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PROJECT_ROOT` | `cwd` | Project to index |
| `EMBEDDING_BACKEND` | `local` | `local` \| `ollama` \| `openai` |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `nomic-embed-text` | Ollama embedding model |
| `OPENAI_API_KEY` | _(unset)_ | Enables OpenAI backend automatically |
| `PORT_CG` | `3841` | contextgraph HTTP port |
| `PORT_BR` | `3842` | blastradius HTTP port |

---

## 10. Troubleshooting

### MCP tools not appearing in Claude Code

1. Run `ctx register` and check the output for errors
2. Verify `~/.claude/claude_desktop_config.json` contains the `contextgraph` and `blastradius` entries
3. Make sure `bunx` is in your PATH (`which bunx`)
4. Start a new Claude Code session

### MCP tools not appearing in Cursor

1. Confirm servers are running: `ctx status`
2. If not running, start them: `ctx start`
3. Check `~/.cursor/mcp.json` contains the correct URLs
4. Open Cursor Settings → MCP and click the refresh icon
5. Restart Cursor if needed

### Servers fail to start

```bash
ctx status   # check what's already running on those ports
ctx stop     # stop any zombie processes
ctx start    # try again
```

If port 3841 or 3842 is in use, set different ports:

```bash
PORT_CG=4841 PORT_BR=4842 ctx start
PORT_CG=4841 PORT_BR=4842 ctx register --http
```

### Search results are poor quality

1. Make sure the project is indexed: `ctx index`
2. Tell the agent what file you're editing to improve structural ranking
3. Consider switching to Ollama or OpenAI backend for better semantic quality
4. Re-index after adding new files: `ctx index`

### Index is missing new files

Run `ctx index` — it only processes files that changed since last index, so it's fast.

### Stale memories causing confusion

```bash
ctx memory audit
ctx memory list   # review flagged ones
ctx memory delete <id>
```

### Uninstall

```bash
ctx stop
bun remove -g @loosilo/contextgraph-cli
rm -rf /path/to/project/.contextgraph
```

Remove the MCP config entries from `~/.claude/claude_desktop_config.json` and `~/.cursor/mcp.json` manually.
