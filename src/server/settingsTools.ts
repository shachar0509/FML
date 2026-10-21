import { COURSE_ID_RE, university } from "@/core/universities";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { SettingsData } from "@/cards/types";
import { buildKnowledgeBoundary } from "@/core/domain/boundary/boundary";
import { loadCourse, listCourses } from "@/core/domain/courses/courses";
import { SettingsSchema } from "@/core/domain/schemas";
import { findConflictCopies } from "@/core/lib/fs/conflicts";
import { useSettings } from "@/stores/settings";
import { CARDS_URI } from "./resources";

const appOnly = { ui: { resourceUri: CARDS_URI, visibility: ["app" as const] } };
const out = (text: string, structuredContent?: object) => ({ content: [{ type: "text" as const, text }], ...(structuredContent ? { structuredContent: structuredContent as Record<string, unknown> } : {}) });
const fail = (text: string) => ({ ...out(text), isError: true as const });
const patch = z.object({ language: z.enum(["he", "en"]).optional(), learning: SettingsSchema.shape.learning.optional() });

/** Settings card (plan v2 §6.8) and the side-question context (§6.7). */
export function registerSettingsTools(server: McpServer) {
  const sets = () => useSettings.getState().settings;
  async function data(): Promise<SettingsData> {
    const { language, theme, dataRoot, learning } = sets();
    return { view: "settings", language, theme, university: university()?.id ?? null, dataRoot, learning, conflicts: await findConflictCopies(dataRoot) };
  }

  registerAppTool(server, "shalav_settings", { title: "Shalav settings", description: "Show the settings card (language, data folder, learning criteria).", _meta: { ui: { resourceUri: CARDS_URI } } }, async () => out("The settings card is shown.", await data()));

  registerAppTool(server, "settings_update", { title: "Update settings", description: "Card-only: change the language or the learning criteria.", inputSchema: patch, _meta: appOnly }, async (p) => {
    useSettings.getState().update({ ...(p.language ? { language: p.language } : {}), ...(p.learning ? { learning: p.learning } : {}) });
    return out("ok", await data());
  });

  server.registerTool(
    "shalav_context",
    {
      title: "Study context",
      description: "For side questions during study: the student's knowledge boundary (what they have and have not learned), the current stage and the nearby plan. Answer only with what the boundary allows. courseNumber defaults to the only course; stageId to the current stage.",
      inputSchema: z.object({ courseNumber: z.string().regex(COURSE_ID_RE).optional(), stageId: z.string().optional() }),
    },
    async ({ courseNumber, stageId }) => {
      const all = await listCourses();
      const c = courseNumber ? await loadCourse(courseNumber) : all.length === 1 ? all[0] : null;
      if (!c) return fail(all.length ? `Say which course: ${all.map((x) => `${x.course.courseNumber} ${x.course.nameHe}`).join("; ")}.` : "No courses yet.");
      if (!c.plan || !c.progress) return fail(`Course ${c.course.courseNumber} has no study plan yet.`);
      const { plan, progress } = c;
      const id = stageId ?? progress.currentStageId;
      const i = plan.stages.findIndex((s) => s.id === id);
      const cur = plan.stages[i];
      const near = plan.stages.slice(Math.max(0, i - 2), i + 4).map((s) => `${s.id} ${s.title} [${progress.stages[s.id]?.status ?? "locked"}]`);
      return out([
        `Course ${c.course.courseNumber} — ${c.course.nameHe}. Progress ${progress.totals.stagesCompleted}/${progress.totals.stagesTotal} stages.`,
        buildKnowledgeBoundary({ course: c.course, plan, progress, currentStageId: id ?? null }),
        cur ? `Current stage ${cur.id} — ${cur.title}\nObjectives: ${cur.objectives.join("; ")}` : "No current stage (all done or none started).",
        `Plan nearby:\n${near.join("\n")}`,
        `Answer in ${sets().language === "he" ? "Hebrew" : "English"}. Do not use anything listed under "Not learned yet".`,
      ].join("\n\n"));
    },
  );
}
