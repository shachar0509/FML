import { checkGradingPrompt, gradingPrompt } from "@/claude/prompts/practice";
import type { Lang } from "@/claude/prompts/shared";
import { submitCheckGrade, submitGrade, type CheckGrade, type Grade } from "@/claude/practiceTools";
import { callStructured } from "@/claude/structured";
import type { Block, ClaudeGateway } from "@/claude/types";
import { buildKnowledgeBoundary } from "@/domain/boundary/boundary";
import type { StoredBlock } from "@/domain/dataSchemas";
import { normalizeTag } from "@/domain/progress/reduce";
import { appendEvent } from "@/domain/progress/store";
import { newId } from "@/lib/ids";
import { useSettings } from "@/stores/settings";
import { figureImages, type Ctx, type Ex } from "./exercises";

export type Attachment = Extract<StoredBlock, { type: "image_ref" }>;
export type LoadImage = (sha256: string, mediaType: "image/jpeg" | "image/png") => Promise<string>;
export type Env = { gw: ClaudeGateway; loadImage: LoadImage; signal?: AbortSignal };
export type Context = "learn" | "practice";
export const MAX_PAGES = 12;
export class TooManyPages extends Error {
  constructor() {
    super("grade.tooManyPages");
  }
}

export const langName = (): Lang => (useSettings.getState().settings.language === "he" ? "Hebrew" : "English");
const THINKING = 8000;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const stageLine = (ctx: Ctx, id: string) => {
  const s = ctx.plan.stages.find((x) => x.id === id);
  return s ? `${s.id} ${s.title}: ${s.objectives.join("; ")}` : id;
};
export const stageList = (ctx: Ctx, ids: string[]) => ids.map((i) => stageLine(ctx, i)).join("\n");
export const boundaryFor = (ctx: Ctx, currentStageId: string | null = null) =>
  buildKnowledgeBoundary({ course: ctx.course, plan: ctx.plan, progress: ctx.progress, currentStageId });

/** 7.6 item 3: tags touching the exercise's stages + the 20 heaviest overall. */
export function mistakeTagList(ctx: Ctx, stageIds: string[]): string {
  const m = ctx.progress.mistakes;
  const pick = new Map([...m.filter((x) => x.stageIds.some((s) => stageIds.includes(s))), ...[...m].sort((a, b) => b.weight - a.weight).slice(0, 20)].map((x) => [x.tag, x]));
  return [...pick.values()].map((x) => `${x.tag} — ${x.labelEn} — ${x.description}`).join("\n");
}

async function imageBlocks(env: Env, files: Attachment[]): Promise<Block[]> {
  const out: Block[] = [];
  for (const f of files) out.push({ type: "image", source: { type: "base64", media_type: f.mediaType, data: await env.loadImage(f.sha256, f.mediaType) } });
  return out;
}

/** mistake_tag_defined for new tags; returns normalized tags. */
export async function defineTags(courseNumber: string, ctx: Ctx, tags: { tag: string; labelHe: string; labelEn: string; description: string }[]) {
  const known = new Set(ctx.events.flatMap((e) => (e.type === "mistake_tag_defined" ? [e.tag] : [])));
  const out: string[] = [];
  for (const t of tags) {
    const tag = normalizeTag(t.tag);
    if (!known.has(tag)) {
      known.add(tag);
      await appendEvent(courseNumber, { type: "mistake_tag_defined", tag, labelHe: t.labelHe, labelEn: t.labelEn, description: t.description });
    }
    out.push(tag);
  }
  return out;
}

export type GradeOpts = { hintsUsed: number; solutionRevealed: boolean; context: Context; completedTitles?: string };

/** Spec 7.6: grade written work; stores the attempt as events. Returns the grade and the attempt id. */
export async function gradeAttempt(env: Env, ctx: Ctx, ex: Ex, files: Attachment[], o: GradeOpts): Promise<{ grade: Grade; attemptId: string }> {
  if (files.length > MAX_PAGES) throw new TooManyPages();
  const n = ctx.course.courseNumber;
  const done = ctx.plan.stages.filter((s) => ["completed", "completed_override"].includes(ctx.progress.stages[s.id]?.status ?? ""));
  const system = gradingPrompt({
    course: ctx.course, lang: langName(), statement: ex.statementMd, reference: ex.referenceSolutionMd, gradingNotes: ex.gradingNotes,
    requiredStages: stageList(ctx, ex.requiredStageIds), completedTitles: done.map((s) => `${s.id} ${s.title}`).join("\n") || "(none)",
    mistakeTags: mistakeTagList(ctx, ex.requiredStageIds), boundary: boundaryFor(ctx),
  });
  const figs = (await figureImages(n, ex)).flatMap((f): Block[] => [{ type: "image", source: { type: "base64", media_type: f.mediaType, data: f.base64 } }]);
  const content: Block[] = [
    { type: "text", text: figs.length ? "Figures of the exercise, then the student's solution pages:" : "The student's solution pages:" },
    ...figs, ...(await imageBlocks(env, files)),
  ];
  const { value: g } = await callStructured(env.gw, submitGrade, {
    task: "grading", courseNumber: n, system, messages: [{ role: "user", content }], thinkingBudget: THINKING, signal: env.signal,
  });
  const tags = await defineTags(n, ctx, g.mistakes);
  const attemptId = newId();
  const valid = g.stageIds.filter((s) => ex.stageIds.includes(s));
  await appendEvent(n, {
    type: "attempt_graded", attemptId, exercise: ex.ref, stageIds: valid.length ? valid : ex.stageIds, context: o.context,
    verdict: g.legibility === "illegible" ? "unreadable" : g.verdict, score: g.score,
    mistakes: g.mistakes.map((m, i) => ({ tag: tags[i] as string, severity: m.severity, note: clip(m.whereMd || m.description, 120) })),
    missingForFullCredit: g.missingForFullCredit.length, edgeCasesMissed: g.edgeCasesMissed, attachmentHashes: files.map((f) => f.sha256),
    difficulty: ex.difficulty, hasEdgeCaseFocus: ex.edgeCaseFocus.length > 0, hintsUsed: o.hintsUsed, solutionRevealedBefore: o.solutionRevealed,
  });
  return { grade: g, attemptId };
}

/** Practice open answer / MCQ-style check graded by the grading model (10.5, short answer). */
export async function gradeCheck(
  env: Env, ctx: Ctx,
  q: { id: string; stageIds: string[]; questionMd: string; expectedPoints: string[] },
  answerText: string, files: Attachment[], context: Context,
): Promise<CheckGrade> {
  const n = ctx.course.courseNumber;
  const { value } = await callStructured(env.gw, submitCheckGrade, {
    task: "grading", courseNumber: n,
    system: checkGradingPrompt({ course: ctx.course, lang: langName(), question: q.questionMd, expectedPoints: q.expectedPoints, mistakeTags: mistakeTagList(ctx, q.stageIds), boundary: boundaryFor(ctx) }),
    messages: [{ role: "user", content: [{ type: "text", text: `<student_answer>${answerText || "(see images)"}</student_answer>` }, ...(await imageBlocks(env, files))] }],
    signal: env.signal,
  });
  const tags = await defineTags(n, ctx, value.mistakes);
  await appendEvent(n, {
    type: "check_answered", stageId: q.stageIds[0] as string, checkId: q.id, kind: "open", context, correct: value.correct, score: value.score, mistakeTags: tags,
  });
  return value;
}
