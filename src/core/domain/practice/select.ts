// Practice selection, spec 7.2-7.5. Pure.
import type { CourseJson, Event, GeneratedExercise, IndexedExercise, PlanJson, ProgressJson } from "@/core/domain/dataSchemas";
import { knowledgeOf, meanControl, priorOf, targetDifficulty as aimAt, type Knowledge } from "@/core/domain/knowledge/control";
import { graphOf, nodesOfStages, type Graph } from "@/core/domain/knowledge/graph";
import { mapEvents } from "@/core/domain/progress/reduce";

export type Ex = IndexedExercise | GeneratedExercise;
export type Scope =
  | { kind: "all" }
  | { kind: "unit"; unitId: string }
  | { kind: "weak" }
  | { kind: "stage"; stageId: string }
  /** M59 Test practice: past exam questions only; `stageIds` null = the whole course */
  | { kind: "test"; stageIds: string[] | null };

export const ITEM_CYCLE = ["E", "E", "M", "E", "O", "E", "E", "M", "E", "O"] as const;
/** M56: the more advanced the student (level = skill, 2-5; a new student is 3.5), the more of the items are exercises. */
const CYCLES: Record<number, readonly ("E" | "M" | "O")[]> = {
  2: ["E", "M", "O"],
  3: ITEM_CYCLE,
  4: ["E", "E", "M", "E", "E", "E", "E", "O", "E", "E"],
  5: ["E"],
};
export const itemKind = (i: number, level = 3): "E" | "M" | "O" => {
  const c = CYCLES[Math.min(5, Math.max(2, Math.floor(level)))] ?? ITEM_CYCLE;
  return c[((i % c.length) + c.length) % c.length] ?? "E";
};

const DAY = 86_400_000;
type Attempt = Extract<Event, { type: "attempt_graded" }>;
type Ctx = { plan: PlanJson; progress: ProgressJson; events: Event[]; course?: Pick<CourseJson, "type" | "level"> };
type EligibleIn = Ctx & { exercises: Ex[]; scope: Scope; servedIds: string[]; now: string };

export function completedIds(progress: ProgressJson): Set<string> {
  return new Set(
    Object.entries(progress.stages)
      .filter(([, s]) => s.status === "completed" || s.status === "completed_override")
      .map(([id]) => id),
  );
}

const orderOf = (plan: PlanJson, id: string) => plan.stages.find((s) => s.id === id)?.order ?? 0;
const maxOrder = (plan: PlanJson, ids: Iterable<string>) => Math.max(0, ...[...ids].map((i) => orderOf(plan, i)));
const mastery = (p: ProgressJson, id: string) => p.stages[id]?.mastery ?? 0;
const unresolved = (p: ProgressJson) => p.mistakes.filter((m) => !m.resolved);

const attemptsOf = (events: Event[], id: string): Attempt[] =>
  events.filter((e): e is Attempt => e.type === "attempt_graded" && e.exercise.id === id && e.verdict !== "unreadable");

export function weak(e: Ex, c: Ctx): number {
  const ids = e.requiredStageIds;
  const mean = ids.length
    ? ids.reduce((a, s) => a + (1 - mastery(c.progress, s)) * (c.progress.stages[s]?.status === "completed_override" ? 1.5 : 1), 0) / ids.length
    : 0;
  const hit = unresolved(c.progress).some((m) => m.stageIds.some((s) => ids.includes(s)));
  return Math.min(1, mean + (hit ? 0.25 : 0));
}

export function eligible(o: EligibleIn): Ex[] {
  const done = completedIds(o.progress);
  const now = Date.parse(o.now);
  const served = new Set(o.servedIds);
  const unitStages = o.scope.kind === "unit" ? new Set(o.plan.units.find((u) => u.id === (o.scope as { unitId: string }).unitId)?.stageIds) : null;
  return o.exercises.filter((e) => {
    if (!e.requiredStageIds.every((s) => done.has(s)) || served.has(e.id)) return false;
    if (o.scope.kind === "stage" && e.primaryStageId !== o.scope.stageId) return false;
    if (unitStages && !unitStages.has(e.primaryStageId)) return false;
    if (o.scope.kind === "weak" && weak(e, o) < 0.4) return false;
    return !attemptsOf(o.events, e.id).some((a) => {
      const age = now - Date.parse(a.ts);
      return age < DAY || (a.score >= 90 && age < 21 * DAY);
    });
  });
}

/** M63: the student's knowledge graph (control per node; a custom course starts at its self-rated level). */
type Level = { g: Graph; k: Knowledge; prior: number };
export const levelOf = (c: Ctx): Level => {
  const ev = mapEvents(c.events);
  const g = graphOf(c.plan, ev);
  const prior = c.course ? priorOf(c.course) : 0.1;
  return { g, k: knowledgeOf(g, ev, prior), prior };
};
const controlOf = (lv: Level, stageIds: string[]) => meanControl(lv.k, nodesOfStages(lv.g, stageIds).map((n) => n.id), lv.prior);

/** 2-5: how well the student controls what they completed (the practice scope); 3.5 before anything is completed. */
export function skill(c: Ctx, lv = levelOf(c)): number {
  const done = [...completedIds(c.progress)];
  return done.length ? 2 + 3 * controlOf(lv, done) : 3.5;
}
/** The difficulty (2-5) that makes an exercise on these stages about 3★ for this student; 4★ after 3 good answers in a row there. */
export function targetDifficulty(c: Ctx, stageIds: string[], lv = levelOf(c)): number {
  const want = new Set(stageIds);
  const last = c.events
    .filter((e): e is Attempt => e.type === "attempt_graded" && e.verdict !== "unreadable" && e.stageIds.some((s) => want.has(s)))
    .slice(-3);
  return Math.max(2, aimAt(controlOf(lv, stageIds), last.length === 3 && last.every((a) => a.score >= 85)));
}

export function scoreExercise(e: Ex, c: Ctx & { previous?: Ex | null; target?: number; level?: Level }): number {
  const done = completedIds(c.progress);
  const mo = maxOrder(c.plan, done);
  const depth = mo ? maxOrder(c.plan, e.requiredStageIds) / mo : 0;
  const tries = attemptsOf(c.events, e.id);
  const fresh = tries.length === 0 ? 1 : Math.max(...tries.map((a) => a.score)) < 90 ? 0.5 : 0;
  const diffFit = 1 - Math.abs(e.difficulty - (c.target ?? targetDifficulty(c, e.requiredStageIds, c.level))) / 4;
  const p = c.previous;
  const variety = p ? (p.type === e.type ? -0.3 : 0) + (p.primaryStageId === e.primaryStageId ? -0.2 : 0) : 0;
  return 0.4 * depth + 0.25 * weak(e, c) + 0.15 * fresh + 0.2 * diffFit + variety;
}

export function pick(o: EligibleIn & { previous?: Ex | null; rng?: () => number }) {
  const pool = eligible(o);
  const level = levelOf(o);
  const top = pool
    .map((e) => ({ e, s: scoreExercise(e, { ...o, level }) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 5);
  const first = top[0];
  if (!first) return { exercise: null, bestScore: 0, needsGeneration: true };
  const w = top.map((t) => Math.max(t.s, 0.01) ** 3);
  let r = (o.rng ?? Math.random)() * w.reduce((a, b) => a + b, 0);
  const i = w.findIndex((x) => (r -= x) < 0);
  const bestScore = first.s;
  return { exercise: (top[i] ?? first).e, bestScore, needsGeneration: bestScore < 0.45 };
}

export function focusStage(o: { plan: PlanJson; progress: ProgressJson; scope: Scope }): string | null {
  const done = completedIds(o.progress);
  const bad = unresolved(o.progress);
  const unitStages = o.scope.kind === "unit" ? new Set(o.plan.units.find((u) => u.id === (o.scope as { unitId: string }).unitId)?.stageIds) : null;
  const cands = o.plan.stages.filter((s) => {
    if (!done.has(s.id)) return false;
    if (o.scope.kind === "stage") return s.id === o.scope.stageId;
    if (unitStages) return unitStages.has(s.id);
    if (o.scope.kind === "weak") return mastery(o.progress, s.id) < 0.75 || bad.some((m) => m.stageIds.includes(s.id));
    return true;
  });
  const mo = maxOrder(o.plan, done) || 1;
  let best: string | null = null, bs = -Infinity;
  for (const s of cands) {
    const v = (0.6 * s.order) / mo + 0.4 * (1 - mastery(o.progress, s.id));
    if (v > bs) {
      bs = v;
      best = s.id;
    }
  }
  return best;
}

export function requiredSet(plan: PlanJson, focusId: string, completed: Set<string>): string[] {
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    plan.stages.find((s) => s.id === id)?.prerequisites.forEach(walk);
  };
  walk(focusId);
  return [...seen].filter((s) => completed.has(s));
}
