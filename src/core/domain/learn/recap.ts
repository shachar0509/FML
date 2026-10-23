import type { Event, PlanJson } from "@/core/domain/dataSchemas";
import { mapEvents } from "@/core/domain/progress/reduce";

/** RECAP block for a student who returns to a stage in a new chat (plan v2 §6.3). Null when nothing happened yet. */
export function buildRecap(plan: PlanJson, rawEvents: Event[], stageId: string): string | null {
  const stage = plan.stages.find((s) => s.id === stageId);
  const ev = mapEvents(rawEvents).filter((e) => "stageId" in e && e.stageId === stageId);
  const a = ev.findLast((e) => e.type === "assessment_updated");
  const checks = ev.filter((e) => e.type === "check_answered");
  const graded = ev.filter((e) => e.type === "attempt_graded");
  if (!stage || (!a && !checks.length && !graded.length)) return null;
  const lines = ["RECAP (the student has already worked on this stage; recap in 2-3 sentences, then continue):"];
  if (ev.findLast((e) => e.type === "stage_reopened" || e.type === "stage_completed")?.type === "stage_reopened") lines.push("- The student reopened this stage to relearn it.");
  if (a?.type === "assessment_updated") {
    lines.push(`- Last assessment: mastery ${a.mastery}; covered objectives: ${a.coveredObjectives.map((i) => stage.objectives[i]).filter(Boolean).join("; ") || "none"}`);
    if (a.gaps.length) lines.push(`- Gaps: ${a.gaps.join("; ")}`);
    if (a.reviewTopics.length) lines.push(`- Review topics: ${a.reviewTopics.join("; ")}`);
    if (a.rationale) lines.push(`- Rationale: ${a.rationale}`);
  }
  if (checks.length) lines.push(`- Check questions: ${checks.filter((e) => e.type === "check_answered" && e.correct).length} correct of ${checks.length}`);
  if (graded.length) lines.push(`- Graded exercises: ${graded.map((e) => (e.type === "attempt_graded" ? e.score : 0)).join(", ")} (scores)`);
  return lines.join("\n");
}

/** Event types that studying writes. A file scan's teacher evidence, plan changes and graph edits are not the student's activity. */
const ACTIVITY = new Set<Event["type"]>(["stage_started", "stage_completed", "stage_reopened", "check_answered", "attempt_graded", "hint_requested", "solution_revealed", "assessment_updated"]);

/**
 * A8: [STATUS] "Minutes since last activity". Whole minutes (floored) since the later of the course's newest studying event
 * and `lastAction` (the open lesson's last saved action). 0 when there is none; never negative (a synced device's clock may run ahead).
 * `events` sorted by ts (readJsonlDir does that).
 */
export function idleMinutes(events: Event[], lastAction: string | null | undefined, now: string): number {
  const last = Math.max(...[events.findLast((e) => ACTIVITY.has(e.type))?.ts, lastAction].map((t) => (t ? Date.parse(t) : NaN)).filter(Number.isFinite));
  return Number.isFinite(last) ? Math.max(0, Math.floor((Date.parse(now) - last) / 60_000)) : 0;
}
