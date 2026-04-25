import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createBlastRadiusServer } from "./server.js";

const PROJECT_ROOT = process.env.PROJECT_ROOT ?? process.cwd();
const PORT = parseInt(process.env.PORT ?? "3842");

const server = createBlastRadiusServer(PROJECT_ROOT);
const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();

Bun.serve({
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok", server: "blastradius", projectRoot: PROJECT_ROOT });
    }

    if (url.pathname === "/mcp") {
      const sessionId = req.headers.get("mcp-session-id") ?? undefined;
      let transport = sessionId ? sessions.get(sessionId) : undefined;

      if (!transport) {
        transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (id) => { sessions.set(id, transport!); },
        });
        sessions.set(transport.sessionId ?? "default", transport);
        await server.connect(transport);
      }

      return transport.handleRequest(req);
    }

    return new Response("BlastRadius MCP server\nEndpoints: GET /health  POST /mcp", { status: 200 });
  },
});

console.error(`[blastradius] HTTP MCP server listening on http://localhost:${PORT}/mcp`);
console.error(`[blastradius] Project root: ${PROJECT_ROOT}`);
