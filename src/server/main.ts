import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { fileURLToPath } from "node:url";
import { initNode } from "./platform";
import { createServer } from "./server";

process.env.SHALAV_PDF_FONTS ||= fileURLToPath(new URL("./standard_fonts/", import.meta.url));
await initNode();
await createServer().connect(new StdioServerTransport());
