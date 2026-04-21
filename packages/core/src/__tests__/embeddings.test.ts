import { test, expect, describe } from "bun:test";
import { cosineSimilarity, serializeEmbedding, deserializeEmbedding } from "../embeddings.js";

describe("cosineSimilarity", () => {
  test("identical vectors return 1", () => {
    const v = [1, 0, 0, 1];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  test("orthogonal vectors return 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  test("opposite vectors return -1", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  test("zero vector returns 0 (no NaN)", () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });

  test("mismatched lengths return 0", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  test("similar vectors score higher than dissimilar ones", () => {
    const a = [0.9, 0.1, 0.0];
    const b = [0.8, 0.2, 0.0]; // close to a
    const c = [0.0, 0.0, 1.0]; // far from a
    expect(cosineSimilarity(a, b)).toBeGreaterThan(cosineSimilarity(a, c));
  });
});

describe("serializeEmbedding / deserializeEmbedding", () => {
  test("round-trips correctly", () => {
    const v = [0.1, 0.2, -0.5, 1.0];
    expect(deserializeEmbedding(serializeEmbedding(v))).toEqual(v);
  });

  test("serializes to valid JSON string", () => {
    const v = [1, 2, 3];
    const s = serializeEmbedding(v);
    expect(typeof s).toBe("string");
    expect(() => JSON.parse(s)).not.toThrow();
  });

  test("handles empty array", () => {
    expect(deserializeEmbedding(serializeEmbedding([]))).toEqual([]);
  });

  test("handles large vectors without precision loss", () => {
    const v = Array.from({ length: 1536 }, (_, i) => Math.sin(i * 0.01));
    const roundTripped = deserializeEmbedding(serializeEmbedding(v));
    roundTripped.forEach((val, i) => expect(val).toBeCloseTo(v[i], 10));
  });
});
