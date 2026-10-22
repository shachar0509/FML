import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { nodeDirs } from "@/core/lib/platform";
import { EnginePool } from "./knowledge/engine";
import { ensureEngine } from "./knowledge/install";
import { createKnowledge, knowledgeDir } from "./knowledge/knowledge";
import { initNode } from "./platform";
import { createServer } from "./server";

process.env.SHALAV_PDF_FONTS ||= fileURLToPath(new URL("./standard_fonts/", import.meta.url));
await initNode();
// The student-model engine (M61): downloaded once per device in the background, one process per course while used.
let bin: Promise<string> | undefined;
const engineBin = () =>
  (bin ??= ensureEngine(join(nodeDirs.config ?? "", "engines"), (p) => (knowledge.installing = p < 100 ? p : null))
    .finally(() => (knowledge.installing = null))
    .catch((e: unknown) => ((bin = undefined), Promise.reject(e))));
const engines = new EnginePool(engineBin, (n) => join(knowledgeDir(n), "engine"));
const knowledge = createKnowledge((n) => engines.get(n));
process.on("exit", () => void engines.closeAll());
await createServer(undefined, undefined, undefined, knowledge).connect(new StdioServerTransport());
