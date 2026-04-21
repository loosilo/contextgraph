# Scenario 06 — Full Workflow

**Situation:** You're starting a non-trivial task on a live codebase. This is the complete ContextGraph workflow from session start to code complete.

**Task:** "Add IP-based rate limiting to the login endpoint."

---

## Step 1: Recall — what do we already know?

Always start a session by checking memory. Past discoveries might change your approach before you read a single file.

**Prompt:**
```
Before I start working on rate limiting, recall anything relevant about auth and sessions.
```

**Agent calls:** `recall("auth session login rate limiting", topK: 3)`

**Returns:**
```markdown
**Relevant memories:**
- [0.91] Sessions are stored in an in-memory Map, not Redis. Any IP-based rate limiting 
  added to the auth layer needs its own store — the session store resets on restart.
  *(auth, session, architecture)*

- [0.74] PASSWORD_SALT env var must be set in production. Default is "dev-salt-change-in-production" 
  which is printed in the README but not enforced at startup.
  *(auth, security, config)*
```

**Agent's response:**
> Heads-up from past sessions: the session store is **in-memory only**. If you implement IP rate limiting using the same in-memory approach, your rate limit counters will reset every time the server restarts. That might be acceptable for a quick implementation, but it's worth knowing before we start.
>
> Shall I pull the relevant code context?

---

## Step 2: Search — get the relevant code

**Prompt:**
```
Yes. Pull context for the login flow and wherever auth middleware sits.
```

**Agent calls:** `search_context("login endpoint auth middleware request handling", topK: 8, density: "balanced")`

**Returns:**
```markdown
## High Relevance

### src/auth/middleware.ts:14 — authenticate [full] (score: 0.92)
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

### src/auth/session.ts:18 — createSession [full] (score: 0.85)
```ts
export function createSession(userId: string): Session {
  const token = generateToken(64);
  ...
}
```

### src/auth/password.ts:6 — hashPassword [full] (score: 0.78)
```ts
export function hashPassword(plaintext: string): string {
  return sha256(`${SALT}:${plaintext}`);
}
```

## Medium Relevance

### src/users/repository.ts:30 — findByEmail [summary] (score: 0.54)
export function findByEmail(email: string): User | null {
  // ... 8 lines total (chunk_id: src/users/repository.ts::findByEmail)

---
*~390 tokens | 5 chunks | density: balanced*
```

**Agent:**
> The login flow isn't a single function — `authenticate()` validates an existing session token, but the actual login (email + password → session) isn't wired up in what I can see. `findByEmail`, `verifyPassword`, and `createSession` exist as building blocks but there's no `login()` function yet.
>
> Rate limiting would go at the HTTP route level, before `authenticate()` is called. Want me to check the blast radius on `middleware.ts` before we add anything there?

---

## Step 3: Blast Radius — is it safe to touch middleware?

**Prompt:**
```
Yes, check the blast radius for auth/middleware.ts.
```

**Agent calls:** `analyze_impact("src/auth/middleware.ts")`

**Returns:**
```markdown
## Blast Radius: `src/auth/middleware.ts`
**Risk: HIGH (40/100)**

**Direct dependents (2):**
- `src/orders/service.ts`
- `src/routes/api.ts`

**Transitive dependents (1):**
- `src/routes/admin.ts` (depth 2)

**Test files affected (1):**
- `src/auth/middleware.test.ts`
```

**Agent:**
> High risk — `middleware.ts` is imported by `orders/service.ts` directly, and indirectly by both API route files. Any change to its public interface (function signatures, thrown error types) will ripple into all of those.
>
> **Safe approach:** Don't modify `authenticate()` itself. Add rate limiting as a separate function `checkRateLimit(ip: string)` in a new file `src/auth/rate-limit.ts`, and call it in the route handler before `authenticate()`. That way `middleware.ts` is untouched and the blast radius is zero.

---

## Step 4: Implement with confidence

**Prompt:**
```
Good plan. Implement checkRateLimit in a new file. In-memory store is fine for now — 
we'll note the restart caveat in memory.
```

**Agent implements** `src/auth/rate-limit.ts`:

```ts
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 10;

interface Window { count: number; resetAt: number }
const windows = new Map<string, Window>();

export class RateLimitError extends Error {
  constructor() { super("Too many login attempts. Try again in 15 minutes."); }
}

export function checkRateLimit(ip: string): void {
  const now = Date.now();
  const win = windows.get(ip);

  if (!win || win.resetAt < now) {
    windows.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  win.count++;
  if (win.count > MAX_ATTEMPTS) throw new RateLimitError();
}

export function resetRateLimit(ip: string): void {
  windows.delete(ip);
}
```

---

## Step 5: Save the learning

**Prompt:**
```
Save a memory: we added rate limiting in src/auth/rate-limit.ts as a separate module.
In-memory store resets on restart — known limitation. Suggest Redis if this becomes production-critical.
Tags: auth, rate-limiting, architecture
```

**Agent calls:** `save_learning("IP rate limiting lives in src/auth/rate-limit.ts (added 2026-04-20). Uses in-memory Map — counters reset on restart. If production traffic requires persistence, replace windows Map with Redis INCR + EXPIRE.", ["auth", "rate-limiting", "architecture"])`

**Returns:**
```
Saved learning (id: 7c3e9d1a-...)
```

---

## The complete session at a glance

| Step | Tool | Why |
|---|---|---|
| Recall | `recall("auth session")` | Surfaced the in-memory store caveat before reading any code |
| Search | `search_context(...)` | Found the right 5 chunks in ~390 tokens |
| Blast radius | `analyze_impact(...)` | Decided *not* to modify `middleware.ts` — zero blast radius |
| Implement | (agent writes code) | New file, no existing code touched |
| Save | `save_learning(...)` | Next session knows where rate limiting lives and its limits |

**Total tokens used for context:** ~390 (vs. reading the 4 relevant files in full: ~3,800 tokens)
