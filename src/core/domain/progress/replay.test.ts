// @vitest-environment node
import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { Event, PlanJson } from "@/core/domain/dataSchemas";
import { nodeId } from "@/core/domain/knowledge/graph";
import { reduceProgress } from "./reduce";

/**
 * M66 replay check: a long, realistic history (a 36-stage plan, ~5000 events: lessons, checks, graded exercises with hints and
 * reveals, assessments, completions, reopenings, tutor nodes) through reduceProgress. REPLAY_OUT=<file> also writes every
 * stage's status and mastery, to diff against an older commit's reduce (see DECISIONS.md, M66).
 */
const N = "01040195";
const stage = (i: number): PlanJson["stages"][number] => ({
  id: `S${String(i).padStart(3, "0")}`, unitId: `U0${1 + Math.floor((i - 1) / 9)}`, order: i, title: `t${i}`, summary: "s", kind: "concept",
  objectives: ["a", "b", "c"], newConcepts: [`c${i}a`, `c${i}b`], theorems: i % 3 ? [] : [{ name: `th${i}`, statement: "s", proofRequired: false }], techniques: i % 4 ? [] : [`te${i}`],
  prerequisites: i > 1 ? [`S${String(i - 1).padStart(3, "0")}`] : [], edgeCases: i % 2 ? [`e${i}`] : [], examRelevance: i % 5 ? "core" : "occasional", estimatedMinutes: 30,
});
const stages = Array.from({ length: 36 }, (_, i) => stage(i + 1));
const plan: PlanJson = {
  schema: 1, courseNumber: N, version: 1, generatedAt: "t", model: "m", courseKind: "mixed",
  units: [1, 2, 3, 4].map((u) => ({ id: `U0${u}`, title: `u${u}`, summary: "s", stageIds: stages.filter((s) => s.unitId === `U0${u}`).map((s) => s.id) })),
  stages,
};

export function history(seed = 7): Event[] {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const out: Event[] = [];
  let t = Date.parse("2026-03-01T08:00:00Z");
  const push = (e: Record<string, unknown>) => out.push({ id: `e${out.length}`, ts: new Date((t += 60_000 + rnd() * 600_000)).toISOString(), deviceId: "d", courseNumber: N, ...e } as Event);
  const ctx = () => (rnd() < 0.6 ? "learn" : "practice");
  for (const s of stages.slice(0, 30)) {
    const skill = 0.4 + rnd() * 0.6; // how well this student does on this stage
    push({ type: "stage_started", stageId: s.id });
    for (let k = 0; k < 120; k++) {
      const ok = rnd() < skill;
      const r = rnd();
      if (r < 0.45) {
        const tagged = rnd() < 0.5 ? { nodes: [{ id: nodeId(s.id, "concept", s.newConcepts[0] as string), score: ok ? 1 : 0 }] } : {};
        push({ type: "check_answered", stageId: s.id, checkId: `k${out.length}`, kind: rnd() < 0.6 ? "mcq" : "open", context: ctx(), correct: ok, score: ok ? 100 : Math.round(rnd() * 50), mistakeTags: ok ? [] : ["sign-slip"], ...tagged });
      } else if (r < 0.75) {
        const hints = Math.floor(rnd() * 3);
        const score = Math.round(Math.min(100, skill * 100 + (rnd() - 0.5) * 40));
        push({
          type: "attempt_graded", attemptId: `a${out.length}`, exercise: { source: "generated", id: `x${out.length}` }, stageIds: [s.id], context: ctx(),
          verdict: score >= 85 ? "correct" : score >= 40 ? "partially_correct" : "incorrect", score, mistakes: score < 85 ? [{ tag: "sign-slip", severity: "minor", note: "n" }] : [],
          missingForFullCredit: score < 85 ? 1 : 0, edgeCasesMissed: [], attachmentHashes: [], difficulty: 1 + Math.floor(rnd() * 5), hasEdgeCaseFocus: rnd() < 0.2,
          hintsUsed: hints, solutionRevealedBefore: rnd() < 0.1, ...(rnd() < 0.5 ? { nodes: [{ id: nodeId(s.id, "concept", s.newConcepts[1] as string), score: score / 100 }] } : {}),
        });
      } else if (r < 0.85) push({ type: "assessment_updated", stageId: s.id, mastery: Math.round(skill * 100) / 100, coveredObjectives: [0, 1], gaps: [], reviewTopics: [], readyToAdvance: skill > 0.8, rationale: "r" });
      else if (r < 0.95) push({ type: "hint_requested", exercise: { source: "generated", id: "x" }, level: 1, context: ctx() });
      else push({ type: "node_observed", nodeId: nodeId(s.id, "concept", s.newConcepts[0] as string), score: ok ? 0.9 : 0.2, why: "w", context: ctx() });
    }
    if (rnd() < 0.15) push({ type: "node_added", nodeId: nodeId(null, "skill", `skill ${s.id}`), kind: "skill", label: `skill ${s.id}`, why: "w", stageIds: [], requires: [], origin: "grader", refId: "a" });
    push({ type: "stage_completed", stageId: s.id, by: skill > 0.7 ? "mastery" : "user_override", masteryAtCompletion: skill });
    if (rnd() < 0.1) push({ type: "stage_reopened", stageId: s.id });
  }
  return out;
}

it("M66 replay: a long history reduces fast; every stage keeps its status and mastery stays in 0..1", () => {
  const ev = history();
  expect(ev.length).toBeGreaterThan(3500);
  const t0 = performance.now();
  const p = reduceProgress(plan, ev, "2026-10-22T00:00:00Z");
  const ms = performance.now() - t0;
  expect(ms).toBeLessThan(2000); // ponytail: a loose bound for slow CI machines; measured ~11 ms locally (7 ms before M63)
  for (const [id, s] of Object.entries(p.stages)) {
    expect(s.mastery, id).toBeGreaterThanOrEqual(0);
    expect(s.mastery, id).toBeLessThanOrEqual(1);
  }
  expect(p.totals.stagesCompleted).toBeGreaterThan(20);
  if (process.env.REPLAY_OUT) writeFileSync(process.env.REPLAY_OUT, JSON.stringify({ ms, stages: Object.fromEntries(Object.entries(p.stages).map(([id, s]) => [id, [s.status, s.mastery]])) }));
});
