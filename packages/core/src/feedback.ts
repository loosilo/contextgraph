import { getDb } from "./db.js";
import { join } from "node:path";
import { createHash } from "node:crypto";

export function hashQuery(query: string): string {
  return createHash("sha256").update(query).digest("hex").slice(0, 16);
}

export function logExpand(queryHash: string, chunkId: string, projectRoot: string): void {
  const db = getDb(join(projectRoot, ".contextgraph/index.sqlite"));
  db.run(
    "INSERT INTO query_log (query_hash, chunk_id, action) VALUES (?,?,?)",
    [queryHash, chunkId, "expand"]
  );
}

export function logReturned(queryHash: string, chunkIds: string[], projectRoot: string): void {
  const db = getDb(join(projectRoot, ".contextgraph/index.sqlite"));
  const insert = db.prepare("INSERT INTO query_log (query_hash, chunk_id, action) VALUES (?,?,?)");
  db.transaction(() => {
    for (const id of chunkIds) insert.run(queryHash, id, "returned");
  })();
}

export function getExpandCount(chunkId: string, projectRoot: string): number {
  const db = getDb(join(projectRoot, ".contextgraph/index.sqlite"));
  const row = db.query<{ n: number }, [string]>(
    "SELECT COUNT(*) as n FROM query_log WHERE chunk_id = ? AND action = 'expand'"
  ).get(chunkId);
  return row?.n ?? 0;
}

export function getChunkBoost(chunkId: string, projectRoot: string): number {
  const count = getExpandCount(chunkId, projectRoot);
  return Math.min(0.15, count * 0.02);
}
