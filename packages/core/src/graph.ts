import { readFileSync, existsSync } from "node:fs";
import { extname, resolve, dirname, join } from "node:path";
import { getDb } from "./db.js";

// ── tsconfig path alias resolution ─────────────────────────────────────────

interface TsConfig {
  baseUrl: string;
  paths: Record<string, string[]>;
}

const _tsConfigCache = new Map<string, TsConfig>();

function loadTsConfig(projectRoot: string): TsConfig {
  if (_tsConfigCache.has(projectRoot)) return _tsConfigCache.get(projectRoot)!;
  const empty: TsConfig = { baseUrl: projectRoot, paths: {} };

  for (const name of ["tsconfig.json", "tsconfig.base.json"]) {
    const configPath = join(projectRoot, name);
    if (!existsSync(configPath)) continue;
    try {
      const raw = JSON.parse(readFileSync(configPath, "utf8"));
      const opts = raw?.compilerOptions ?? {};
      const baseUrl = opts.baseUrl ? resolve(projectRoot, opts.baseUrl) : projectRoot;
      const paths = opts.paths ?? {};
      const result: TsConfig = { baseUrl, paths };
      _tsConfigCache.set(projectRoot, result);
      return result;
    } catch { /* malformed tsconfig */ }
  }

  _tsConfigCache.set(projectRoot, empty);
  return empty;
}

function resolveAlias(importPath: string, tsConfig: TsConfig): string | null {
  for (const [pattern, targets] of Object.entries(tsConfig.paths)) {
    const isWildcard = pattern.endsWith("/*");
    const prefix = isWildcard ? pattern.slice(0, -2) : pattern;

    if (isWildcard && importPath.startsWith(prefix + "/")) {
      const suffix = importPath.slice(prefix.length + 1);
      for (const target of targets) {
        const resolved = resolve(tsConfig.baseUrl, target.replace("*", suffix));
        const found = tryExtensions(resolved);
        if (found) return found;
      }
    } else if (!isWildcard && importPath === pattern) {
      for (const target of targets) {
        const resolved = resolve(tsConfig.baseUrl, target);
        const found = tryExtensions(resolved);
        if (found) return found;
      }
    }
  }
  return null;
}

// ── File resolution ─────────────────────────────────────────────────────────

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];

function tryExtensions(base: string): string | null {
  if (existsSync(base) && !base.endsWith("/")) {
    try {
      const stat = readFileSync(base); // will throw if directory
      return base;
    } catch { /* is a directory */ }
  }
  for (const ext of EXTENSIONS) {
    const candidate = `${base}${ext}`;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveImport(
  importPath: string,
  fromFile: string,
  projectRoot: string,
  tsConfig: TsConfig
): string | null {
  // Relative import
  if (importPath.startsWith(".")) {
    return tryExtensions(resolve(dirname(fromFile), importPath));
  }

  // Path alias
  const aliased = resolveAlias(importPath, tsConfig);
  if (aliased) return aliased;

  // Workspace monorepo package (name matches a local packages/* directory)
  const parts = importPath.split("/");
  const pkgName = parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
  const localPkg = join(projectRoot, "packages", pkgName.replace(/^@[^/]+\//, ""), "src/index.ts");
  if (existsSync(localPkg)) return localPkg;

  return null; // external package — ignore
}

// ── Barrel export following (one level deep) ────────────────────────────────

const EXPORT_RE = /(?:export\s+(?:\*|\{[^}]*\})\s+from|export\s+\*\s+from)\s*['"]([^'"]+)['"]/g;

function followBarrel(barrelPath: string, projectRoot: string, tsConfig: TsConfig, visited: Set<string>): string[] {
  if (visited.has(barrelPath)) return [];
  visited.add(barrelPath);

  let content: string;
  try { content = readFileSync(barrelPath, "utf8"); } catch { return []; }

  const results: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(EXPORT_RE.source, "g");
  while ((m = re.exec(content)) !== null) {
    const resolved = resolveImport(m[1], barrelPath, projectRoot, tsConfig);
    if (resolved) results.push(resolved);
  }
  return results;
}

// ── Import extraction ───────────────────────────────────────────────────────

const IMPORT_RE = /(?:from|import|require)\s*(?:\(?\s*)?['"]([^'"]+)['"]/g;

function extractImports(filePath: string, projectRoot: string, tsConfig: TsConfig): string[] {
  const ext = extname(filePath).toLowerCase();
  let content: string;
  try { content = readFileSync(filePath, "utf8"); } catch { return []; }

  const results = new Set<string>();

  if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
    let m: RegExpExecArray | null;
    const re = new RegExp(IMPORT_RE.source, "g");
    while ((m = re.exec(content)) !== null) {
      const resolved = resolveImport(m[1], filePath, projectRoot, tsConfig);
      if (!resolved) continue;
      results.add(resolved);

      // If it resolves to a barrel (index.ts), follow one level
      if (resolved.endsWith("index.ts") || resolved.endsWith("index.js")) {
        const barrelTargets = followBarrel(resolved, projectRoot, tsConfig, new Set([filePath]));
        for (const t of barrelTargets) results.add(t);
      }
    }
  }

  if (ext === ".py") {
    const re = /^(?:from\s+(\S+)\s+import|import\s+(\S+))/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const mod = (m[1] ?? m[2]).replace(/\./g, "/");
      const resolved = resolveImport(`./${mod}`, filePath, projectRoot, tsConfig);
      if (resolved) results.add(resolved);
    }
  }

  return Array.from(results);
}

// ── Graph build ─────────────────────────────────────────────────────────────

export function buildGraph(projectRoot: string, filePaths: string[]): void {
  // Clear tsconfig cache so changes to tsconfig.json are picked up on rebuild
  _tsConfigCache.delete(projectRoot);
  const db = getDb(join(projectRoot, ".contextgraph/index.sqlite"));
  const tsConfig = loadTsConfig(projectRoot);
  db.run("DELETE FROM graph_edges");

  const insert = db.prepare("INSERT OR IGNORE INTO graph_edges (from_file, to_file) VALUES (?,?)");
  db.transaction(() => {
    for (const filePath of filePaths) {
      const deps = extractImports(filePath, projectRoot, tsConfig);
      for (const dep of deps) insert.run(filePath, dep);
    }
  })();
}

// ── Traversal utilities ─────────────────────────────────────────────────────

export function getDirectDependents(filePath: string, projectRoot: string): string[] {
  const db = getDb(join(projectRoot, ".contextgraph/index.sqlite"));
  return db.query<{ from_file: string }, [string]>(
    "SELECT from_file FROM graph_edges WHERE to_file = ?"
  ).all(filePath).map((r) => r.from_file);
}

export function getDependencies(filePath: string, projectRoot: string): string[] {
  const db = getDb(join(projectRoot, ".contextgraph/index.sqlite"));
  return db.query<{ to_file: string }, [string]>(
    "SELECT to_file FROM graph_edges WHERE from_file = ?"
  ).all(filePath).map((r) => r.to_file);
}

export function getGraphDistance(
  fromFile: string,
  toFile: string,
  projectRoot: string,
  maxHops = 4
): number {
  if (fromFile === toFile) return 0;
  const db = getDb(join(projectRoot, ".contextgraph/index.sqlite"));
  const visited = new Set<string>([fromFile]);
  const queue: { file: string; dist: number }[] = [{ file: fromFile, dist: 0 }];

  while (queue.length > 0) {
    const { file, dist } = queue.shift()!;
    if (dist >= maxHops) continue;

    // Follow edges in both directions (imports and imported-by)
    const fwd = db.query<{ f: string }, [string]>("SELECT to_file as f FROM graph_edges WHERE from_file = ?").all(file).map(r => r.f);
    const rev = db.query<{ f: string }, [string]>("SELECT from_file as f FROM graph_edges WHERE to_file = ?").all(file).map(r => r.f);

    for (const neighbor of [...fwd, ...rev]) {
      if (neighbor === toFile) return dist + 1;
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ file: neighbor, dist: dist + 1 });
      }
    }
  }
  return maxHops + 1;
}

// ── Blast radius ─────────────────────────────────────────────────────────────

export interface ImpactResult {
  file: string;
  depth: number;
  isTest: boolean;
}

export function analyzeImpact(filePath: string, projectRoot: string, maxDepth = 5): ImpactResult[] {
  const db = getDb(join(projectRoot, ".contextgraph/index.sqlite"));
  const visited = new Map<string, number>();
  const queue: { file: string; depth: number }[] = [{ file: filePath, depth: 0 }];

  while (queue.length > 0) {
    const { file, depth } = queue.shift()!;
    if (depth > maxDepth) continue;
    const dependents = db.query<{ from_file: string }, [string]>(
      "SELECT from_file FROM graph_edges WHERE to_file = ?"
    ).all(file).map((r) => r.from_file);

    for (const dep of dependents) {
      if (!visited.has(dep) && depth + 1 <= maxDepth) {
        visited.set(dep, depth + 1);
        queue.push({ file: dep, depth: depth + 1 });
      }
    }
  }

  return Array.from(visited.entries()).map(([file, depth]) => ({
    file,
    depth,
    isTest: /\.(test|spec)\.[jt]sx?$/.test(file) || /\/__tests__\//.test(file),
  })).sort((a, b) => a.depth - b.depth);
}

export function computeRiskScore(impacts: ImpactResult[]): { score: number; label: "low" | "medium" | "high" | "critical" } {
  const direct = impacts.filter((i) => i.depth === 1).length;
  const transitive = impacts.filter((i) => i.depth > 1).length;
  const score = Math.min(100, direct * 10 + transitive * 2);
  const label = score >= 60 ? "critical" : score >= 30 ? "high" : score >= 10 ? "medium" : "low";
  return { score, label };
}
