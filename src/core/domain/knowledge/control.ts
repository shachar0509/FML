import type { CourseJson, Event } from "@/core/domain/dataSchemas";
import { isCustom } from "@/core/universities";
import { type Graph, nodesOfStages } from "./graph";

/**
 * The gentle layer (M61): how much the student *controls* each graph node, from Shalav's own event log.
 * The engine's BKT estimate swings hard after one miss (0.94 → 0.51 → 0.27), so levels and stars use this instead:
 * a decaying average of every answer on the node, where one or two misses move it a little and a run of them moves it a lot.
 * Forgetting comes from the engine (FSRS retention), applied on top.
 */
type Evidence = { s: number; w: number };

/** Half-lives in answers (M75): a long memory, so one or two slips after a good run barely move it (30 good + 2 misses: −0.078);
 * a short one once the node is in a slump (≥5 misses in its last 10 answers), so a real slump shows within those 10 (8 of 10: 0.42). */
const SLOW = 36;
const FAST = 6;
const WINDOW = 10;
const SLUMP = 5;
/** Pseudo-answers at the prior; they fade with a 12-answer half-life (as before M75, whatever the memory), so full control is reachable and a new student rises as fast. */
const K = 3;
const PRIOR_HALF = 12;
/** Self-rated level of a custom course (1-5) → starting control of every node. */
const LEVEL_PRIOR = [0.05, 0.25, 0.45, 0.65, 0.85];
export const priorOf = (c: Pick<CourseJson, "type" | "level">) => (isCustom(c) ? (LEVEL_PRIOR[(c.level ?? 1) - 1] ?? 0.05) : 0.1);

/** Per node, the answers that tested it, oldest first. Answers from before M62 (no `nodes`) count for all their stage's nodes at half weight. */
export function evidenceByNode(g: Graph, events: Event[]): Map<string, Evidence[]> {
  const out = new Map<string, Evidence[]>();
  const ids = new Set(g.nodes.map((n) => n.id));
  const add = (id: string, s: number, w: number) => {
    if (!ids.has(id)) return;
    const l = out.get(id) ?? [];
    l.push({ s: Math.max(0, Math.min(1, s)), w });
    out.set(id, l);
  };
  const spread = (stageIds: string[], s: number, w: number) => nodesOfStages(g, stageIds).forEach((n) => add(n.id, s, w));
  for (const e of events) {
    if (e.type === "check_answered") {
      if (e.nodes?.length) e.nodes.forEach((n) => add(n.id, n.score, 1));
      else spread([e.stageId], e.score / 100, 0.5);
    } else if (e.type === "attempt_graded") {
      if (e.verdict === "unreadable") continue;
      // as before (reduce.ts): each hint costs 0.1, a solution seen first caps the answer at 0.6
      const adj = (s: number) => {
        const v = s - 0.1 * e.hintsUsed;
        return e.solutionRevealedBefore ? Math.min(v, 0.6) : v;
      };
      if (e.nodes?.length) e.nodes.forEach((n) => add(n.id, adj(n.score), 1));
      else spread(e.stageIds, adj(e.score / 100), 0.5);
    } else if (e.type === "node_observed") add(e.nodeId, e.score, e.context === "teacher" ? 2 : 1); // M71: the teacher's own marks weigh twice an AI grade
    else if (e.type === "assessment_updated") spread([e.stageId], e.mastery, 0.2); // the lesson's checks already count; the tutor's guess only nudges
  }
  return out;
}

/** A decaying average of the answers with half-life `half`, starting from the prior. */
function average(evs: Evidence[], prior: number, half: number): number {
  const n = evs.length;
  let num = K * prior * 0.5 ** (n / PRIOR_HALF);
  let den = K * 0.5 ** (n / PRIOR_HALF);
  evs.forEach((e, i) => {
    const w = e.w * 0.5 ** ((n - 1 - i) / half);
    num += w * e.s;
    den += w;
  });
  return den ? num / den : prior;
}

/** Control of one node: the long-memory average; in a slump, the lower of it and the short-memory one. */
export function control(evs: Evidence[], prior: number): number {
  const slow = average(evs, prior, SLOW);
  const slump = evs.slice(-WINDOW).filter((e) => e.s < 0.5).length >= SLUMP;
  return slump ? Math.min(slow, average(evs, prior, FAST)) : slow;
}

export type Knowledge = {
  /** node → control 0..1 (before forgetting) */
  control: Map<string, number>;
  /** node → answers seen */
  seen: Map<string, number>;
};
export function knowledgeOf(g: Graph, events: Event[], prior: number): Knowledge {
  const ev = evidenceByNode(g, events);
  const c = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const n of g.nodes) {
    const l = ev.get(n.id) ?? [];
    c.set(n.id, control(l, prior));
    seen.set(n.id, l.length);
  }
  return { control: c, seen };
}

/** Control after forgetting: the engine's FSRS retention (1 when unknown, e.g. no engine). */
export const effective = (k: Knowledge, id: string, retention?: Map<string, number>) => (k.control.get(id) ?? 0) * (retention?.get(id) ?? 1);

/** 0..5 stars of the whole course: the (relevance-weighted) mean effective control of every node. */
export function rawStars(g: Graph, k: Knowledge, retention?: Map<string, number>, weight: (id: string) => number = () => 1): number {
  let num = 0;
  let den = 0;
  for (const n of g.nodes) {
    const w = weight(n.id);
    num += w * effective(k, n.id, retention);
    den += w;
  }
  return den ? (5 * num) / den : 0;
}

/** Half-star steps with hysteresis: up as soon as the next half star is reached, down only 0.35★ below what is shown, one half star at a time. */
export function shownStars(prev: number | null, raw: number): number {
  const step = Math.floor(raw * 2) / 2;
  if (prev === null) return step;
  if (step > prev) return step;
  if (raw < prev - 0.35) return Math.max(step, prev - 0.5);
  return prev;
}

/** How hard a question is *for this student*: its difficulty (1-5) eased by how well they control what it tests (mean control m). */
export const questionStars = (d: number, m: number) => Math.min(5, Math.max(1, Math.round(d + 2 * (0.5 - m))));
/** The difficulty to ask at so the question is about 3★ for them, or a 4★ stretch after a run of good answers. */
export const targetDifficulty = (m: number, stretch: boolean) => Math.min(5, Math.max(1, Math.round((stretch ? 4 : 3) - 2 * (0.5 - m))));
/** Mean effective control of some nodes (the prior when none are known). */
export const meanControl = (k: Knowledge, ids: string[], prior: number, retention?: Map<string, number>) => {
  const known = ids.filter((id) => k.control.has(id));
  return known.length ? known.reduce((a, id) => a + effective(k, id, retention), 0) / known.length : prior;
};
