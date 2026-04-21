import { test, expect, describe, beforeAll, afterAll, mock } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const TMP = "/tmp/contextgraph-test-memory-ext";

mock.module("../embeddings.js", () => ({
  embed: async (text: string) => {
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
      dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  },
  serializeEmbedding: JSON.stringify,
  deserializeEmbedding: JSON.parse,
}));

const { saveLearning, recallLearnings, listMemories, saveCheckpoint, getLatestCheckpoint, listCheckpoints } = await import("../memory.js");

beforeAll(() => mkdirSync(join(TMP, ".contextgraph"), { recursive: true }));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("memory staleness", () => {
  test("freshly saved memory is not stale", async () => {
    await saveLearning("auth uses Redis for sessions", ["auth"], TMP);
    const list = listMemories(TMP);
    const entry = list.find((m) => m.content.includes("Redis"));
    expect(entry?.stale).toBe(false);
  });

  test("recall results include stale flag", async () => {
    const results = await recallLearnings("auth session", TMP);
    for (const r of results) {
      expect(typeof r.stale).toBe("boolean");
    }
  });

  test("listMemories includes stale flag on each entry", async () => {
    const list = listMemories(TMP);
    for (const m of list) {
      expect(typeof m.stale).toBe("boolean");
    }
  });
});

describe("saveCheckpoint / getLatestCheckpoint", () => {
  test("returns null when no checkpoints exist", () => {
    expect(getLatestCheckpoint(TMP)).toBeNull();
  });

  test("saved checkpoint is retrievable", () => {
    const id = saveCheckpoint("Investigated auth flow. Sessions are in-memory.", ["Add rate limiting"], TMP);
    expect(typeof id).toBe("string");

    const cp = getLatestCheckpoint(TMP);
    expect(cp).not.toBeNull();
    expect(cp!.summary).toContain("Investigated auth flow");
    expect(cp!.openTasks).toContain("Add rate limiting");
  });

  test("getLatestCheckpoint returns most recent", () => {
    saveCheckpoint("First checkpoint", [], TMP);
    saveCheckpoint("Second checkpoint", ["task A"], TMP);
    const cp = getLatestCheckpoint(TMP);
    expect(cp!.summary).toBe("Second checkpoint");
  });

  test("checkpoint has a createdAt timestamp", () => {
    const cp = getLatestCheckpoint(TMP);
    expect(typeof cp!.createdAt).toBe("number");
    expect(cp!.createdAt).toBeGreaterThan(0);
  });

  test("open tasks round-trip correctly", () => {
    saveCheckpoint("Multi-task session", ["Fix bug #123", "Review PR #456", "Update docs"], TMP);
    const cp = getLatestCheckpoint(TMP);
    expect(cp!.openTasks).toEqual(["Fix bug #123", "Review PR #456", "Update docs"]);
  });
});

describe("listCheckpoints", () => {
  test("returns array sorted newest first", () => {
    const list = listCheckpoints(TMP);
    expect(Array.isArray(list)).toBe(true);
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1].createdAt).toBeGreaterThanOrEqual(list[i].createdAt);
    }
  });

  test("each entry has id, summary, createdAt", () => {
    const list = listCheckpoints(TMP);
    for (const cp of list) {
      expect(typeof cp.id).toBe("string");
      expect(typeof cp.summary).toBe("string");
      expect(typeof cp.createdAt).toBe("number");
    }
  });
});
