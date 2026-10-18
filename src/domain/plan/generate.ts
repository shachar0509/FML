import { z } from "zod";
import { callStructured } from "@/claude/structured";
import { detailsPrompt, outlinePrompt, tooFewMsg, tooManyMsg } from "@/claude/prompts/plan";
import { submitPlanOutline, submitUnitDetails, type PlanOutline } from "@/claude/tools";
import { ClaudeError } from "@/claude/errors";
import type { ClaudeGateway, Message } from "@/claude/types";
import type { CourseJson, PlanJson, Stage, Unit } from "@/domain/dataSchemas";
import { stageId, unitId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { outlineText, SLACK, stageRange, validatePlan } from "./plan";

type Head = Pick<CourseJson, "courseNumber" | "nameHe" | "credits" | "faculty" | "syllabusHe" | "prerequisitesRaw">;
export type PlanProgress = { step: "plan" | "validate"; unit?: { k: number; n: number } };
type Opts = { gw: ClaudeGateway; course: Head; lang: "he" | "en"; onProgress?: (p: PlanProgress) => void; signal?: AbortSignal };

const langName = (l: "he" | "en") => (l === "he" ? "Hebrew" : "English");
const count = (o: PlanOutline) => o.units.reduce((n, u) => n + u.stages.length, 0);

/** Pass A (4.5): outline, up to 2 same-conversation corrections on stage count, then accept within ±15 %. */
async function passA({ gw, course, lang, signal }: Opts) {
  const r = stageRange(course.credits);
  let messages: Message[] = [{ role: "user", content: outlinePrompt(course, r, langName(lang)) }];
  for (let fix = 0; ; fix++) {
    const { value, response } = await callStructured(gw, submitPlanOutline, {
      task: "plan", courseNumber: course.courseNumber, system: "You are an expert Technion curriculum designer.", messages, signal,
    });
    const n = count(value);
    const msg = n < r.min ? tooFewMsg(n, r.min) : n > r.max ? tooManyMsg(n, r.max) : null;
    if (!msg) return { outline: value, model: response.model };
    if (fix >= 2) {
      if (n >= r.min * (1 - SLACK) && n <= r.max * (1 + SLACK)) return { outline: value, model: response.model };
      throw new ClaudeError("invalid_output", `outline has ${n} stages, range ${r.min}-${r.max}`);
    }
    const use = response.content.find((b) => b.type === "tool_use") as { id: string } | undefined;
    messages = [
      ...messages,
      { role: "assistant", content: response.content },
      { role: "user", content: use ? [{ type: "tool_result", tool_use_id: use.id, content: msg }] : msg },
    ];
  }
}

/** Assign S###/U## ids in order and convert 1-based prerequisite positions to ids (invalid/forward ones dropped). */
export function outlineToSkeleton(o: PlanOutline) {
  const units: Unit[] = [];
  const stages: Omit<Stage, "objectives" | "newConcepts" | "theorems" | "techniques" | "edgeCases" | "examRelevance" | "estimatedMinutes">[] = [];
  o.units.forEach((u, ui) => {
    const unit: Unit = { id: unitId(ui + 1), title: u.title, summary: u.summary, stageIds: [] };
    for (const s of u.stages) {
      const order = stages.length + 1;
      const prerequisites = [...new Set(s.prerequisites)].filter((p) => p >= 1 && p < order).map(stageId);
      stages.push({ id: stageId(order), unitId: unit.id, order, title: s.title, summary: s.summary, kind: s.kind, prerequisites });
      unit.stageIds.push(stageId(order));
    }
    units.push(unit);
  });
  return { units, stages };
}

/** Pass B for one unit: exactly the unit's ids, one retry with the errors. */
async function detailUnit(opts: Opts, outline: string, unit: Unit): Promise<Map<string, UnitDetails>> {
  const { gw, course, lang, signal } = opts;
  let messages: Message[] = [{ role: "user", content: detailsPrompt(course, outline, unit, langName(lang)) }];
  for (let attempt = 0; ; attempt++) {
    const { value, response } = await callStructured(gw, submitUnitDetails, {
      task: "plan", courseNumber: course.courseNumber, system: "You are an expert Technion curriculum designer.", messages, signal,
    });
    const got = value.stages.map((s) => s.id);
    const ok = got.length === unit.stageIds.length && unit.stageIds.every((id) => got.includes(id));
    if (ok) return new Map(value.stages.map((s) => [s.id, s]));
    if (attempt >= 1) throw new ClaudeError("invalid_output", `unit ${unit.id}: stage ids ${got.join(",")} != ${unit.stageIds.join(",")}`);
    const use = response.content.find((b) => b.type === "tool_use") as { id: string } | undefined;
    const msg = `The response must contain exactly these stage ids: ${unit.stageIds.join(", ")}. You returned: ${got.join(", ")}.`;
    messages = [
      ...messages,
      { role: "assistant", content: response.content },
      { role: "user", content: use ? [{ type: "tool_result", tool_use_id: use.id, content: msg, is_error: true }] : msg },
    ];
  }
}
type UnitDetails = z.infer<typeof submitUnitDetails.schema>["stages"][number];

/** Two-pass plan generation (4.5). Throws on failure; callers keep the course and offer "Try again". */
export async function generatePlan(opts: Opts): Promise<PlanJson> {
  const { course, onProgress } = opts;
  onProgress?.({ step: "plan" });
  const { outline, model } = await passA(opts);
  const { units, stages } = outlineToSkeleton(outline);
  const text = outlineText(units, stages);

  // Max 3 units in parallel.
  const details = new Map<string, UnitDetails>();
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < units.length) {
      const u = units[next++] as Unit;
      for (const [id, d] of await detailUnit(opts, text, u)) details.set(id, d);
      onProgress?.({ step: "plan", unit: { k: ++done, n: units.length } });
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, units.length) }, worker));

  onProgress?.({ step: "validate" });
  const plan: PlanJson = {
    schema: 1,
    courseNumber: course.courseNumber,
    version: 1,
    generatedAt: nowIso(),
    model,
    courseKind: outline.courseKind,
    units,
    stages: stages.map((s) => {
      const d = details.get(s.id) as UnitDetails;
      return {
        ...s,
        objectives: d.objectives,
        newConcepts: d.newConcepts,
        theorems: d.theorems,
        techniques: d.techniques,
        edgeCases: d.edgeCases,
        examRelevance: d.examRelevance,
        estimatedMinutes: Math.min(45, Math.max(20, Math.round(d.estimatedMinutes))),
      };
    }),
  };
  const errs = validatePlan(plan, course.credits);
  if (errs.length) throw new ClaudeError("invalid_output", `plan invalid: ${errs.slice(0, 5).join("; ")}`);
  return plan;
}
