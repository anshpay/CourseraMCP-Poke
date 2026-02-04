import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCourseraServer } from "./coursera-server.js";

async function main() {
  const server = createCourseraServer();
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
