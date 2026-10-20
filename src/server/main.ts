import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { initNode } from "./platform";
import { createServer } from "./server";

await initNode();
await createServer().connect(new StdioServerTransport());
