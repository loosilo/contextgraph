import { test, expect, describe, beforeAll, afterAll, mock } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const TMP = "/tmp/contextgraph-test-memory";

// Mock embeddings so tests don't require an OpenAI key
mock.module("../embeddings.js", () => ({
  embed: async (text: string) => {
    // Deterministic: each unique text gets a unique vector based on char codes
    const vec = new Array(8).fill(0);
    for (let i = 0; i < text.length; i++) vec[i % 8] += text.charCodeAt(i);
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  },
  embedQuery: async (text: string) => {
    const vec = new Array(8).fill(0);
    for (let i = 0; i < text.length; i++) vec[i % 8] += text.charCodeAt(i);
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  },
  cosineSimilarity: (a: number[], b: number[]) => {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  },
  serializeEmbedding: JSON.stringify,
  deserializeEmbedding: JSON.parse,
}));

// Import after mock is set up
const { saveLearning, recallLearnings, listMemories, deleteMemory } = await import("../memory.js");

beforeAll(() => mkdirSync(join(TMP, ".contextgraph"), { recursive: true }));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("saveLearning", () => {
  test("returns a UUID string", async () => {
    const id = await saveLearning("auth uses Redis for sessions", [], TMP);
    expect(typeof id).toBe("string");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("saved memory appears in listMemories", async () => {
    await saveLearning("database uses PostgreSQL", ["db", "infra"], TMP);
    const list = listMemories(TMP);
    expect(list.some((m) => m.content.includes("PostgreSQL"))).toBe(true);
  });

  test("tags are stored and returned", async () => {
    await saveLearning("CI runs on GitHub Actions", ["ci", "devops"], TMP);
    const list = listMemories(TMP);
    const entry = list.find((m) => m.content.includes("GitHub Actions"));
    expect(entry?.tags).toContain("ci");
    expect(entry?.tags).toContain("devops");
  });

  test("multiple memories can be saved independently", async () => {
    const id1 = await saveLearning("fact A", [], TMP);
    const id2 = await saveLearning("fact B", [], TMP);
    expect(id1).not.toBe(id2);
  });
});

describe("listMemories", () => {
  test("returns array", () => {
    const list = listMemories(TMP);
    expect(Array.isArray(list)).toBe(true);
  });

  test("each entry has required fields", () => {
    const list = listMemories(TMP);
    for (const m of list) {
      expect(typeof m.id).toBe("string");
      expect(typeof m.content).toBe("string");
      expect(Array.isArray(m.tags)).toBe(true);
      expect(typeof m.created_at).toBe("number");
    }
  });
});

describe("recallLearnings", () => {
  test("returns array with score field", async () => {
    const results = await recallLearnings("Redis session storage", TMP, 3);
    expect(Array.isArray(results)).toBe(true);
    for (const r of results) {
      expect(typeof r.score).toBe("number");
      expect(typeof r.content).toBe("string");
    }
  });

  test("results are sorted by score descending", async () => {
    const results = await recallLearnings("database", TMP, 10);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  test("respects topK limit", async () => {
    const results = await recallLearnings("anything", TMP, 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

describe("deleteMemory", () => {
  test("returns true when memory exists", async () => {
    const id = await saveLearning("temporary fact", [], TMP);
    expect(deleteMemory(id, TMP)).toBe(true);
  });

  test("returns false when memory does not exist", () => {
    expect(deleteMemory("00000000-0000-0000-0000-000000000000", TMP)).toBe(false);
  });

  test("deleted memory no longer appears in list", async () => {
    const id = await saveLearning("to be deleted", [], TMP);
    deleteMemory(id, TMP);
    const list = listMemories(TMP);
    expect(list.some((m) => m.id === id)).toBe(false);
  });
});
