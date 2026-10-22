import { isCustom } from "@/core/universities";
import { clarifyPrompt, cluePrompt, hintPrompt, solvePrompt } from "@/core/claude/prompts/practice";
import { submitClue, submitHint, submitSolution } from "@/core/claude/practiceTools";
import { callStructured } from "@/core/claude/structured";
import type { Block } from "@/core/claude/types";
import { appendEvent } from "@/core/domain/progress/store";
import { getLessonBrief } from "@/core/domain/retrieval/retrieve";
import { cachedSolution, saveSolution, type Ctx, type Ex } from "./exercises";
import { nearestExercises, refsText } from "./generate";
import { boundaryFor, boundaryOf, conventionsFor, imageBlocks, langName, stageList, type Attachment, type Context, type Env } from "./grade";

/** Material digest for the exercise's focus stage (cached lesson brief, 7.7/9.9); "" if unavailable. Without a stage (homework) the host's digest ranks all materials by the statement. */
export async function digest(env: Env, ctx: Ctx, ex: Ex): Promise<string> {
  try {
    const stageId = ex.requiredStageIds[0] ?? ex.stageIds[0];
    if (env.digest) return await env.digest(ctx, stageId ?? null, ex.statementMd);
    if (!stageId) return "";
    return (await getLessonBrief({ gw: env.gw, signal: env.signal }, { course: ctx.course, plan: ctx.plan, stageId, lang: langName() })).briefMd;
  } catch {
    return "";
  }
}

/** 7.7: hint `level` (1-3) given earlier hints and optional partial work. */
export async function getHint(env: Env, ctx: Ctx, ex: Ex, level: number, previous: string[], files: Attachment[], context: Context) {
  const content: Block[] = [{ type: "text", text: files.length ? "The student's work so far:" : "The student has not written anything yet." }];
  for (const f of files) content.push({ type: "image", source: { type: "base64", media_type: f.mediaType, data: await env.loadImage(f.sha256, f.mediaType) } });
  const { value } = await callStructured(env.gw, submitHint, {
    task: "hint", courseNumber: ctx.course.courseNumber,
    system: hintPrompt({
      lang: langName(), level, statement: ex.statementMd, reference: ex.referenceSolutionMd, previous, boundary: boundaryFor(ctx),
      requiredStages: stageList(ctx, ex.requiredStageIds), digest: await digest(env, ctx, ex), conventions: conventionsFor(ctx, ex.stageIds).text,
    }),
    messages: [{ role: "user", content }], signal: env.signal,
  });
  if (context !== "homework") await appendEvent(ctx.course.courseNumber, { type: "hint_requested", exercise: ex.ref, level: level as 1 | 2 | 3, context });
  return value;
}

/** 7.7: reference solution, generated once with solve mode if missing, cached under solutions[id]. */
export async function getSolution(env: Env, ctx: Ctx, ex: Ex, context: Context): Promise<string> {
  const n = ctx.course.courseNumber;
  let md = ex.referenceSolutionMd ?? (await cachedSolution(n, ex.ref.id));
  if (!md) {
    const { value } = await callStructured(env.gw, submitSolution, {
      task: "grading", courseNumber: n,
      system: solvePrompt(langName(), stageList(ctx, ex.requiredStageIds), boundaryOf(ctx, ex), await digest(env, ctx, ex), isCustom(ctx.course), await examples(ctx, ex), conventionsFor(ctx, ex.stageIds).text),
      messages: [{ role: "user", content: `<exercise>${ex.statementMd}</exercise>` }], signal: env.signal,
    });
    md = value.solutionMd;
    await saveSolution(n, ex.ref.id, md);
  }
  if (context !== "homework") await appendEvent(n, { type: "solution_revealed", exercise: ex.ref, context });
  return md;
}

/** The course's example exercises nearest this one, with their solutions (M56: the loop sticks to them). */
export const examples = async (ctx: Ctx, ex: Ex) =>
  refsText((await nearestExercises(ctx, ex.requiredStageIds[0] ?? ex.stageIds[0] ?? null, ex.statementMd)).filter((r) => r.id !== ex.ref.id));

async function clueArgs(env: Env, ctx: Ctx, ex: Ex) {
  return {
    lang: langName(), statement: ex.statementMd, reference: ex.referenceSolutionMd, boundary: boundaryOf(ctx, ex), // homework and exams follow the course's own schedule, not Shalav progress
    requiredStages: stageList(ctx, ex.requiredStageIds), digest: await digest(env, ctx, ex), examples: await examples(ctx, ex),
    conventions: conventionsFor(ctx, ex.stageIds).text,
  };
}

/** M56 solving loop, "Get a clue": the first mistake in the attached work, or one small clue. */
export async function getClue(env: Env, ctx: Ctx, ex: Ex, previous: string[], files: Attachment[]) {
  const content: Block[] = [{ type: "text", text: files.length ? "The student's work so far:" : "The student has not written anything yet." }, ...(await imageBlocks(env, files))];
  const { value } = await callStructured(env.gw, submitClue, {
    task: "hint", courseNumber: ctx.course.courseNumber, system: cluePrompt({ ...(await clueArgs(env, ctx, ex)), previous }),
    messages: [{ role: "user", content }], signal: env.signal,
  });
  return value;
}

/** M56 solving loop, "I didn't understand the clue": the same clue in other words. */
export async function clarifyClue(env: Env, ctx: Ctx, ex: Ex, clue: string, tried: string[]) {
  const { value } = await callStructured(env.gw, submitClue, {
    task: "hint", courseNumber: ctx.course.courseNumber, system: clarifyPrompt({ ...(await clueArgs(env, ctx, ex)), previous: [], clue, tried }),
    messages: [{ role: "user", content: "Explain the clue again." }], signal: env.signal,
  });
  return value.clueMd;
}
