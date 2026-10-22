import { isCustom } from "@/core/universities";
import type { CourseJson, PlanJson, Stage, Unit } from "@/core/domain/dataSchemas";

/** Spec 4.4: stage count target range. */
export function stageRange(credits: number) {
  const min = Math.max(30, Math.round(credits * 12));
  const max = Math.round(credits * 22);
  return { min, max, target: Math.round((min + max) / 2) };
}
/** A custom course has no credits: its size comes from the subject (M52). */
export const planRange = (c: Pick<CourseJson, "credits" | "type">) => (isCustom(c) ? { min: 12, max: 60, target: 30 } : stageRange(c.credits));
/** Pass A accepts a result within ±15 % of the range after two failed corrections (4.5); validatePlan uses the same slack. */
export const SLACK = 0.15;

/** Spec 3.5 validatePlan. Returns human-readable errors (empty = valid). */
export function validatePlan(plan: PlanJson, range: number | { min: number; max: number }): string[] {
  const errs: string[] = [];
  const { min, max } = typeof range === "number" ? stageRange(range) : range;
  const ids = new Set<string>();
  const order = new Map<string, number>();
  plan.stages.forEach((s, i) => {
    if (ids.has(s.id)) errs.push(`duplicate stage id ${s.id}`);
    ids.add(s.id);
    order.set(s.id, s.order);
    if (s.order !== i + 1) errs.push(`${s.id}: order ${s.order} is not ${i + 1}`);
    if (s.objectives.length < 2 || s.objectives.length > 6) errs.push(`${s.id}: needs 2-6 objectives`);
    if (s.estimatedMinutes < 20 || s.estimatedMinutes > 45) errs.push(`${s.id}: estimatedMinutes out of 20-45`);
  });
  for (const s of plan.stages)
    for (const p of s.prerequisites) {
      const po = order.get(p);
      if (po === undefined) errs.push(`${s.id}: unknown prerequisite ${p}`);
      else if (po >= s.order) errs.push(`${s.id}: prerequisite ${p} is not earlier`);
    }
  const unitIds = new Set<string>();
  const owned = new Map<string, string>();
  for (const u of plan.units) {
    if (unitIds.has(u.id)) errs.push(`duplicate unit id ${u.id}`);
    unitIds.add(u.id);
    let last = 0;
    for (const sid of u.stageIds) {
      if (owned.has(sid)) errs.push(`${sid} listed in two units`);
      owned.set(sid, u.id);
      const o = order.get(sid);
      if (o === undefined) errs.push(`${u.id}: unknown stage ${sid}`);
      else if (o <= last) errs.push(`${u.id}: stages not in order`);
      else last = o;
    }
  }
  for (const s of plan.stages) if (owned.get(s.id) !== s.unitId) errs.push(`${s.id}: unit mismatch`);
  const n = plan.stages.length;
  if (n < min * (1 - SLACK) || n > max * (1 + SLACK)) errs.push(`stage count ${n} outside ${min}-${max}`);
  return errs;
}

/** Spec 4.5 plan.md. */
export function renderPlanMd(course: Pick<CourseJson, "courseNumber" | "nameHe" | "credits">, plan: PlanJson): string {
  const byId = new Map(plan.stages.map((s) => [s.id, s]));
  const out = [`# ${course.nameHe}`, "", `${course.courseNumber} · ${course.credits}`, ""];
  for (const u of plan.units) {
    out.push(`## ${u.title}`, "");
    u.stageIds.forEach((sid, i) => {
      const s = byId.get(sid);
      if (!s) return;
      out.push(`${i + 1}. **${s.id} — ${s.title}**`, `   ${s.summary}`, "   Objectives:");
      s.objectives.forEach((o) => out.push(`   - ${o}`));
      if (s.prerequisites.length) out.push(`   Requires: ${s.prerequisites.join(", ")}`);
    });
    out.push("");
  }
  return out.join("\n");
}

export const outlineText = (units: Unit[], stages: Stage[] | { id: string; title: string; kind: string }[]) => {
  const byId = new Map(stages.map((s) => [s.id, s]));
  return units
    .map((u) => `${u.id} ${u.title}\n` + u.stageIds.map((id) => `  ${id} [${byId.get(id)?.kind}] ${byId.get(id)?.title}`).join("\n"))
    .join("\n");
};
