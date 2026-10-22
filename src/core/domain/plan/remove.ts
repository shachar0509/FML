import { CourseJsonSchema, PlanJsonSchema, type PlanJson } from "@/core/domain/dataSchemas";
import { appendEvent, recomputeProgress } from "@/core/domain/progress/store";
import { readJsonFile, writeJsonAtomic, writeTextAtomic } from "@/core/lib/fs/atomicWrite";
import { coursePaths } from "@/core/lib/fs/paths";
import { nowIso } from "@/core/lib/time";
import { useSettings } from "@/stores/settings";
import { renderPlanMd } from "./plan";

/**
 * M53: the student deletes stages (or a whole unit) from the plan. Kept stages keep their ids; a unit left empty goes.
 * Events of a removed stage stop counting (plan_replaced maps it to null). File indexes keep pointing at it, so to the next
 * Update plan its pages are uncovered and the topic may come back when the course files teach it.
 */
export function withoutStages(plan: PlanJson, ids: Set<string>): PlanJson {
  const stages = plan.stages
    .filter((s) => !ids.has(s.id))
    .map((s, i) => ({ ...s, order: i + 1, prerequisites: s.prerequisites.filter((p) => !ids.has(p)) }));
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
  await appendEvent(n, { type: "plan_replaced", fromVersion: old.version, toVersion: plan.version, idMap: Object.fromEntries(old.stages.map((s) => [s.id, ids.has(s.id) ? null : s.id])) });
  await recomputeProgress(n);
  return plan;
}
