# Scenario 01 — First Session on a New Project

**Situation:** You've just cloned a repo you've never seen before and opened it in Cursor or Claude Code.

---

## Step 0: One-time setup (if not done already)

```bash
# Install ContextGraph and start the MCP servers
cd /path/to/contextgraph
bun install && bun run build && bun link

# Start both servers in the background
ctx start

# Register with your editor
ctx register --http   # Cursor / Windsurf
# or
ctx register          # Claude Code (stdio)
```

Restart your editor. The `contextgraph` and `blastradius` tools are now available in every session.

---

## Step 1: Index the project

Navigate to the project you want to work on and index it:

```bash
cd /path/to/my-project
PROJECT_ROOT=$(pwd) ctx index .
# Indexing /path/to/my-project...
# ✓ Indexed 142 files, 891 chunks
```

Or ask your agent directly:

```
Use the index_project tool to index this codebase.
```

---

## Step 2: Check what's been indexed

**Your prompt:**
```
What's the current index status for this project?
```

**Agent uses:** `index_project` (or you can just run `ctx status` in the terminal)

**Terminal:**
```
ContextGraph Status
  Files indexed : 142
  Chunks        : 891
  Graph edges   : 437
  Memories      : 0
  Index path    : /my-project/.contextgraph/index.sqlite
```

---

## Step 3: First search — get oriented

**Your prompt:**
```
I'm new to this codebase. Give me an overview of how user authentication works.
```

**Agent calls:** `search_context("user authentication login session", topK: 8, density: "thorough")`

**Tool returns:**
```markdown
# Context for: user authentication login session

## High Relevance

### src/auth/middleware.ts:14 — authenticate [full] (score: 0.91)
```ts
export function authenticate(authHeader: string | undefined): AuthContext {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing or malformed Authorization header");
  }
  const token = authHeader.slice(7);
  const session = getSession(token);
  if (!session) throw new UnauthorizedError("Session expired or invalid");
  return { userId: session.userId, sessionId: session.id };
}
```

### src/auth/session.ts:18 — createSession [full] (score: 0.87)
```ts
export function createSession(userId: string): Session {
  const token = generateToken(64);
  const session: Session = {
    id: sha256(token).slice(0, 16),
    userId,
    token,
    expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000),
    createdAt: new Date(),
  };
  store.set(token, session);
  return session;
}
```

## Medium Relevance

### src/users/repository.ts:1 — module [summary] (score: 0.58)
import { isEmail, isUUID } from "../utils/validate.js";
  // ... 52 lines total (chunk_id: src/users/repository.ts::module)

---
*~420 tokens | 6 chunks | density: thorough*
```

**Agent's response:**
> Authentication is Bearer-token based. The flow:
> 1. `createSession(userId)` generates a 64-char random token, stores it in an in-memory Map with a 24h TTL
> 2. `authenticate(header)` extracts the token from `Authorization: Bearer <token>`, looks it up, and returns `{ userId, sessionId }`
> 3. Sessions are **in-memory only** — they don't survive server restarts
>
> I'd suggest checking `src/auth/password.ts` for how passwords are hashed before login.

---

## Tips for first sessions

- Use `density: "thorough"` when exploring — it keeps more chunks visible
- Ask broad orientation questions first, then drill into specifics
- If the agent references a function you can't see, ask it to call `expand_chunk("<chunk_id>")`
