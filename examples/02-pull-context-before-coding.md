# Scenario 02 — Pull Context Before Coding

**Situation:** You're starting work on a specific feature. Before writing any code, you pull the most relevant context so the agent has exactly what it needs — no more.

---

## The task

> "Add a `GET /orders/:id` endpoint that validates the user owns the order before returning it."

---

## Prompt

```
I'm about to implement GET /orders/:id. Pull the relevant context for this task.
```

**Agent calls:** `search_context("order retrieval by id ownership check route handler", topK: 8, density: "balanced")`

**Tool returns:**
```markdown
# Context for: order retrieval by id ownership check route handler

## High Relevance

### src/orders/service.ts:32 — getOrder [full] (score: 0.93)
```ts
export function getOrder(authHeader: string, orderId: string): Order {
  const { userId } = authenticate(authHeader);
  const order = orders.get(orderId);
  if (!order) throw new Error("Order not found");
  if (order.userId !== userId) throw new Error("Access denied");
  return order;
}
```

### src/auth/middleware.ts:14 — authenticate [full] (score: 0.88)
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

## Medium Relevance

### src/orders/service.ts:1 — module [summary] (score: 0.61)
import { findActive } from "../users/repository.js";
import { findProduct, decrementStock } from "../products/repository.js";
  // ... 68 lines total (chunk_id: src/orders/service.ts::module)

### src/users/repository.ts:24 — findActive [stub] (score: 0.37)
export function findActive(id: string): User | null {
  // ... (chunk_id: src/users/repository.ts::findActive)

---
*~310 tokens | 4 chunks | density: balanced*
```

**Agent's response:**
> `getOrder()` in `src/orders/service.ts` already handles exactly this: it authenticates the request, fetches the order, and throws `"Access denied"` if the `userId` doesn't match. You just need a route handler that calls it.
>
> ```ts
> // src/routes/orders.ts
> app.get("/orders/:id", (req, res) => {
>   try {
>     const order = getOrder(req.headers.authorization, req.params.id);
>     res.json(order);
>   } catch (e) {
>     if (e instanceof UnauthorizedError) return res.status(401).json({ error: e.message });
>     if (e.message === "Order not found") return res.status(404).json({ error: e.message });
>     res.status(500).json({ error: "Internal error" });
>   }
> });
> ```
>
> I need to see the existing route structure. Want me to search for it?

---

## Follow-up: expand a stub

The `findActive` stub was in the results. If the agent needs the full implementation:

**Prompt:**
```
Expand the findActive chunk.
```

**Agent calls:** `expand_chunk("src/users/repository.ts::findActive")`

**Tool returns:**
```ts
export function findActive(id: string): User | null {
  const user = findById(id);
  return user?.deletedAt ? null : user ?? null;
}
```

---

## Why this matters

Without ContextGraph, the agent would either:
- Ask you to paste the relevant files manually
- Read entire files and burn the full token budget
- Miss the ownership check in `getOrder` and implement it twice

With ContextGraph, it lands directly on the two functions it needs in ~310 tokens.
