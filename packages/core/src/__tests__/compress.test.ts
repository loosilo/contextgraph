import { test, expect, describe } from "bun:test";
import { compressChunks, renderContext, type DensityPreset } from "../compress.js";
import type { ScoredChunk } from "../scorer.js";

function makeChunk(score: number, id = `chunk-${score}`): ScoredChunk {
  return {
    id,
    filePath: "src/foo.ts",
    kind: "function",
    name: `fn_${id}`,
    startLine: 1,
    endLine: 10,
    content: `function fn_${id}() {\n  // line 2\n  return 42;\n}`,
    score,
  };
}

describe("compressChunks", () => {
  test("high-score chunks get 'full' tier (balanced)", () => {
    const { chunks } = compressChunks([makeChunk(0.9)], "balanced");
    expect(chunks[0].tier).toBe("full");
    expect(chunks[0].content).toContain("return 42");
  });

  test("medium-score chunks get 'summary' tier (balanced)", () => {
    const { chunks } = compressChunks([makeChunk(0.5)], "balanced");
    expect(chunks[0].tier).toBe("summary");
  });

  test("low-score chunks get 'stub' tier (balanced)", () => {
    const { chunks } = compressChunks([makeChunk(0.2)], "balanced");
    expect(chunks[0].tier).toBe("stub");
    expect(chunks[0].content).toContain("chunk_id:");
  });

  test("very low-score chunks are dropped", () => {
    const { chunks, dropped } = compressChunks([makeChunk(0.05)], "balanced");
    expect(chunks).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  test("summary tier includes chunk_id reference for expand_chunk", () => {
    const chunk = makeChunk(0.5);
    const { chunks } = compressChunks([chunk], "balanced");
    expect(chunks[0].content).toContain(chunk.id);
  });

  test("stub tier includes chunk_id reference", () => {
    const chunk = makeChunk(0.2);
    const { chunks } = compressChunks([chunk], "balanced");
    expect(chunks[0].content).toContain(chunk.id);
  });

  describe("density presets affect thresholds", () => {
    const presets: DensityPreset[] = ["minimal", "sparse", "balanced", "detailed", "thorough"];

    test("thorough returns more full-tier chunks than minimal at score 0.5", () => {
      const chunks = [makeChunk(0.5)];
      const { chunks: thorough } = compressChunks(chunks, "thorough");
      const { chunks: minimal } = compressChunks(chunks, "minimal");
      expect(thorough[0]?.tier).toBe("full");
      expect(minimal[0]?.tier).not.toBe("full");
    });

    test("all presets return arrays without throwing", () => {
      const chunks = [makeChunk(0.9), makeChunk(0.5), makeChunk(0.2), makeChunk(0.05)];
      for (const preset of presets) {
        expect(() => compressChunks(chunks, preset)).not.toThrow();
      }
    });
  });

  test("processes multiple chunks preserving order", () => {
    const { chunks } = compressChunks([makeChunk(0.9, "a"), makeChunk(0.5, "b"), makeChunk(0.2, "c")], "balanced");
    expect(chunks[0].id).toBe("a");
    expect(chunks[1].id).toBe("b");
    expect(chunks[2].id).toBe("c");
  });

  test("empty input returns empty output", () => {
    const { chunks, dropped } = compressChunks([], "balanced");
    expect(chunks).toEqual([]);
    expect(dropped).toBe(0);
  });

  test("exclude option skips specified chunk IDs", () => {
    const all = [makeChunk(0.9, "a"), makeChunk(0.9, "b"), makeChunk(0.9, "c")];
    const { chunks } = compressChunks(all, "balanced", { exclude: ["b"] });
    expect(chunks.map((c) => c.id)).toEqual(["a", "c"]);
  });

  test("token_budget limits output size", () => {
    // Each chunk content is ~40 chars; budget 50 tokens = ~200 chars so only ~3 fit
    const many = Array.from({ length: 10 }, (_, i) => makeChunk(0.9, `c${i}`));
    const { chunks, dropped } = compressChunks(many, "balanced", { tokenBudget: 50 });
    expect(chunks.length).toBeLessThan(many.length);
    expect(dropped).toBeGreaterThan(0);
  });

  test("token_budget with large budget includes all chunks", () => {
    const few = [makeChunk(0.9, "a"), makeChunk(0.9, "b")];
    const { chunks, dropped } = compressChunks(few, "balanced", { tokenBudget: 10000 });
    expect(chunks).toHaveLength(2);
    expect(dropped).toBe(0);
  });
});

describe("renderContext", () => {
  test("includes task name in header", () => {
    const result = renderContext([], "Fix authentication bug");
    expect(result).toContain("Fix authentication bug");
  });

  test("sections appear only when non-empty", () => {
    const { chunks } = compressChunks([makeChunk(0.9)], "balanced");
    const output = renderContext(chunks, "task");
    expect(output).toContain("High");
    expect(output).not.toContain("Medium");
    expect(output).not.toContain("Low");
  });

  test("chunks grouped into correct relevance tiers", () => {
    const { chunks } = compressChunks(
      [makeChunk(0.9, "h"), makeChunk(0.5, "m"), makeChunk(0.2, "l")],
      "thorough"
    );
    const output = renderContext(chunks, "task");
    const highIdx = output.indexOf("## High");
    const medIdx  = output.indexOf("## Medium");
    const lowIdx  = output.indexOf("## Low");
    expect(highIdx).toBeLessThan(medIdx);
    expect(medIdx).toBeLessThan(lowIdx);
  });

  test("each chunk block includes file path and line number", () => {
    const { chunks } = compressChunks([makeChunk(0.9)], "balanced");
    const output = renderContext(chunks, "task");
    expect(output).toContain("src/foo.ts");
    expect(output).toContain(":1");
  });

  test("full-tier chunks render their complete content", () => {
    const { chunks } = compressChunks([makeChunk(0.9)], "balanced");
    const output = renderContext(chunks, "task");
    expect(output).toContain("return 42");
  });

  test("dropped count appears when non-zero", () => {
    const { chunks } = compressChunks([makeChunk(0.9)], "balanced");
    const output = renderContext(chunks, "task", 3);
    expect(output).toContain("3 lower-scoring chunk(s) omitted");
  });

  test("no dropped notice when dropped is zero", () => {
    const { chunks } = compressChunks([makeChunk(0.9)], "balanced");
    const output = renderContext(chunks, "task", 0);
    expect(output).not.toContain("omitted");
  });
});
