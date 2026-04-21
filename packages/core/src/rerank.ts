import type { ScoredChunk } from "./scorer.js";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function bm25(queryTerms: string[], doc: string, avgDocLen: number, k1 = 1.5, b = 0.75): number {
  const docTerms = tokenize(doc);
  const docLen = docTerms.length;
  if (docLen === 0) return 0;

  const tf = new Map<string, number>();
  for (const t of docTerms) tf.set(t, (tf.get(t) ?? 0) + 1);

  let score = 0;
  for (const term of queryTerms) {
    const f = tf.get(term) ?? 0;
    if (f === 0) continue;
    const numerator = f * (k1 + 1);
    const denominator = f + k1 * (1 - b + b * (docLen / avgDocLen));
    score += numerator / denominator;
  }
  return score;
}

export function rerank(
  query: string,
  candidates: ScoredChunk[],
  topK: number,
  embeddingWeight = 0.7
): ScoredChunk[] {
  if (candidates.length === 0) return [];

  const queryTerms = tokenize(query);
  const avgDocLen =
    candidates.reduce((s, c) => s + tokenize(c.content).length, 0) / candidates.length;

  const bm25Scores = candidates.map((c) =>
    bm25(queryTerms, `${c.name ?? ""} ${c.content}`, avgDocLen)
  );
  const maxBm25 = Math.max(...bm25Scores, 1e-9);
  const minBm25 = Math.min(...bm25Scores);
  const rangeBm25 = maxBm25 - minBm25 || 1;

  const reranked = candidates.map((chunk, i) => {
    const normalizedBm25 = (bm25Scores[i] - minBm25) / rangeBm25;
    const combined =
      embeddingWeight * chunk.score + (1 - embeddingWeight) * normalizedBm25;
    return { ...chunk, score: Math.min(1.0, combined) };
  });

  return reranked.sort((a, b) => b.score - a.score).slice(0, topK);
}
