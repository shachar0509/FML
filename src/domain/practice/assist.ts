import { hintPrompt, solvePrompt } from "@/claude/prompts/practice";
import { submitHint, submitSolution } from "@/claude/practiceTools";
import { callStructured } from "@/claude/structured";
import type { Block } from "@/claude/types";
import { appendEvent } from "@/domain/progress/store";
import { getLessonBrief } from "@/domain/retrieval/retrieve";
import { cachedSolution, saveSolution, type Ctx, type Ex } from "./exercises";
import { boundaryFor, langName, stageList, type Attachment, type Context, type Env } from "./grade";

/** Material digest for the exercise's focus stage (cached lesson brief, 7.7/9.9); "" if unavailable. */
async function digest(env: Env, ctx: Ctx, ex: Ex): Promise<string> {
  try {
    const stageId = ex.requiredStageIds[0] ?? ex.stageIds[0];
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
      requiredStages: stageList(ctx, ex.requiredStageIds), digest: await digest(env, ctx, ex),
    }),
    messages: [{ role: "user", content }], signal: env.signal,
  });
  await appendEvent(ctx.course.courseNumber, { type: "hint_requested", exercise: ex.ref, level: level as 1 | 2 | 3, context });
  return value;
}

/** 7.7: reference solution, generated once with solve mode if missing, cached under solutions[id]. */
export async function getSolution(env: Env, ctx: Ctx, ex: Ex, context: Context): Promise<string> {
  const n = ctx.course.courseNumber;
  let md = ex.referenceSolutionMd ?? (await cachedSolution(n, ex.ref.id));
  if (!md) {
    const { value } = await callStructured(env.gw, submitSolution, {
      task: "grading", courseNumber: n,
      system: solvePrompt(langName(), stageList(ctx, ex.requiredStageIds), boundaryFor(ctx), await digest(env, ctx, ex)),
      messages: [{ role: "user", content: `<exercise>${ex.statementMd}</exercise>` }], signal: env.signal,
    });
    md = value.solutionMd;
    await saveSolution(n, ex.ref.id, md);
  }
  await appendEvent(n, { type: "solution_revealed", exercise: ex.ref, context });
  return md;
}
