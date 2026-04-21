import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createContextGraphServer } from "./server.js";

const PROJECT_ROOT = process.env.PROJECT_ROOT ?? process.cwd();
const PORT = parseInt(process.env.PORT ?? "3841");

const server = createContextGraphServer(PROJECT_ROOT);

// Map session IDs to transports for stateful connections
const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();

Bun.serve({
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Health check
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", server: "contextgraph", projectRoot: PROJECT_ROOT });
    }

    // MCP endpoint
    if (url.pathname === "/mcp") {
      const sessionId = req.headers.get("mcp-session-id") ?? undefined;
      let transport = sessionId ? sessions.get(sessionId) : undefined;

      if (!transport) {
        transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (id) => sessions.set(id, transport!),
        });
        sessions.set(transport.sessionId ?? "default", transport);
        await server.connect(transport);
      }

      return transport.handleRequest(req);
    }

    return new Response("ContextGraph MCP server\nEndpoints: GET /health  POST /mcp", { status: 200 });
  },
});

console.error(`[contextgraph] HTTP MCP server listening on http://localhost:${PORT}/mcp`);
console.error(`[contextgraph] Project root: ${PROJECT_ROOT}`);
