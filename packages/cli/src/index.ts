#!/usr/bin/env bun
import chalk from "chalk";
import {
  indexProject, listMemories, deleteMemory, recallLearnings,
  analyzeImpact, computeRiskScore, auditMemories,
  saveCheckpoint, getLatestCheckpoint, listCheckpoints,
} from "@loosilo/contextgraph-core";
import { join, resolve, dirname } from "node:path";
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const command = args[0];
const PROJECT_ROOT = process.env.PROJECT_ROOT ?? process.cwd();

// ── Paths ───────────────────────────────────────────────────────────────────

const CONTEXTGRAPH_DIR = join(PROJECT_ROOT, ".contextgraph");
const PIDS_FILE = join(CONTEXTGRAPH_DIR, "servers.json");
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
const MCP_CG_HTTP  = join(dirname(_require.resolve("@loosilo/contextgraph-mcp/package.json")), "src/http.ts");
const MCP_BR_HTTP  = join(dirname(_require.resolve("@loosilo/blastradius-mcp/package.json")), "src/http.ts");
const MCP_CG_STDIO = join(dirname(_require.resolve("@loosilo/contextgraph-mcp/package.json")), "src/index.ts");
const MCP_BR_STDIO = join(dirname(_require.resolve("@loosilo/blastradius-mcp/package.json")), "src/index.ts");

// ── Help ────────────────────────────────────────────────────────────────────

function help() {
  console.log(`
${chalk.bold("cograph")} — ContextGraph control plane

${chalk.bold("Server management:")}

  ${chalk.cyan("cograph start")}                          Start both MCP servers (HTTP mode)
  ${chalk.cyan("cograph stop")}                           Stop running MCP servers
  ${chalk.cyan("cograph status")}                         Show server status and index stats
  ${chalk.cyan("cograph register")}                       Write stdio config for Claude Code / Cursor
  ${chalk.cyan("cograph register --http")}                Write HTTP config (use after cograph start)

${chalk.bold("Indexing:")}

  ${chalk.cyan("cograph index")} [path]                   Index/re-index a project (default: cwd)

${chalk.bold("Memory:")}

  ${chalk.cyan("cograph memory list")}                    List all stored memories
  ${chalk.cyan("cograph memory recall")} <topic>          Recall memories about a topic
  ${chalk.cyan("cograph memory delete")} <id>             Delete a memory by ID
  ${chalk.cyan("cograph memory audit")}                   Flag stale memories (no matching code)

${chalk.bold("Checkpoints:")}

  ${chalk.cyan("cograph checkpoint save")} <summary>      Save session checkpoint
  ${chalk.cyan("cograph checkpoint get")}                 Show latest checkpoint
  ${chalk.cyan("cograph checkpoint list")}                List all checkpoints

${chalk.bold("Analysis:")}

  ${chalk.cyan("cograph blast")} <file>                   Analyze blast radius for a file

${chalk.bold("Setup:")}

  ${chalk.cyan("cograph instructions")}                   Print system-prompt snippet to auto-trigger tools

${chalk.bold("Options:")}
  --root <path>   Override project root
  --help          Show this help
`);
}

// ── Server management ───────────────────────────────────────────────────────

interface ServerPids {
  contextgraph?: { pid: number; port: number; startedAt: string };
  blastradius?:  { pid: number; port: number; startedAt: string };
}

function readPids(): ServerPids {
  try { return JSON.parse(readFileSync(PIDS_FILE, "utf8")); } catch { return {}; }
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function cmdStart() {
  mkdirSync(CONTEXTGRAPH_DIR, { recursive: true });
  const existing = readPids();
  const bunPath = spawnSync("which", ["bun"], { encoding: "utf8" }).stdout.trim() || "bun";

  const portCG = parseInt(process.env.PORT_CG ?? "3841");
  const portBR = parseInt(process.env.PORT_BR ?? "3842");

  // Stop any already-running servers first
  if (existing.contextgraph?.pid && isAlive(existing.contextgraph.pid)) {
    try { process.kill(existing.contextgraph.pid, "SIGTERM"); } catch { /**/ }
  }
  if (existing.blastradius?.pid && isAlive(existing.blastradius.pid)) {
    try { process.kill(existing.blastradius.pid, "SIGTERM"); } catch { /**/ }
  }

  const cgProc = spawn(bunPath, [MCP_CG_HTTP], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PROJECT_ROOT, PORT: String(portCG) },
  });
  cgProc.unref();

  const brProc = spawn(bunPath, [MCP_BR_HTTP], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PROJECT_ROOT, PORT: String(portBR) },
  });
  brProc.unref();

  const pids: ServerPids = {
    contextgraph: { pid: cgProc.pid!, port: portCG, startedAt: new Date().toISOString() },
    blastradius:  { pid: brProc.pid!, port: portBR, startedAt: new Date().toISOString() },
  };
  writeFileSync(PIDS_FILE, JSON.stringify(pids, null, 2));

  console.log(chalk.green("✓ ContextGraph MCP server started"));
  console.log(`  URL: ${chalk.cyan(`http://localhost:${portCG}/mcp`)}  (pid ${cgProc.pid})`);
  console.log(chalk.green("✓ BlastRadius MCP server started"));
  console.log(`  URL: ${chalk.cyan(`http://localhost:${portBR}/mcp`)}  (pid ${brProc.pid})`);
  console.log();
  console.log(`Run ${chalk.cyan("cograph register --http")} to write these URLs into your editor config.`);
}

function cmdStop() {
  const pids = readPids();
  let stopped = 0;

  if (pids.contextgraph?.pid) {
    try { process.kill(pids.contextgraph.pid, "SIGTERM"); stopped++; console.log(chalk.green("✓ Stopped contextgraph")); }
    catch { console.log(chalk.yellow("  contextgraph was not running")); }
  }
  if (pids.blastradius?.pid) {
    try { process.kill(pids.blastradius.pid, "SIGTERM"); stopped++; console.log(chalk.green("✓ Stopped blastradius")); }
    catch { console.log(chalk.yellow("  blastradius was not running")); }
  }

  if (existsSync(PIDS_FILE)) rmSync(PIDS_FILE);
  if (stopped === 0) console.log("No servers were running.");
}

function cmdStatus() {
  // Server processes
  const pids = readPids();
  console.log(chalk.bold("MCP Servers"));

  const servers = [
    { name: "contextgraph", info: pids.contextgraph },
    { name: "blastradius",  info: pids.blastradius },
  ];
  for (const { name, info } of servers) {
    if (info && isAlive(info.pid)) {
      console.log(`  ${chalk.green("●")} ${name.padEnd(16)} http://localhost:${info.port}/mcp  (pid ${info.pid})`);
    } else {
      console.log(`  ${chalk.gray("○")} ${name.padEnd(16)} ${chalk.gray("not running")}`);
    }
  }

  // Index stats
  const dbPath = join(PROJECT_ROOT, ".contextgraph/index.sqlite");
  if (!existsSync(dbPath)) {
    console.log(chalk.yellow("\nNo index found. Run: cograph index"));
    return;
  }

  const { Database } = require("bun:sqlite");
  const db = new Database(dbPath);
  const chunks   = (db.query("SELECT COUNT(*) as n FROM chunks").get()      as { n: number }).n;
  const memories = (db.query("SELECT COUNT(*) as n FROM memories").get()    as { n: number }).n;
  const stale    = (db.query("SELECT COUNT(*) as n FROM memories WHERE stale=1").get() as { n: number }).n;
  const files    = (db.query("SELECT COUNT(*) as n FROM file_meta").get()   as { n: number }).n;
  const edges    = (db.query("SELECT COUNT(*) as n FROM graph_edges").get() as { n: number }).n;
  const checkpts = (db.query("SELECT COUNT(*) as n FROM checkpoints").get() as { n: number }).n;
  const expands  = (db.query("SELECT COUNT(*) as n FROM query_log WHERE action='expand'").get() as { n: number }).n;
  const ctxRow   = db.query("SELECT file FROM context_state WHERE id=1").get() as { file: string } | null;

  console.log(chalk.bold("\nIndex"));
  console.log(`  Files          : ${chalk.cyan(files)}`);
  console.log(`  Chunks         : ${chalk.cyan(chunks)}`);
  console.log(`  Graph edges    : ${chalk.cyan(edges)}`);
  console.log(`  Memories       : ${chalk.cyan(memories)}${stale ? chalk.yellow(` (${stale} stale)`) : ""}`);
  console.log(`  Checkpoints    : ${chalk.cyan(checkpts)}`);
  console.log(`  Feedback       : ${chalk.cyan(expands)} expand(s)`);
  console.log(`  Current file   : ${ctxRow?.file ? chalk.gray(ctxRow.file) : chalk.gray("(none)")}`);
  console.log(`  DB path        : ${chalk.gray(dbPath)}`);
}

// ── Register ────────────────────────────────────────────────────────────────

function cmdRegister() {
  const httpMode = args.includes("--http");
  const bunPath = spawnSync("which", ["bun"], { encoding: "utf8" }).stdout.trim() || "bun";
  const pids = readPids();

  // Determine config file locations for known editors
  const configs: { name: string; path: string }[] = [
    { name: "Claude Code", path: join(process.env.HOME ?? "~", ".claude", "claude_desktop_config.json") },
    { name: "Cursor",      path: join(process.env.HOME ?? "~", ".cursor", "mcp.json") },
  ];

  for (const { name, path: configPath } of configs) {
    let config: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try { config = JSON.parse(readFileSync(configPath, "utf8")); } catch { /**/ }
    }

    const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>;

    if (httpMode) {
      const portCG = pids.contextgraph?.port ?? 3841;
      const portBR = pids.blastradius?.port ?? 3842;
      mcpServers["contextgraph"] = { url: `http://localhost:${portCG}/mcp` };
      mcpServers["blastradius"]  = { url: `http://localhost:${portBR}/mcp` };
    } else {
      mcpServers["contextgraph"] = {
        command: bunPath,
        args: [MCP_CG_STDIO],
        env: { PROJECT_ROOT },
      };
      mcpServers["blastradius"] = {
        command: bunPath,
        args: [MCP_BR_STDIO],
        env: { PROJECT_ROOT },
      };
    }

    config.mcpServers = mcpServers;
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(chalk.green(`✓ ${name}: ${configPath}`));
  }

  console.log(chalk.gray("\nRestart your editor to pick up the changes."));

  if (!httpMode) {
    console.log(chalk.gray("\nMode: stdio (editor manages server lifecycle)"));
    console.log(chalk.gray("Tip:  run 'cograph start' + 'cograph register --http' for HTTP mode (shared across editors)"));
  } else {
    console.log(chalk.gray("\nMode: HTTP (servers run independently via 'cograph start')"));
  }
}

// ── Index ───────────────────────────────────────────────────────────────────

async function cmdIndex() {
  const root = resolve(args[1] ?? PROJECT_ROOT);
  console.log(chalk.cyan(`Indexing ${root}...`));
  const result = await indexProject(root);
  console.log(chalk.green(`✓ Indexed ${result.files} files, ${result.chunks} chunks`));
}

// ── Memory ──────────────────────────────────────────────────────────────────

async function cmdMemory() {
  const sub = args[1];

  if (sub === "list") {
    const mems = listMemories(PROJECT_ROOT);
    if (!mems.length) { console.log("No memories stored."); return; }
    for (const m of mems) {
      const date = new Date(m.created_at * 1000).toLocaleDateString();
      const staleTag = m.stale ? chalk.yellow(" [stale]") : "";
      console.log(`${chalk.gray(m.id.slice(0, 8))} ${chalk.yellow(`[${date}]`)}${staleTag} ${m.content}`);
      if (m.tags.length) console.log(`  tags: ${m.tags.join(", ")}`);
    }
  } else if (sub === "recall") {
    const topic = args.slice(2).join(" ");
    if (!topic) { console.error("Usage: cograph memory recall <topic>"); process.exit(1); }
    const results = await recallLearnings(topic, PROJECT_ROOT);
    if (!results.length) { console.log("No relevant memories found."); return; }
    for (const r of results) {
      const staleTag = r.stale ? chalk.yellow(" [stale]") : "";
      console.log(`${chalk.cyan(`[${r.score.toFixed(2)}]`)}${staleTag} ${r.content}`);
    }
  } else if (sub === "delete") {
    const id = args[2];
    if (!id) { console.error("Usage: cograph memory delete <id>"); process.exit(1); }
    const ok = deleteMemory(id, PROJECT_ROOT);
    console.log(ok ? chalk.green("Deleted.") : chalk.red("Not found."));
  } else if (sub === "audit") {
    console.log(chalk.cyan("Auditing memories for staleness..."));
    const { audited, markedStale } = await auditMemories(PROJECT_ROOT);
    if (markedStale > 0) {
      console.log(chalk.yellow(`⚠  ${markedStale} of ${audited} memories flagged stale`));
      console.log(chalk.gray("   Run 'cograph memory list' to review, 'cograph memory delete <id>' to clean up."));
    } else {
      console.log(chalk.green(`✓ All ${audited} memories look current.`));
    }
  } else {
    console.error("Usage: cograph memory [list|recall|delete|audit]");
  }
}

// ── Checkpoint ──────────────────────────────────────────────────────────────

function cmdCheckpoint() {
  const sub = args[1];

  if (sub === "save") {
    const summary = args.slice(2).join(" ");
    if (!summary) { console.error("Usage: cograph checkpoint save <summary>"); process.exit(1); }
    const id = saveCheckpoint(summary, [], PROJECT_ROOT);
    console.log(chalk.green(`✓ Checkpoint saved (${id.slice(0, 8)})`));
  } else if (sub === "get") {
    const cp = getLatestCheckpoint(PROJECT_ROOT);
    if (!cp) { console.log("No checkpoints yet."); return; }
    const date = new Date(cp.createdAt * 1000).toLocaleString();
    console.log(`${chalk.bold("Latest checkpoint")} ${chalk.gray(`[${date}]`)}`);
    console.log(`  ${cp.summary}`);
    if (cp.openTasks.length) {
      console.log(chalk.bold("\n  Open tasks:"));
      for (const t of cp.openTasks) console.log(`    - ${t}`);
    }
  } else if (sub === "list") {
    const list = listCheckpoints(PROJECT_ROOT);
    if (!list.length) { console.log("No checkpoints yet."); return; }
    for (const cp of list) {
      const date = new Date(cp.createdAt * 1000).toLocaleDateString();
      console.log(`${chalk.gray(cp.id.slice(0, 8))} ${chalk.yellow(`[${date}]`)} ${cp.summary.slice(0, 80)}`);
    }
  } else {
    console.error("Usage: cograph checkpoint [save|get|list]");
  }
}

// ── Blast ───────────────────────────────────────────────────────────────────

function cmdBlast() {
  const file = resolve(args[1] ?? "");
  if (!args[1]) { console.error("Usage: cograph blast <file>"); process.exit(1); }
  const impacts = analyzeImpact(file, PROJECT_ROOT);
  const { score, label } = computeRiskScore(impacts);
  const color = label === "critical" ? chalk.red : label === "high" ? chalk.yellow : label === "medium" ? chalk.blue : chalk.green;
  console.log(`${chalk.bold("Blast Radius:")} ${file}`);
  console.log(`Risk: ${color(label.toUpperCase())} (${score}/100)`);
  console.log(`Total affected: ${impacts.length}`);
  const direct = impacts.filter((i) => i.depth === 1);
  if (direct.length) { console.log(chalk.bold("\nDirect dependents:")); for (const i of direct) console.log(`  ${i.file}`); }
  const tests = impacts.filter((i) => i.isTest);
  if (tests.length) { console.log(chalk.bold("\nTest files:")); for (const t of tests) console.log(`  ${t.file}`); }
}

// ── Instructions ────────────────────────────────────────────────────────────

function cmdInstructions() {
  const snippet = `
## ContextGraph — automatic context rules

At the start of every conversation:
1. Call \`start_task\` with a brief description of what you are working on.
   - This recalls relevant memories AND loads code context in one call.
   - Pass \`token_budget: 3000\` to keep context within a safe limit.

Before editing any file:
2. Call \`set_context\` with the absolute path of the file you are about to change.
   - This boosts search results for files nearby in the dependency graph.

Before any significant edit to a shared/core file:
3. Call \`analyze_impact\` (blastradius) to understand what else will be affected.

During work:
4. Call \`search_context\` for additional context as needed.
   - Pass \`exclude: [<chunk_ids already in context>]\` to avoid re-sending duplicates.
   - Pass \`token_budget: <N>\` instead of guessing density/topK.

At the end of every conversation:
5. Call \`save_checkpoint\` with a summary and a list of open tasks.
6. If you discovered something non-obvious, call \`save_learning\` to persist it.
`.trim();

  console.log(chalk.bold("Paste this into your editor's system prompt or CLAUDE.md:\n"));
  console.log(snippet);
  console.log();
  console.log(chalk.gray("CLAUDE.md location (project-level): ") + chalk.cyan(join(PROJECT_ROOT, "CLAUDE.md")));
  console.log(chalk.gray("Cursor system prompt: ") + chalk.cyan("Settings → Features → Rules for AI"));
}

// ── Router ──────────────────────────────────────────────────────────────────

if (!command || command === "--help" || command === "help") {
  help();
} else if (command === "start") {
  cmdStart();
} else if (command === "stop") {
  cmdStop();
} else if (command === "status") {
  cmdStatus();
} else if (command === "register") {
  cmdRegister();
} else if (command === "index") {
  await cmdIndex();
} else if (command === "memory") {
  await cmdMemory();
} else if (command === "checkpoint") {
  cmdCheckpoint();
} else if (command === "blast") {
  cmdBlast();
} else if (command === "instructions") {
  cmdInstructions();
} else {
  console.error(chalk.red(`Unknown command: ${command}`));
  help();
  process.exit(1);
}
