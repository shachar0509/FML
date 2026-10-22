import { COURSE_ID_RE } from "@/core/universities";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { FigureData, LessonData, McqData, OpenData, StepData } from "@/cards/types";
import { statusBlock, tutorSystem } from "@/core/claude/prompts/tutor";
import { askOpenQuestion, assignExercise, consultMaterials, presentMcq, recordCheckResult, updateAssessment, updateKnowledgeGraph } from "@/core/claude/tutorTools";
import { knowledgeOf, priorOf } from "@/core/domain/knowledge/control";
import { applyNodes, candidates, courseGraph, listText } from "@/core/domain/knowledge/tag";
import { buildKnowledgeBoundary } from "@/core/domain/boundary/boundary";
import { localize } from "@/core/domain/plan/translate";
import { CourseJsonSchema, EventSchema, PlanJsonSchema } from "@/core/domain/dataSchemas";
import { listFileIndexes } from "@/core/domain/ingest/indexStore";
import { buildRecap } from "@/core/domain/learn/recap";
import { checkAdvanceCriteria } from "@/core/domain/progress/criteria";
import { mapEvents, normalizeTag, reduceProgress } from "@/core/domain/progress/reduce";
import { appendEvent } from "@/core/domain/progress/store";
import { addEntry, checkpoint, createConv, listConvs, loadConv, transcript, type Entry } from "@/core/domain/history/history";
import { resolveExercise, type Ex } from "@/core/domain/practice/exercises";
import { materialsLang, pagesFor } from "@/core/domain/retrieval/retrieve";
import { parseGeometry, parsePlot } from "@/core/render/figures/specs";
import { readJsonFile } from "@/core/lib/fs/atomicWrite";
import { readJsonlDir } from "@/core/lib/fs/jsonl";
import { coursePaths } from "@/core/lib/fs/paths";
import { newId } from "@/core/lib/ids";
import { nowIso } from "@/core/lib/time";
import { useSettings } from "@/stores/settings";
import type { BridgeGateway } from "./bridge";
import { registerExerciseTools } from "./exerciseTools";
import { CARDS_URI } from "./resources";

const appOnly = { ui: { resourceUri: CARDS_URI, visibility: ["app" as const] } };
const withCard = { ui: { resourceUri: CARDS_URI } };
const num = z.string().regex(COURSE_ID_RE);
const MATERIAL_CHARS = 6000;
const out = (text: string, structuredContent?: object) => ({ content: [{ type: "text" as const, text }], ...(structuredContent ? { structuredContent: structuredContent as Record<string, unknown> } : {}) });
const fail = (text: string) => ({ ...out(text), isError: true as const });

type Check = { kind: "mcq" | "open"; n: string; stageId: string; correctIndex?: number; explanationMd?: string; selected?: number; /** M62: graph nodes the MCQ tests */ nodes?: string[] };

/** Learn (plan v2 §6.3): the host chat is the lesson; the tutor tools record the v1 events and return cards. */
export function registerLearnTools(server: McpServer, bridge: BridgeGateway, exercises: ReturnType<typeof registerExerciseTools>) {
  /** The lesson the student is in; the tutor tools carry a stageId but no course number. `cid`: its saved conversation (M60), made on its first entry. */
  let active: { n: string; stageId: string; cid: string | null; title: string; /** M62: the lesson's numbered graph nodes ([STATUS] numbers stay put; new nodes are appended) */ nodes: string[] } | null = null;
  /** M60: every card and student action of the lesson goes to its saved conversation (a failed write never breaks the lesson). */
  async function log(e: Omit<Entry, "at">) {
    const a = active;
    if (!a) return;
    try {
      if (!a.cid) a.cid = (await createConv(a.n, { kind: "lesson", type: "lesson", title: a.title, stageId: a.stageId })).id;
      await addEntry(a.n, a.cid, e);
    } catch {
      /* best effort */
    }
  }
  const checks = new Map<string, Check>(); // lost on a server restart; check_answer then says so

  const sets = () => useSettings.getState().settings;
  async function load(n: string) {
    const p = coursePaths(sets().dataRoot, n);
    const [course, plan] = await Promise.all([readJsonFile(p.courseJson, CourseJsonSchema), readJsonFile(p.planJson, PlanJsonSchema)]);
    if (!course || !plan) return null;
    const events = await readJsonlDir(p.events, EventSchema);
    const { tr } = await localize(course, plan, sets().language); // card titles in the settings language (M48)
    return { course, plan, events, progress: reduceProgress(plan, events, nowIso()), tr };
  }
  type S = NonNullable<Awaited<ReturnType<typeof load>>>;
  const criteria = (s: S, stageId: string) =>
    checkAdvanceCriteria({ plan: s.plan, events: s.events, stageId, cfg: sets().learning, lang: sets().language, now: nowIso() });

  function lessonData(s: S, stageId: string): LessonData {
    const i = s.plan.stages.findIndex((x) => x.id === stageId);
    const stage = s.plan.stages[i];
    const sp = s.progress.stages[stageId];
    const next = s.plan.stages[i + 1];
    const { language, theme } = sets();
    return {
      view: "lesson", language, theme, number: s.course.courseNumber, stageId, title: stage ? s.tr(stage.title) : stageId,
      status: sp?.status ?? "locked",
      objectives: (stage?.objectives ?? []).map((text, k) => ({ text, covered: !!sp?.coveredObjectives.includes(k) })),
      mastery: Math.round((sp?.mastery ?? 0) * 100),
      criteria: criteria(s, stageId),
      next: next ? { id: next.id, title: s.tr(next.title) } : null,
    };
  }

  /** The lesson's graph nodes in [STATUS] order: the numbers the tutor uses. */
  function lessonNodes(s: S, stageId: string) {
    const g = courseGraph(s.plan, s.events);
    const ids = active?.nodes ?? [];
    for (const n of candidates(g, [stageId])) if (!ids.includes(n.id)) ids.push(n.id);
    if (active) active.nodes = ids;
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    return { g, list: ids.flatMap((id) => byId.get(id) ?? []) };
  }

  function status(s: S, stageId: string) {
    const { g, list } = lessonNodes(s, stageId);
    const k = knowledgeOf(g, mapEvents(s.events), priorOf(s.course));
    const stage = s.plan.stages.find((x) => x.id === stageId);
    const sp = s.progress.stages[stageId];
    const lang = sets().language;
    return statusBlock({
      nodes: listText(list, k.control),
      completed: s.progress.totals.stagesCompleted,
      total: s.progress.totals.stagesTotal,
      mastery: Math.round((sp?.tutorMastery ?? 0) * 100) / 100,
      covered: sp?.coveredObjectives ?? [],
      gaps: sp?.gaps ?? [],
      reviewTopics: sp?.reviewTopics ?? [],
      missing: criteria(s, stageId).missing,
      overriddenPrereqs: (stage?.prerequisites ?? []).filter((p) => s.progress.stages[p]?.status === "completed_override"),
      mistakes: s.progress.mistakes.filter((m) => !m.resolved && m.stageIds.includes(stageId)).slice(0, 8).map((m) => `${m.tag} — ${lang === "he" ? m.labelHe : m.labelEn}`),
      idleMinutes: 0,
    });
  }

  /** The lesson a tutor tool belongs to: the active course + the stage it names (or the active stage). */
  async function ctx(stageId?: string) {
    if (!active) return null;
    const s = await load(active.n);
    if (!s) return null;
    return { s, n: active.n, stageId: stageId && s.plan.stages.some((x) => x.id === stageId) ? stageId : active.stageId };
  }
  const STEP_CHARS = 900;
  /** Set by "Explain differently": the next tutor move must be the same step re-taught, not a question. */
  let reexplain = false;
  const REEXPLAIN = "The student pressed Explain differently: re-teach the same step first with teach_step (same topic, simpler words or another example or figure). Do not ask a question now.";
  const NO_LESSON = "No lesson is open. Call shalav_start_lesson first.";

  /** The checkpoint card of a saved lesson, live again: an MCQ's key goes back to `checks`, an exercise gets a new run. */
  async function resumed(n: string, c: NonNullable<Awaited<ReturnType<typeof loadConv>>>): Promise<object> {
    const e = checkpoint(c);
    const s = (await load(n)) as S;
    const { language, theme } = sets();
    const history = { number: n, id: c.id, count: c.entries.filter((x) => x.kind === "step").length };
    if (!e?.card) return lessonData(s, c.stageId ?? "");
    const x = (e.extra ?? {}) as { checkId?: string; correctIndex?: number; explanationMd?: string; ex?: Ex; loop?: boolean };
    // an MCQ answered before leaving keeps its answer (check_answer then shows it, and records nothing again)
    const chose = c.entries.findLast((y) => y.kind === "check" && (y.extra as { checkId?: string } | undefined)?.checkId === x.checkId)?.extra as { selectedIndex?: number } | undefined;
    if (e.kind === "mcq" && x.checkId) checks.set(x.checkId, { kind: "mcq", n, stageId: c.stageId ?? "", correctIndex: x.correctIndex, explanationMd: x.explanationMd, selected: chose?.selectedIndex });
    if (e.kind === "open" && x.checkId) checks.set(x.checkId, { kind: "open", n, stageId: c.stageId ?? "" });
    if (e.kind === "exercise" && x.ex) return { ...(await exercises.open(n, x.ex, "learn", !!x.loop)), history };
    return { ...e.card, language, theme, history };
  }

  registerAppTool(
    server,
    "shalav_start_lesson",
    {
      title: "Start a lesson",
      description: 'Open the lesson card for a stage and get the tutor instructions. Use when the student wants to learn a stage (a new lesson; stageId defaults to the course\'s current stage). Lessons are saved: to continue where the student stopped, pass resume: "latest" (or the id from a card request).',
      inputSchema: z.object({
        courseNumber: num, stageId: z.string().optional(),
        resume: z.string().optional().describe('Continue a saved lesson where the student stopped: its id (from a card request), or "latest" for the course\'s newest lesson. Without it a new lesson starts.'),
      }),
      _meta: withCard,
    },
    async ({ courseNumber: n, stageId, resume }) => {
      const s = await load(n);
      if (!s) return fail(`No course ${n} with a study plan. Use shalav_home.`);
      const saved = resume ? await loadConv(n, resume === "latest" ? ((await listConvs(n, "lesson"))[0]?.id ?? "") : resume) : null;
      if (resume && !saved) return fail(resume === "latest" ? "This course has no saved lesson. Start a new one (without resume)." : `No saved lesson ${resume}.`);
      const id = saved?.stageId ?? stageId ?? s.progress.currentStageId ?? s.plan.stages[0]?.id;
      const stage = s.plan.stages.find((x) => x.id === id);
      if (!stage) return fail(`No stage ${stageId}.`);
      const st = s.progress.stages[stage.id]?.status;
      if (st === "locked") return fail(`Stage ${stage.id} is locked: finish its prerequisites (${stage.prerequisites.join(", ")}) first.`);
      active = { n, stageId: stage.id, cid: saved?.id ?? null, title: `${stage.id} · ${s.tr(stage.title)}`, nodes: [] };
      if (!saved && (st === "completed" || st === "completed_override"))
        return out(`Stage ${stage.id} — ${stage.title} is already completed. The card shows a review with "Learn this stage again"; do not teach unless the student reopens it.`, lessonData(s, stage.id));
      if (st === "available") {
        await appendEvent(n, { type: "stage_started", stageId: stage.id });
        s.progress = (await load(n))?.progress ?? s.progress;
      }
      const lang = sets().language === "he" ? "Hebrew" : "English";
      const pages = await pagesFor({ gw: bridge }, s.course, [stage.id], [...stage.objectives, ...stage.newConcepts].join(" "));
      let brief = "";
      for (const p of pages) {
        const t = `[${p.fileName} p.${p.page}]\n${p.text}\n\n`;
        if (brief && brief.length + t.length > MATERIAL_CHARS) break;
        brief += t;
      }
      const exercises = (await listFileIndexes(n)).flatMap((f) => f.exercises).filter((e) => e.primaryStageId === stage.id || e.requiredStageIds.includes(stage.id));
      const system = tutorSystem({
        course: s.course, courseKind: s.course.courseKind, stage, plan: s.plan, minExercises: sets().learning.minExercises, lang, mcp: true,
        materialsLang: await materialsLang({ gw: bridge }, s.course),
        knowledgeBoundary: buildKnowledgeBoundary({ course: s.course, plan: s.plan, progress: s.progress, currentStageId: stage.id }),
        lessonBrief: brief.trim() || "No indexed course materials match this stage yet; explain in your own words.",
        exercises, mistakeTags: s.progress.mistakes,
      });
      const recap = buildRecap(s.plan, s.events, stage.id);
      if (saved) {
        await log({ who: "student", kind: "request", text: "Came back to this lesson." });
        return out([
          system,
          status(s, stage.id),
          `THE LESSON SO FAR (saved; the student left and came back):\n${transcript(saved)}`,
          "The student is back at the last checkpoint, shown in the card. Continue the lesson from exactly there: one short welcome-back sentence, then the next move (if the card is a question, wait for the answer). Do not re-teach what is above.",
        ].join("\n\n"), await resumed(n, saved));
      }
      const text = [
        system,
        status(s, stage.id),
        recap,
        "The lesson card is shown. Begin the lesson now: one short sentence in the chat, then teach_step with the overview and the first small idea. Do not ask any question in this first message.",
      ].filter(Boolean).join("\n\n");
      return out(text, lessonData(s, stage.id));
    },
  );

  server.registerTool(
    "shalav_lesson_status",
    { title: "Lesson status", description: "Fresh [STATUS] progress data for the open lesson (update_assessment already returns it). Call it when you need current progress, e.g. after the student answered questions in cards.", inputSchema: z.object({}) },
    async () => {
      const c = await ctx();
      if (!c) return fail(NO_LESSON);
      const k = criteria(c.s, c.stageId);
      return out(`${status(c.s, c.stageId)}\nAdvancement criteria met: ${k.met ? "yes (the student can press Complete stage)" : "no"}`);
    },
  );

  const hint = " The card is shown to the student: end your message now and wait for their reply.";
  registerAppTool(server, presentMcq.def.name, { title: "Multiple-choice question", description: presentMcq.def.description + hint, inputSchema: presentMcq.schema, _meta: withCard }, async (i) => {
    if (reexplain) return fail(REEXPLAIN);
    const c = await ctx(i.stageId);
    if (!c) return fail(NO_LESSON);
    if (i.correctIndex >= i.options.length) return fail("correctIndex is outside options.");
    const checkId = newId();
    const ids = active?.nodes ?? [];
    checks.set(checkId, { kind: "mcq", n: c.n, stageId: c.stageId, correctIndex: i.correctIndex, explanationMd: i.explanationMd, nodes: i.nodes.flatMap((x) => ids[x - 1] ?? []) });
    const { language, theme } = sets();
    const data: McqData = { view: "mcq", language, theme, checkId, questionMd: i.questionMd, options: i.options };
    await log({ who: "tutor", kind: "mcq", text: `${i.questionMd}\nOptions: ${i.options.map((o, k) => `(${k + 1}) ${o}`).join(" ")}`, card: data, extra: { checkId, correctIndex: i.correctIndex, explanationMd: i.explanationMd } });
    return out(`Question shown (check id ${checkId}). Never reveal the answer. The student's choice arrives as their next message.`, data);
  });
  registerAppTool(server, askOpenQuestion.def.name, { title: "Open question", description: askOpenQuestion.def.description + hint, inputSchema: askOpenQuestion.schema, _meta: withCard }, async (i) => {
    if (reexplain) return fail(REEXPLAIN);
    const c = await ctx(i.stageId);
    if (!c) return fail(NO_LESSON);
    const checkId = newId();
    checks.set(checkId, { kind: "open", n: c.n, stageId: c.stageId });
    const { language, theme } = sets();
    const data: OpenData = { view: "open", language, theme, checkId, number: c.s.course.courseNumber, questionMd: i.questionMd };
    await log({ who: "tutor", kind: "open", text: i.questionMd, card: data, extra: { checkId } });
    return out(`Question shown (check id ${checkId}). The student's answer arrives as their next message, typed or as page images of a solution written on paper (read those as the answer); evaluate it, then call record_check_result with checkToolUseId "${checkId}".`, data);
  });

  /** Checks a figure source; returns the error text or null. */
  const badFigure = (kind: string, source: string) => {
    try {
      if (kind === "plot") parsePlot(source);
      else if (kind === "geometry") parseGeometry(source);
      else if (!/^\s*<svg[\s>]/i.test(source)) throw new Error("source must be one <svg> element");
      return null;
    } catch (e) {
      return `Invalid ${kind} figure: ${e instanceof Error ? e.message : String(e)}.`;
    }
  };
  const figure = z.object({ kind: z.enum(["plot", "geometry", "svg"]), source: z.string().max(50_000), captionMd: z.string().max(500).default("") });

  registerAppTool(
    server,
    "show_figure",
    {
      title: "Show a figure",
      description:
        "Draw a graph or diagram for the student in a card inside the chat (outside teach_step, e.g. in feedback). kind plot: function-plot JSON; geometry: JSXGraph-style JSON; svg: one <svg viewBox> element (strokes/text in currentColor, no scripts). Keep writing after it; it does not end your message.",
      inputSchema: figure,
      _meta: withCard,
    },
    async ({ kind, source, captionMd }) => {
      const bad = badFigure(kind, source);
      if (bad) return fail(`${bad} Fix it and call show_figure again.`);
      const { language, theme } = sets();
      const data: FigureData = { view: "figure", language, theme, kind, source, captionMd };
      await log({ who: "tutor", kind: "figure", text: `(figure) ${captionMd}` });
      return out("Figure shown to the student. Refer to it and continue.", data);
    },
  );

  registerAppTool(
    server,
    "teach_step",
    {
      title: "Lesson step",
      description: `Show ONE small step of the lesson as a card: one idea (a definition, one property, one proof step, one example), at most about 120 words of Markdown with $math$, optionally one figure. All teaching goes here, not in the chat. The student then presses Continue, Explain differently, or asks a question.${hint}`,
      inputSchema: z.object({ titleMd: z.string().max(120), bodyMd: z.string().max(6000), sideMd: z.string().max(1500).optional().describe("A short side remark written beside the board (an inclusion, a reminder, a warning), shown as a note next to the step."), figure: figure.optional(), progress: z.object({ n: z.number().int().min(1), of: z.number().int().min(1).max(30) }).optional().describe("This step's number within the current part of the stage and your estimate of its steps (shown as a progress bar).") }),
      _meta: withCard,
    },
    async ({ titleMd, bodyMd, sideMd, figure: f, progress }) => {
      if (!active) return fail(NO_LESSON);
      // ponytail: length cap counts characters without LaTeX commands; tune STEP_CHARS if Hebrew steps feel cramped.
      if ((bodyMd + (sideMd ?? "")).replace(/\\[a-zA-Z]+|[{}$]/g, "").length > STEP_CHARS) return fail(`This step is too long (${bodyMd.length + (sideMd?.length ?? 0)} characters). Teach less at once: split it into smaller steps and send only the first one.`);
      const bad = f && badFigure(f.kind, f.source);
      if (bad) return fail(`${bad} Fix it and call teach_step again.`);
      reexplain = false;
      const { language, theme } = sets();
      const data: StepData = { view: "step", language, theme, titleMd, bodyMd, figure: f ?? null, sideMd: sideMd?.trim() || null, progress: progress && { n: Math.min(progress.n, progress.of), of: progress.of } };
      await log({ who: "tutor", kind: "step", text: `${titleMd}\n${bodyMd}${sideMd ? `\n(side) ${sideMd}` : ""}`, card: data });
      return out("Step shown. End your message now (no more text) and wait: the student continues, asks for another explanation, or asks a question.", data);
    },
  );

  // A question about a step is answered in a pop-up over that step card (a new card would replace the step).
  let answer: { answerMd: string; at: number } | null = null;
  server.registerTool(
    "answer_question",
    {
      title: "Answer a question about the step",
      description: "Answer the student's question about the lesson step on screen; the answer pops up over the step card, which stays open. Short Markdown with $math$, in the student's language. Use it only for such a question, never to teach the next step.",
      inputSchema: z.object({ answerMd: z.string().min(1).max(4000) }),
    },
    async ({ answerMd }) => {
      if (!active) return fail(NO_LESSON);
      answer = { answerMd, at: Date.now() };
      await log({ who: "tutor", kind: "answer", text: answerMd });
      return out("The answer is shown over the step card. End your message now (no more text) and wait.");
    },
  );
  registerAppTool(server, "step_answer", { title: "Step answer", description: "Card-only: the answer to a question asked since the given time.", inputSchema: z.object({ since: z.number() }), _meta: appOnly }, async ({ since }) => {
    const a = answer && answer.at >= since ? answer.answerMd : null;
    return out(a ? "answer" : "waiting", { answerMd: a });
  });

  registerAppTool(server, assignExercise.def.name, { title: "Exercise", description: assignExercise.def.description + hint, inputSchema: assignExercise.schema, _meta: withCard }, async (i) => {
    if (reexplain) return fail(REEXPLAIN);
    const c = await ctx(i.stageIds[0]);
    if (!c) return fail(NO_LESSON);
    let ex: Ex | null = i.source === "index" && i.exerciseId ? await resolveExercise(c.n, { source: "index", id: i.exerciseId }) : null;
    if (!ex && i.statementMd) {
      const ids = i.stageIds.length ? i.stageIds : [c.stageId];
      ex = { ref: { source: "tutor", id: newId() }, statementMd: i.statementMd, referenceSolutionMd: i.referenceSolutionMd ?? null, gradingNotes: "", requiredStageIds: ids, stageIds: ids, difficulty: i.difficulty, edgeCaseFocus: i.edgeCaseFocus, figures: [] };
    }
    if (!ex) return fail('Unknown exerciseId and no statementMd. Use an id from the exercise list, or source "new" with statementMd and referenceSolutionMd.');
    const kind = c.s.plan.stages.find((x) => x.id === ex.stageIds[0])?.kind;
    const loop = ex.difficulty >= 4 && kind !== "concept" && kind !== "definition"; // M56: hard exercises of advanced stages use the solving loop
    const data = await exercises.open(c.n, ex, "learn", loop);
    await log({ who: "tutor", kind: "exercise", text: ex.statementMd, card: { ...data, figures: [] } as unknown as Record<string, unknown>, extra: { ex, loop } }); // reopened from `ex`: no need to keep the images
    return out("Exercise card shown. The student works on paper, uploads a photo and presses Grade; the graded result then comes back to you through the chat. Do not describe the solution.", data);
  });

  registerAppTool(
    server,
    "check_answer",
    { title: "Check an answer", description: "Card-only: record and mark a multiple-choice answer.", inputSchema: z.object({ checkId: z.string(), selectedIndex: z.number().int().min(0) }), _meta: appOnly },
    async ({ checkId, selectedIndex }) => {
      const k = checks.get(checkId);
      if (!k || k.kind !== "mcq") return fail("This question expired (Shalav was restarted). Ask the tutor for a new one.");
      if (k.selected === undefined) {
        k.selected = selectedIndex;
        const correct = selectedIndex === k.correctIndex;
        await appendEvent(k.n, { type: "check_answered", stageId: k.stageId, checkId, kind: "mcq", context: "learn", correct, score: correct ? 100 : 0, mistakeTags: [], ...(k.nodes?.length ? { nodes: k.nodes.map((id) => ({ id, score: correct ? 1 : 0 })) } : {}) });
        await log({ who: "student", kind: "check", text: `Chose option ${selectedIndex + 1} (${correct ? "correct" : "wrong"}).`, extra: { checkId, selectedIndex } });
      }
      const correct = k.selected === k.correctIndex;
      return out(correct ? "correct" : "wrong", { selectedIndex: k.selected, correct, correctIndex: k.correctIndex, explanationMd: k.explanationMd });
    },
  );

  async function defineTags(n: string, events: S["events"], tags: { tag: string; labelHe: string; labelEn: string; description: string }[]) {
    const known = new Set(events.flatMap((e) => (e.type === "mistake_tag_defined" ? [e.tag] : [])));
    const res: string[] = [];
    for (const t of tags) {
      const tag = normalizeTag(t.tag);
      if (!known.has(tag)) {
        known.add(tag);
        await appendEvent(n, { type: "mistake_tag_defined", tag, labelHe: t.labelHe, labelEn: t.labelEn, description: t.description });
      }
      res.push(tag);
    }
    return res;
  }

  server.registerTool(recordCheckResult.def.name, { title: "Record check result", description: recordCheckResult.def.description, inputSchema: recordCheckResult.schema }, async (i) => {
    const k = checks.get(i.checkToolUseId);
    const c = await ctx(k?.stageId);
    if (!c) return fail(NO_LESSON);
    const tags = await defineTags(c.n, c.s.events, i.mistakes);
    const { g, list } = lessonNodes(c.s, c.stageId);
    const nodes = await applyNodes(c.n, c.s.plan, g, list, i, i.checkToolUseId, "tutor");
    if (k?.kind === "mcq") {
      // the card already recorded the choice: the misconception and per-node scores come as observations
      for (const tag of tags) await appendEvent(c.n, { type: "mistake_observed", tag, stageIds: [c.stageId], refId: i.checkToolUseId, context: "learn" });
      // nodes the MCQ was tagged with already got the choice's 1/0: counting them again would double a miss
      for (const x of nodes) if (!k.nodes?.includes(x.id)) await appendEvent(c.n, { type: "node_observed", nodeId: x.id, score: x.score, why: "MCQ answer", context: "learn" });
    } else
      await appendEvent(c.n, { type: "check_answered", stageId: c.stageId, checkId: i.checkToolUseId, kind: "open", context: "learn", correct: i.correct, score: i.score, mistakeTags: tags, ...(nodes.length ? { nodes } : {}) });
    await log({ who: "tutor", kind: "check", text: `Answer ${i.correct ? "correct" : "not correct"} (${i.score}).` });
    return out(JSON.stringify({ ok: true, mistakeTags: tags }));
  });

  server.registerTool(updateKnowledgeGraph.def.name, { title: "Update knowledge graph", description: updateKnowledgeGraph.def.description, inputSchema: updateKnowledgeGraph.schema }, async (i) => {
    const c = await ctx();
    if (!c) return fail(NO_LESSON);
    const { g, list } = lessonNodes(c.s, c.stageId);
    const ref = `lesson:${active?.cid ?? c.stageId}`;
    const added = await applyNodes(c.n, c.s.plan, g, list, { nodeResults: [], newNodes: i.add }, ref, "tutor");
    for (const [k, x] of added.entries()) await appendEvent(c.n, { type: "node_observed", nodeId: x.id, score: x.score, why: i.add[k]?.why ?? "added by the tutor", context: "learn" });
    for (const o of i.observe) {
      const n = list[o.n - 1];
      if (n) await appendEvent(c.n, { type: "node_observed", nodeId: n.id, score: o.score, why: o.why, context: "learn" });
    }
    for (const l of i.link) {
      const [from, to] = [list[l.from - 1], list[l.to - 1]];
      if (from && to && from.id !== to.id) await appendEvent(c.n, { type: "node_linked", from: from.id, to: to.id, rel: l.rel });
    }
    const s = (await load(c.n)) as S;
    return out(`Graph updated. The numbered list now:\n${listText(lessonNodes(s, c.stageId).list)}`);
  });

  server.registerTool(updateAssessment.def.name, { title: "Update assessment", description: updateAssessment.def.description, inputSchema: updateAssessment.schema }, async (i) => {
    const c = await ctx(i.stageId);
    if (!c) return fail(NO_LESSON);
    await appendEvent(c.n, {
      type: "assessment_updated", stageId: c.stageId, mastery: i.mastery, coveredObjectives: i.coveredObjectives,
      gaps: i.gaps, reviewTopics: i.reviewTopics, readyToAdvance: i.readyToAdvance, rationale: i.rationale,
    });
    await log({ who: "tutor", kind: "assessment", text: `Mastery ${i.mastery}. ${i.rationale}` });
    const s = (await load(c.n)) as S;
    const k = criteria(s, c.stageId);
    // The fresh [STATUS] comes with the result: no shalav_lesson_status round trip after every assessment.
    return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, advanceCriteriaMet: k.met, missing: k.missing }) }, { type: "text" as const, text: status(s, c.stageId) }] };
  });

  // Plan v2 §6.3 allows raw pages for short retrievals; always doing that saves a host round trip (DECISIONS.md).
  server.registerTool(consultMaterials.def.name, { title: "Consult materials", description: consultMaterials.def.description, inputSchema: consultMaterials.schema }, async (i) => {
    const c = await ctx(i.stageId);
    if (!c) return fail(NO_LESSON);
    const pages = await pagesFor({ gw: bridge }, c.s.course, [c.stageId], i.question);
    let body = "";
    for (const p of pages) {
      const t = `[${p.fileName} p.${p.page}]\n${p.text}\n\n`;
      if (body && body.length + t.length > MATERIAL_CHARS) break;
      body += t;
    }
    return out(body ? `<materials>\n${body.trim()}\n</materials>\nThese are the best-matching pages. Quote exact wording only from them.` : "No indexed course material matches. Explain in your own words and say the materials do not cover it.");
  });

  registerAppTool(server, "lesson_state", { title: "Lesson state", description: "Card-only: current data of the lesson card.", inputSchema: z.object({ number: num, stageId: z.string() }), _meta: appOnly }, async ({ number, stageId }) => {
    const s = await load(number);
    return s ? out("ok", lessonData(s, stageId)) : fail("No such course.");
  });
  registerAppTool(
    server,
    "stage_complete",
    {
      title: "Complete the stage",
      description: "Card-only: complete a stage by mastery (criteria must be met) or by the student's confirmed override.",
      inputSchema: z.object({ number: num, stageId: z.string(), by: z.enum(["mastery", "user_override"]) }),
      _meta: appOnly,
    },
    async ({ number, stageId, by }) => {
      const s = await load(number);
      if (!s) return fail("No such course.");
      if (by === "mastery" && !criteria(s, stageId).met) return fail("The advancement criteria are not met yet.");
      await appendEvent(number, { type: "stage_completed", stageId, by, masteryAtCompletion: s.progress.stages[stageId]?.mastery ?? 0 });
      return out("completed", lessonData((await load(number)) as S, stageId));
    },
  );
  registerAppTool(server, "stage_reopen", { title: "Reopen a stage", description: "Card-only: reopen a completed stage to relearn it.", inputSchema: z.object({ number: num, stageId: z.string() }), _meta: appOnly }, async ({ number, stageId }) => {
    await appendEvent(number, { type: "stage_reopened", stageId });
    return out("reopened", lessonData((await load(number)) as S, stageId));
  });

  registerAppTool(server, "history_slides", { title: "Lesson slides", description: "Card-only: the slides of a saved lesson, for browsing back.", inputSchema: z.object({ number: num, id: z.string() }), _meta: appOnly }, async ({ number, id }) => {
    const c = await loadConv(number, id);
    if (!c) return fail("No such lesson.");
    const { language, theme } = sets();
    return out("ok", { slides: c.entries.filter((e) => e.kind === "step" && e.card).map((e) => ({ ...e.card, language, theme })) });
  });

  return {
    reexplain: () => void (reexplain = true),
    /** M60: a student action from a card (Continue, Explain differently, a question, an answer) goes to the open lesson's conversation. */
    note: (text: string) => log({ who: "student", kind: "request", text }),
  };
}
