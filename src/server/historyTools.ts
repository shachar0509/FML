import { COURSE_ID_RE } from "@/core/universities";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { deleteConvs, listConvs } from "@/core/domain/history/history";
import { CARDS_URI } from "./resources";

const appOnly = { ui: { resourceUri: CARDS_URI, visibility: ["app" as const] } };
const out = (structuredContent: object) => ({ content: [{ type: "text" as const, text: "ok" }], structuredContent: structuredContent as Record<string, unknown> });
const shape = { number: z.string().regex(COURSE_ID_RE), kind: z.enum(["lesson", "practice"]) };

/** M60: the saved lessons / practice sessions of a course (newest first), and deleting them. `forget` ends a deleted one that is running. */
export function registerHistoryTools(server: McpServer, forget: (n: string, ids: string[]) => Promise<void>) {
  registerAppTool(server, "history_list", { title: "Saved sessions", description: "Card-only: the saved lessons or practice sessions of a course, newest first.", inputSchema: z.object(shape), _meta: appOnly }, async ({ number, kind }) =>
    out({ items: await listConvs(number, kind) }),
  );
  registerAppTool(
    server,
    "history_delete",
    { title: "Delete saved sessions", description: "Card-only: delete saved lessons or practice sessions.", inputSchema: z.object({ ...shape, ids: z.array(z.string().max(64)).min(1).max(1000) }), _meta: appOnly },
    async ({ number, kind, ids }) => {
      await forget(number, ids);
      await deleteConvs(number, ids);
      return out({ items: await listConvs(number, kind) });
    },
  );
}
