import { chooseUniversity } from "@/core/lib/firstRun";
import { COURSE_ID_RE, isCustom, UNIVERSITIES, UNIVERSITY_IDS, university } from "@/core/universities";
import { loadImageB64 } from "@/core/lib/attachments";
import { getUiCapability, registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/server";
import { listCourses } from "@/core/domain/courses/courses";
import { localize } from "@/core/domain/plan/translate";
import * as z from "zod";
import { BridgeGateway } from "./bridge";
import { createKnowledge, type KnowledgeService } from "./knowledge/knowledge";
import type { HomeData } from "@/cards/types";
import { useSettings } from "@/stores/settings";
import type { CatalogSource } from "@/core/domain/catalog/catalog";
import { registerCourseTools } from "./courseTools";
import type { Moodle } from "./moodle";
import { registerMoodleTools } from "./moodleTools";
import { registerFileTools } from "./fileTools";
import { registerExerciseTools } from "./exerciseTools";
import { registerLearnTools } from "./learnTools";
import { registerHistoryTools } from "./historyTools";
import { registerFigureTools } from "./figureTools";
import { registerPracticeTools } from "./practiceTools";
import { registerSettingsTools } from "./settingsTools";
import { INSTRUCTIONS } from "./instructions";
import { CARDS_URI, readCards } from "./resources";

/** Transport-agnostic: tests connect it to an in-memory transport, main.ts to stdio. */
export function createServer(bridge = new BridgeGateway(), catalog?: CatalogSource, moodleMake?: (profileDir: string) => Moodle, knowledge: KnowledgeService = createKnowledge(null)): McpServer {
  const server = new McpServer({ name: "shalav", version: "2.0.0" }, { instructions: INSTRUCTIONS });
  const closed = server.server.onclose;
  server.server.onclose = () => (knowledge.dispose(), closed?.());
  // Every card result carries its own number (M31). A card claims the number of the result it was created with, so a
  // card the host mounts again (Claude Desktop re-renders the chat after a card's own tool call) keeps its old number
  // and never outranks the newest card; results of a card's own calls (Back, open course) are never a card's first data.
  // Date.now() keeps the numbers rising across server restarts, so old cards still lose to new ones.
  let cardSeq = 0;
  const register = server.registerTool.bind(server);
  server.registerTool = ((name: string, config: unknown, cb: (...a: unknown[]) => unknown) =>
    register(name, config as never, (async (...a: unknown[]) => {
      const r = (await cb(...a)) as { structuredContent?: Record<string, unknown> };
      if (typeof r?.structuredContent?.view === "string") r.structuredContent.card = cardSeq = Math.max(cardSeq + 1, Date.now());
      return r;
    }) as never)) as typeof server.registerTool;

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
        courses: await Promise.all(courses.map(async ({ course, plan, progress }) => {
          const t = progress?.totals;
          const stage = plan?.stages.find((x) => x.id === progress?.currentStageId);
          const { tr } = await localize(course, plan, language);
          return {
            number: course.courseNumber,
            name: tr(course.nameHe),
            credits: course.credits,
            pct: t && t.stagesTotal ? Math.round((100 * t.stagesCompleted) / t.stagesTotal) : 0,
            stage: stage ? `${stage.id} · ${tr(stage.title)}` : null,
            // the Learn / Practice buttons on the row
            current: stage ? { id: stage.id, title: tr(stage.title) } : null,
            hasPlan: !!plan,
            building: builds.building(course.courseNumber),
            custom: isCustom(course),
          };
        })),
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

  const moodle = registerMoodleTools(server, moodleMake);
  const files = registerFileTools(server, { moodle });
  const builds = registerCourseTools(server, bridge, files, catalog, knowledge);
  const exercises = registerExerciseTools(server, bridge);
  const learn = registerLearnTools(server, bridge, exercises, knowledge);
  registerFigureTools(server);
  registerHistoryTools(server, registerPracticeTools(server, bridge, exercises, knowledge).forget);
  registerSettingsTools(server);

  // Card requests (M15): the card posts only "▶️ Continue" in the chat; what it wants waits here for shalav_next_job.
  // A card request, with the photos of a handwritten answer (stored attachments of that course).
  const inbox: { text: string; images?: { number: string; shas: string[] } }[] = [];
  registerAppTool(
    server,
    "shalav_request",
    {
      title: "Card request",
      description: "Card-only: queue what the student asked for in a card; the model gets it from shalav_next_job.",
      inputSchema: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("learn"), stageId: z.string().regex(/^S\d{3}$/), title: z.string().max(200) }),
        z.object({ kind: z.literal("relearn"), stageId: z.string().regex(/^S\d{3}$/), title: z.string().max(200) }),
        // a written answer, or photos / a PDF of one solved on paper (attachment_upload of that course), or both
        z.object({ kind: z.literal("answer"), text: z.string().max(4000), number: z.string().regex(COURSE_ID_RE).optional(), files: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(12).optional() }),
        z.object({ kind: z.literal("step"), action: z.enum(["next", "again", "question"]), text: z.string().max(4000).optional(), beat: z.object({ n: z.number().int(), of: z.number().int() }).optional() }),
        // M60: continue a saved lesson
        z.object({ kind: z.literal("resume"), number: z.string().regex(COURSE_ID_RE), id: z.string().max(64) }),
        // the card moved to another screen: requests made on the old one (e.g. a lesson step) are void
        z.object({ kind: z.literal("clear") }),
      ]),
      _meta: { ui: { resourceUri: CARDS_URI, visibility: ["app"] } },
    },
    async (r) => {
      if (r.kind === "clear") {
        inbox.length = 0;
        return { content: [{ type: "text" as const, text: "ok" }], structuredContent: { ok: true } };
      }
      if (r.kind === "step" && r.action === "again") learn.reexplain();
      if (r.kind === "step") void learn.note(r.action === "next" ? "Pressed Continue." : r.action === "again" ? "Pressed Explain differently." : `Asked: ${r.text ?? ""}`);
      if (r.kind === "answer") void learn.note(`Answered: ${r.text.trim() || "(handwritten pages)"}`);
      // Only the newest click counts: an older one that was never fetched belongs to a card already gone, and serving it
      // later made every answer lag a few steps behind.
      if (r.kind === "answer" && !r.text.trim() && !(r.number && r.files?.length)) return { content: [{ type: "text" as const, text: "An answer needs text or files." }], isError: true };
      const images = r.kind === "answer" && r.number && r.files?.length ? { number: r.number, shas: r.files } : undefined;
      inbox.length = 0;
      inbox.push({ images, text:
        r.kind === "answer"
          ? `The student answered the current question in the card${images ? ` (${images.shas.length} page image(s) of their handwritten solution follow; read them as their answer)` : ""}:\n<answer>\n${r.text.trim() || "(see the images)"}\n</answer>\nRespond to it and continue the lesson.`
          : r.kind === "step"
            ? r.action === "next"
              ? "The student understood the last lesson step and pressed Continue. Teach the next small step with teach_step (or, after 2-3 steps, check with one quick question)."
              : r.action === "again"
                ? "The student did not understand the last lesson step and pressed Explain differently. Call teach_step now for the SAME step, rewritten: same topic, simpler words, a different example or a figure. Do not ask a question, do not quiz, do not move on to the next idea."
                : `The student asked about the lesson step on screen${r.beat ? ` while part ${r.beat.n} of ${r.beat.of} was shown` : ""} (the step card stays open):\n<question>\n${r.text ?? ""}\n</question>\nAnswer with answer_question: short and direct, about this step and the course material (consult_materials if the step does not cover it). Do not call teach_step and do not move on; then end your message and wait.`
            : r.kind === "resume"
              ? `The student wants to continue a saved lesson. Call shalav_start_lesson with courseNumber ${r.number} and resume "${r.id}", and continue from where it stopped.`
              : `The student wants to ${r.kind === "learn" ? "learn" : "learn again"} ${r.stageId} · ${r.title}. Call shalav_start_lesson with stageId ${r.stageId} and teach it.`,
      });
      return { content: [{ type: "text" as const, text: "ok" }], structuredContent: { ok: true } };
    },
  );
  // The spinner's Cancel: stops the AI work the card started (keys: build:/translate:/web:/practice:/hw: + course, exercise: + run).
  registerAppTool(
    server,
    "shalav_cancel",
    {
      title: "Cancel",
      description: "Card-only: stop the AI work a card started.",
      inputSchema: z.object({ key: z.string().max(80) }),
      _meta: { ui: { resourceUri: CARDS_URI, visibility: ["app"] } },
    },
    async ({ key }) => {
      bridge.cancelKey(key);
      return { content: [{ type: "text" as const, text: "ok" }], structuredContent: { ok: true } };
    },
  );
  // One card on screen (M23): a card claims the number of the result it was created with; an older card sees a newer one and folds away.
  let latestCard = 0;
  registerAppTool(
    server,
    "shalav_card",
    {
      title: "Card number",
      description: "Card-only: claim the number of a shown card's result, or read the newest one.",
      inputSchema: z.object({ claim: z.boolean(), card: z.number().optional() }),
      _meta: { ui: { resourceUri: CARDS_URI, visibility: ["app"] } },
    },
    async ({ claim, card }) => {
      if (claim) latestCard = Math.max(latestCard, card ?? Date.now()); // no number (a result from before M31): a new card
      return { content: [{ type: "text" as const, text: String(latestCard) }], structuredContent: { latest: latestCard } };
    },
  );
  server.registerTool(
    "shalav_next_job",
    {
      title: "Next Shalav job",
      description: "Fetch what the student asked for in a Shalav card, or the next pending Shalav AI job (instructions and the answer format). \"▶️ המשך\" / \"▶️ Continue\" → call it with no arguments. \"▶️ בניית תוכנית\" / \"▶️ Building the plan\" → call it with build: true (plan build jobs only).",
      inputSchema: z.object({ build: z.boolean().optional() }),
    },
    async ({ build }, { mcpReq: { signal } }) => {
      if (build) return { content: await bridge.nextWait("build", signal) };
      // Card requests first, then study jobs; build jobs belong to the chat that pressed Build (another chat may be building meanwhile).
      const req = bridge.pending("study") ? undefined : inbox.shift();
      if (req) {
        const im = req.images;
        const load = im && loadImageB64(im.number);
        const images = im && load ? await Promise.all(im.shas.map(async (sha) => ({ type: "image" as const, mimeType: "image/jpeg", data: await load(sha, "image/jpeg") }))) : [];
        return { content: [{ type: "text" as const, text: `Student request from the card:\n${req.text}${bridge.pending("study") || inbox.length ? "\n\nAfterwards call shalav_next_job again: more is pending." : ""}` }, ...images] };
      }
      const c = await bridge.nextWait("study", signal);
      return { content: inbox.length && !bridge.pending("study") ? [...c, { type: "text" as const, text: "Then call shalav_next_job again: the student asked for something in a card." }] : c };
    },
  );
  server.registerTool(
    "shalav_submit_job",
    {
      title: "Submit Shalav job",
      description: "Answer a Shalav job. Pass `input` (matching the job's schema) or `text`. Returns the next job or the final result.",
      inputSchema: z.object({ jobId: z.number(), input: z.record(z.string(), z.unknown()).optional(), text: z.string().optional() }),
    },
    async (a, { mcpReq: { signal } }) => {
      const study = bridge.jobLane(a.jobId) === "study"; // a building chat is not handed card requests
      const r = await bridge.submit(a, signal);
      return study && inbox.length && !bridge.pending("study") ? { ...r, content: [...r.content, { type: "text" as const, text: "Then call shalav_next_job again: the student asked for something in a card." }] } : r;
    },
  );

  const prompt = (name: string, title: string, text: string) =>
    server.registerPrompt(name, { title, description: title }, () => ({
      messages: [{ role: "user", content: { type: "text", text } }],
    }));
  prompt("shalav_my_courses", "Shalav: my courses", "Show me my courses in Shalav (the Shalav home card).");
  prompt("shalav_continue_learning", "Shalav: continue learning", 'Let\'s continue my lesson in Shalav where I stopped (shalav_start_lesson with resume "latest").');

  return server;
}
