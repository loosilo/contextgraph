import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { buildGraph, analyzeImpact, computeRiskScore, getDirectDependents, getDependencies } from "../graph.js";
import { getDb } from "../db.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const TMP = "/tmp/contextgraph-test-graph";
const DB_PATH = join(TMP, ".contextgraph/index.sqlite");

beforeAll(() => {
  mkdirSync(join(TMP, ".contextgraph"), { recursive: true });
  mkdirSync(join(TMP, "src"), { recursive: true });

  // Create a small dependency tree:
  // utils.ts  <-- auth.ts <-- api.ts <-- index.ts
  //                                 <-- api.test.ts

  writeFileSync(join(TMP, "src/utils.ts"), `export function hash(s: string) { return s; }\n`);
  writeFileSync(join(TMP, "src/auth.ts"), `import { hash } from "./utils";\nexport function login() {}\n`);
  writeFileSync(join(TMP, "src/api.ts"), `import { login } from "./auth";\nexport function getUser() {}\n`);
  writeFileSync(join(TMP, "src/index.ts"), `import { getUser } from "./api";\nconsole.log(getUser());\n`);
  writeFileSync(join(TMP, "src/api.test.ts"), `import { getUser } from "./api";\n`);
});

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function buildTestGraph() {
  const files = [
    join(TMP, "src/utils.ts"),
    join(TMP, "src/auth.ts"),
    join(TMP, "src/api.ts"),
    join(TMP, "src/index.ts"),
    join(TMP, "src/api.test.ts"),
  ];
  buildGraph(TMP, files);
}

describe("buildGraph", () => {
  test("builds edges without throwing", () => {
    expect(() => buildTestGraph()).not.toThrow();
  });

  test("persists edges to SQLite", () => {
    buildTestGraph();
    const db = getDb(DB_PATH);
    const count = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM graph_edges").get()!;
    expect(count.n).toBeGreaterThan(0);
  });

  test("rebuilding clears old edges", () => {
    buildTestGraph();
    const db = getDb(DB_PATH);
    const before = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM graph_edges").get()!.n;
    buildTestGraph();
    const after = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM graph_edges").get()!.n;
    expect(after).toBe(before);
  });
});

describe("analyzeImpact", () => {
  beforeAll(() => buildTestGraph());

  test("utils.ts has downstream dependents", () => {
    const impacts = analyzeImpact(join(TMP, "src/utils.ts"), TMP);
    expect(impacts.length).toBeGreaterThan(0);
  });

  test("auth.ts is a direct dependent of utils.ts", () => {
    const impacts = analyzeImpact(join(TMP, "src/utils.ts"), TMP);
    const direct = impacts.filter((i) => i.depth === 1).map((i) => i.file);
    expect(direct.some((f) => f.includes("auth.ts"))).toBe(true);
  });

  test("returns depth values starting at 1", () => {
    const impacts = analyzeImpact(join(TMP, "src/utils.ts"), TMP);
    const depths = impacts.map((i) => i.depth);
    expect(Math.min(...depths)).toBe(1);
  });

  test("detects test files correctly", () => {
    const impacts = analyzeImpact(join(TMP, "src/api.ts"), TMP);
    const testFiles = impacts.filter((i) => i.isTest);
    expect(testFiles.some((f) => f.file.includes("api.test.ts"))).toBe(true);
  });

  test("leaf node (index.ts) has no dependents", () => {
    const impacts = analyzeImpact(join(TMP, "src/index.ts"), TMP);
    expect(impacts).toHaveLength(0);
  });

  test("respects maxDepth parameter", () => {
    const impacts = analyzeImpact(join(TMP, "src/utils.ts"), TMP, 1);
    const allDepthOne = impacts.every((i) => i.depth <= 1);
    expect(allDepthOne).toBe(true);
  });
});

describe("computeRiskScore", () => {
  test("returns low risk for empty impact list", () => {
    const { score, label } = computeRiskScore([]);
    expect(score).toBe(0);
    expect(label).toBe("low");
  });

  test("more direct dependents = higher score", () => {
    const few = Array.from({ length: 2 }, (_, i) => ({ file: `f${i}.ts`, depth: 1, isTest: false }));
    const many = Array.from({ length: 8 }, (_, i) => ({ file: `f${i}.ts`, depth: 1, isTest: false }));
    expect(computeRiskScore(many).score).toBeGreaterThan(computeRiskScore(few).score);
  });

  test("score is capped at 100", () => {
    const impacts = Array.from({ length: 100 }, (_, i) => ({ file: `f${i}.ts`, depth: 1, isTest: false }));
    expect(computeRiskScore(impacts).score).toBe(100);
  });

  test("labels map correctly to score ranges", () => {
    expect(computeRiskScore([]).label).toBe("low");
    const medImpacts = Array.from({ length: 2 }, (_, i) => ({ file: `f${i}.ts`, depth: 1, isTest: false }));
    expect(computeRiskScore(medImpacts).label).toBe("medium");
    const highImpacts = Array.from({ length: 4 }, (_, i) => ({ file: `f${i}.ts`, depth: 1, isTest: false }));
    expect(computeRiskScore(highImpacts).label).toBe("high");
    const critImpacts = Array.from({ length: 7 }, (_, i) => ({ file: `f${i}.ts`, depth: 1, isTest: false }));
    expect(computeRiskScore(critImpacts).label).toBe("critical");
  });
});
