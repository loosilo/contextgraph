import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { analyzeImpact, computeRiskScore, buildGraph, getDb } from "@loosilo/core";
import { join } from "node:path";

export function createBlastRadiusServer(projectRoot: string): McpServer {
  const server = new McpServer({ name: "blastradius", version: "0.2.0" });

  server.registerTool(
    "analyze_impact",
    {
      description: "Analyze the blast radius of changing a file — shows all dependents, depth, and risk score.",
      inputSchema: {
        file: z.string().describe("Path to the file you are about to change"),
        max_depth: z.number().optional().default(5),
      },
    },
    async ({ file, max_depth }) => {
      const impacts = analyzeImpact(file, projectRoot, max_depth);
      const { score, label } = computeRiskScore(impacts);
      if (!impacts.length) {
        return { content: [{ type: "text", text: `No dependents found for \`${file}\`. Safe to change.` }] };
      }
      const direct = impacts.filter((i) => i.depth === 1);
      const transitive = impacts.filter((i) => i.depth > 1);
      const tests = impacts.filter((i) => i.isTest);
      const lines = [
        `## Blast Radius: \`${file}\``,
        `**Risk: ${label.toUpperCase()} (${score}/100)**`,
        "",
        `**Direct dependents (${direct.length}):**`,
        ...direct.map((i) => `- \`${i.file}\``),
        "",
        transitive.length ? `**Transitive dependents (${transitive.length}):**` : "",
        ...transitive.map((i) => `- \`${i.file}\` (depth ${i.depth})`),
        "",
        tests.length ? `**Test files affected (${tests.length}):**` : "No test files affected.",
        ...tests.map((i) => `- \`${i.file}\``),
      ].filter(Boolean);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.registerTool(
    "safe_to_change",
    {
      description: "Quick check: is it safe to change this file? Returns JSON with risk level and affected count.",
      inputSchema: {
        file: z.string(),
      },
    },
    async ({ file }) => {
      const impacts = analyzeImpact(file, projectRoot);
      const { score, label } = computeRiskScore(impacts);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            file, risk: label, score,
            affected: impacts.length,
            direct: impacts.filter((i) => i.depth === 1).length,
          }),
        }],
      };
    }
  );

  server.registerTool(
    "rebuild_graph",
    {
      description: "Rebuild the dependency graph from scratch. Run after large refactors.",
    },
    async () => {
      const db = getDb(join(projectRoot, ".contextgraph/index.sqlite"));
      const files = db.query<{ file_path: string }, []>(
        "SELECT DISTINCT file_path FROM chunks"
      ).all().map((r) => r.file_path);
      buildGraph(projectRoot, files);
      return { content: [{ type: "text", text: `Graph rebuilt for ${files.length} files.` }] };
    }
  );

  return server;
}
