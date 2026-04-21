import { getDb } from "./db.js";
import { embed, embedQuery, cosineSimilarity, serializeEmbedding, deserializeEmbedding } from "./embeddings.js";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

interface DbMemory {
  id: string;
  content: string;
  tags: string | null;
  embedding: string | null;
  stale: number;
  created_at: number;
  last_seen_at: number | null;
}

interface DbCheckpoint {
  id: string;
  summary: string;
  open_tasks: string;
  created_at: number;
}

// ── Learnings ───────────────────────────────────────────────────────────────

export async function saveLearning(
  content: string,
  tags: string[],
  projectRoot: string
): Promise<string> {
  const db = getDb(join(projectRoot, ".contextgraph/index.sqlite"));
  const id = randomUUID();
  const embedding = await embed(content);
  db.run(
    "INSERT INTO memories (id, content, tags, embedding) VALUES (?,?,?,?)",
    [id, content, JSON.stringify(tags), serializeEmbedding(embedding)]
  );
  return id;
}

export async function recallLearnings(
  topic: string,
  projectRoot: string,
  topK = 5
): Promise<{ id: string; content: string; tags: string[]; score: number; stale: boolean }[]> {
  const db = getDb(join(projectRoot, ".contextgraph/index.sqlite"));
  const queryVec = await embedQuery(topic);
  const now = Math.floor(Date.now() / 1000);

  const memories = db.query<DbMemory, []>(
    "SELECT * FROM memories WHERE embedding IS NOT NULL ORDER BY created_at DESC"
  ).all();

  const results = memories
    .map((m) => ({
      id: m.id,
      content: m.content,
      tags: m.tags ? JSON.parse(m.tags) : [],
      score: cosineSimilarity(queryVec, deserializeEmbedding(m.embedding!)),
      stale: m.stale === 1,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  // Update last_seen_at for returned memories
  const ids = results.map((r) => r.id);
  if (ids.length) {
    db.transaction(() => {
      for (const id of ids) {
        db.run("UPDATE memories SET last_seen_at = ? WHERE id = ?", [now, id]);
      }
    })();
  }

  return results;
}

export function listMemories(projectRoot: string): { id: string; content: string; tags: string[]; created_at: number; stale: boolean }[] {
  const db = getDb(join(projectRoot, ".contextgraph/index.sqlite"));
  return db.query<DbMemory, []>("SELECT * FROM memories ORDER BY created_at DESC").all().map((m) => ({
    id: m.id,
    content: m.content,
    tags: m.tags ? JSON.parse(m.tags) : [],
    created_at: m.created_at,
    stale: m.stale === 1,
  }));
}

export function deleteMemory(id: string, projectRoot: string): boolean {
  const db = getDb(join(projectRoot, ".contextgraph/index.sqlite"));
  const info = db.run("DELETE FROM memories WHERE id = ?", [id]);
  return info.changes > 0;
}

// ── Memory decay audit ──────────────────────────────────────────────────────

export async function auditMemories(projectRoot: string): Promise<{ audited: number; markedStale: number }> {
  const db = getDb(join(projectRoot, ".contextgraph/index.sqlite"));

  const memories = db.query<DbMemory, []>(
    "SELECT * FROM memories WHERE embedding IS NOT NULL AND stale = 0"
  ).all();

  let markedStale = 0;

  for (const m of memories) {
    const memVec = deserializeEmbedding(m.embedding!);

    // Check if any indexed chunk is still meaningfully similar to this memory
    const chunks = db.query<{ embedding: string }, []>(
      "SELECT embedding FROM chunks WHERE embedding IS NOT NULL LIMIT 500"
    ).all();

    const maxSim = chunks.reduce((best, c) => {
      const sim = cosineSimilarity(memVec, deserializeEmbedding(c.embedding));
      return sim > best ? sim : best;
    }, 0);

    // If no chunk in the codebase is similar, the memory references deleted/renamed code
    if (maxSim < 0.4) {
      db.run("UPDATE memories SET stale = 1 WHERE id = ?", [m.id]);
      markedStale++;
    }
  }

  return { audited: memories.length, markedStale };
}

// ── Checkpoints ─────────────────────────────────────────────────────────────

export function saveCheckpoint(
  summary: string,
  openTasks: string[],
  projectRoot: string
): string {
  const db = getDb(join(projectRoot, ".contextgraph/index.sqlite"));
  const id = randomUUID();
  db.run(
    "INSERT INTO checkpoints (id, summary, open_tasks) VALUES (?,?,?)",
    [id, summary, JSON.stringify(openTasks)]
  );
  return id;
}

export function getLatestCheckpoint(
  projectRoot: string
): { id: string; summary: string; openTasks: string[]; createdAt: number } | null {
  const db = getDb(join(projectRoot, ".contextgraph/index.sqlite"));
  const row = db.query<DbCheckpoint, []>(
    "SELECT * FROM checkpoints ORDER BY rowid DESC LIMIT 1"
  ).get();
  if (!row) return null;
  return {
    id: row.id,
    summary: row.summary,
    openTasks: JSON.parse(row.open_tasks),
    createdAt: row.created_at,
  };
}

export function listCheckpoints(projectRoot: string): { id: string; summary: string; createdAt: number }[] {
  const db = getDb(join(projectRoot, ".contextgraph/index.sqlite"));
  return db.query<DbCheckpoint, []>("SELECT * FROM checkpoints ORDER BY rowid DESC").all().map((r) => ({
    id: r.id,
    summary: r.summary,
    createdAt: r.created_at,
  }));
}
