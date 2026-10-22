import { CourseJsonSchema, PlanJsonSchema, type PlanJson } from "@/core/domain/dataSchemas";
import { listFileIndexes, readFileIndex, writeFileIndex } from "@/core/domain/ingest/indexStore";
import { appendEvent, recomputeProgress } from "@/core/domain/progress/store";
import { readJsonFile, writeJsonAtomic, writeTextAtomic } from "@/core/lib/fs/atomicWrite";
import { coursePaths } from "@/core/lib/fs/paths";
import { nowIso } from "@/core/lib/time";
import { useSettings } from "@/stores/settings";
import { renderPlanMd } from "./plan";

/**
 * M53: the student deletes stages (or a whole unit) from the plan. Kept stages keep their ids; a unit left empty goes.
 * Events of a removed stage stop counting (plan_replaced maps it to null). File indexes drop it too: a page left with no
 * stage is uncovered for the next Update plan, which may bring the topic back when the course files teach it.
 */
export function withoutStages(plan: PlanJson, ids: Set<string>): PlanJson {
  const pre = new Map(plan.stages.map((s) => [s.id, s.prerequisites]));
  // a deleted prerequisite hands down its own, so the order still holds (delete S002: S003 waits for S001)
  const keep = (id: string): string[] => (ids.has(id) ? (pre.get(id) ?? []).flatMap(keep) : [id]);
  const stages = plan.stages
    .filter((s) => !ids.has(s.id))
    .map((s, i) => ({ ...s, order: i + 1, prerequisites: [...new Set(s.prerequisites.flatMap(keep))] }));
  const units = plan.units.map((u) => ({ ...u, stageIds: u.stageIds.filter((id) => !ids.has(id)) })).filter((u) => u.stageIds.length);
  return { ...plan, version: plan.version + 1, generatedAt: nowIso(), units, stages };
}

/** Returns the new plan, or null when nothing would be removed or nothing would remain. */
export async function removeFromPlan(n: string, stageIds: string[]): Promise<PlanJson | null> {
  const p = coursePaths(useSettings.getState().settings.dataRoot, n);
  const [course, old] = await Promise.all([readJsonFile(p.courseJson, CourseJsonSchema), readJsonFile(p.planJson, PlanJsonSchema)]);
  const ids = new Set(stageIds.filter((id) => old?.stages.some((s) => s.id === id)));
  if (!course || !old || !ids.size || ids.size === old.stages.length) return null;
  const plan = withoutStages(old, ids);
  await writeJsonAtomic(`${p.history}/plan-v${old.version}.json`, old);
  await writeJsonAtomic(p.planJson, plan);
  await writeTextAtomic(p.planMd, renderPlanMd(course, plan));
  await writeJsonAtomic(p.courseJson, { ...course, planVersion: plan.version, updatedAt: nowIso() });
  // re-read each record at write time (the index queue may be writing it); an exercise needing a deleted stage would never be offered
  for (const { sha256 } of await listFileIndexes(n)) {
    const r = await readFileIndex(n, sha256);
    if (!r) continue;
    const left = (xs: string[]) => xs.filter((id) => !ids.has(id));
    await writeFileIndex(n, {
      ...r,
      planVersion: r.planVersion === null ? null : plan.version,
      materialPages: r.materialPages.map((pg) => ({ ...pg, stageIds: left(pg.stageIds) })),
      exercises: r.exercises.map((e) => ({ ...e, requiredStageIds: left(e.requiredStageIds), primaryStageId: ids.has(e.primaryStageId) ? (left(e.requiredStageIds)[0] ?? e.primaryStageId) : e.primaryStageId })),
      ...(r.teacherItems ? { teacherItems: r.teacherItems.map((t) => ({ ...t, stageIds: left(t.stageIds) })) } : {}),
    });
  }
  await appendEvent(n, { type: "plan_replaced", fromVersion: old.version, toVersion: plan.version, idMap: Object.fromEntries(old.stages.map((s) => [s.id, ids.has(s.id) ? null : s.id])) });
  await recomputeProgress(n);
  return plan;
}
