import { callStructured } from "@/core/claude/structured";
import { refinePrompt, revisionFixMsg } from "@/core/claude/prompts/refine";
import { ClaudeError } from "@/core/claude/errors";
import type { ClaudeGateway, Message } from "@/core/claude/types";
import { PlanJsonSchema, type CourseJson, type FileIndex, type PlanJson, type Stage, type Unit } from "@/core/domain/dataSchemas";
import { listFileIndexes, writeFileIndex } from "@/core/domain/ingest/indexStore";
import { appendEvent, recomputeProgress } from "@/core/domain/progress/store";
import { readJsonFile, writeJsonAtomic, writeTextAtomic } from "@/core/lib/fs/atomicWrite";
import { coursePaths } from "@/core/lib/fs/paths";
import { stageId, unitId } from "@/core/lib/ids";
import { nowIso } from "@/core/lib/time";
import { useSettings } from "@/stores/settings";
import { detailUnit, type PlanProgress, type UnitDetails } from "./generate";
import { outlineText, renderPlanMd, validatePlan } from "./plan";
import { submitPlanRevision, type PlanRevision } from "./refineTool";

const SYSTEM = "You are an expert university curriculum designer.";

/** Rule check on the model's revision (4.6); returns correction lines. */
export function revisionErrors(old: PlanJson, rev: PlanRevision): string[] {
  const known = new Set(old.stages.map((s) => s.id));
  const parts = new Map<string, number>();
  for (const s of rev.units.flatMap((u) => u.stages)) if (s.sourceId) parts.set(s.sourceId, (parts.get(s.sourceId) ?? 0) + 1);
  const errs: string[] = [];
  for (const id of parts.keys()) if (!known.has(id)) errs.push(`Unknown sourceId ${id}.`);
  for (const [id, n] of parts) if (n > 3) errs.push(`Stage ${id} is split into ${n} parts; at most 3.`);
  const missing = [...known].filter((id) => !parts.has(id));
  if (missing.length) errs.push(`Stages must never be deleted or merged; missing sourceIds: ${missing.join(", ")}.`);
  return errs;
}

/**
 * Pure: assign ids (first part keeps the original, the rest get next unused numbers), orders and units.
 * `fresh` = new or split stages (need Pass B; their detail fields are placeholders). idMap: original -> LAST part.
 */
export function applyRevision(old: PlanJson, rev: PlanRevision) {
  const byId = new Map(old.stages.map((s) => [s.id, s]));
  let nextNo = Math.max(0, ...old.stages.map((s) => Number(s.id.slice(1)))) + 1;
  const seen = new Set<string>();
  const total = new Map<string, number>();
  const flat = rev.units.flatMap((u, ui) => u.stages.map((s) => ({ s, ui })));
  for (const { s } of flat) if (s.sourceId) total.set(s.sourceId, (total.get(s.sourceId) ?? 0) + 1);
  const ids = flat.map(({ s }) => {
    if (s.sourceId && !seen.has(s.sourceId)) return seen.add(s.sourceId), s.sourceId;
    return stageId(nextNo++);
  });
  const idMap: Record<string, string | null> = {};
  flat.forEach(({ s }, i) => {
    if (s.sourceId) idMap[s.sourceId] = ids[i] as string;
  });
  const fresh = new Set<string>();
  const units: Unit[] = rev.units.map((u, ui) => ({ id: unitId(ui + 1), title: u.title, summary: u.summary, stageIds: [] }));
  const stages: Stage[] = flat.map(({ s, ui }, i) => {
    const id = ids[i] as string;
    const unit = units[ui] as Unit;
    unit.stageIds.push(id);
    const prerequisites = [...new Set(s.prerequisites)].filter((p) => p >= 1 && p < i + 1).map((p) => ids[p - 1] as string);
    const o = s.sourceId && total.get(s.sourceId) === 1 ? byId.get(s.sourceId) : undefined;
    if (!o) fresh.add(id);
    return {
      objectives: [], newConcepts: [], theorems: [], techniques: [], edgeCases: [], examRelevance: "core", estimatedMinutes: 20,
      ...o, id, unitId: unit.id, order: i + 1, title: s.title, summary: s.summary, kind: s.kind, prerequisites,
    };
  });
  return { units, stages, fresh, idMap };
}

/** Pure: ids present in `next` but not in `prev` (UI "New" badge). */
export const newStageIds = (prev: PlanJson, next: PlanJson): Set<string> => {
  const had = new Set(prev.stages.map((s) => s.id));
  return new Set(next.stages.map((s) => s.id).filter((id) => !had.has(id)));
};

/** Pure: remap an index record made under an older plan version through idMap (4.6). */
export function remapIndex(rec: FileIndex, idMap: Record<string, string | null>, version: number): FileIndex {
  if (rec.planVersion === null || rec.planVersion >= version) return rec;
  const m = (id: string) => idMap[id] ?? id;
  const list = (ids: string[]) => [...new Set(ids.map(m))];
  return {
    ...rec,
    planVersion: version,
    materialPages: rec.materialPages.map((p) => ({ ...p, stageIds: list(p.stageIds) })),
    exercises: rec.exercises.map((e) => ({ ...e, requiredStageIds: list(e.requiredStageIds), primaryStageId: m(e.primaryStageId) })),
  };
}

type Opts = { gw: ClaudeGateway; course: CourseJson; lang: "he" | "en"; onProgress?: (p: PlanProgress) => void; signal?: AbortSignal };

/** Spec 4.6. Throws on failure; the old plan stays untouched until everything is validated. */
export async function refinePlan(opts: Opts): Promise<PlanJson> {
  const { gw, course, lang, onProgress, signal } = opts;
  const p = coursePaths(useSettings.getState().settings.dataRoot, course.courseNumber);
  const old = await readJsonFile(p.planJson, PlanJsonSchema);
  if (!old) throw new ClaudeError("invalid_output", "plan.json missing");
  const indexes = await listFileIndexes(course.courseNumber);
  const materials = indexes
    .filter((r) => r.role === "material" && r.status === "indexed")
    .map((r) => `## ${r.fileName}\n` + r.materialPages.map((m) => `p${m.page}: ${m.summary}`).join("\n"))
    .join("\n\n");
  const byId = new Map(old.stages.map((s) => [s.id, s]));
  const planText = old.units
    .map((u) => `${u.id} ${u.title}\n` + u.stageIds.map((id) => `  ${id} [${byId.get(id)?.kind}] ${byId.get(id)?.title} — ${byId.get(id)?.summary}`).join("\n"))
    .join("\n");

  onProgress?.({ step: "plan" });
  let messages: Message[] = [{ role: "user", content: refinePrompt(course, planText, materials, lang === "he" ? "Hebrew" : "English") }];
  let rev: PlanRevision;
  let model: string;
  for (let fix = 0; ; fix++) {
    const { value, response } = await callStructured(gw, submitPlanRevision, {
      task: "plan", courseNumber: course.courseNumber, system: SYSTEM, messages, signal,
    });
    const errs = revisionErrors(old, value);
    if (!errs.length) {
      rev = value;
      model = response.model;
      break;
    }
    if (fix >= 2) throw new ClaudeError("invalid_output", `plan revision invalid: ${errs.join(" ")}`);
    const use = response.content.find((b) => b.type === "tool_use") as { id: string } | undefined;
    const msg = revisionFixMsg(errs);
    messages = [
      ...messages,
      { role: "assistant", content: response.content },
      { role: "user", content: use ? [{ type: "tool_result", tool_use_id: use.id, content: msg, is_error: true }] : msg },
    ];
  }

  const { units, stages, fresh, idMap } = applyRevision(old, rev);
  // Pass B only for new/split stages, grouped by unit, max 3 in parallel.
  const text = outlineText(units, stages);
  const jobs = units.map((u) => ({ ...u, stageIds: u.stageIds.filter((id) => fresh.has(id)) })).filter((u) => u.stageIds.length);
  const details = new Map<string, UnitDetails>();
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < jobs.length) {
      for (const [id, d] of await detailUnit(opts, text, jobs[next++] as Unit)) details.set(id, d);
      onProgress?.({ step: "plan", unit: { k: ++done, n: jobs.length } });
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker));

  onProgress?.({ step: "validate" });
  const plan: PlanJson = {
    ...old,
    version: old.version + 1,
    generatedAt: nowIso(),
    model,
    courseKind: rev.courseKind,
    units,
    stages: stages.map((s) => {
      const d = details.get(s.id);
      return d ? { ...s, ...d, estimatedMinutes: Math.min(45, Math.max(20, Math.round(d.estimatedMinutes))) } : s;
    }),
  };
  const errs = validatePlan(plan, course.credits);
  if (errs.length) throw new ClaudeError("invalid_output", `plan invalid: ${errs.slice(0, 5).join("; ")}`);

  await writeJsonAtomic(`${p.history}/plan-v${old.version}.json`, old);
  await writeJsonAtomic(p.planJson, plan);
  await writeTextAtomic(p.planMd, renderPlanMd(course, plan));
  await writeJsonAtomic(p.courseJson, { ...course, courseKind: plan.courseKind, planVersion: plan.version, updatedAt: nowIso() });
  await appendEvent(course.courseNumber, { type: "plan_replaced", fromVersion: old.version, toVersion: plan.version, idMap });
  for (const r of indexes) {
    const m = remapIndex(r, idMap, plan.version);
    if (m !== r) await writeFileIndex(course.courseNumber, m);
  }
  await recomputeProgress(course.courseNumber);
  return plan;
}
