# Scenario 04 — Cross-Session Memory

**Situation:** You discovered something important in Session 1. Session 2 starts cold — but the agent remembers.

---

## Session 1: Discovery

You're debugging why orders are occasionally overselling on high traffic.

**Your prompt:**
```
I think there's a race condition in the order placement. Investigate decrementStock.
```

**Agent searches, reads the code, and finds it:**
> `decrementStock()` in `products/repository.ts` does a read-then-write without any locking:
> ```ts
> if (product.stock < quantity) return false;
> product.stock -= quantity;
> ```
> Under concurrent requests, two threads can both read `stock = 1`, both pass the check, and both decrement — resulting in `stock = -1`. Classic TOCTOU race.

**You prompt the agent to remember this:**
```
Save that finding to memory with tags: products, concurrency, bug
```

**Agent calls:** `save_learning("decrementStock() in products/repository.ts has a TOCTOU race condition under concurrent requests. Two simultaneous calls can both pass the stock check and both decrement, resulting in negative stock. Needs a transaction or atomic compare-and-swap.", ["products", "concurrency", "bug"])`

**Tool returns:**
```
Saved learning (id: f3a1b2c4-...)
```

---

## Session 1 ends. You close your editor.

---

## Session 2: New task, new conversation

You open a fresh session. No conversation history. You start a new task:

**Your prompt:**
```
I need to add a "buy now" button that purchases a single item immediately. 
Start by recalling anything relevant about the ordering system.
```

**Agent calls:** `recall("order purchase product stock inventory", topK: 3)`

**Tool returns:**
```markdown
**Relevant memories:**
- [0.87] decrementStock() in products/repository.ts has a TOCTOU race condition under 
  concurrent requests. Two simultaneous calls can both pass the stock check and both 
  decrement, resulting in negative stock. Needs a transaction or atomic compare-and-swap.
  *(products, concurrency, bug)*

- [0.61] authenticate() in middleware.ts calls getSession() which uses an in-memory Map. 
  Sessions are not persisted across restarts.
  *(auth, session, architecture)*
```

**Agent's response:**
> Before implementing "buy now", here's what we know from past sessions:
>
> ⚠️ **Known bug:** `decrementStock()` has a race condition — if two users click "buy now" simultaneously on the last unit, both could succeed. Your new feature will inherit this bug unless we fix it first.
>
> I'd recommend either fixing the race condition before adding "buy now", or at minimum flagging it as a known limitation. Want me to show you the fix?

**Without memory:** the agent would implement the feature, ship the same bug, and you'd find out in production.  
**With memory:** the warning surfaces before a single line is written.

---

## Managing your memory bank

### List everything saved

```
Show me all stored memories for this project.
```

Terminal alternative:
```bash
ctx memory list
# a3f1b2c0 [4/20/2026] decrementStock() has a TOCTOU race condition...
#           tags: products, concurrency, bug
# 9e7d4f12 [4/18/2026] Sessions are stored in-memory, not Redis...
#           tags: auth, session, architecture
```

### Search memories by topic

```bash
ctx memory recall "database transactions"
```

### Delete a stale memory

After you've fixed the race condition, the warning is no longer relevant:

```
Delete the memory about decrementStock race condition.
```

Terminal:
```bash
ctx memory delete a3f1b2c0
# Deleted.
```

---

## What's worth saving to memory

**Good candidates** — things you'd want to know *before* starting a task:
- Architectural decisions that aren't obvious from the code ("sessions use Redis in prod, but in-memory in dev")
- Gotchas and traps ("User.findById does NOT exclude soft-deleted users — use findActive")
- Known bugs ("stock decrement has a race condition under load")
- Process rules ("always run the migration dry-run first before applying")
- Config locations ("rate limit config is in config/services.ts, not env vars")

**Not worth saving:**
- Things already clear from reading the code
- Standard patterns the agent would figure out in one search
- Temporary state ("I'm currently refactoring X") — this belongs in a task, not memory
