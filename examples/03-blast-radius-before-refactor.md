# Scenario 03 — Blast Radius Before a Refactor

**Situation:** You want to change a shared utility. Before touching it, you check what will break.

---

## The task

> "I want to switch from SHA-256 to bcrypt in `utils/hash.ts`. What's the blast radius?"

---

## Prompt

```
Before I change the hashing function in src/utils/hash.ts, show me the blast radius.
```

**Agent calls:** `analyze_impact("src/utils/hash.ts")`

**Tool returns:**
```markdown
## Blast Radius: `src/utils/hash.ts`
**Risk: HIGH (40/100)**

**Direct dependents (2):**
- `src/auth/password.ts`
- `src/auth/session.ts`

**Transitive dependents (3):**
- `src/users/repository.ts` (depth 2)
- `src/orders/service.ts` (depth 3)
- `src/auth/middleware.ts` (depth 2)

**Test files affected (1):**
- `src/auth/middleware.test.ts`
```

**Agent's response:**
> Changing `hash.ts` has a **HIGH** blast radius. Here's the propagation chain:
>
> - `hash.ts` → `password.ts` (uses `sha256` for password hashing)
> - `hash.ts` → `session.ts` (uses `sha256` to generate the session ID, and `generateToken`)
> - `password.ts` → `users/repository.ts` (used during user creation)
> - `session.ts` + `password.ts` → `auth/middleware.ts` → `orders/service.ts`
>
> **Specific risks:**
> 1. `hashPassword()` in `password.ts` wraps `sha256` directly — swapping to bcrypt changes the call signature (bcrypt is async)
> 2. `createSession()` in `session.ts` uses `sha256` to shorten the session ID — that's unrelated to password security and probably doesn't need changing
> 3. Existing password hashes in the user store will be SHA-256 — you'll need a migration strategy for existing users
>
> **Recommendation:** Only change the password-specific `sha256` call in `password.ts`, not the session ID generation in `session.ts`. Surgical change, smaller blast radius.

---

## Narrower check: is it safe to change just the password module?

**Prompt:**
```
What about just src/auth/password.ts — is that safer?
```

**Agent calls:** `safe_to_change("src/auth/password.ts")`

**Tool returns:**
```json
{ "file": "src/auth/password.ts", "risk": "medium", "score": 20, "affected": 2, "direct": 1 }
```

**Agent's response:**
> `password.ts` has a **MEDIUM** risk score (20/100). Only 1 direct dependent: `src/users/repository.ts` (which calls `hashPassword` during `createUser`). That's a much more contained change.
>
> Go in through `password.ts` rather than `hash.ts` — same outcome for users, half the blast radius.

---

## After the change: rebuild the graph

If the refactor moves functions between files, the graph needs to be rebuilt:

**Prompt:**
```
I've moved the bcrypt logic into a new file. Rebuild the dependency graph.
```

**Agent calls:** `rebuild_graph()`

**Tool returns:**
```
Graph rebuilt for 143 files.
```

---

## When to use this

- Before editing any file imported by more than 2 other files
- Before moving or renaming exported functions
- Before changing function signatures that are used across modules
- As a pre-commit sanity check: `ctx blast <file>` in the terminal
