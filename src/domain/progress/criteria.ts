import type { Event, PlanJson } from "@/domain/dataSchemas";
import type { Settings } from "@/domain/schemas";
import { mapEvents, reduceProgress } from "./reduce";

type Lang = "he" | "en";
export type Learning = Settings["learning"];

const M = {
  he: {
    notReady: "ההערכה של המורה עדיין לא מאשרת מעבר",
    gaps: (g: string) => `לסגור את הפערים: ${g}`,
    objectives: (o: string) => `לכסות את המטרות: ${o}`,
    more: (k: number, min: number) => `לפתור עוד ${k} תרגילים בציון ${min} ומעלה`,
    harder: "אחד התרגילים צריך להיות ברמת קושי 3 ומעלה או להתמקד במקרי קצה",
    checks: "לענות נכון על 3 מתוך 4 שאלות הבדיקה האחרונות",
    mastery: (m: number, t: number) => `השליטה היא ${m}%, נדרש ${t}% לפחות`,
  },
  en: {
    notReady: "The tutor's assessment does not say you are ready to advance",
    gaps: (g: string) => `Close the remaining gaps: ${g}`,
    objectives: (o: string) => `Cover the objectives: ${o}`,
    more: (k: number, min: number) => `Solve ${k} more exercise${k === 1 ? "" : "s"} with score ≥ ${min}`,
    harder: "One of them must have difficulty 3+ or focus on edge cases",
    checks: "Answer 3 of the last 4 check questions correctly",
    mastery: (m: number, t: number) => `Mastery is ${m}%, needs at least ${t}%`,
  },
} as const;

/** Spec 8.3. `missing` sentences are in the teaching language. */
export function checkAdvanceCriteria(args: {
  plan: PlanJson; events: Event[]; stageId: string; cfg: Learning; lang: Lang; now: string;
}): { met: boolean; missing: string[] } {
  const { plan, stageId, cfg, now } = args;
  const m = M[args.lang];
  const stage = plan.stages.find((s) => s.id === stageId);
  if (!stage) return { met: false, missing: ["unknown stage"] };
  const events = mapEvents(args.events);
  const sp = reduceProgress(plan, events, now).stages[stageId];
  const missing: string[] = [];
  const assess = events.findLast((e) => e.type === "assessment_updated" && e.stageId === stageId);
  const a = assess?.type === "assessment_updated" ? assess : null;

  if (!a || !a.readyToAdvance) missing.push(m.notReady);
  if (a && a.gaps.length) missing.push(m.gaps(a.gaps.join(", ")));
  if (cfg.requireAllObjectives) {
    // coveredObjectives holds 0-based indices into stage.objectives.
    const gone = stage.objectives.map((_, i) => i).filter((i) => !a?.coveredObjectives.includes(i));
    if (gone.length) missing.push(m.objectives(gone.map((i) => stage.objectives[i]).join("; ")));
  }
  const late = stage.kind === "integration" || stage.kind === "exam-prep";
  const need = late ? cfg.minExercises + 1 : cfg.minExercises;
  const good = events.filter(
    (e) => e.type === "attempt_graded" && e.context === "learn" && e.verdict !== "unreadable" && e.stageIds.includes(stageId) && e.score >= cfg.minExerciseScore,
  );
  if (good.length < need) missing.push(m.more(need - good.length, cfg.minExerciseScore));
  else if (!good.some((e) => e.type === "attempt_graded" && (e.difficulty >= 3 || e.hasEdgeCaseFocus))) missing.push(m.harder);
  if (!late) {
    const last4 = events.filter((e) => e.type === "check_answered" && e.stageId === stageId).slice(-4);
    if (last4.filter((e) => e.type === "check_answered" && e.correct).length < 3) missing.push(m.checks);
  }
  if ((sp?.mastery ?? 0) < cfg.masteryThreshold) missing.push(m.mastery(Math.round((sp?.mastery ?? 0) * 100), Math.round(cfg.masteryThreshold * 100)));
  return { met: missing.length === 0, missing };
}
