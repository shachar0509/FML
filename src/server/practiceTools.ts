import { COURSE_ID_RE } from "@/core/universities";
import { localize } from "@/core/domain/plan/translate";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { writeFile } from "node:fs/promises";
import type { HomeworkData, PracticeData } from "@/cards/types";
import { loadCtx } from "@/core/domain/practice/exercises";
import { Practice } from "@/core/domain/practice/engine";
import { completedIds, type Scope } from "@/core/domain/practice/select";
import { acceptedPages, asExercise, endHomework, loadHomework, newHomework, saveHomework, splitHomework, type Homework } from "@/core/domain/practice/homework";
import { ExerciseRun, perfect } from "@/core/domain/practice/run";
import { fs } from "@/core/lib/fs/fs";
import { loadImageB64 } from "@/core/lib/attachments";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import type { BridgeGateway } from "./bridge";
import type { registerExerciseTools } from "./exerciseTools";
import { saveDialog } from "./native";
import { imagesToPdf } from "./pdf";
import { CARDS_URI } from "./resources";

const appOnly = { ui: { resourceUri: CARDS_URI, visibility: ["app" as const] } };
const num = z.string().regex(COURSE_ID_RE);
const scopeSchema = z.union([z.object({ kind: z.enum(["all", "weak"]) }), z.object({ kind: z.literal("unit"), unitId: z.string() }), z.object({ kind: z.literal("stage"), stageId: z.string() })]);
const out = (text: string, structuredContent?: object) => ({ content: [{ type: "text" as const, text }], ...(structuredContent ? { structuredContent: structuredContent as Record<string, unknown> } : {}) });
const fail = (text: string) => ({ ...out(text), isError: true as const });
const files = z.array(z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/), mediaType: z.enum(["image/jpeg", "image/png"]) })).min(1).max(12);

/** Practice card (plan v2 §6.5): the v1 `Practice` engine, one session per course in memory (its state is also saved as v1 `ui` lines). */
export function registerPracticeTools(server: McpServer, bridge: BridgeGateway, exercises: ReturnType<typeof registerExerciseTools>) {
  const sessions = new Map<string, Practice>();

  async function session(n: string): Promise<Practice> {
    let p = sessions.get(n);
    if (!p) {
      p = new Practice(n, { gw: bridge, loadImage: loadImageB64(n), digest: exercises.digest });
      p.prefetchOn = false; // ponytail: no prefetch; a parked job nobody fetches would stall, add if the host ever fetches jobs on its own
      await p.open();
      sessions.set(n, p);
    }
    return p;
  }

  // ----- M57: homework / single question -----
  const env = (n: string) => ({ gw: bridge, loadImage: loadImageB64(n), digest: exercises.digest });
  const reading = new Set<string>(); // courses whose uploaded pages the host model is reading
  const hwError = new Map<string, string>();
  const hwRuns = new Map<string, ExerciseRun>();

  async function hwData(n: string): Promise<HomeworkData | null> {
    const hw = await loadHomework(n);
    if (!hw) return null;
    let exercise: HomeworkData["exercise"] = null;
    const i = hw.current;
    if (hw.how === "tutor" && hw.questions[i]) {
      const key = `hw-${hw.id}-${i}`;
      let run = hwRuns.get(key);
      if (!run) {
        // A perfect answer's pages (the student's own) become that question's part of the solution file.
        run = new ExerciseRun(n, asExercise(n, hw, i), "homework", env(n), (hw.questions[i] as Homework["questions"][number]).run, async (st) => {
          const h = await loadHomework(n);
          const q = h?.id === hw.id ? h.questions[i] : null;
          if (!h || !q) return;
          q.run = st;
          if (perfect(st.grade) && st.files?.length) q.accepted = st.files;
          await saveHomework(n, h);
        }, true);
        hwRuns.set(key, run);
      }
      exercise = await exercises.adopt(key, n, run, "homework");
    }
    return {
      kind: hw.kind, how: hw.how, name: hw.name, splitting: reading.has(n), current: i, exercise, error: hwError.get(n) ?? null,
      questions: hw.questions.map((q) => ({ label: q.label, accepted: !!q.accepted })),
    };
  }

  async function data(n: string, p: Practice): Promise<PracticeData> {
    const { language, theme } = useSettings.getState().settings;
    const ctx = await loadCtx(n);
    const { tr } = await localize(ctx.course, ctx.plan, language);
    const done = completedIds(ctx.progress);
    const st = p.state;
    await p.binding;
    let item: PracticeData["item"] = null;
    const cur = st?.current;
    if (cur?.kind === "E" && p.run && p.exercise) item = { kind: "E", exercise: await exercises.adopt(`practice-${n}-${st?.sid}-${st?.index}`, n, p.run, "practice") };
    else if (cur?.kind === "M") {
      const a = cur.selected !== null;
      item = { kind: "M", questionMd: cur.check.questionMd, options: cur.check.options ?? [], selected: cur.selected, correctIndex: a ? (cur.check.correctIndex ?? null) : null, explanationMd: a ? cur.check.explanationMd : null };
    } else if (cur?.kind === "O") {
      item = { kind: "O", questionMd: cur.check.questionMd, answer: cur.answer, result: cur.result && { correct: cur.result.correct, score: cur.result.score, feedbackMd: cur.result.feedbackMd } };
    }
    return {
      view: "practice", language, theme, number: n,
      mode: p.summary ? "summary" : st ? "item" : done.size ? "choose" : "locked",
      units: ctx.plan.units.filter((u) => u.stageIds.some((s) => done.has(s))).map((u) => ({ id: u.id, title: tr(u.title) })),
      stages: ctx.plan.stages.filter((s) => done.has(s.id)).map((s) => ({ id: s.id, title: tr(s.title) })),
      counters: p.counters, item, loading: p.loading, error: p.error, summary: p.summary, hw: await hwData(n),
    };
  }

  /** Run an engine action as a bridge op; if it needs Claude the card asks the chat to fetch the job. */
  async function act(n: string, label: string, fn: (p: Practice) => Promise<unknown>) {
    const p = await session(n);
    const { done } = bridge.run(`practice ${label}`, () => fn(p), () => [{ type: "text", text: "Done. The card shows the result; do not repeat it, wait for the student." }]);
    done.catch(() => undefined);
    await Promise.race([done.catch(() => undefined), new Promise((r) => setTimeout(r, 100))]);
    return out(p.loading ? "Working. Call shalav_next_job now." : "ok", await data(n, p));
  }

  const card = async (n: string, scope?: Scope) => {
    const p = await session(n);
    if (scope && !p.state) return act(n, "start", (x) => x.start(scope));
    return out(`Practice card shown for ${n}. Do not repeat what it shows; the student works in the card.`, await data(n, p));
  };

  registerAppTool(
    server,
    "shalav_practice",
    {
      title: "Practice",
      description: "Open the Practice card for a course (needs a completed stage). Optional scope: {kind:'all'|'weak'} or {kind:'unit',unitId} or {kind:'stage',stageId}; without it the card lets the student choose.",
      inputSchema: z.object({ courseNumber: num, scope: scopeSchema.optional() }),
      _meta: { ui: { resourceUri: CARDS_URI } },
    },
    async ({ courseNumber, scope }) => card(courseNumber, scope),
  );
  const app = (name: string, description: string, shape: z.ZodRawShape, h: (a: never) => Promise<ReturnType<typeof out>>) =>
    registerAppTool(server, name, { title: name, description: `Card-only: ${description}`, inputSchema: z.object({ courseNumber: num, ...shape }), _meta: appOnly }, h as never);

  app("practice_state", "current Practice card data.", {}, async ({ courseNumber }: { courseNumber: string }) => out("ok", await data(courseNumber, await session(courseNumber))));
  app("practice_start_request", "start a session with a scope.", { scope: scopeSchema }, async ({ courseNumber, scope }: { courseNumber: string; scope: Scope }) => act(courseNumber, "start", (p) => p.start(scope)));
  app("practice_next_request", "serve the next item.", {}, async ({ courseNumber }: { courseNumber: string }) => act(courseNumber, "next item", (p) => p.advance()));
  app("practice_answer_mcq", "mark a multiple-choice answer.", { selected: z.number().int().min(0).max(3) }, async ({ courseNumber, selected }: { courseNumber: string; selected: number }) => {
    const p = await session(courseNumber);
    await p.answerMcq(selected);
    return out("ok", await data(courseNumber, p));
  });
  app("practice_answer_open_request", "grade an open answer (an AI job).", { text: z.string().min(1).max(20000) }, async ({ courseNumber, text }: { courseNumber: string; text: string }) => act(courseNumber, "grade open answer", (p) => p.answerOpen(text, [])));
  app("practice_retry", "same item, new attempt.", {}, async ({ courseNumber }: { courseNumber: string }) => {
    const p = await session(courseNumber);
    await p.tryAgain();
    return out("ok", await data(courseNumber, p));
  });
  app("practice_end", "end the session and show the summary.", {}, async ({ courseNumber }: { courseNumber: string }) => {
    const p = await session(courseNumber);
    if (!p.state) return fail("No session.");
    await p.end();
    return out("ok", await data(courseNumber, p));
  });
  const state = async (n: string, text = "ok", extra?: Partial<HomeworkData>) => {
    const d = await data(n, await session(n));
    return out(text, d.hw && extra ? { ...d, hw: { ...d.hw, ...extra } } : d);
  };
  app("homework_start", "upload a homework (or one question) and have it read (an AI job).", { kind: z.enum(["single", "homework"]), files }, async ({ courseNumber: n, kind, files: f }: { courseNumber: string; kind: Homework["kind"]; files: z.infer<typeof files> }) => {
    if (reading.has(n)) return fail("Already reading a homework.");
    await endHomework(n);
    const hw = newHomework(kind, f.map((x) => ({ type: "image_ref" as const, ...x })));
    await saveHomework(n, hw);
    hwError.delete(n);
    reading.add(n);
    const { done } = bridge.run(`read ${kind === "single" ? "the question" : "the homework"}`, async () => {
      try {
        await saveHomework(n, await splitHomework(env(n), n, hw));
      } catch (e) {
        hwError.set(n, e instanceof Error ? e.message : String(e));
      } finally {
        reading.delete(n);
      }
    }, () => [{ type: "text", text: "Read. The card shows the questions; do not repeat them, wait for the student." }]);
    done.catch(() => undefined);
    return state(n, "Reading started. Call shalav_next_job now.");
  });
  app("homework_how", "solve with the tutor (the solving loop).", { how: z.enum(["tutor"]) }, async ({ courseNumber: n, how }: { courseNumber: string; how: "tutor" }) => {
    const hw = await loadHomework(n);
    if (!hw) return fail("No homework.");
    await saveHomework(n, { ...hw, how });
    return state(n);
  });
  app("homework_open", "show another question.", { index: z.number().int().min(0) }, async ({ courseNumber: n, index }: { courseNumber: string; index: number }) => {
    const hw = await loadHomework(n);
    if (!hw?.questions[index]) return fail("No such question.");
    await saveHomework(n, { ...hw, current: index });
    return state(n);
  });
  app("homework_download", "save the solutions so far as a PDF where the student picks (Save as dialog).", {}, async ({ courseNumber: n }: { courseNumber: string }) => {
    const hw = await loadHomework(n);
    const pages = hw ? acceptedPages(hw) : [];
    if (!hw || !pages.length) return fail("No solved question yet.");
    const dir = coursePaths(useSettings.getState().settings.dataRoot, n).attachments;
    const pdf = await imagesToPdf(await Promise.all(pages.map((sha) => fs().readBytes(`${dir}/${sha}.jpg`))), hw.name || "solution");
    const path = await saveDialog("solution.pdf");
    if (!path) return state(n, "cancelled");
    await writeFile(path, pdf);
    return state(n, `saved to ${path}`, { saved: path });
  });
  app("homework_end", "leave the homework / question.", {}, async ({ courseNumber: n }: { courseNumber: string }) => {
    await endHomework(n);
    hwError.delete(n);
    return state(n);
  });
  app("practice_learn_again", "reopen a weak stage from the summary.", { stageId: z.string() }, async ({ courseNumber, stageId }: { courseNumber: string; stageId: string }) => {
    const p = await session(courseNumber);
    await p.relearn(stageId);
    return out("ok", await data(courseNumber, p));
  });
}
