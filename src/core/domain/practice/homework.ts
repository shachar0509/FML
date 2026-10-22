import * as z from "zod";
import { solvePrompt, splitPrompt } from "@/core/claude/prompts/practice";
import { submitHomework, submitSolution } from "@/core/claude/practiceTools";
import { callStructured } from "@/core/claude/structured";
import type { Block } from "@/core/claude/types";
import { readJsonFile, writeJsonAtomic } from "@/core/lib/fs/atomicWrite";
import { fs } from "@/core/lib/fs/fs";
import { newId } from "@/core/lib/ids";
import { nowIso } from "@/core/lib/time";
import { isCustom } from "@/core/universities";
import { digest, examples } from "./assist";
import { figureImages, loadCtx, paths, type Ex } from "./exercises";
import { imageBlocks, langName, type Attachment, type Env } from "./grade";
import { emptyRun, type RunState } from "./run";

/** M57: one question of the student's own homework; `accepted` = the pages of their perfect solution (their handwriting), in order. */
export type HwQuestion = { label: string; statementMd: string; pages: number[]; run: RunState; accepted: string[] | null; solutionMd: string | null };
export type Homework = {
  id: string; kind: "single" | "homework"; how: "tutor" | "ai" | null; name: string; createdAt: string;
  /** the uploaded pages (attachments), in order */
  pages: Attachment[];
  questions: HwQuestion[];
  current: number;
};

const file = (n: string) => `${paths(n).homework}/current.json`;
const Any = z.custom<Homework>((v) => typeof v === "object" && v !== null);

export const loadHomework = (n: string) => readJsonFile(file(n), Any);
export const saveHomework = (n: string, hw: Homework) => writeJsonAtomic(file(n), hw);
/** Ends the current one; it is kept under its id. */
export async function endHomework(n: string) {
  const hw = await loadHomework(n);
  if (!hw) return;
  await writeJsonAtomic(`${paths(n).homework}/${hw.id}.json`, hw);
  await fs().remove(file(n));
}

export const newHomework = (kind: Homework["kind"], pages: Attachment[]): Homework => ({
  id: newId(), kind, how: kind === "single" ? "tutor" : null, name: "", createdAt: nowIso(), pages, questions: [], current: 0,
});

/** The question as an exercise: no plan stages (the course material is ranked by its text), the original pages as its figures. */
export function asExercise(n: string, hw: Homework, i: number): Ex {
  const q = hw.questions[i] as HwQuestion;
  const rel = paths(n).attachments.slice(paths(n).course.length + 1);
  return {
    ref: { source: "tutor", id: `hw-${hw.id}-${i}` }, statementMd: q.statementMd, referenceSolutionMd: q.solutionMd, gradingNotes: "",
    requiredStageIds: [], stageIds: [], difficulty: 0, edgeCaseFocus: [],
    figures: q.pages.flatMap((p) => (hw.pages[p - 1] ? [{ file: `${rel}/${hw.pages[p - 1]?.sha256}.jpg` }] : [])),
  };
}

/** The host model reads the pages and returns the questions. */
export async function splitHomework(env: Env, n: string, hw: Homework): Promise<Homework> {
  const content: Block[] = [{ type: "text", text: `${hw.pages.length} page(s):` }, ...(await imageBlocks(env, hw.pages))];
  const { value } = await callStructured(env.gw, submitHomework, {
    task: "grading", courseNumber: n, system: splitPrompt(langName(), hw.kind === "single"),
    messages: [{ role: "user", content }], signal: env.signal,
  });
  const qs = hw.kind === "single" ? value.questions.slice(0, 1) : value.questions;
  return {
    ...hw, name: value.name, current: 0,
    questions: qs.map((q) => ({ label: q.label, statementMd: q.statementMd, pages: q.pages.filter((p) => p <= hw.pages.length), run: emptyRun(), accepted: null, solutionMd: null })),
  };
}

/** The accepted solution pages, in question order. */
export const acceptedPages = (hw: Homework) => hw.questions.flatMap((q) => q.accepted ?? []);

/** M58 "Let the AI solve it": one job per unsolved question, each saved as it lands (a failure resumes where it stopped). */
export async function solveHomework(env: Env, n: string, id: string) {
  for (;;) {
    const hw = await loadHomework(n);
    const i = hw?.id === id ? hw.questions.findIndex((q) => !q.solutionMd) : -1;
    if (!hw || i < 0) return;
    const ctx = await loadCtx(n);
    const ex = asExercise(n, hw, i);
    const figs = await figureImages(n, ex);
    const content: Block[] = [
      { type: "text", text: `<exercise>${ex.statementMd}</exercise>${figs.length ? "\nThe question's original page(s):" : ""}` },
      ...figs.map((f): Block => ({ type: "image", source: { type: "base64", media_type: f.mediaType, data: f.base64 } })),
    ];
    const { value } = await callStructured(env.gw, submitSolution, {
      task: "grading", courseNumber: n, system: solvePrompt(langName(), "", "", await digest(env, ctx, ex), isCustom(ctx.course), await examples(ctx, ex)),
      messages: [{ role: "user", content }], signal: env.signal,
    });
    const now = await loadHomework(n);
    const q = now?.id === id ? now.questions[i] : null;
    if (!now || !q) return;
    q.solutionMd = value.solutionMd;
    await saveHomework(n, now);
  }
}

/** Where the AI's solutions PDF is kept once printed. */
export const solutionsPdf = (n: string, id: string) => `${paths(n).homework}/${id}.pdf`;
