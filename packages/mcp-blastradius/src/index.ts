import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBlastRadiusServer } from "./server.js";

const PROJECT_ROOT = process.env.PROJECT_ROOT ?? process.cwd();
const server = createBlastRadiusServer(PROJECT_ROOT);
const transport = new StdioServerTransport();
await server.connect(transport);
