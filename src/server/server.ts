import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/server";
import { listCourses } from "@/domain/courses/courses";
import * as z from "zod";
import { BridgeGateway } from "./bridge";
import type { HomeData } from "@/cards/types";
import { useSettings } from "@/stores/settings";
import type { CatalogSource } from "@/domain/catalog/catalog";
import { registerCourseTools } from "./courseTools";
import { registerFileTools } from "./fileTools";
import { registerExerciseTools } from "./exerciseTools";
import { registerLearnTools } from "./learnTools";
import { registerPracticeTools } from "./practiceTools";
import { INSTRUCTIONS } from "./instructions";
import { CARDS_URI, readCards } from "./resources";

/** Transport-agnostic: tests connect it to an in-memory transport, main.ts to stdio. */
export function createServer(bridge = new BridgeGateway(), catalog?: CatalogSource): McpServer {
  const server = new McpServer({ name: "shalav", version: "2.0.0" }, { instructions: INSTRUCTIONS });

  registerAppResource(server, "Shalav cards", CARDS_URI, { description: "Shalav study cards" }, async () => ({
    contents: [{ uri: CARDS_URI, mimeType: RESOURCE_MIME_TYPE, text: await readCards() }],
  }));

  registerAppTool(
    server,
    "shalav_home",
    { title: "My courses", description: "Show the student's Shalav courses and what to do next.", _meta: { ui: { resourceUri: CARDS_URI } } },
    async () => {
      const courses = await listCourses();
      const text = courses.length
        ? courses.map((c, i) => `${i + 1}. ${c.course.courseNumber} — ${c.course.nameHe}`).join("\n")
        : "No courses yet. Ask the student which Technion course number to add.";
      const { language, theme } = useSettings.getState().settings;
      const data: HomeData = {
        view: "home",
        language,
        theme,
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
      return { content: [{ type: "text", text }], structuredContent: data };
    },
  );

  registerCourseTools(server, bridge, catalog);
  registerFileTools(server, bridge);
  const exercises = registerExerciseTools(server, bridge);
  registerLearnTools(server, bridge, exercises);
  registerPracticeTools(server, bridge, exercises);

  server.registerTool(
    "shalav_next_job",
    { title: "Next Shalav job", description: "Fetch the next pending Shalav AI job (instructions and the answer format). Call it whenever a Shalav card says work is pending." },
    async () => ({ content: await bridge.nextWait() }),
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
  prompt("shalav_my_courses", "Shalav: my courses", "Open Shalav and show my courses.");
  prompt("shalav_continue_learning", "Shalav: continue learning", "Open Shalav and continue my lesson where I stopped.");

  return server;
}
