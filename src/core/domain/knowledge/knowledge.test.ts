import { describe, expect, it } from "vitest";
import type { Event, PlanJson } from "@/core/domain/dataSchemas";
import { control, knowledgeOf, priorOf, questionStars, rawStars, shownStars, targetDifficulty } from "./control";
import { mapEvents, reduceProgress } from "@/core/domain/progress/reduce";
import { engineNames, graphOf, nodeId, planGraph } from "./graph";

const stage = (id: string, order: number, x: Partial<PlanJson["stages"][number]> = {}) => ({
  id, unitId: "U01", order, title: `t${id}`, summary: "s", kind: "concept" as const, objectives: [], newConcepts: [], theorems: [], techniques: [], prerequisites: [], edgeCases: [], examRelevance: "core" as const, estimatedMinutes: 30, ...x,
});
const plan: PlanJson = {
  schema: 1, courseNumber: "C1", version: 1, generatedAt: "t", model: "m", courseKind: "mixed",
  units: [{ id: "U01", title: "u", summary: "s", stageIds: ["S001", "S002"] }],
  stages: [
    stage("S001", 1, { newConcepts: ["סדרה", "גבול"], edgeCases: ["סדרה קבועה"] }),
    stage("S002", 2, { newConcepts: ["גבול"], theorems: [{ name: "משפט הסנדוויץ'", statement: "", proofRequired: false }], prerequisites: ["S001"] }),
  ],
};
const base = { ts: "2026-01-01T00:00:00Z", deviceId: "d", courseNumber: "C1", context: "practice" as const };
const answers = (id: string, scores: number[]): Event[] =>
  scores.map((s, i) => ({ ...base, id: `e${id}${i}`, type: "check_answered", stageId: "S001", checkId: `c${i}`, kind: "open", correct: s >= 0.7, score: s * 100, mistakeTags: [], nodes: [{ id, score: s }] }));
const seq = (spec: [number, number][]) => spec.flatMap(([n, s]) => Array<number>(n).fill(s));
const ctl = (scores: number[], prior = 0.1) => control(scores.map((s) => ({ s, w: 1 })), prior);

describe("graph", () => {
  it("Hebrew labels give distinct, stable ids; edges follow prerequisites and in-stage concepts", () => {
    const g = planGraph(plan);
    const ids = g.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(nodeId("S001", "concept", "  סדרה "));
    const thm = nodeId("S002", "theorem", "משפט הסנדוויץ'");
    expect(g.requires[thm]).toEqual(expect.arrayContaining([nodeId("S002", "concept", "גבול"), nodeId("S001", "concept", "סדרה")]));
    expect(g.requires[nodeId("S001", "edge", "סדרה קבועה")]).toEqual([nodeId("S001", "concept", "סדרה"), nodeId("S001", "concept", "גבול")]);
  });

  it("the tutor's nodes join the graph once; links only between known nodes", () => {
    const skill = nodeId(null, "skill", "Cites statute + section");
    const ev = (x: object) => ({ ...base, id: Math.random().toString(), ...x }) as Event;
    const add = ev({ type: "node_added", nodeId: skill, kind: "skill", label: "Cites statute + section", why: "w", stageIds: [], requires: [], origin: "grader", refId: "a1" });
    const g = graphOf(plan, [add, add, ev({ type: "node_linked", from: skill, to: nodeId("S001", "concept", "סדרה"), rel: "requires" }), ev({ type: "node_linked", from: skill, to: "nope", rel: "requires" })]);
    expect(g.nodes.filter((n) => n.id === skill)).toHaveLength(1);
    expect(g.requires[skill]).toEqual([nodeId("S001", "concept", "סדרה")]);
  });

  it("a replaced plan moves node ids with their stage; nodes of a removed stage drop", () => {
    const old = nodeId("S001", "concept", "סדרה");
    const gone = nodeId("S002", "concept", "גבול");
    const ev = [...answers(old, [1]), ...answers(gone, [1]), { ...base, id: "p", type: "plan_replaced", fromVersion: 1, toVersion: 2, idMap: { S001: "S004", S002: null } } as Event];
    const m = mapEvents(ev).filter((e) => e.type === "check_answered");
    expect(m.flatMap((e) => (e.type === "check_answered" ? (e.nodes ?? []).map((n) => n.id) : []))).toEqual([nodeId("S004", "concept", "סדרה")]);
  });

  it("engine names are unique labels and never change once given", () => {
    const g = planGraph(plan);
    const names = engineNames(g, plan);
    expect(new Set(Object.values(names)).size).toBe(g.nodes.length);
    expect(names[nodeId("S002", "concept", "גבול")]).toBe("גבול · tS002"); // the repeated label gets its stage
    expect(engineNames(g, plan, { [nodeId("S001", "concept", "סדרה")]: "old name" })[nodeId("S001", "concept", "סדרה")]).toBe("old name");
  });
});

describe("control: gentle, but honest", () => {
  // M75: the plan's required behaviour, exactly (two speeds: no single half-life can meet both "forgive 2 slips" and "see a slump")
  it("full control is reachable, and 1-2 misses after a long run barely move it", () => {
    const good = ctl(seq([[30, 1]]));
    expect(good).toBeGreaterThan(0.95);
    expect(good - ctl(seq([[30, 1], [2, 0]]))).toBeLessThanOrEqual(0.08);
    expect(ctl(seq([[30, 1], [2, 0], [3, 1]]))).toBeGreaterThan(0.9); // back up after a few good answers
    expect(ctl(seq([[10, 1]]))).toBeGreaterThan(0.84); // a new student rises as fast as before M75
  });

  it("a steady 80% student stays within ±0.05 of 0.8 (no swings after each miss)", () => {
    const pattern = Array.from({ length: 80 }, (_, i) => (i % 5 === 4 ? 0 : 1));
    const vals = pattern.map((_, i) => ctl(pattern.slice(0, i + 1))).slice(30);
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(0.75);
    expect(Math.max(...vals)).toBeLessThanOrEqual(0.85);
  });

  it("8 misses out of the last 10 bring it below 0.5 within those 10", () => {
    expect(ctl([...seq([[30, 1]]), 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])).toBeLessThan(0.5);
    expect(ctl(seq([[30, 1], [20, 0]]))).toBeLessThan(0.35);
  });

  it("shown stars never drop after 1-2 misses on one node of a course (3 nodes, any starting point)", () => {
    for (const n of [10, 30, 60]) {
      const other = ctl(seq([[n, 1]]));
      const stars = (hit: number) => (5 * (2 * other + hit)) / 3;
      const shown = shownStars(null, stars(other));
      for (const misses of [1, 2]) expect(shownStars(shown, stars(ctl(seq([[n, 1], [misses, 0]]))))).toBe(shown);
    }
  });

  it("a custom course starts at its self-rated level; academic starts low", () => {
    expect(priorOf({ type: "customCourse", level: 3 })).toBe(0.45);
    expect(priorOf({ type: "academic" })).toBe(0.1);
    const g = planGraph(plan);
    const stars = rawStars(g, knowledgeOf(g, [], priorOf({ type: "customCourse", level: 3 })));
    expect(stars).toBeCloseTo(2.25, 5);
  });

  it("legacy stage-level answers count for the stage's nodes at half weight", () => {
    const g = planGraph(plan);
    const legacy: Event = { ...base, id: "x", type: "check_answered", stageId: "S001", checkId: "c", kind: "mcq", correct: true, score: 100, mistakeTags: [] };
    const k = knowledgeOf(g, [legacy], 0.1);
    const s1 = nodeId("S001", "concept", "סדרה");
    expect(k.control.get(s1)).toBeGreaterThan(0.1);
    expect(k.control.get(nodeId("S002", "concept", "גבול"))).toBeCloseTo(0.1, 5);
    expect(knowledgeOf(g, answers(s1, [1]), 0.1).control.get(s1)).toBeGreaterThan(k.control.get(s1) as number);
  });

  it("forgetting (engine retention) lowers the stars", () => {
    const g = planGraph(plan);
    const all = g.nodes.flatMap((n) => answers(n.id, seq([[10, 1]])));
    const k = knowledgeOf(g, all, 0.1);
    const fresh = rawStars(g, k);
    const faded = rawStars(g, k, new Map(g.nodes.map((n) => [n.id, 0.5])));
    expect(faded).toBeCloseTo(fresh / 2, 5);
  });
});

describe("stars", () => {
  it("shown stars rise at the next half star, drop only well below, one half star at a time", () => {
    expect(shownStars(null, 2.3)).toBe(2);
    expect(shownStars(2, 2.49)).toBe(2);
    expect(shownStars(2, 2.5)).toBe(2.5);
    expect(shownStars(2.5, 2.2)).toBe(2.5); // a dip after a miss or two
    expect(shownStars(2.5, 2.1)).toBe(2);
    expect(shownStars(3, 1.2)).toBe(2.5);
  });

  it("a question on what the student controls is easy for them; the target lands near 3 stars", () => {
    expect(questionStars(3, 0.95)).toBe(2);
    expect(questionStars(3, 0.1)).toBe(4);
    expect(questionStars(5, 1)).toBe(4);
    const m = 0.9;
    expect(questionStars(targetDifficulty(m, false), m)).toBe(3);
    expect(questionStars(targetDifficulty(m, true), m)).toBe(4);
    expect(targetDifficulty(0.1, false)).toBe(2);
  });
});

describe("M63: stage mastery on the graph", () => {
  const ev = (x: object) => ({ ...base, id: Math.random().toString(), ...x }) as Event;
  const now = "2026-02-01T00:00:00Z";
  it("never below the older formula; nothing answered is 0 (no prior credit); every node of the stage counts", () => {
    expect(reduceProgress(plan, [], now).stages.S001?.mastery).toBe(0);
    const guess = ev({ type: "assessment_updated", stageId: "S001", mastery: 0.9, coveredObjectives: [], gaps: [], reviewTopics: [], readyToAdvance: false, rationale: "" });
    expect(reduceProgress(plan, [guess], now).stages.S001?.mastery).toBe(0.9); // the old formula's value is kept
    // the tutor saw the student master one of S002's two nodes: half the stage, not all of it
    const lim = nodeId("S002", "concept", "גבול");
    const seen = Array.from({ length: 12 }, () => ev({ type: "node_observed", nodeId: lim, score: 1, why: "w" }));
    const m = reduceProgress(plan, seen, now).stages.S002?.mastery ?? 0;
    expect(m).toBeGreaterThan(0.4);
    expect(m).toBeLessThan(0.5);
  });
});
