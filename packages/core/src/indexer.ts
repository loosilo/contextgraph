import { readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { getDb } from "./db.js";
import { parseFile, type Chunk } from "./parser.js";
import { embed, serializeEmbedding } from "./embeddings.js";
import simpleGit from "simple-git";

const SUPPORTED_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".md", ".go", ".rs"]);
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", ".contextgraph", ".next", "__pycache__"]);

export async function indexProject(projectRoot: string): Promise<{ files: number; chunks: number }> {
  const db = getDb(join(projectRoot, ".contextgraph/index.sqlite"));
  const git = simpleGit(projectRoot);
  let gitLog: Record<string, number> = {};

  try {
    const log = await git.log(["--name-only", "--pretty=format:%ct", "--diff-filter=M"]);
    for (const entry of log.all) {
      const ts = parseInt((entry as { hash: string }).hash, 10);
      // simple-git parses log differently; use raw approach
    }
    // simpler: get last commit timestamp per file
    const files = await collectFiles(projectRoot);
    for (const f of files) {
      try {
        const rel = relative(projectRoot, f);
        const result = await git.log(["--follow", "--pretty=format:%ct", "-1", "--", rel]);
        if (result.latest) {
          gitLog[f] = parseInt((result.latest as unknown as { hash: string }).hash, 10);
        }
      } catch { /* ignore */ }
    }
  } catch { /* not a git repo */ }

  const files = await collectFiles(projectRoot);
  let chunkCount = 0;

  for (const filePath of files) {
    const stat = statSync(filePath);
    const mtime = Math.floor(stat.mtimeMs / 1000);

    const cached = db.query<{ mtime: number }, [string]>(
      "SELECT mtime FROM file_meta WHERE path = ?"
    ).get(filePath);

    if (cached && cached.mtime === mtime) continue;

    const chunks = parseFile(filePath);

    db.transaction(() => {
      db.run("DELETE FROM chunks WHERE file_path = ?", [filePath]);
      for (const chunk of chunks) {
        db.run(
          "INSERT OR REPLACE INTO chunks (id, file_path, kind, name, start_line, end_line, content) VALUES (?,?,?,?,?,?,?)",
          [chunk.id, chunk.filePath, chunk.kind, chunk.name ?? null, chunk.startLine, chunk.endLine, chunk.content]
        );
      }
      db.run(
        "INSERT OR REPLACE INTO file_meta (path, mtime, git_updated_at) VALUES (?,?,?)",
        [filePath, mtime, gitLog[filePath] ?? null]
      );
    })();

    // embed chunks (batched to avoid rate limits)
    for (const chunk of chunks) {
      try {
        const vec = await embed(`${chunk.name ?? chunk.kind} ${chunk.content.slice(0, 512)}`);
        db.run("UPDATE chunks SET embedding = ? WHERE id = ?", [serializeEmbedding(vec), chunk.id]);
      } catch { /* embedding failure is non-fatal */ }
      chunkCount++;
    }
  }

  return { files: files.length, chunks: chunkCount };
}

export async function indexFile(projectRoot: string, filePath: string): Promise<void> {
  const db = getDb(join(projectRoot, ".contextgraph/index.sqlite"));
  const chunks = parseFile(filePath);
  const stat = statSync(filePath);
  const mtime = Math.floor(stat.mtimeMs / 1000);

  db.transaction(() => {
    db.run("DELETE FROM chunks WHERE file_path = ?", [filePath]);
    for (const chunk of chunks) {
      db.run(
        "INSERT OR REPLACE INTO chunks (id, file_path, kind, name, start_line, end_line, content) VALUES (?,?,?,?,?,?,?)",
        [chunk.id, chunk.filePath, chunk.kind, chunk.name ?? null, chunk.startLine, chunk.endLine, chunk.content]
      );
    }
    db.run("INSERT OR REPLACE INTO file_meta (path, mtime) VALUES (?,?)", [filePath, mtime]);
  })();

  for (const chunk of chunks) {
    const vec = await embed(`${chunk.name ?? chunk.kind} ${chunk.content.slice(0, 512)}`);
    db.run("UPDATE chunks SET embedding = ? WHERE id = ?", [serializeEmbedding(vec), chunk.id]);
  }
}

async function collectFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) walk(join(dir, entry.name));
      } else if (SUPPORTED_EXTS.has(extname(entry.name).toLowerCase())) {
        results.push(join(dir, entry.name));
      }
    }
  }
  walk(root);
  return results;
}
