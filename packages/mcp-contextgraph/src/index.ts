import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createContextGraphServer } from "./server.js";

const PROJECT_ROOT = process.env.PROJECT_ROOT ?? process.cwd();
const server = createContextGraphServer(PROJECT_ROOT);
const transport = new StdioServerTransport();
await server.connect(transport);
