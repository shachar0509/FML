import { checksPrompt, generationPrompt, verificationPrompt } from "@/core/claude/prompts/practice";
import { submitGeneratedExercise, submitPracticeCheck, submitVerification, type CheckItem } from "@/core/claude/practiceTools";
import { callStructured } from "@/core/claude/structured";
import type { GeneratedExercise, IndexedExercise } from "@/core/domain/dataSchemas";
import { listFileIndexes } from "@/core/domain/ingest/indexStore";
import { getLessonBrief } from "@/core/domain/retrieval/retrieve";
import { newId } from "@/core/lib/ids";
import { nowIso } from "@/core/lib/time";
import { addGenerated, type Ctx } from "./exercises";
import { boundaryFor, langName, stageList, type Env } from "./grade";
import { candidates, listText } from "@/core/domain/knowledge/tag";
import { completedIds, focusStage, levelOf, requiredSet, targetDifficulty, type Scope } from "./select";

export type Focus = { stageId: string; required: string[] };
export function chooseFocus(ctx: Ctx, scope: Scope, hot?: string[]): Focus | null {
  const stageId = focusStage({ plan: ctx.plan, progress: ctx.progress, scope, hot });
  return stageId ? { stageId, required: requiredSet(ctx.plan, stageId, completedIds(ctx.progress)) } : null;
}

const orderOf = (ctx: Ctx, id: string) => ctx.plan.stages.find((s) => s.id === id)?.order ?? 0;
const focusJson = (ctx: Ctx, id: string) => JSON.stringify(ctx.plan.stages.find((s) => s.id === id));
const mistakesText = (ctx: Ctx, stages: string[]) =>
  ctx.progress.mistakes.filter((m) => !m.resolved && m.stageIds.some((s) => stages.includes(s))).slice(0, 5).map((m) => `${m.tag} — ${m.labelEn}: ${m.description}`).join("\n");
async function digest(env: Env, ctx: Ctx, stageId: string) {
  try {
    return (await getLessonBrief({ gw: env.gw, signal: env.signal }, { course: ctx.course, plan: ctx.plan, stageId, lang: langName() })).briefMd;
  } catch {
    return "";
  }
}

/** M69: the focus stage's graph nodes (course-wide ones first), numbered with the student's control; the model answers by number. */
function nodeList(ctx: Ctx, focus: Focus) {
  const lv = levelOf(ctx);
  const cands = candidates(lv.g, [focus.stageId, ...focus.required.filter((s) => s !== focus.stageId)]);
  return { text: listText(cands, lv.k.control), ids: (ns: number[]) => [...new Set(ns.flatMap((x) => cands[x - 1]?.id ?? []))] };
}

const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
/** The 3 course exercises nearest the stage (by plan order) or, without a stage, sharing the most words with `query`; solved ones first. */
export async function nearestExercises(ctx: Ctx, stageId: string | null, query = ""): Promise<IndexedExercise[]> {
  const q = words(query);
  const dist = (e: IndexedExercise) =>
    (e.referenceSolutionMd ? 0 : 1000) + (stageId ? Math.abs(orderOf(ctx, e.primaryStageId) - orderOf(ctx, stageId)) : -[...words(e.statementMd)].filter((w) => q.has(w)).length);
  return (await listFileIndexes(ctx.course.courseNumber)).flatMap((f) => f.exercises).sort((a, b) => dist(a) - dist(b)).slice(0, 3);
}
export const refsText = (refs: IndexedExercise[]) => refs.map((r) => `- ${r.statementMd}${r.referenceSolutionMd ? `\n  Solution: ${r.referenceSolutionMd}` : ""}`).join("\n");

/** 7.5: generate + verify one exercise (one regeneration with the verifier's issues). Null if both attempts fail.
 * M59 `test`: an exam question for test practice, like `like` (the exam question the student missed) when given; any stage of the course, no progress boundary. */
export async function generateExercise(env: Env, ctx: Ctx, focus: Focus, test?: { like: IndexedExercise | null }): Promise<GeneratedExercise | null> {
  const n = ctx.course.courseNumber;
  const done = test ? new Set(ctx.plan.stages.map((s) => s.id)) : completedIds(ctx.progress);
  const refs = test?.like ? [test.like] : await nearestExercises(ctx, focus.stageId);
  const styleRefs = test?.like
    ? `The student got this past exam question wrong. Write a NEW exam question that tests the same concept and skills, with different data and setting (not a copy):\n${refsText(refs)}`
    : refsText(refs);
  const boundary = test ? "" : boundaryFor(ctx);
  const type = ctx.course.courseKind === "proof-based" ? "proof" : ctx.course.courseKind === "programming" ? "coding" : "computation";
  const tags = nodeList(ctx, focus);
  const common = {
    nodes: tags.text,
    course: ctx.course, lang: langName(), type, difficulty: targetDifficulty(ctx, [focus.stageId]), requiredStages: stageList(ctx, focus.required),
    focusJson: focusJson(ctx, focus.stageId), styleRefs, digest: await digest(env, ctx, focus.stageId), boundary, mistakes: mistakesText(ctx, focus.required),
    ...(test ? { difficulty: Math.max(4, test.like?.difficulty ?? 4) } : {}),
  };
  let issues: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { value: g } = await callStructured(env.gw, submitGeneratedExercise, {
      task: "generation", courseNumber: n, system: generationPrompt({ ...common, issues }), messages: [{ role: "user", content: "Create the exercise." }], signal: env.signal,
    });
    if (!g.requiredStageIds.every((s) => done.has(s))) { issues = [`requiredStageIds must be among: ${[...done].join(", ")}`]; continue; }
    const { value: v } = await callStructured(env.gw, submitVerification, {
      task: "grading", courseNumber: n, system: verificationPrompt(stageList(ctx, g.requiredStageIds), boundary),
      messages: [{ role: "user", content: `<exercise>${g.statementMd}</exercise>\nReference solution:\n${g.referenceSolutionMd}\nGrading notes: ${g.gradingNotes}` }], signal: env.signal,
    });
    if (v.wellPosed && v.solvable && v.matchesReference && !v.requiresStagesBeyond.length) {
      const ex: GeneratedExercise = {
        id: `gen-${newId()}`, label: "", pages: [], statementMd: g.statementMd, figureCrops: [], referenceSolutionMd: g.referenceSolutionMd,
        requiredStageIds: g.requiredStageIds, primaryStageId: focus.stageId as GeneratedExercise["primaryStageId"],
        difficulty: Math.min(5, Math.max(1, g.difficulty)) as GeneratedExercise["difficulty"], type: g.type, estimatedMinutes: g.estimatedMinutes,
        edgeCaseFocus: g.edgeCaseFocus, gist: g.statementMd.slice(0, 120), origin: "generated", styleRefIds: refs.map((r) => r.id),
        verified: true, gradingNotes: g.gradingNotes, createdAt: nowIso(), nodeIds: tags.ids(g.nodes),
      };
      await addGenerated(n, ex);
      return ex;
    }
    issues = [...v.issues, ...v.requiresStagesBeyond.map((s) => `requires stage beyond the list: ${s}`)];
  }
  return null;
}

/** 7.5 batching: 4 questions (2 mcq + 2 open) per call. */
export async function generateChecks(env: Env, ctx: Ctx, focus: Focus): Promise<(CheckItem & { id: string; nodeIds: string[] })[]> {
  const tags = nodeList(ctx, focus);
  const { value } = await callStructured(env.gw, submitPracticeCheck, {
    task: "generation", courseNumber: ctx.course.courseNumber,
    system: checksPrompt({
      lang: langName(), requiredStages: stageList(ctx, focus.required), focusJson: focusJson(ctx, focus.stageId),
      boundary: boundaryFor(ctx), digest: await digest(env, ctx, focus.stageId), mistakes: mistakesText(ctx, focus.required), nodes: tags.text,
    }),
    messages: [{ role: "user", content: "Create the questions." }], signal: env.signal,
  });
  const done = completedIds(ctx.progress);
  return value.items.map((i) => ({ ...i, stageIds: i.stageIds.filter((s) => done.has(s)).length ? i.stageIds.filter((s) => done.has(s)) : [focus.stageId], id: `chk-${newId()}`, nodeIds: tags.ids(i.nodes) }));
}
