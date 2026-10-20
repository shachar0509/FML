import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { LessonData, McqData, OpenData } from "@/cards/types";
import { statusBlock, tutorSystem } from "@/claude/prompts/tutor";
import { askOpenQuestion, assignExercise, consultMaterials, presentMcq, recordCheckResult, updateAssessment } from "@/claude/tutorTools";
import { buildKnowledgeBoundary } from "@/domain/boundary/boundary";
import { CourseJsonSchema, EventSchema, PlanJsonSchema } from "@/domain/dataSchemas";
import { listFileIndexes } from "@/domain/ingest/indexStore";
import { buildRecap } from "@/domain/learn/recap";
import { checkAdvanceCriteria } from "@/domain/progress/criteria";
import { normalizeTag, reduceProgress } from "@/domain/progress/reduce";
import { appendEvent } from "@/domain/progress/store";
import { resolveExercise, type Ex } from "@/domain/practice/exercises";
import { pagesFor } from "@/domain/retrieval/retrieve";
import { readJsonFile } from "@/lib/fs/atomicWrite";
import { readJsonlDir } from "@/lib/fs/jsonl";
import { coursePaths } from "@/lib/fs/paths";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { useSettings } from "@/stores/settings";
import type { BridgeGateway } from "./bridge";
import { registerExerciseTools } from "./exerciseTools";
import { CARDS_URI } from "./resources";

const appOnly = { ui: { resourceUri: CARDS_URI, visibility: ["app" as const] } };
const withCard = { ui: { resourceUri: CARDS_URI } };
const num = z.string().regex(/^\d{8}$/);
const MATERIAL_CHARS = 6000;
const out = (text: string, structuredContent?: object) => ({ content: [{ type: "text" as const, text }], ...(structuredContent ? { structuredContent: structuredContent as Record<string, unknown> } : {}) });
const fail = (text: string) => ({ ...out(text), isError: true as const });

type Check = { kind: "mcq" | "open"; n: string; stageId: string; correctIndex?: number; explanationMd?: string; selected?: number };

/** Learn (plan v2 §6.3): the host chat is the lesson; the tutor tools record the v1 events and return cards. */
export function registerLearnTools(server: McpServer, bridge: BridgeGateway) {
  /** The lesson the student is in; the tutor tools carry a stageId but no course number. */
  let active: { n: string; stageId: string } | null = null;
  const checks = new Map<string, Check>(); // lost on a server restart; check_answer then says so

  const sets = () => useSettings.getState().settings;
  async function load(n: string) {
    const p = coursePaths(sets().dataRoot, n);
    const [course, plan] = await Promise.all([readJsonFile(p.courseJson, CourseJsonSchema), readJsonFile(p.planJson, PlanJsonSchema)]);
    if (!course || !plan) return null;
    const events = await readJsonlDir(p.events, EventSchema);
    return { course, plan, events, progress: reduceProgress(plan, events, nowIso()) };
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
      view: "lesson", language, theme, number: s.course.courseNumber, stageId, title: stage?.title ?? stageId,
      status: sp?.status ?? "locked",
      objectives: (stage?.objectives ?? []).map((text, k) => ({ text, covered: !!sp?.coveredObjectives.includes(k) })),
      mastery: Math.round((sp?.mastery ?? 0) * 100),
      criteria: criteria(s, stageId),
      next: next ? { id: next.id, title: next.title } : null,
    };
  }

  function status(s: S, stageId: string) {
    const stage = s.plan.stages.find((x) => x.id === stageId);
    const sp = s.progress.stages[stageId];
    const lang = sets().language;
    return statusBlock({
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
  const NO_LESSON = "No lesson is open. Call shalav_start_lesson first.";
  const exercises = registerExerciseTools(server, bridge);

  registerAppTool(
    server,
    "shalav_start_lesson",
    {
      title: "Start a lesson",
      description: "Open the lesson card for a stage and get the tutor instructions. Use when the student wants to learn (or continue) a stage; stageId defaults to the course's current stage.",
      inputSchema: z.object({ courseNumber: num, stageId: z.string().optional() }),
      _meta: withCard,
    },
    async ({ courseNumber: n, stageId }) => {
      const s = await load(n);
      if (!s) return fail(`No course ${n} with a study plan. Use shalav_home.`);
      const id = stageId ?? s.progress.currentStageId ?? s.plan.stages[0]?.id;
      const stage = s.plan.stages.find((x) => x.id === id);
      if (!stage) return fail(`No stage ${stageId}.`);
      const st = s.progress.stages[stage.id]?.status;
      if (st === "locked") return fail(`Stage ${stage.id} is locked: finish its prerequisites (${stage.prerequisites.join(", ")}) first.`);
      active = { n, stageId: stage.id };
      if (st === "completed" || st === "completed_override")
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
        knowledgeBoundary: buildKnowledgeBoundary({ course: s.course, plan: s.plan, progress: s.progress, currentStageId: stage.id }),
        lessonBrief: brief.trim() || "No indexed course materials match this stage yet; explain in your own words.",
        exercises, mistakeTags: s.progress.mistakes,
      });
      const recap = buildRecap(s.plan, s.events, stage.id);
      const text = [
        system,
        status(s, stage.id),
        recap,
        "The lesson card is shown. Begin the lesson now as the instructions say.",
      ].filter(Boolean).join("\n\n");
      return out(text, lessonData(s, stage.id));
    },
  );

  server.registerTool(
    "shalav_lesson_status",
    { title: "Lesson status", description: "Fresh [STATUS] progress data for the open lesson. Call it after every update_assessment and whenever you need current progress.", inputSchema: z.object({}) },
    async () => {
      const c = await ctx();
      if (!c) return fail(NO_LESSON);
      const k = criteria(c.s, c.stageId);
      return out(`${status(c.s, c.stageId)}\nAdvancement criteria met: ${k.met ? "yes (the student can press Complete stage)" : "no"}`);
    },
  );

  const hint = " The card is shown to the student: end your message now and wait for their reply.";
  registerAppTool(server, presentMcq.def.name, { title: "Multiple-choice question", description: presentMcq.def.description + hint, inputSchema: presentMcq.schema, _meta: withCard }, async (i) => {
    const c = await ctx(i.stageId);
    if (!c) return fail(NO_LESSON);
    if (i.correctIndex >= i.options.length) return fail("correctIndex is outside options.");
    const checkId = newId();
    checks.set(checkId, { kind: "mcq", n: c.n, stageId: c.stageId, correctIndex: i.correctIndex, explanationMd: i.explanationMd });
    const { language, theme } = sets();
    const data: McqData = { view: "mcq", language, theme, checkId, questionMd: i.questionMd, options: i.options };
    return out(`Question shown (check id ${checkId}). Never reveal the answer. The student's choice arrives as their next message.`, data);
  });
  registerAppTool(server, askOpenQuestion.def.name, { title: "Open question", description: askOpenQuestion.def.description + hint, inputSchema: askOpenQuestion.schema, _meta: withCard }, async (i) => {
    const c = await ctx(i.stageId);
    if (!c) return fail(NO_LESSON);
    const checkId = newId();
    checks.set(checkId, { kind: "open", n: c.n, stageId: c.stageId });
    const { language, theme } = sets();
    const data: OpenData = { view: "open", language, theme, checkId, questionMd: i.questionMd };
    return out(`Question shown (check id ${checkId}). The student's written answer arrives as their next message; evaluate it, then call record_check_result with checkToolUseId "${checkId}".`, data);
  });

  registerAppTool(server, assignExercise.def.name, { title: "Exercise", description: assignExercise.def.description + hint, inputSchema: assignExercise.schema, _meta: withCard }, async (i) => {
    const c = await ctx(i.stageIds[0]);
    if (!c) return fail(NO_LESSON);
    let ex: Ex | null = i.source === "index" && i.exerciseId ? await resolveExercise(c.n, { source: "index", id: i.exerciseId }) : null;
    if (!ex && i.statementMd) {
      const ids = i.stageIds.length ? i.stageIds : [c.stageId];
      ex = { ref: { source: "tutor", id: newId() }, statementMd: i.statementMd, referenceSolutionMd: i.referenceSolutionMd ?? null, gradingNotes: "", requiredStageIds: ids, stageIds: ids, difficulty: i.difficulty, edgeCaseFocus: i.edgeCaseFocus, figures: [] };
    }
    if (!ex) return fail('Unknown exerciseId and no statementMd. Use an id from the exercise list, or source "new" with statementMd and referenceSolutionMd.');
    const data = await exercises.open(c.n, ex, "learn");
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
        await appendEvent(k.n, { type: "check_answered", stageId: k.stageId, checkId, kind: "mcq", context: "learn", correct, score: correct ? 100 : 0, mistakeTags: [] });
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
    if (k?.kind === "mcq") for (const tag of tags) await appendEvent(c.n, { type: "mistake_observed", tag, stageIds: [c.stageId], refId: i.checkToolUseId, context: "learn" });
    else
      await appendEvent(c.n, { type: "check_answered", stageId: c.stageId, checkId: i.checkToolUseId, kind: "open", context: "learn", correct: i.correct, score: i.score, mistakeTags: tags });
    return out(JSON.stringify({ ok: true, mistakeTags: tags }));
  });

  server.registerTool(updateAssessment.def.name, { title: "Update assessment", description: updateAssessment.def.description, inputSchema: updateAssessment.schema }, async (i) => {
    const c = await ctx(i.stageId);
    if (!c) return fail(NO_LESSON);
    await appendEvent(c.n, {
      type: "assessment_updated", stageId: c.stageId, mastery: i.mastery, coveredObjectives: i.coveredObjectives,
      gaps: i.gaps, reviewTopics: i.reviewTopics, readyToAdvance: i.readyToAdvance, rationale: i.rationale,
    });
    const s = (await load(c.n)) as S;
    const k = criteria(s, c.stageId);
    return out(JSON.stringify({ ok: true, advanceCriteriaMet: k.met, missing: k.missing }));
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
}
