import { checksPrompt, generationPrompt, verificationPrompt } from "@/claude/prompts/practice";
import { submitGeneratedExercise, submitPracticeCheck, submitVerification, type CheckItem } from "@/claude/practiceTools";
import { callStructured } from "@/claude/structured";
import type { GeneratedExercise, IndexedExercise } from "@/domain/dataSchemas";
import { listFileIndexes } from "@/domain/ingest/indexStore";
import { getLessonBrief } from "@/domain/retrieval/retrieve";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { addGenerated, type Ctx } from "./exercises";
import { boundaryFor, langName, stageList, type Env } from "./grade";
import { completedIds, focusStage, requiredSet, targetDifficulty, type Scope } from "./select";

export type Focus = { stageId: string; required: string[] };
export function chooseFocus(ctx: Ctx, scope: Scope): Focus | null {
  const stageId = focusStage({ plan: ctx.plan, progress: ctx.progress, scope });
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

/** 7.5: generate + verify one exercise (one regeneration with the verifier's issues). Null if both attempts fail. */
export async function generateExercise(env: Env, ctx: Ctx, focus: Focus): Promise<GeneratedExercise | null> {
  const n = ctx.course.courseNumber;
  const done = completedIds(ctx.progress);
  const refs = (await listFileIndexes(n)).flatMap((f) => f.exercises)
    .sort((a, b) => Math.abs(orderOf(ctx, a.primaryStageId) - orderOf(ctx, focus.stageId)) - Math.abs(orderOf(ctx, b.primaryStageId) - orderOf(ctx, focus.stageId)))
    .slice(0, 3);
  const styleRefs = refs.map((r: IndexedExercise) => `- ${r.statementMd}${r.referenceSolutionMd ? `\n  Solution: ${r.referenceSolutionMd}` : ""}`).join("\n");
  const type = ctx.course.courseKind === "proof-based" ? "proof" : ctx.course.courseKind === "programming" ? "coding" : "computation";
  const common = {
    course: ctx.course, lang: langName(), type, difficulty: Math.round(targetDifficulty(ctx.events)), requiredStages: stageList(ctx, focus.required),
    focusJson: focusJson(ctx, focus.stageId), styleRefs, digest: await digest(env, ctx, focus.stageId), boundary: boundaryFor(ctx), mistakes: mistakesText(ctx, focus.required),
  };
  let issues: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { value: g } = await callStructured(env.gw, submitGeneratedExercise, {
      task: "generation", courseNumber: n, system: generationPrompt({ ...common, issues }), messages: [{ role: "user", content: "Create the exercise." }], signal: env.signal,
    });
    if (!g.requiredStageIds.every((s) => done.has(s))) { issues = [`requiredStageIds must be among: ${[...done].join(", ")}`]; continue; }
    const { value: v } = await callStructured(env.gw, submitVerification, {
      task: "grading", courseNumber: n, system: verificationPrompt(stageList(ctx, g.requiredStageIds), boundaryFor(ctx)),
      messages: [{ role: "user", content: `<exercise>${g.statementMd}</exercise>\nReference solution:\n${g.referenceSolutionMd}\nGrading notes: ${g.gradingNotes}` }], signal: env.signal,
    });
    if (v.wellPosed && v.solvable && v.matchesReference && !v.requiresStagesBeyond.length) {
      const ex: GeneratedExercise = {
        id: `gen-${newId()}`, label: "", pages: [], statementMd: g.statementMd, figureCrops: [], referenceSolutionMd: g.referenceSolutionMd,
        requiredStageIds: g.requiredStageIds, primaryStageId: focus.stageId as GeneratedExercise["primaryStageId"],
        difficulty: Math.min(5, Math.max(1, g.difficulty)) as GeneratedExercise["difficulty"], type: g.type, estimatedMinutes: g.estimatedMinutes,
        edgeCaseFocus: g.edgeCaseFocus, gist: g.statementMd.slice(0, 120), origin: "generated", styleRefIds: refs.map((r) => r.id),
        verified: true, gradingNotes: g.gradingNotes, createdAt: nowIso(),
      };
      await addGenerated(n, ex);
      return ex;
    }
    issues = [...v.issues, ...v.requiresStagesBeyond.map((s) => `requires stage beyond the list: ${s}`)];
  }
  return null;
}

/** 7.5 batching: 4 questions (2 mcq + 2 open) per call. */
export async function generateChecks(env: Env, ctx: Ctx, focus: Focus): Promise<(CheckItem & { id: string })[]> {
  const { value } = await callStructured(env.gw, submitPracticeCheck, {
    task: "generation", courseNumber: ctx.course.courseNumber,
    system: checksPrompt({
      lang: langName(), requiredStages: stageList(ctx, focus.required), focusJson: focusJson(ctx, focus.stageId),
      boundary: boundaryFor(ctx), digest: await digest(env, ctx, focus.stageId), mistakes: mistakesText(ctx, focus.required),
    }),
    messages: [{ role: "user", content: "Create the questions." }], signal: env.signal,
  });
  const done = completedIds(ctx.progress);
  return value.items.map((i) => ({ ...i, stageIds: i.stageIds.filter((s) => done.has(s)).length ? i.stageIds.filter((s) => done.has(s)) : [focus.stageId], id: `chk-${newId()}` }));
}
