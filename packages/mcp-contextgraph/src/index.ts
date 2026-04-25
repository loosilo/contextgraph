if (process.argv.includes("--http")) {
  await import("./http.js");
} else {
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { createContextGraphServer } = await import("./server.js");
  const PROJECT_ROOT = process.env.PROJECT_ROOT ?? process.cwd();
  const server = createContextGraphServer(PROJECT_ROOT);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
