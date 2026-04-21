# Testing Guide

## Running tests

```bash
# All tests
bun test

# Specific package
bun test packages/core/src/__tests__/

# Specific file
bun test packages/core/src/__tests__/parser.test.ts

# Watch mode (re-runs on file change)
bun test --watch packages/core/src/__tests__/

# With coverage
bun test --coverage
```

---

## Test structure

```
packages/core/src/__tests__/
├── db.test.ts          Database schema, migrations, WAL mode
├── embeddings.test.ts  Cosine similarity, serialization (no API calls)
├── parser.test.ts      AST chunking for TS/JS/Python/Markdown
├── compress.test.ts    Compression tiers, density presets, rendering
├── graph.test.ts       Import extraction, BFS traversal, risk scoring
└── memory.test.ts      Save/recall/delete cycle (embeddings mocked)
```

---

## What each test file covers

### `embeddings.test.ts` — pure math, always fast

Tests the vector math functions that work on any numeric arrays. No API key needed, no network.

- `cosineSimilarity`: identical = 1, orthogonal = 0, opposite = -1, zero vector = 0 (no NaN), mismatched lengths = 0
- `serializeEmbedding` / `deserializeEmbedding`: round-trip correctness, precision on 1536-dim vectors

Run these first when debugging — if these fail, nothing else will work.

---

### `parser.test.ts` — file system, always fast

Creates real temporary files in `/tmp/contextgraph-test-parser/` and parses them. Tests every supported language.

**TypeScript/JavaScript:**
- Named functions, classes, arrow const functions are extracted
- Files with no top-level declarations fall back to a single `module` chunk
- Chunk IDs are unique within a file
- Start/end line numbers are positive integers

**Python:**
- `def` and `async def` are extracted
- `class` declarations are extracted

**Markdown:**
- H1/H2/H3 headings split the file into sections
- Files with no headings fall back to a single chunk

**Edge cases:**
- Unknown extensions → single module chunk
- Unreadable/nonexistent files → empty array (no throw)

---

### `compress.test.ts` — pure logic, always fast

No file system or network access. Uses hardcoded `ScoredChunk` objects.

**What's tested:**
- Score 0.9 → `full` tier (content included as-is)
- Score 0.5 → `summary` tier (includes `chunk_id` for `expand_chunk`)
- Score 0.2 → `stub` tier (first line + `chunk_id`)
- Score 0.05 → dropped (not in output)
- `thorough` preset passes more chunks at `full` than `minimal` preset
- All 5 density presets don't throw
- `renderContext` groups chunks into High/Medium/Low sections in the right order

**Key invariant tested:** every summary and stub includes a `chunk_id` so agents can call `expand_chunk` to get the full content.

---

### `graph.test.ts` — file system + SQLite

Creates a small dependency tree in `/tmp/contextgraph-test-graph/`:

```
utils.ts  ←  auth.ts  ←  api.ts  ←  index.ts
                               ←  api.test.ts
```

**What's tested:**
- `buildGraph` builds edges without throwing
- Edges are persisted to SQLite
- Rebuilding clears old edges (idempotent)
- `analyzeImpact` on `utils.ts` finds downstream dependents
- `auth.ts` is correctly identified as depth-1 dependent of `utils.ts`
- Test files (`api.test.ts`) are flagged with `isTest: true`
- Leaf nodes (no dependents) return empty impact list
- `maxDepth` parameter limits BFS traversal
- `computeRiskScore` returns correct labels for each score range

---

### `memory.test.ts` — SQLite, embeddings mocked

Embeddings are mocked via `mock.module` so no `OPENAI_API_KEY` is needed. The mock uses a deterministic hash so recall results are still ordered (not random).

**What's tested:**
- `saveLearning` returns a UUID
- Saved memory appears in `listMemories`
- Tags are stored and returned correctly
- Multiple memories get different IDs
- `recallLearnings` returns results sorted by score descending
- `topK` is respected
- `deleteMemory` returns `true` on success, `false` for missing ID
- Deleted memory no longer appears in the list

---

### `db.test.ts` — SQLite schema

**What's tested:**
- Database file is created at the given path
- Same path returns the same instance (path-keyed cache)
- All four tables exist after migration: `chunks`, `file_meta`, `memories`, `graph_edges`
- `chunks` table has the required columns
- WAL mode is enabled (`PRAGMA journal_mode = wal`)
- Migration SQL is idempotent (`CREATE TABLE IF NOT EXISTS` is safe to run twice)

---

## Testing with a real OpenAI key

By default, `memory.test.ts` mocks embeddings. To run with real embeddings:

```bash
OPENAI_API_KEY=sk-... bun test packages/core/src/__tests__/memory.test.ts
```

Note: you'll need to remove or bypass the `mock.module` call in that file, or write a separate integration test.

To test the full `search_context` pipeline with real embeddings:

```bash
# 1. Index the project with real embeddings
OPENAI_API_KEY=sk-... bun run packages/cli/src/index.ts index .

# 2. Verify chunks have embeddings (should be > 0)
bun run packages/cli/src/index.ts status

# 3. Start the MCP server and test manually
OPENAI_API_KEY=sk-... PROJECT_ROOT=$(pwd) bun run packages/mcp-contextgraph/src/index.ts
```

---

## Testing the MCP servers manually

The MCP servers communicate over stdio. You can test them with `mcp-inspector` or by sending raw JSON:

```bash
# Install MCP inspector
bunx @modelcontextprotocol/inspector bun packages/mcp-contextgraph/src/index.ts
```

This opens a browser UI where you can invoke each tool and inspect the response.

Alternatively, test via Claude Code once registered:

```bash
ctx register
# Then in Claude Code, type:
# search_context("how does X work")
```

---

## Testing the CLI

```bash
# All commands can be tested directly with bun
bun run packages/cli/src/index.ts --help
bun run packages/cli/src/index.ts index .
bun run packages/cli/src/index.ts status
bun run packages/cli/src/index.ts memory list
bun run packages/cli/src/index.ts blast packages/core/src/db.ts
```

---

## Adding new tests

Tests live in `packages/core/src/__tests__/`. The pattern is:

```ts
import { test, expect, describe, beforeAll, afterAll } from "bun:test";

const TMP = "/tmp/contextgraph-test-myfeature";
beforeAll(() => mkdirSync(TMP, { recursive: true }));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("myFunction", () => {
  test("does the thing", () => {
    expect(myFunction()).toBe(expectedValue);
  });
});
```

**Rules:**
- Each test file uses its own `/tmp/contextgraph-test-<name>/` directory to avoid cross-file SQLite conflicts
- Tear down in `afterAll` so failed runs don't leave stale state
- Mock embeddings in any test that would otherwise need `OPENAI_API_KEY`
- Don't test network calls — test the logic around them

---

## CI

Add to your CI pipeline:

```yaml
- name: Install Bun
  run: curl -fsSL https://bun.sh/install | bash

- name: Install dependencies
  run: bun install

- name: Test
  run: bun test
  # No OPENAI_API_KEY needed — tests use mocked/local embeddings
```

All tests pass without any API keys because:
- Embedding tests use pure math
- Memory tests mock the embedding module
- Graph/parser/db/compress tests have no network calls at all
