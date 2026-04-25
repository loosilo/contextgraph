# Examples

Realistic usage scenarios for ContextGraph MCP tools inside Claude Code, Cursor, or any MCP-compatible agent.

Each scenario shows the prompts you'd type, which MCP tools fire, and what you get back.

---

## Prerequisites

```bash
# 1. Index your project
cograph index .

# 2. Register the MCP servers
cograph register

# 3. Restart your editor (Claude Code / Cursor)
```

---

## Scenarios

| File | What it demonstrates |
|---|---|
| [01-first-session.md](./01-first-session.md) | Setting up on a new project, first search |
| [02-pull-context-before-coding.md](./02-pull-context-before-coding.md) | Starting a task by pulling relevant context |
| [03-blast-radius-before-refactor.md](./03-blast-radius-before-refactor.md) | Checking impact before touching a shared file |
| [04-cross-session-memory.md](./04-cross-session-memory.md) | Saving discoveries and recalling them next session |
| [05-compression-density.md](./05-compression-density.md) | Controlling how much context fits in the window |
| [06-full-workflow.md](./06-full-workflow.md) | End-to-end: recall → search → blast check → save |

The `sample-app/` directory is a small TypeScript e-commerce API used in several scenarios to show realistic output.
