import { test, expect, describe } from "bun:test";
import { rerank } from "../rerank.js";
import type { ScoredChunk } from "../scorer.js";

function chunk(id: string, score: number, content: string, name = id): ScoredChunk {
  return { id, filePath: `src/${id}.ts`, kind: "function", name, startLine: 1, endLine: 10, content, score };
}

describe("rerank", () => {
  test("returns at most topK results", () => {
    const chunks = Array.from({ length: 20 }, (_, i) => chunk(`fn${i}`, 0.5, `function fn${i}() { return ${i}; }`));
    expect(rerank("return value", chunks, 5)).toHaveLength(5);
  });

  test("returns empty array for empty input", () => {
    expect(rerank("query", [], 5)).toEqual([]);
  });

  test("all scores remain in [0, 1]", () => {
    const chunks = [
      chunk("a", 0.9, "export function authenticate(token: string) { return verify(token); }"),
      chunk("b", 0.5, "export function hashPassword(plain: string) { return sha256(plain); }"),
      chunk("c", 0.2, "export const config = { timeout: 30 };"),
    ];
    const result = rerank("authenticate user token", chunks, 3);
    for (const r of result) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  test("keyword-matching chunk scores boost when query terms appear in content", () => {
    const chunks = [
      chunk("a", 0.6, "export function processPayment(amount: number) { charge(amount); }"),
      chunk("b", 0.6, "export function authenticate(token: string) { return verify(token); }"),
    ];
    // "authenticate token" query should cause b to outscore a after BM25
    const result = rerank("authenticate token", chunks, 2);
    const bIdx = result.findIndex((r) => r.id === "b");
    const aIdx = result.findIndex((r) => r.id === "a");
    expect(bIdx).toBeLessThan(aIdx);
  });

  test("high embedding score chunk stays near top even with low keyword overlap", () => {
    const chunks = [
      chunk("high-embed", 0.95, "export function x() { return y; }"),         // high embedding, no keywords
      chunk("low-embed", 0.1, "session expiry invalidation token timeout"),    // low embedding, all keywords
    ];
    const result = rerank("session expiry invalidation", chunks, 2);
    // embedding weight is 0.7 so high-embed should still outscore low-embed
    expect(result[0].id).toBe("high-embed");
  });

  test("results are sorted descending by combined score", () => {
    const chunks = Array.from({ length: 8 }, (_, i) =>
      chunk(`fn${i}`, Math.random(), `function fn${i}() { /* body */ }`)
    );
    const result = rerank("function body", chunks, 8);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
  });

  test("topK larger than input returns all items", () => {
    const chunks = [chunk("a", 0.5, "foo"), chunk("b", 0.3, "bar")];
    expect(rerank("foo bar", chunks, 10)).toHaveLength(2);
  });

  test("embedding weight of 1.0 preserves original ordering", () => {
    const chunks = [
      chunk("a", 0.9, "completely unrelated content xyz"),
      chunk("b", 0.7, "also unrelated"),
      chunk("c", 0.5, "still unrelated"),
    ];
    // With embeddingWeight=1.0, BM25 has 0 influence — order is purely by embedding score
    const result = rerank("query", chunks, 3, 1.0);
    expect(result.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});
