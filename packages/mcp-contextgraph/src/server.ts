import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  searchContext, compressChunks, renderContext,
  saveLearning, recallLearnings, indexProject, getDb,
  logExpand, hashQuery,
  auditMemories, saveCheckpoint, getLatestCheckpoint,
} from "@contextgraph/core";
import { join } from "node:path";

// Extract the first file-path-like token from a query string to auto-seed context.
function extractFilePath(query: string): string | undefined {
  const match = query.match(/(?:^|\s)([\w./\-@]+\.(?:ts|tsx|js|jsx|py|md|go|rs))/);
  return match?.[1];
}

export function createContextGraphServer(projectRoot: string): McpServer {
  const server = new McpServer({ name: "contextgraph", version: "0.2.0" });

  server.registerTool(
    "search_context",
    {
      description: "Search indexed code/docs for chunks relevant to a task. Use `exclude` to skip chunk IDs already in context. Use `token_budget` to auto-fit results into a token limit (overrides density).",
      inputSchema: {
        query: z.string().describe("The task or question to find relevant context for"),
        topK: z.number().optional().default(10),
        density: z.enum(["minimal", "sparse", "balanced", "detailed", "thorough"]).optional().default("balanced"),
        exclude: z.array(z.string()).optional().default([]).describe("Chunk IDs already in your context window — skip re-sending them"),
        token_budget: z.number().optional().describe("Max tokens to use. When set, density is ignored and chunks are greedily fitted."),
      },
    },
    async ({ query, topK, density, exclude, token_budget }) => {
      // Auto-seed structural signal if query mentions a file path
      const db = getDb(join(projectRoot, ".contextgraph/index.sqlite"));
      const existingCtx = (db.query<{ file: string }, []>("SELECT file FROM context_state WHERE id=1").get())?.file;
      const autoFile = extractFilePath(query);
      if (autoFile && !existingCtx) {
        db.run("INSERT OR REPLACE INTO context_state (id, file) VALUES (1, ?)", [autoFile]);
      }

      const chunks = await searchContext(query, projectRoot, topK);
      const { chunks: compressed, dropped } = compressChunks(chunks, density, {
        exclude,
        tokenBudget: token_budget,
      });
      const rendered = renderContext(compressed, query, dropped);
      const tokenEst = Math.ceil(rendered.length / 4);
      const seenIds  = compressed.map((c) => c.id);

      return {
        content: [{
          type: "text",
          text: [
            rendered,
            `---`,
            `*~${tokenEst} tokens | ${compressed.length} chunks shown${dropped ? ` | ${dropped} dropped` : ""}${exclude.length ? ` | ${exclude.length} excluded` : ""}*`,
            `*chunk_ids: ${seenIds.join(", ")}*`,
          ].join("\n"),
        }],
      };
    }
  );

  server.registerTool(
    "expand_chunk",
    {
      description: "Fetch the full content of a chunk by its ID. Records a positive relevance signal to improve future searches.",
      inputSchema: {
        chunk_id: z.string().describe("The chunk_id from a stub or summary result"),
        query: z.string().optional().describe("The query that led to this chunk (improves future ranking)"),
      },
    },
    async ({ chunk_id, query }) => {
      const db = getDb(join(projectRoot, ".contextgraph/index.sqlite"));
      const row = db.query<{ content: string; file_path: string; start_line: number }, [string]>(
        "SELECT content, file_path, start_line FROM chunks WHERE id = ?"
      ).get(chunk_id);
      if (!row) return { content: [{ type: "text", text: `Chunk not found: ${chunk_id}` }] };
      logExpand(hashQuery(query ?? chunk_id), chunk_id, projectRoot);
      return {
        content: [{
          type: "text",
          text: `**${row.file_path}:${row.start_line}**\n\`\`\`\n${row.content}\n\`\`\``,
        }],
      };
    }
  );

  server.registerTool(
    "set_context",
    {
      description: "Tell ContextGraph which file you are currently editing. Enables the structural graph signal so nearby files score higher.",
      inputSchema: {
        file: z.string().describe("Absolute path to the file you are currently editing"),
      },
    },
    async ({ file }) => {
      const db = getDb(join(projectRoot, ".contextgraph/index.sqlite"));
      db.run("INSERT OR REPLACE INTO context_state (id, file) VALUES (1, ?)", [file]);
      return { content: [{ type: "text", text: `Context set to: ${file}` }] };
    }
  );

  server.registerTool(
    "start_task",
    {
      description: "One-shot task kickoff: recalls relevant memories AND searches for code context in a single call.",
      inputSchema: {
        task: z.string().describe("Description of the task you are about to work on"),
        density: z.enum(["minimal", "sparse", "balanced", "detailed", "thorough"]).optional().default("balanced"),
        token_budget: z.number().optional().describe("Max tokens for the code context section"),
      },
    },
    async ({ task, density, token_budget }) => {
      const [memories, chunks] = await Promise.all([
        recallLearnings(task, projectRoot, 3),
        searchContext(task, projectRoot, 8),
      ]);
      const sections: string[] = [];
      if (memories.length) {
        const staleWarning = memories.some((m) => m.stale) ? "\n> Some memories are flagged stale — verify before relying on them." : "";
        sections.push(`## Memories from past sessions${staleWarning}\n`);
        for (const m of memories) {
          sections.push(`- [${m.score.toFixed(2)}] ${m.content}${m.stale ? " *[stale]*" : ""}${m.tags.length ? ` *(${m.tags.join(", ")})*` : ""}`);
        }
      } else {
        sections.push("## Memories from past sessions\n*(none found for this topic)*");
      }
      sections.push("");
      const { chunks: compressed, dropped } = compressChunks(chunks, density, { tokenBudget: token_budget });
      sections.push(renderContext(compressed, task, dropped));
      const tokenEst = Math.ceil(sections.join("\n").length / 4);
      sections.push(`\n---\n*~${tokenEst} tokens | ${memories.length} memories | ${compressed.length} chunks${dropped ? ` | ${dropped} dropped` : ""}*`);
      return { content: [{ type: "text", text: sections.join("\n") }] };
    }
  );

  server.registerTool(
    "save_learning",
    {
      description: "Persist a learning or discovery to memory so future sessions can recall it.",
      inputSchema: {
        content: z.string().describe("The fact, rule, or discovery to remember"),
        tags: z.array(z.string()).optional().default([]),
      },
    },
    async ({ content, tags }) => {
      const id = await saveLearning(content, tags, projectRoot);
      return { content: [{ type: "text", text: `Saved learning (id: ${id})` }] };
    }
  );

  server.registerTool(
    "recall",
    {
      description: "Retrieve memories relevant to a topic from previous sessions. Stale memories are flagged.",
      inputSchema: {
        topic: z.string().describe("Topic or question to recall memories about"),
        topK: z.number().optional().default(5),
      },
    },
    async ({ topic, topK }) => {
      const memories = await recallLearnings(topic, projectRoot, topK);
      if (!memories.length) return { content: [{ type: "text", text: "No relevant memories found." }] };
      const text = memories.map((m) =>
        `- [${m.score.toFixed(2)}] ${m.content}${m.stale ? " *[stale]*" : ""}${m.tags.length ? ` *(${m.tags.join(", ")})*` : ""}`
      ).join("\n");
      return { content: [{ type: "text", text: `**Relevant memories:**\n${text}` }] };
    }
  );

  server.registerTool(
    "audit_memories",
    {
      description: "Flag stale memories that no longer match any code in the index. Run after large refactors.",
    },
    async () => {
      const { audited, markedStale } = await auditMemories(projectRoot);
      const msg = markedStale > 0
        ? `Audited ${audited} memories. Marked ${markedStale} as stale.`
        : `Audited ${audited} memories. All look current.`;
      return { content: [{ type: "text", text: msg }] };
    }
  );

  server.registerTool(
    "save_checkpoint",
    {
      description: "Save a session checkpoint — where you left off and what's still open.",
      inputSchema: {
        summary: z.string(),
        open_tasks: z.array(z.string()).optional().default([]),
      },
    },
    async ({ summary, open_tasks }) => {
      const id = saveCheckpoint(summary, open_tasks, projectRoot);
      return { content: [{ type: "text", text: `Checkpoint saved (id: ${id})` }] };
    }
  );

  server.registerTool(
    "get_checkpoint",
    {
      description: "Get the most recent session checkpoint to resume where you left off.",
    },
    async () => {
      const cp = getLatestCheckpoint(projectRoot);
      if (!cp) return { content: [{ type: "text", text: "No checkpoints saved yet." }] };
      const date = new Date(cp.createdAt * 1000).toLocaleString();
      const tasks = cp.openTasks.length ? `\n\n**Open tasks:**\n${cp.openTasks.map((t) => `- ${t}`).join("\n")}` : "";
      return { content: [{ type: "text", text: `**Last checkpoint** (${date})\n\n${cp.summary}${tasks}` }] };
    }
  );

  server.registerTool(
    "index_project",
    {
      description: "Index or re-index the project to update the context database.",
      inputSchema: {
        root: z.string().optional(),
      },
    },
    async ({ root }) => {
      const result = await indexProject(root ?? projectRoot);
      return { content: [{ type: "text", text: `Indexed ${result.files} files, ${result.chunks} chunks.` }] };
    }
  );

  return server;
}
