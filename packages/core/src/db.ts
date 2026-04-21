import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const _cache = new Map<string, Database>();

export function getDb(dbPath = ".contextgraph/index.sqlite"): Database {
  if (_cache.has(dbPath)) return _cache.get(dbPath)!;
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode=WAL;");
  migrate(db);
  _cache.set(dbPath, db);
  return db;
}

function migrate(db: Database) {
  // Base tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT,
      start_line INTEGER,
      end_line INTEGER,
      content TEXT NOT NULL,
      embedding TEXT,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path);

    CREATE TABLE IF NOT EXISTS file_meta (
      path TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL,
      git_updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      tags TEXT,
      embedding TEXT,
      stale INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_seen_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS graph_edges (
      from_file TEXT NOT NULL,
      to_file TEXT NOT NULL,
      PRIMARY KEY (from_file, to_file)
    );

    CREATE INDEX IF NOT EXISTS idx_edges_from ON graph_edges(from_file);
    CREATE INDEX IF NOT EXISTS idx_edges_to ON graph_edges(to_file);

    CREATE TABLE IF NOT EXISTS context_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      file TEXT
    );

    CREATE TABLE IF NOT EXISTS query_log (
      query_hash TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      action TEXT NOT NULL,
      ts INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_qlog_chunk ON query_log(chunk_id);

    CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      open_tasks TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  // Incremental migrations using schema_version
  const row = db.query<{ version: number }, []>(
    "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1"
  ).get();
  const currentVersion = row?.version ?? 0;

  if (currentVersion < 1) {
    // v1: add stale + last_seen_at to memories (for DBs created before this migration)
    try { db.exec("ALTER TABLE memories ADD COLUMN stale INTEGER NOT NULL DEFAULT 0"); } catch { /* already exists */ }
    try { db.exec("ALTER TABLE memories ADD COLUMN last_seen_at INTEGER"); } catch { /* already exists */ }
    db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (1)");
  }
}
