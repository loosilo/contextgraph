if (process.argv.includes("--http")) {
  await import("./http.js");
} else {
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { createBlastRadiusServer } = await import("./server.js");
  const PROJECT_ROOT = process.env.PROJECT_ROOT ?? process.cwd();
  const server = createBlastRadiusServer(PROJECT_ROOT);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
