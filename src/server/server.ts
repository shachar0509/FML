import { chooseUniversity } from "@/core/lib/firstRun";
import { UNIVERSITIES, UNIVERSITY_IDS, university } from "@/core/universities";
import { getUiCapability, registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/server";
import { listCourses } from "@/core/domain/courses/courses";
import * as z from "zod";
import { BridgeGateway } from "./bridge";
import type { HomeData } from "@/cards/types";
import { useSettings } from "@/stores/settings";
import type { CatalogSource } from "@/core/domain/catalog/catalog";
import { registerCourseTools } from "./courseTools";
import type { Moodle } from "./moodle";
import { registerMoodleTools } from "./moodleTools";
import { registerFileTools } from "./fileTools";
import { registerExerciseTools } from "./exerciseTools";
import { registerLearnTools } from "./learnTools";
import { registerPracticeTools } from "./practiceTools";
import { registerSettingsTools } from "./settingsTools";
import { INSTRUCTIONS } from "./instructions";
import { CARDS_URI, readCards } from "./resources";

/** Transport-agnostic: tests connect it to an in-memory transport, main.ts to stdio. */
export function createServer(bridge = new BridgeGateway(), catalog?: CatalogSource, moodleMake?: (profileDir: string) => Moodle): McpServer {
  const server = new McpServer({ name: "shalav", version: "2.0.0" }, { instructions: INSTRUCTIONS });

  registerAppResource(server, "Shalav cards", CARDS_URI, { description: "Shalav study cards" }, async () => ({
    contents: [{ uri: CARDS_URI, mimeType: RESOURCE_MIME_TYPE, text: await readCards() }],
  }));

  const home = async () => {
      const uni = university();
      const courses = uni ? await listCourses() : [];
      // With cards the student acts in the card; the model must not ask the same in chat (it does not see card clicks).
      const cards = !!getUiCapability(server.server.getClientCapabilities());
      const cardText = `${uni ? `${courses.length} course(s) shown in the card.` : "The card shows the university picker."} The student acts in the card; do not ask them in chat. The card already does choices and adds courses itself. When the student sends "▶️ המשך" / "▶️ Continue", call shalav_next_job.`;
      // Text fallback for hosts without cards: the courses and numbered next actions.
      const text = cards ? cardText : !uni ? `No university chosen yet. Ask the student: ${UNIVERSITY_IDS.map((i) => UNIVERSITIES[i].nameEn).join(", ")}; then call shalav_choose_university (it cannot be changed later).` : `${courses.length ? courses.map((c, i) => `${i + 1}. ${c.course.courseNumber} — ${c.course.nameHe}`).join("\n") : "No courses yet."}\nOptions: a) add a course (ask for the number, then course_lookup and course_create_request); ${courses.length ? "b) open a course (shalav_course); c) " : ""}settings (shalav_settings).`;
      const { language, theme } = useSettings.getState().settings;
      const data: HomeData = {
        view: "home",
        language,
        theme,
        university: uni?.id ?? null,
        courses: courses.map(({ course, plan, progress }) => {
          const t = progress?.totals;
          const stage = plan?.stages.find((x) => x.id === progress?.currentStageId);
          return {
            number: course.courseNumber,
            name: course.nameHe,
            credits: course.credits,
            pct: t && t.stagesTotal ? Math.round((100 * t.stagesCompleted) / t.stagesTotal) : 0,
            stage: stage ? `${stage.id} · ${stage.title}` : null,
          };
        }),
      };
      return { content: [{ type: "text" as const, text }], structuredContent: data };
  };
  registerAppTool(server, "shalav_home", { title: "My courses", description: "Show the student's Shalav courses and what to do next.", _meta: { ui: { resourceUri: CARDS_URI } } }, home);
  registerAppTool(
    server,
    "shalav_choose_university",
    { title: "Choose the university", description: "Set the student's university once (technion, huji, reichman, braude). It cannot be changed later; it sets the course number format.", inputSchema: z.object({ university: z.enum(UNIVERSITY_IDS) }), _meta: { ui: { resourceUri: CARDS_URI } } },
    async ({ university: id }) => {
      try {
        await chooseUniversity(useSettings.getState().settings.dataRoot, id);
      } catch (e) {
        return { content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }], isError: true };
      }
      return home();
    },
  );

  registerCourseTools(server, bridge, catalog);
  const moodle = registerMoodleTools(server, moodleMake);
  registerFileTools(server, bridge, { moodle });
  const exercises = registerExerciseTools(server, bridge);
  registerLearnTools(server, bridge, exercises);
  registerPracticeTools(server, bridge, exercises);
  registerSettingsTools(server);

  // Card requests (M15): the card posts only "▶️ Continue" in the chat; what it wants waits here for shalav_next_job.
  const inbox: string[] = [];
  registerAppTool(
    server,
    "shalav_request",
    {
      title: "Card request",
      description: "Card-only: queue what the student asked for in a card; the model gets it from shalav_next_job.",
      inputSchema: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("learn"), stageId: z.string().regex(/^S\d{3}$/), title: z.string().max(200) }),
        z.object({ kind: z.literal("relearn"), stageId: z.string().regex(/^S\d{3}$/), title: z.string().max(200) }),
        z.object({ kind: z.literal("answer"), text: z.string().min(1).max(4000) }),
      ]),
      _meta: { ui: { resourceUri: CARDS_URI, visibility: ["app"] } },
    },
    async (r) => {
      inbox.splice(0, inbox.length - 4); // ponytail: keep the last few, a stale click is not worth more
      inbox.push(
        r.kind === "answer"
          ? `The student answered the current question in the card:\n<answer>\n${r.text}\n</answer>\nRespond to it and continue the lesson.`
          : `The student wants to ${r.kind === "learn" ? "learn" : "learn again"} ${r.stageId} · ${r.title}. Call shalav_start_lesson with stageId ${r.stageId} and teach it.`,
      );
      return { content: [{ type: "text" as const, text: "ok" }], structuredContent: { ok: true } };
    },
  );
  server.registerTool(
    "shalav_next_job",
    { title: "Next Shalav job", description: "Fetch what the student asked for in a Shalav card, or the next pending Shalav AI job (instructions and the answer format). Call it when the student sends \"▶️ המשך\" / \"▶️ Continue\" or a card says work is pending." },
    async () => {
      const req = inbox.shift();
      if (req) return { content: [{ type: "text" as const, text: `Student request from the card:\n${req}${bridge.pending() || inbox.length ? "\n\nAfterwards call shalav_next_job again: more is pending." : ""}` }] };
      return { content: await bridge.nextWait() };
    },
  );
  server.registerTool(
    "shalav_submit_job",
    {
      title: "Submit Shalav job",
      description: "Answer a Shalav job. Pass `input` (matching the job's schema) or `text`. Returns the next job or the final result.",
      inputSchema: z.object({ jobId: z.number(), input: z.record(z.string(), z.unknown()).optional(), text: z.string().optional() }),
    },
    (a) => bridge.submit(a),
  );

  const prompt = (name: string, title: string, text: string) =>
    server.registerPrompt(name, { title, description: title }, () => ({
      messages: [{ role: "user", content: { type: "text", text } }],
    }));
  prompt("shalav_my_courses", "Shalav: my courses", "Show me my courses in Shalav (the Shalav home card).");
  prompt("shalav_continue_learning", "Shalav: continue learning", "Let's continue my lesson in Shalav where I stopped.");

  return server;
}
