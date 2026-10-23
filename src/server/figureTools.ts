import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { FIGURE_KINDS, figureGuide } from "@/core/claude/prompts/figureGuides";
import { SERVER_KINDS, libraryParts, renderFigure } from "./figures/render";
import { CARDS_URI } from "./resources";

const appOnly = { ui: { resourceUri: CARDS_URI, visibility: ["app" as const] } };

/** M79: figure_guide (one kind's conventions, fetched once per kind per lesson) and figure_render (the card fetches a server drawing; it never enters the model's context). */
export function registerFigureTools(server: McpServer) {
  server.registerTool(
    "figure_guide",
    { title: "Figure guide", description: "The format, beat and colour conventions and an example of one figure kind for teach_step / show_figure. Call it once per kind per lesson, before the first figure of that kind.", inputSchema: z.object({ kind: z.enum(FIGURE_KINDS) }), annotations: { readOnlyHint: true } },
    async ({ kind }) => ({ content: [{ type: "text" as const, text: figureGuide(kind, kind === "bio" ? Object.keys(libraryParts()) : []) }] }),
  );
  registerAppTool(server, "figure_render", { title: "Draw a figure", description: "Card-only: the SVG of a figure drawn on the server.", inputSchema: z.object({ kind: z.enum(SERVER_KINDS), source: z.string().max(50_000) }), _meta: appOnly }, async ({ kind, source }) => {
    try {
      return { content: [{ type: "text" as const, text: "ok" }], structuredContent: { svg: await renderFigure(kind, source) } };
    } catch (e) {
      return { content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }], isError: true };
    }
  });
}
