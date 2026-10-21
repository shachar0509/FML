import { COURSE_ID_RE } from "@/core/universities";
import { claude } from "@/core/claude/runtime";
import type { CatalogEntry } from "@/core/domain/catalog/catalog";
import { CourseJsonSchema, PlanJsonSchema, ProgressJsonSchema, type CourseJson, type PlanJson, type ProgressJson } from "@/core/domain/dataSchemas";
import { generatePlan, type PlanProgress } from "@/core/domain/plan/generate";
import { renderPlanMd } from "@/core/domain/plan/plan";
import { reduceProgress } from "@/core/domain/progress/reduce";
import { renderProgressMd } from "@/core/domain/progress/render";
import { readJsonFile, writeJsonAtomic, writeTextAtomic } from "@/core/lib/fs/atomicWrite";
import { fs } from "@/core/lib/fs/fs";
import { coursePaths, coursesDir } from "@/core/lib/fs/paths";
import { nowIso } from "@/core/lib/time";
import { useSettings } from "@/stores/settings";

export type CourseSummary = { course: CourseJson; plan: PlanJson | null; progress: ProgressJson | null };
export type ManualEntry = Omit<CatalogEntry, "semester">;
export type CreateProgress = { step: "folders" | "plan" | "validate" | "progress"; unit?: { k: number; n: number } };

const root = () => useSettings.getState().settings.dataRoot;
const paths = (n: string) => coursePaths(root(), n);

export async function loadCourse(n: string): Promise<CourseSummary | null> {
  const p = paths(n);
  const course = await readJsonFile(p.courseJson, CourseJsonSchema);
  if (!course) return null;
  return {
    course,
    plan: await readJsonFile(p.planJson, PlanJsonSchema),
    progress: await readJsonFile(p.progressJson, ProgressJsonSchema),
  };
}

export async function courseExists(n: string): Promise<boolean> {
  return fs().exists(paths(n).courseJson);
}

export async function listCourses(): Promise<CourseSummary[]> {
  const dir = coursesDir(root());
  if (!(await fs().exists(dir))) return [];
  const all = await Promise.all((await fs().readDir(dir)).filter((e) => e.isDirectory && COURSE_ID_RE.test(e.name)).map((e) => loadCourse(e.name)));
  return all.filter((c): c is CourseSummary => !!c).sort((a, b) => a.course.createdAt.localeCompare(b.course.createdAt));
}

/** Spec 4.3 steps 1 and 2-4. A plan failure keeps the course (planError set); the UI offers "Try again". */
export async function createCourse(
  entry: CatalogEntry | ManualEntry,
  onProgress: (p: CreateProgress) => void,
): Promise<{ course: CourseJson; planError: string | null }> {
  const p = paths(entry.courseNumber);
  onProgress({ step: "folders" });
  for (const d of [p.materials, p.exercises, p.events, p.history, p.indexFiles, p.attachments]) await fs().mkdir(d);
  const now = nowIso();
  const course: CourseJson = {
    schema: 1,
    courseNumber: entry.courseNumber,
    nameHe: entry.nameHe,
    credits: entry.credits,
    faculty: entry.faculty,
    syllabusHe: entry.syllabusHe,
    prerequisitesRaw: entry.prerequisitesRaw,
    catalogSemester: "semester" in entry ? entry.semester : null,
    courseKind: "mixed",
    planVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
  await writeJsonAtomic(p.courseJson, course);
  const { planError } = await buildPlan(course.courseNumber, onProgress);
  return { course: (await loadCourse(course.courseNumber))?.course ?? course, planError };
}

/** Steps 2-4: generate, validate, write plan.json/plan.md, update course.json, write progress. Also the "Try again" action. */
export async function buildPlan(n: string, onProgress: (p: CreateProgress) => void): Promise<{ planError: string | null }> {
  const p = paths(n);
  const course = await readJsonFile(p.courseJson, CourseJsonSchema);
  if (!course) return { planError: "course.json missing" };
  try {
    const plan = await generatePlan({
      gw: claude(),
      course,
      lang: useSettings.getState().settings.language,
      onProgress: (x: PlanProgress) => onProgress(x),
    });
    await writeJsonAtomic(p.planJson, plan);
    await writeTextAtomic(p.planMd, renderPlanMd(course, plan));
    await writeJsonAtomic(p.courseJson, { ...course, courseKind: plan.courseKind, planVersion: 1, updatedAt: nowIso() });
    onProgress({ step: "progress" });
    const progress = reduceProgress(plan, [], nowIso());
    await writeJsonAtomic(p.progressJson, progress);
    await writeTextAtomic(p.progressMd, renderProgressMd(course, plan, progress, useSettings.getState().settings.language));
    return { planError: null };
  } catch (e) {
    return { planError: e instanceof Error ? e.message : String(e) };
  }
}
