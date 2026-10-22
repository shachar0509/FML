import { COURSE_ID_RE } from "@/core/universities";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { ExerciseData } from "@/cards/types";
import { pagesFor } from "@/core/domain/retrieval/retrieve";
import { saveAnswerFile, loadImageB64 } from "@/core/lib/attachments";
import { canReveal, ExerciseRun, emptyRun, perfect } from "@/core/domain/practice/run";
import { figureImages, type Ctx, type Ex } from "@/core/domain/practice/exercises";
import type { Attachment, Context } from "@/core/domain/practice/grade";
import { newId } from "@/core/lib/ids";
import { useSettings } from "@/stores/settings";
import type { BridgeGateway, Content } from "./bridge";
import { CARDS_URI } from "./resources";

const appOnly = { ui: { resourceUri: CARDS_URI, visibility: ["app" as const] } };
const num = z.string().regex(COURSE_ID_RE);
const run_ = z.object({ runId: z.string() });
const files = z.array(z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/), mediaType: z.enum(["image/jpeg", "image/png"]) })).max(12);
const out = (text: string, structuredContent?: object) => ({ content: [{ type: "text" as const, text }], ...(structuredContent ? { structuredContent: structuredContent as Record<string, unknown> } : {}) });
const fail = (text: string) => ({ ...out(text), isError: true as const });
const text = (t: string): Content[] => [{ type: "text", text: t }];
const readable = (g: { verdict: string; legibility: string } | null) => !!g && g.verdict !== "unreadable" && g.legibility !== "illegible";
const toAtt = (f: z.infer<typeof files>): Attachment[] => f.map((x) => ({ type: "image_ref", ...x }));

type R = { run: ExerciseRun; n: string; context: Context; busy: "grade" | "hint" | "solution" | "clue" | null; figures: string[] };

/** Exercise card (plan v2 §6.4): Grade / Hint / Show solution run the v1 pipeline as bridge ops; state lives in memory (lost on a restart). */
export function registerExerciseTools(server: McpServer, bridge: BridgeGateway) {
  const runs = new Map<string, R>();
  // Raw BM25 pages instead of a lesson-brief job: one host round trip less per hint (DECISIONS.md, as in M7).
  // Without a stage (homework, M57) the pages are ranked over all materials by the exercise text.
  const digest = async (ctx: Ctx, stageId: string | null, query = "") => {
    const stage = ctx.plan.stages.find((x) => x.id === stageId);
    const pages = await pagesFor({ gw: bridge }, ctx.course, stageId ? [stageId] : null, stage ? [...stage.objectives, ...stage.newConcepts].join(" ") : query);
    let body = "";
    for (const p of pages) {
      const t = `[${p.fileName} p.${p.page}]\n${p.text}\n\n`;
      if (body && body.length + t.length > 4000) break;
      body += t;
    }
    return body.trim();
  };

  function data(runId: string): ExerciseData {
    const x = runs.get(runId) as R;
    const { state: s, ex } = x.run;
    const { language, theme } = useSettings.getState().settings;
    return {
      view: "exercise", language, theme, number: x.n, runId, difficulty: ex.difficulty, statementMd: ex.statementMd, figures: x.figures,
      hints: s.hints.map(({ level, hintMd }) => ({ level, hintMd })), solutionMd: s.solutionMd, grade: s.grade, canReveal: canReveal(s), busy: x.busy, error: x.run.error,
      loop: x.run.loop, clues: s.clues ?? [], clueOpen: !!s.clueOpen, perfect: perfect(s.grade),
    };
  }

  /** Register a run (idempotent per runId) and return its card data. */
  async function adopt(runId: string, n: string, run: ExerciseRun, context: Context): Promise<ExerciseData> {
    if (runs.get(runId)?.run !== run) runs.set(runId, { run, n, context, busy: null, figures: (await figureImages(n, run.ex)).map((f) => `data:${f.mediaType};base64,${f.base64}`) });
    return data(runId);
  }

  /** Called by assign_exercise (Learn). Practice owns its run and uses adopt(). */
  async function open(n: string, ex: Ex, context: Context, loop = false): Promise<ExerciseData> {
    const run = new ExerciseRun(n, ex, context, { gw: bridge, loadImage: loadImageB64(n), digest }, emptyRun(), async () => undefined, loop);
    return adopt(newId(), n, run, context);
  }

  const get = (runId: string) => runs.get(runId);
  const gone = () => fail("This exercise expired (Shalav was restarted). Ask the tutor for it again.");
  function start(x: R, kind: NonNullable<R["busy"]>, work: () => Promise<unknown>, summary: () => string) {
    x.busy = kind;
    bridge.run(`${kind} for exercise ${x.run.ex.ref.id}`, async () => {
      try {
        await work();
      } finally {
        x.busy = null;
      }
    }, () => text(summary())).done.catch(() => undefined);
  }
  const wait = "Call shalav_next_job now.";

  registerAppTool(server, "exercise_state", { title: "Exercise state", description: "Card-only: current data of the exercise card.", inputSchema: run_, _meta: appOnly }, async ({ runId }) => (get(runId) ? out("ok", data(runId)) : gone()));

  registerAppTool(server, "exercise_grade_request", { title: "Grade a solution", description: "Card-only: grade the uploaded solution pages (an AI job).", inputSchema: run_.extend({ files: files.min(1) }), _meta: appOnly }, async ({ runId, files: f }) => {
    const x = get(runId);
    if (!x) return gone();
    if (x.busy) return out("Already working.", data(runId));
    start(x, "grade", () => x.run.submit(toAtt(f)), () => {
      const g = x.run.state.grade;
      if (x.run.error) return `Grading failed: ${x.run.error}. Tell the student; they can press Grade again.`;
      if (!g || !readable(g)) return "The solution was not readable. The card asks the student for a clearer photo; wait for their next message.";
      const res = JSON.stringify({ ...g, hintsUsed: x.run.state.hints.length, solutionRevealed: !!x.run.state.solutionMd });
      return `Graded; the Grade card is shown. Result: ${res}\n${x.context === "learn" ? "Continue the lesson like a TA checking homework: do not repeat the score, go through each wrong or unjustified step (what is wrong, why, the corrected step), call update_assessment, then ask them to fix it and submit again or give a similar exercise." : ""}`;
    });
    return out(`Grading started. ${wait}`, data(runId));
  });

  registerAppTool(server, "exercise_hint_request", { title: "Get a hint", description: "Card-only: the next hint level (an AI job).", inputSchema: run_.extend({ files }), _meta: appOnly }, async ({ runId, files: f }) => {
    const x = get(runId);
    if (!x) return gone();
    if (x.busy) return out("Already working.", data(runId));
    if (x.run.state.hints.length >= 3) return fail("All three hints were used.");
    start(x, "hint", () => x.run.hint(toAtt(f)), () => (x.run.error ? `The hint failed: ${x.run.error}. The student can press Hint again.` : "The hint is shown in the card. Nothing else to do; wait for the student."));
    return out(`Hint started. ${wait}`, data(runId));
  });

  registerAppTool(server, "exercise_solution_request", { title: "Show the solution", description: "Card-only: the full solution (an AI job if it does not exist yet).", inputSchema: run_, _meta: appOnly }, async ({ runId }) => {
    const x = get(runId);
    if (!x) return gone();
    if (x.busy) return out("Already working.", data(runId));
    if (!canReveal(x.run.state)) return fail("The solution unlocks after hint 3 or a graded attempt.");
    start(x, "solution", () => x.run.reveal(), () => (x.run.error ? `The solution failed: ${x.run.error}. The student can press Show solution again.` : "The solution is shown in the card. Nothing else to do; wait for the student."));
    return out(`Solution started. ${wait}`, data(runId));
  });

  // M56 solving loop: Get a clue / I didn't understand / Thank you.
  registerAppTool(server, "exercise_clue_request", { title: "Get a clue", description: "Card-only: check the work so far and give one small clue (an AI job).", inputSchema: run_.extend({ files }), _meta: appOnly }, async ({ runId, files: f }) => {
    const x = get(runId);
    if (!x) return gone();
    if (x.busy) return out("Already working.", data(runId));
    start(x, "clue", () => x.run.clue(toAtt(f)), () => (x.run.error ? `The clue failed: ${x.run.error}. The student can press Get a clue again.` : "The clue is shown in the card. Nothing else to do; wait for the student."));
    return out(`Clue started. ${wait}`, data(runId));
  });
  registerAppTool(server, "exercise_clarify_request", { title: "Explain the clue", description: "Card-only: explain the last clue again in other words (an AI job).", inputSchema: run_, _meta: appOnly }, async ({ runId }) => {
    const x = get(runId);
    if (!x) return gone();
    if (x.busy) return out("Already working.", data(runId));
    if (!x.run.clues.length) return fail("No clue yet.");
    start(x, "clue", () => x.run.clarify(), () => (x.run.error ? `The explanation failed: ${x.run.error}. The student can press the button again.` : "The explanation is shown in the card. Nothing else to do; wait for the student."));
    return out(`Explanation started. ${wait}`, data(runId));
  });
  registerAppTool(server, "exercise_clue_done", { title: "Thank you", description: "Card-only: close the clue, back to clue / submit.", inputSchema: run_, _meta: appOnly }, async ({ runId }) => {
    const x = get(runId);
    if (!x) return gone();
    await x.run.clueDone();
    return out("ok", data(runId));
  });

  registerAppTool(server, "exercise_retry", { title: "Try again", description: "Card-only: drop the grade and attempt the same exercise again.", inputSchema: run_, _meta: appOnly }, async ({ runId }) => {
    const x = get(runId);
    if (!x) return gone();
    await x.run.retry();
    return out("ok", data(runId));
  });

  registerAppTool(
    server,
    "attachment_upload",
    { title: "Upload a solution file", description: "Card-only: store an image or PDF (PDF pages become JPEGs, max 12).", inputSchema: z.object({ number: num, name: z.string().max(200), mime: z.string(), base64: z.string().max(40_000_000) }), _meta: appOnly },
    async ({ number, name, mime, base64 }) => {
      if (!mime.startsWith("image/") && mime !== "application/pdf") return fail("Only images and PDFs.");
      try {
        const saved = await saveAnswerFile(number, new File([Buffer.from(base64, "base64")], name, { type: mime }));
        return out("stored", { files: saved.map((a) => ({ sha256: a.sha256, mediaType: a.mediaType })) });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  return { open, adopt, digest };
}
