import type { Event, MistakeSummary, PlanJson, ProgressJson, StageProgress } from "@/core/domain/dataSchemas";
import { knowledgeOf } from "@/core/domain/knowledge/control";
import { graphOf, nodesOfStages } from "@/core/domain/knowledge/graph";

const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const SEV = { minor: 1, major: 2, critical: 3 } as const;

/** 8.4: lowercase kebab-case [a-z0-9-], max 40 chars. */
export const normalizeTag = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");

/** 8.1: map stage ids in older events through every later plan_replaced.idMap; null = stage removed. */
export function mapEvents(events: Event[]): Event[] {
  const later: Record<string, string | null>[] = [];
  const out: Event[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i] as Event;
    if (e.type === "plan_replaced") {
      later.unshift(e.idMap);
      out.push(e);
      continue;
    }
    const map = (id: string): string | null => {
      let cur: string | null = id;
      for (const m of later) if (cur !== null && cur in m) cur = m[cur] ?? null;
      return cur;
    };
    const many = (ids: string[]) => ids.map(map).filter((x): x is string => x !== null);
    // knowledge-graph node ids start with their stage (`S003/concept/…`); course-wide nodes (`G/…`) never move
    const node = (id: string): string | null => {
      if (!/^S\d{3}\//.test(id)) return id;
      const s = map(id.slice(0, 4));
      return s === null ? null : s + id.slice(4);
    };
    const nodes = <T extends { id: string }>(l: T[] | undefined) => l?.flatMap((n) => { const id = node(n.id); return id === null ? [] : [{ ...n, id }]; });
    if (e.type === "node_added") {
      const id = node(e.nodeId);
      if (id !== null) out.push({ ...e, nodeId: id, stageIds: many(e.stageIds), requires: e.requires.map(node).filter((x): x is string => x !== null) });
    } else if (e.type === "node_linked") {
      const from = node(e.from);
      const to = node(e.to);
      if (from !== null && to !== null) out.push({ ...e, from, to });
    } else if (e.type === "node_observed") {
      const id = node(e.nodeId);
      if (id !== null) out.push({ ...e, nodeId: id });
    } else if ("stageId" in e) {
      const s = map(e.stageId);
      if (s !== null) out.push(e.type === "check_answered" ? { ...e, stageId: s, nodes: nodes(e.nodes) } : { ...e, stageId: s });
    } else if (e.type === "attempt_graded") out.push({ ...e, stageIds: many(e.stageIds), nodes: nodes(e.nodes) });
    else if (e.type === "mistake_observed") out.push({ ...e, stageIds: many(e.stageIds) });
    else out.push(e);
  }
  return out.reverse();
}

type Item = { v: number; a: number; ctx: "learn" | "practice" };
const ema = (items: Item[]): number | null => {
  let m: number | null = null;
  for (const it of items) m = m === null ? it.v : (1 - it.a) * m + it.a * it.v;
  return m;
};

/** Spec 8: pure. `events` must be sorted by (ts,id) and de-duplicated (readJsonlDir does that). */
export function reduceProgress(plan: PlanJson, rawEvents: Event[], now: string): ProgressJson {
  const events = mapEvents(rawEvents);
  const ids = new Set(plan.stages.map((s) => s.id));
  const nowMs = Date.parse(now);

  const state = new Map<string, { life: Event | null; started: boolean; items: Item[]; assess: Extract<Event, { type: "assessment_updated" }> | null; sp: StageProgress }>();
  for (const s of plan.stages)
    state.set(s.id, {
      life: null, started: false, items: [], assess: null,
      sp: {
        status: "locked", mastery: 0, tutorMastery: null, practiceMastery: null, coveredObjectives: [], gaps: [], reviewTopics: [],
        checks: 0, correctChecks: 0, attempts: 0, correctAttempts: 0, edgeCaseCorrect: 0, lastActivityAt: null, completedAt: null, completedBy: null,
      },
    });
  const touch = (id: string, ts: string) => {
    const st = state.get(id);
    if (st) st.sp.lastActivityAt = ts;
    return st;
  };

  const defs = new Map<string, Extract<Event, { type: "mistake_tag_defined" }>>();
  type Occ = { ts: string; w: number; stageIds: string[]; attemptId: string; note: string };
  const occs = new Map<string, Occ[]>();
  const addOcc = (tag: string, o: Occ) => {
    const t = normalizeTag(tag);
    if (t) occs.set(t, [...(occs.get(t) ?? []), { ...o, stageIds: o.stageIds.filter((x) => ids.has(x)) }]);
  };
  const goodAttempts: { ts: string; stageIds: string[] }[] = [];
  const totals = { stagesTotal: plan.stages.length, stagesCompleted: 0, attempts: 0, correctAttempts: 0, checks: 0, correctChecks: 0 };

  for (const e of events) {
    switch (e.type) {
      case "stage_started": {
        const st = touch(e.stageId, e.ts);
        if (st) {
          st.started = true;
          st.life ??= e;
        }
        break;
      }
      case "stage_completed":
      case "stage_reopened": {
        const st = touch(e.stageId, e.ts);
        if (st) st.life = e;
        break;
      }
      case "check_answered": {
        const st = touch(e.stageId, e.ts);
        if (!st) break;
        st.sp.checks++;
        totals.checks++;
        if (e.correct) {
          st.sp.correctChecks++;
          totals.correctChecks++;
        }
        st.items.push({ v: e.score / 100, a: 0.175, ctx: e.context });
        for (const tag of e.mistakeTags) addOcc(tag, { ts: e.ts, w: 1, stageIds: [e.stageId], attemptId: e.checkId, note: "" });
        break;
      }
      case "attempt_graded": {
        const valid = e.stageIds.filter((x) => ids.has(x));
        if (e.verdict === "unreadable" || !valid.length) break;
        totals.attempts++;
        if (e.verdict === "correct") totals.correctAttempts++;
        let v = e.score / 100 - 0.1 * e.hintsUsed;
        if (e.solutionRevealedBefore) v = Math.min(v, 0.6);
        v = Math.max(0, v);
        for (const id of valid) {
          const st = touch(id, e.ts) as NonNullable<ReturnType<typeof touch>>;
          st.sp.attempts++;
          if (e.verdict === "correct") {
            st.sp.correctAttempts++;
            if (e.hasEdgeCaseFocus) st.sp.edgeCaseCorrect++;
          }
          st.items.push({ v, a: 0.35, ctx: e.context });
        }
        if (e.score >= 85) goodAttempts.push({ ts: e.ts, stageIds: valid });
        for (const m of e.mistakes) addOcc(m.tag, { ts: e.ts, w: SEV[m.severity], stageIds: valid, attemptId: e.attemptId, note: m.note });
        break;
      }
      case "assessment_updated": {
        const st = touch(e.stageId, e.ts);
        if (st) st.assess = e;
        break;
      }
      case "mistake_observed":
        for (const id of e.stageIds) touch(id, e.ts);
        addOcc(e.tag, { ts: e.ts, w: 1, stageIds: e.stageIds, attemptId: e.refId, note: "" });
        break;
      case "mistake_tag_defined": {
        const t = normalizeTag(e.tag);
        if (t && !defs.has(t)) defs.set(t, e);
        break;
      }
      default:
        break;
    }
  }

  // Mastery and completion. M63: also the student's control of the stage's graph nodes (all of them, prior 0: the
  // self-rated level of a custom course is no completion credit); max() with the older formula, so no student goes back.
  const graph = graphOf(plan, events);
  const know = knowledgeOf(graph, events, 0);
  const done = (id: string) => {
    const l = state.get(id)?.life;
    return l?.type === "stage_completed";
  };
  for (const s of plan.stages) {
    const st = state.get(s.id) as NonNullable<ReturnType<typeof state.get>>;
    const sp = st.sp;
    sp.tutorMastery = st.assess ? st.assess.mastery : null;
    const item = ema(st.items);
    const prac = ema(st.items.filter((i) => i.ctx === "practice"));
    sp.practiceMastery = prac === null ? null : r2(prac);
    const old = sp.tutorMastery === null ? (item ?? 0) : item === null ? sp.tutorMastery : 0.4 * sp.tutorMastery + 0.6 * item;
    const nodes = nodesOfStages(graph, [s.id]);
    const ctl = nodes.length ? nodes.reduce((a, n) => a + (know.control.get(n.id) ?? 0), 0) / nodes.length : 0;
    sp.mastery = r2(Math.max(old, ctl));
    if (st.assess) {
      sp.coveredObjectives = st.assess.coveredObjectives;
      sp.gaps = st.assess.gaps;
      sp.reviewTopics = st.assess.reviewTopics;
    }
    const l = st.life;
    if (l?.type === "stage_completed") {
      sp.status = l.by === "user_override" ? "completed_override" : "completed";
      sp.completedAt = l.ts;
      sp.completedBy = l.by;
      totals.stagesCompleted++;
    }
  }
  for (const s of plan.stages) {
    const st = state.get(s.id) as NonNullable<ReturnType<typeof state.get>>;
    if (st.sp.status !== "locked") continue;
    if (st.started || st.life?.type === "stage_reopened") st.sp.status = "in_progress";
    else if (s.order === 1 || s.prerequisites.every(done)) st.sp.status = "available";
  }
  const stages: Record<string, StageProgress> = {};
  for (const s of plan.stages) stages[s.id] = (state.get(s.id) as NonNullable<ReturnType<typeof state.get>>).sp;
  const cur = plan.stages.find((s) => stages[s.id]?.status === "in_progress" || stages[s.id]?.status === "available");

  const mistakes: MistakeSummary[] = [...occs].map(([tag, list]) => {
    const last = list.reduce((a, b) => (b.ts > a ? b.ts : a), "");
    const stageIds = [...new Set(list.flatMap((o) => o.stageIds))];
    const d = defs.get(tag);
    const weight = list.reduce((n, o) => n + o.w * 0.5 ** (Math.max(0, nowMs - Date.parse(o.ts)) / DAY / 21), 0);
    const resolved = goodAttempts.filter((a) => a.ts > last && a.stageIds.some((x) => stageIds.includes(x))).length >= 3;
    return {
      tag, labelHe: d?.labelHe ?? tag, labelEn: d?.labelEn ?? tag, description: d?.description ?? "",
      count: list.length, weight: Math.round(weight * 1000) / 1000, lastSeenAt: last, stageIds, resolved,
      recentExamples: list.slice(-3).reverse().map((o) => ({ attemptId: o.attemptId, note: o.note })),
    };
  });
  mistakes.sort((a, b) => b.weight - a.weight || a.tag.localeCompare(b.tag));

  return {
    schema: 1, courseNumber: plan.courseNumber, planVersion: plan.version, computedAt: now,
    currentStageId: cur?.id ?? null, stages, mistakes, totals,
  };
}
