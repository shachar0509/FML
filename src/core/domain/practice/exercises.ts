import {
  CourseJsonSchema, EventSchema, GeneratedFileSchema, PlanJsonSchema,
  type CourseJson, type Event, type ExerciseRef, type GeneratedExercise, type GeneratedFile, type IndexedExercise, type PlanJson, type ProgressJson,
} from "@/core/domain/dataSchemas";
import { listFileIndexes } from "@/core/domain/ingest/indexStore";
import { reduceProgress } from "@/core/domain/progress/reduce";
import { getDeviceId } from "@/core/lib/device";
import { readJsonFile, writeJsonAtomic } from "@/core/lib/fs/atomicWrite";
import { fs } from "@/core/lib/fs/fs";
import { readJsonlDir } from "@/core/lib/fs/jsonl";
import { coursePaths } from "@/core/lib/fs/paths";
import { bytesToBase64 } from "@/core/lib/images";
import { nowIso } from "@/core/lib/time";
import { useSettings } from "@/stores/settings";

export const paths = (n: string) => coursePaths(useSettings.getState().settings.dataRoot, n);

/** Everything a grading/hint/generation call needs about the course right now. */
export type Ctx = { course: CourseJson; plan: PlanJson; events: Event[]; progress: ProgressJson };
export async function loadCtx(courseNumber: string): Promise<Ctx> {
  const p = paths(courseNumber);
  const [course, plan] = await Promise.all([readJsonFile(p.courseJson, CourseJsonSchema), readJsonFile(p.planJson, PlanJsonSchema)]);
  if (!course || !plan) throw new Error("course not found");
  const events = await readJsonlDir(p.events, EventSchema);
  return { course, plan, events, progress: reduceProgress(plan, events, nowIso()) };
}

/** What the grading/hint pipeline needs about one exercise, whatever its origin. */
export type Ex = {
  ref: ExerciseRef;
  statementMd: string;
  referenceSolutionMd: string | null;
  gradingNotes: string;
  requiredStageIds: string[];
  stageIds: string[];
  difficulty: number;
  edgeCaseFocus: string[];
  figures: { page?: number; file: string }[];
  /** M59: a test-practice question; exams cover the whole course, so no Shalav-progress boundary */
  open?: boolean;
};

const emptyGen: GeneratedFile = { schema: 1, items: [], solutions: {} };
async function readGenerated(file: string) {
  return (await readJsonFile(file, GeneratedFileSchema)) ?? emptyGen;
}
/** Generated exercises of every device (3.2: reusable on any device). */
export async function listGenerated(courseNumber: string): Promise<GeneratedExercise[]> {
  const dir = paths(courseNumber).generatedFile("x").replace(/\/x\.json$/, "");
  if (!(await fs().exists(dir))) return [];
  const out: GeneratedExercise[] = [];
  for (const e of await fs().readDir(dir)) if (e.isFile && e.name.endsWith(".json")) out.push(...(await readGenerated(`${dir}/${e.name}`)).items);
  return out;
}
export async function addGenerated(courseNumber: string, ex: GeneratedExercise): Promise<void> {
  const f = paths(courseNumber).generatedFile(getDeviceId());
  const cur = await readGenerated(f);
  await writeJsonAtomic(f, { ...cur, items: [...cur.items, ex] });
}
export async function cachedSolution(courseNumber: string, id: string): Promise<string | null> {
  const dir = paths(courseNumber).generatedFile("x").replace(/\/x\.json$/, "");
  if (!(await fs().exists(dir))) return null;
  for (const e of await fs().readDir(dir)) if (e.isFile && e.name.endsWith(".json")) {
    const s = (await readGenerated(`${dir}/${e.name}`)).solutions[id];
    if (s) return s;
  }
  return null;
}
export async function saveSolution(courseNumber: string, id: string, md: string): Promise<void> {
  const f = paths(courseNumber).generatedFile(getDeviceId());
  const cur = await readGenerated(f);
  await writeJsonAtomic(f, { ...cur, solutions: { ...cur.solutions, [id]: md } });
}

/** All exercises Practice may serve (indexed + generated). */
export async function allExercises(courseNumber: string): Promise<(IndexedExercise | GeneratedExercise)[]> {
  const idx = (await listFileIndexes(courseNumber)).filter((f) => f.status === "indexed").flatMap((f) => f.exercises);
  return [...idx, ...(await listGenerated(courseNumber))];
}

export const fromExercise = (e: IndexedExercise | GeneratedExercise): Ex => ({
  ref: { source: "origin" in e ? "generated" : "index", id: e.id },
  statementMd: e.statementMd,
  referenceSolutionMd: e.referenceSolutionMd,
  gradingNotes: "gradingNotes" in e ? e.gradingNotes : "",
  requiredStageIds: e.requiredStageIds,
  stageIds: [...new Set([e.primaryStageId, ...e.requiredStageIds])],
  difficulty: e.difficulty,
  edgeCaseFocus: e.edgeCaseFocus,
  figures: e.figureCrops.map((c) => ({ page: c.page, file: c.file })),
});

export async function resolveExercise(courseNumber: string, ref: ExerciseRef): Promise<Ex | null> {
  const e = (await allExercises(courseNumber)).find((x) => x.id === ref.id);
  return e ? fromExercise(e) : null;
}

/** Figure crops as base64 images (only exercises with figures pay for them, 7.6). */
export async function figureImages(courseNumber: string, ex: Ex): Promise<{ base64: string; mediaType: "image/jpeg" | "image/png" }[]> {
  const out = [];
  for (const f of ex.figures) {
    const p = `${paths(courseNumber).course}/${f.file}`;
    if (await fs().exists(p)) out.push({ base64: bytesToBase64(await fs().readBytes(p)), mediaType: (p.endsWith(".png") ? "image/png" : "image/jpeg") as "image/png" });
  }
  return out;
}
