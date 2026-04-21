# Contributing to ContextGraph

Thanks for your interest in contributing. This document covers how to get the project running locally, how tests work, and the conventions we use.

## Getting started

```bash
git clone https://github.com/your-org/contextgraph.git
cd contextgraph
bun install
```

The project uses Bun workspaces. All packages share the root `node_modules`.

## Project structure

```
packages/
  core/              shared library: indexing, scoring, graph, memory, embeddings
  mcp-contextgraph/  MCP server — context and memory tools
  mcp-blastradius/   MCP server — dependency blast radius tools
  cli/               ctx command-line interface
docs/
examples/
```

## Development workflow

### Build

```bash
bun run build
```

### Run tests

```bash
bun test packages/core/src/__tests__/
```

All 118 tests must pass before opening a PR.

### Run a server locally

```bash
# stdio mode
bun run packages/mcp-contextgraph/src/index.ts

# HTTP mode
PROJECT_ROOT=$(pwd) bun run packages/mcp-contextgraph/src/http.ts
```

### Use the CLI during development

```bash
bun run packages/cli/src/index.ts start
```

## Writing tests

Tests live in `packages/core/src/__tests__/`. We use `bun:test` (Jest-compatible API).

```ts
import { test, expect, mock } from "bun:test";
```

**Rules:**
- Each test file must clean up any SQLite databases it creates (use `:memory:` or temp paths)
- Do not mock the database — tests use real SQLite, which is what caught several production bugs
- Do mock network calls (embeddings HTTP requests) to keep tests fast and offline-capable
- Tests that write `.contextgraph/` directories should write to a `tmp/` path and clean up in `afterAll`

## Conventions

### TypeScript

- Strict mode is on (`tsconfig.json`)
- No `any` without a comment explaining why
- Prefer named exports over default exports
- Module resolution: `"moduleResolution": "Bundler"` — use `.js` extensions in imports

### Commits

Use conventional commits:

```
feat: add support for Python class methods in parser
fix: prevent graph BFS from visiting same node twice at different depths
docs: add Windsurf setup instructions
test: cover BM25 edge case with empty corpus
refactor: extract embedding backend selection to factory function
```

### Pull requests

- One logical change per PR
- Include tests for new behavior
- Update `docs/` if you change user-visible behavior
- Run `bun test` before pushing

## Adding a new MCP tool

1. Add the tool to the relevant `server.ts` factory (`mcp-contextgraph` or `mcp-blastradius`)
2. Add the underlying logic to `packages/core/src/` if it involves indexing or storage
3. Write tests for the core logic
4. Document the tool in `docs/USER_GUIDE.md` under "Part 5: Using the tools"
5. Add an example usage to the relevant file in `examples/`

## Adding a new embedding backend

1. Add a new branch in `packages/core/src/embeddings.ts` `embed()` function
2. Document the new `EMBEDDING_BACKEND` value in `README.md` under "Configuration"
3. Add a test in `__tests__/embeddings.test.ts`

## Reporting bugs

Open an issue at https://github.com/your-org/contextgraph/issues with:
- Bun version (`bun --version`)
- OS and version
- Steps to reproduce
- Expected vs. actual behavior
- Relevant logs from `ctx status` or server stderr

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
