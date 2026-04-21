import type { ScoredChunk } from "./scorer.js";

export type DensityPreset = "minimal" | "sparse" | "balanced" | "detailed" | "thorough";

const THRESHOLDS: Record<DensityPreset, { full: number; summary: number }> = {
  minimal:  { full: 0.85, summary: 0.6 },
  sparse:   { full: 0.75, summary: 0.5 },
  balanced: { full: 0.65, summary: 0.4 },
  detailed: { full: 0.5,  summary: 0.25 },
  thorough: { full: 0.3,  summary: 0.1 },
};

export interface CompressedChunk {
  id: string;
  filePath: string;
  name?: string;
  startLine: number;
  tier: "full" | "summary" | "stub" | "dropped";
  content: string;
  score: number;
}

export interface CompressResult {
  chunks: CompressedChunk[];
  dropped: number;
}

export function compressChunks(
  chunks: ScoredChunk[],
  density: DensityPreset = "balanced",
  options: { exclude?: string[]; tokenBudget?: number } = {}
): CompressResult {
  const { exclude = [], tokenBudget } = options;
  const filtered = exclude.length ? chunks.filter((c) => !exclude.includes(c.id)) : chunks;

  if (tokenBudget != null && tokenBudget > 0) {
    return compressWithBudget(filtered, tokenBudget);
  }

  const { full, summary } = THRESHOLDS[density];
  const result: CompressedChunk[] = [];
  let dropped = 0;

  for (const chunk of filtered) {
    if (chunk.score >= full) {
      result.push({ ...chunk, tier: "full", content: chunk.content });
    } else if (chunk.score >= summary) {
      result.push({ ...chunk, tier: "summary", content: makeSummary(chunk) });
    } else if (chunk.score >= 0.15) {
      result.push({ ...chunk, tier: "stub", content: makeStub(chunk) });
    } else {
      dropped++;
    }
  }

  return { chunks: result, dropped };
}

function compressWithBudget(chunks: ScoredChunk[], tokenBudget: number): CompressResult {
  // ~4 chars per token, reserve 200 chars for section headers
  let charBudget = tokenBudget * 4 - 200;
  const result: CompressedChunk[] = [];
  let dropped = 0;

  for (const chunk of chunks) {
    const full = chunk.content;
    const summary = makeSummary(chunk);
    const stub = makeStub(chunk);
    const headerLen = renderHeader(chunk).length + 10; // +10 for fences

    if (full.length + headerLen <= charBudget) {
      result.push({ ...chunk, tier: "full", content: full });
      charBudget -= full.length + headerLen;
    } else if (summary.length + headerLen <= charBudget) {
      result.push({ ...chunk, tier: "summary", content: summary });
      charBudget -= summary.length + headerLen;
    } else if (stub.length + headerLen <= charBudget) {
      result.push({ ...chunk, tier: "stub", content: stub });
      charBudget -= stub.length + headerLen;
    } else {
      dropped++;
    }
  }

  return { chunks: result, dropped };
}

export function renderContext(chunks: CompressedChunk[], task: string, dropped = 0): string {
  const high   = chunks.filter((c) => c.score >= 0.65);
  const medium = chunks.filter((c) => c.score >= 0.35 && c.score < 0.65);
  const low    = chunks.filter((c) => c.score < 0.35);

  const sections: string[] = [`# Context: ${task}\n`];

  if (high.length)   { sections.push("## High\n");   for (const c of high)   sections.push(renderChunk(c)); }
  if (medium.length) { sections.push("## Medium\n"); for (const c of medium) sections.push(renderChunk(c)); }
  if (low.length)    { sections.push("## Low\n");    for (const c of low)    sections.push(renderChunk(c)); }
  if (dropped > 0)   sections.push(`\n*${dropped} lower-scoring chunk(s) omitted — narrow query or increase token_budget to see them.*\n`);

  return sections.join("\n");
}

function renderHeader(c: Pick<CompressedChunk, "filePath" | "startLine" | "name">): string {
  return `### ${c.filePath}:${c.startLine}${c.name ? ` \`${c.name}\`` : ""}`;
}

function renderChunk(c: CompressedChunk): string {
  const header = renderHeader(c);
  return `${header}\n\`\`\`\n${c.content}\n\`\`\`\n`;
}

function makeSummary(chunk: ScoredChunk): string {
  const lines = chunk.content.split("\n");
  const sig   = lines[0];
  const comments = lines.slice(1).filter((l) => l.trim().startsWith("//") || l.trim().startsWith("*") || l.trim().startsWith("#"));
  return [sig, ...comments.slice(0, 3), `  // … ${lines.length} lines  (chunk_id: ${chunk.id})`].join("\n");
}

function makeStub(chunk: ScoredChunk): string {
  return `${chunk.content.split("\n")[0]}\n  // … (chunk_id: ${chunk.id})`;
}
