import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { logExpand, logReturned, getExpandCount, getChunkBoost, hashQuery } from "../feedback.js";

const TMP = "/tmp/contextgraph-test-feedback";

beforeAll(() => mkdirSync(join(TMP, ".contextgraph"), { recursive: true }));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("hashQuery", () => {
  test("returns a 16-character hex string", () => {
    expect(hashQuery("hello")).toMatch(/^[0-9a-f]{16}$/);
  });

  test("same input produces same hash", () => {
    expect(hashQuery("test query")).toBe(hashQuery("test query"));
  });

  test("different inputs produce different hashes", () => {
    expect(hashQuery("query a")).not.toBe(hashQuery("query b"));
  });
});

describe("logExpand / getExpandCount", () => {
  test("expand count starts at 0 for unknown chunk", () => {
    expect(getExpandCount("nonexistent-chunk", TMP)).toBe(0);
  });

  test("expand count increments after logExpand", () => {
    logExpand("qhash1", "chunk-alpha", TMP);
    expect(getExpandCount("chunk-alpha", TMP)).toBe(1);
  });

  test("multiple expands accumulate", () => {
    logExpand("qhash1", "chunk-beta", TMP);
    logExpand("qhash2", "chunk-beta", TMP);
    logExpand("qhash3", "chunk-beta", TMP);
    expect(getExpandCount("chunk-beta", TMP)).toBe(3);
  });

  test("count is per chunk-id, not global", () => {
    logExpand("qhashX", "chunk-gamma", TMP);
    const gamma = getExpandCount("chunk-gamma", TMP);
    const alpha = getExpandCount("chunk-alpha", TMP);
    expect(gamma).toBe(1);
    expect(alpha).toBe(1); // unchanged from earlier test
  });
});

describe("logReturned", () => {
  test("does not affect expand count", () => {
    logReturned("qhash-ret", ["chunk-delta", "chunk-epsilon"], TMP);
    expect(getExpandCount("chunk-delta", TMP)).toBe(0);
    expect(getExpandCount("chunk-epsilon", TMP)).toBe(0);
  });
});

describe("getChunkBoost", () => {
  test("returns 0 for chunk with no expands", () => {
    expect(getChunkBoost("never-expanded", TMP)).toBe(0);
  });

  test("boost increases with expand count", () => {
    logExpand("q1", "chunk-boost-test", TMP);
    const boost1 = getChunkBoost("chunk-boost-test", TMP);
    logExpand("q2", "chunk-boost-test", TMP);
    const boost2 = getChunkBoost("chunk-boost-test", TMP);
    expect(boost2).toBeGreaterThan(boost1);
  });

  test("boost is capped at 0.15", () => {
    const chunkId = "chunk-saturate";
    // 8 expands × 0.02 = 0.16 > cap of 0.15
    for (let i = 0; i < 8; i++) logExpand(`q${i}`, chunkId, TMP);
    expect(getChunkBoost(chunkId, TMP)).toBe(0.15);
  });

  test("boost value matches formula: min(0.15, count * 0.02)", () => {
    const chunkId = "chunk-formula";
    logExpand("qa", chunkId, TMP);
    logExpand("qb", chunkId, TMP);
    expect(getChunkBoost(chunkId, TMP)).toBeCloseTo(0.04, 5);
  });
});
