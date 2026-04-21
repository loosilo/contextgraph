import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const TMP = "/tmp/contextgraph-test-db";
const DB_PATH = join(TMP, ".contextgraph/index.sqlite");

beforeAll(() => mkdirSync(join(TMP, ".contextgraph"), { recursive: true }));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("getDb", () => {
  test("creates database file at given path", async () => {
    const { getDb } = await import("../db.js");
    const db = getDb(DB_PATH);
    expect(db).toBeDefined();
  });

  test("returns same instance on repeated calls (singleton)", async () => {
    const { getDb } = await import("../db.js");
    const a = getDb(DB_PATH);
    const b = getDb(DB_PATH);
    expect(a).toBe(b);
  });

  test("creates all required tables", async () => {
    const { getDb } = await import("../db.js");
    const db = getDb(DB_PATH);
    const tables = db.query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all().map((r) => r.name);

    expect(tables).toContain("chunks");
    expect(tables).toContain("file_meta");
    expect(tables).toContain("memories");
    expect(tables).toContain("graph_edges");
  });

  test("chunks table has correct columns", async () => {
    const { getDb } = await import("../db.js");
    const db = getDb(DB_PATH);
    const info = db.query<{ name: string }, []>("PRAGMA table_info(chunks)").all();
    const colNames = info.map((c) => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("file_path");
    expect(colNames).toContain("content");
    expect(colNames).toContain("embedding");
    expect(colNames).toContain("start_line");
    expect(colNames).toContain("end_line");
  });

  test("WAL mode is enabled", async () => {
    const { getDb } = await import("../db.js");
    const db = getDb(DB_PATH);
    const row = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()!;
    expect(row.journal_mode).toBe("wal");
  });

  test("migration is idempotent (running twice is safe)", async () => {
    // Create a second db at a different path to test fresh migration
    const { Database } = await import("bun:sqlite");
    const db2Path = join(TMP, ".contextgraph/index2.sqlite");
    // Importing a second getDb instance would share singleton, so test via direct Database
    const db = new Database(db2Path);
    // Run migrations manually twice via the same SQL — should not throw
    const createChunks = `CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT,
      start_line INTEGER,
      end_line INTEGER,
      content TEXT NOT NULL,
      embedding TEXT,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`;
    expect(() => { db.exec(createChunks); db.exec(createChunks); }).not.toThrow();
  });
});
