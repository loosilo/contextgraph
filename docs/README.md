# ContextGraph — Technical Reference

> For setup and usage, see the [User Guide](USER_GUIDE.md) or the [root README](../README.md).

---

## MCP Tools Reference

### contextgraph server (port 3841)

#### `search_context`

Search indexed code for chunks semantically relevant to a task.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `query` | string | required | Natural language query |
| `limit` | number | 10 | Max results |
| `contextFile` | string | — | Boosts results near this file in the dependency graph |

Results are scored by three signals:
- **Semantic** (65%): cosine similarity between query and chunk embeddings
- **Structural** (20%): graph distance from `contextFile` (if provided)
- **Temporal** (15%): recency of last file modification

A BM25 re-ranking pass runs on the top `limit × 3` candidates before final selection. Previously expanded chunks receive a feedback boost (up to +0.15).

---

#### `expand_chunk`

Fetch full content of a chunk by ID.

| Parameter | Type | Description |
|---|---|---|
| `chunk_id` | string | Chunk identifier (format: `filepath::symbolname`) |

Also logs the expansion to `query_log`, which seeds the feedback boost for future searches.

---

#### `set_context`

Set the current working file to anchor structural scoring.

| Parameter | Type | Description |
|---|---|---|
| `file` | string | Path to the file you are working on |

---

#### `start_task`

Record a task goal in memory.

| Parameter | Type | Description |
|---|---|---|
| `goal` | string | What you are trying to accomplish |

---

#### `save_learning`

Persist an insight across sessions.

| Parameter | Type | Description |
|---|---|---|
| `content` | string | The learning to store |
| `tags` | string[] | Optional tags |

---

#### `recall`

Surface stored learnings relevant to a topic.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `topic` | string | required | Topic to search |
| `topK` | number | 5 | Max results |

---

#### `audit_memories`

Mark learnings as stale if they no longer match any code (cosine < 0.4).

No parameters.

---

#### `save_checkpoint`

Snapshot current task state.

| Parameter | Type | Description |
|---|---|---|
| `summary` | string | What is done |
| `openTasks` | string[] | What remains |

Returns a checkpoint UUID.

---

#### `get_checkpoint`

Retrieve the most recent checkpoint.

No parameters.

---

#### `index_project`

Build or refresh the semantic index.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `root` | string | `PROJECT_ROOT` | Directory to index |

---

### blastradius server (port 3842)

#### `analyze_impact`

Full blast radius report.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `file` | string | required | File you are about to change |
| `max_depth` | number | 5 | BFS depth limit |

Returns: direct dependents, transitive dependents, affected test files, risk label, risk score.

---

#### `safe_to_change`

Quick machine-readable risk check.

| Parameter | Type | Description |
|---|---|---|
| `file` | string | File to check |

Returns JSON:
```json
{ "file": "...", "risk": "medium", "score": 24, "affected": 6, "direct": 2 }
```

---

#### `rebuild_graph`

Rebuild dependency graph from scratch. Run after large refactors or tsconfig path changes.

No parameters.

---

## Scoring Details

### Three-signal score

```
base  = semantic × 0.65 + structural × 0.20 + temporal × 0.15
boost = min(0.15, expand_count × 0.02)
score = min(1.0, base + boost)
```

**Structural signal mapping (graph hops):**

| Hops from contextFile | Score |
|---|---|
| 0 (same file) | 1.0 |
| 1 | 0.8 |
| 2 | 0.6 |
| 3 | 0.4 |
| 4+ | 0.0 |
| no contextFile set | 0.5 |

### BM25 re-ranking

After embedding retrieval, a second pass scores candidates using BM25 (k1=1.5, b=0.75). Final rank is a blend:

```
final = 0.7 × embedding_score + 0.3 × normalized_bm25
```

---

## Risk Score Formula

```
score = min(100, direct_dependents × 10 + transitive_dependents × 2)
```

| Score | Label |
|---|---|
| 0–9 | low |
| 10–29 | medium |
| 30–59 | high |
| 60–100 | critical |

---

## Database Schema

All data is stored in `.contextgraph/index.sqlite` (WAL mode).

| Table | Purpose |
|---|---|
| `chunks` | Code chunks with content, embeddings, file path, line numbers |
| `file_meta` | File mtime and size for incremental indexing |
| `memories` | Stored learnings with embeddings and stale flag |
| `graph_edges` | Directed import edges (from → to) |
| `context_state` | Current task goal and context file |
| `query_log` | Expand interactions for feedback scoring |
| `checkpoints` | Task state snapshots |
| `schema_version` | Schema migration tracking |

---

## Embedding Backends

| Backend | Quality | Requires | How to enable |
|---|---|---|---|
| `local` (default) | Good | Nothing | Default |
| `ollama` | Better | Ollama running locally | `EMBEDDING_BACKEND=ollama` |
| `openai` | Best | `OPENAI_API_KEY` | Set the env var |

Auto-detection: if `OPENAI_API_KEY` is set, uses `openai`. Otherwise uses `local`. Override with `EMBEDDING_BACKEND`.

---

## Dependency Graph Resolution

The graph builder resolves imports with full TypeScript support:

1. **Relative imports** — `./foo`, `../bar` resolved relative to the importing file
2. **tsconfig path aliases** — `@/components/*` → `src/components/*` (reads `compilerOptions.paths`)
3. **Barrel exports** — when an import resolves to `index.ts`, one level of re-exports is followed to find the real source file
4. **Extension inference** — tries `.ts`, `.tsx`, `.js`, `.jsx`, `/index.ts` in order

External packages (non-relative imports without a matching alias) are ignored.
