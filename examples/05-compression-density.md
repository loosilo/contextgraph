# Scenario 05 — Controlling Compression Density

**Situation:** You want to tune how much context fits in the window — more detail for deep dives, less for quick checks.

---

## The 5 presets

| Preset | Use when | Token budget |
|---|---|---|
| `minimal` | You just need the function signatures to check if something exists | ~50–150 tokens |
| `sparse` | Quick scan — names and first lines | ~150–300 tokens |
| `balanced` | Default — good signal/token tradeoff | ~300–600 tokens |
| `detailed` | You're actively implementing and need full context around your target | ~600–1200 tokens |
| `thorough` | Exploring unfamiliar code, debugging, or the codebase is small enough | ~1000–3000 tokens |

---

## Example: Same query, different densities

**Query:** "how does session expiry and invalidation work"

---

### `minimal` — just the signatures

**Prompt:**
```
search_context("session expiry invalidation", density: "minimal")
```

**Returns:**
```markdown
# Context for: session expiry invalidation

## High Relevance

### src/auth/session.ts:32 — getSession [stub] (score: 0.89)
export function getSession(token: string): Session | null {
  // ... (chunk_id: src/auth/session.ts::getSession)

### src/auth/session.ts:40 — invalidateSession [stub] (score: 0.84)
export function invalidateSession(token: string): void {
  // ... (chunk_id: src/auth/session.ts::invalidateSession)

### src/auth/session.ts:44 — invalidateAllSessions [stub] (score: 0.79)
export function invalidateAllSessions(userId: string): void {
  // ... (chunk_id: src/auth/session.ts::invalidateAllSessions)

---
*~85 tokens | 3 chunks | density: minimal*
```

Good for: "Does an invalidateAllSessions function exist?" — yes, ~85 tokens, done.

---

### `balanced` — default

**Prompt:**
```
search_context("session expiry invalidation", density: "balanced")
```

**Returns:**
```markdown
# Context for: session expiry invalidation

## High Relevance

### src/auth/session.ts:32 — getSession [full] (score: 0.89)
```ts
export function getSession(token: string): Session | null {
  const session = store.get(token);
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    store.delete(token);
    return null;
  }
  return session;
}
```

### src/auth/session.ts:40 — invalidateSession [full] (score: 0.84)
```ts
export function invalidateSession(token: string): void {
  store.delete(token);
}
```

## Medium Relevance

### src/auth/session.ts:44 — invalidateAllSessions [summary] (score: 0.57)
export function invalidateAllSessions(userId: string): void {
  // ... 4 lines total (chunk_id: src/auth/session.ts::invalidateAllSessions)

---
*~280 tokens | 3 chunks | density: balanced*
```

Good for: actively implementing logout or session cleanup logic.

---

### `thorough` — everything visible

**Prompt:**
```
search_context("session expiry invalidation", density: "thorough")
```

**Returns:** All chunks at `full` tier including `createSession`, the `Session` interface, and the `store` definition — enough to understand the entire session lifecycle in one shot.

```
---
*~820 tokens | 7 chunks | density: thorough*
```

Good for: "Explain the entire session system" or debugging a subtle expiry bug.

---

## Expanding a stub on demand

When you get a stub at `minimal` or `sparse` density and need the full body:

**Prompt:**
```
Expand invalidateAllSessions.
```

**Agent calls:** `expand_chunk("src/auth/session.ts::invalidateAllSessions")`

**Returns:**
```ts
export function invalidateAllSessions(userId: string): void {
  for (const [token, session] of store.entries()) {
    if (session.userId === userId) store.delete(token);
  }
}
```

This is "progressive depth" — you pay for tokens only when you actually need them.

---

## Practical guide: which preset to pick

```
What are the function signatures in the auth module?
→ minimal

Give me a quick overview of how orders are processed.
→ sparse or balanced

I'm implementing the cancel order feature — give me the context I need.
→ balanced (default)

I'm debugging why sessions aren't expiring correctly.
→ detailed or thorough

I'm exploring a service I've never seen before.
→ thorough
```

---

## Token savings reference

For a typical search returning 10 chunks from a mid-size codebase:

| Preset | Approx tokens | vs. uncompressed |
|---|---|---|
| minimal | ~100 | ~20× smaller |
| sparse | ~250 | ~8× smaller |
| balanced | ~450 | ~5× smaller |
| detailed | ~900 | ~2.5× smaller |
| thorough | ~1,800 | ~1.3× smaller |
| (no compression) | ~2,500 | baseline |
