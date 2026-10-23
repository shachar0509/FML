import { describe, expect, it } from "vitest";
import type { Event, IndexedExercise, PlanJson, ProgressJson } from "@/core/domain/dataSchemas";
import { completedIds, eligible, focusStage, itemKind, pick, requiredSet, skill, starsFor, targetDifficulty, uptoStages } from "./select";

const st = (id: string, order: number, prerequisites: string[] = []) => ({ id, unitId: "U01", order, prerequisites, title: id, newConcepts: [], theorems: [], techniques: [], edgeCases: [] }) as unknown as PlanJson["stages"][number];
const plan = { units: [{ id: "U01", stageIds: ["S001", "S002", "S003"] }], stages: [st("S001", 1), st("S002", 2, ["S001"]), st("S003", 3, ["S002"])] } as unknown as PlanJson;
const sp = (status: string, mastery: number) => ({ status, mastery });
const progress = { stages: { S001: sp("completed", 0.9), S002: sp("completed", 0.5), S003: sp("available", 0) }, mistakes: [] } as unknown as ProgressJson;
const ex = (id: string, req: string[], over: Partial<IndexedExercise> = {}) =>
  ({ id, requiredStageIds: req, primaryStageId: req[0], difficulty: 3, type: "proof", ...over }) as unknown as IndexedExercise;
const att = (id: string, ts: string, score: number, context = "practice") =>
  ({ type: "attempt_graded", exercise: { source: "index", id }, ts, score, context, verdict: "correct", edgeCasesMissed: [] }) as unknown as Event;
const now = "2026-01-30T00:00:00Z";
const base = { plan, progress, events: [] as Event[], scope: { kind: "all" } as const, servedIds: [] as string[], now };

describe("practice select", () => {
  it("cycles items", () => {
    expect([0, 1, 2, 3, 4, 9, 10].map((i) => itemKind(i)).join("")).toBe("EEMEOOE");
    expect(completedIds(progress)).toEqual(new Set(["S001", "S002"]));
  });
  it("filters eligibility", () => {
    const exercises = [ex("a", ["S001"]), ex("b", ["S003"]), ex("c", ["S001"]), ex("d", ["S001"]), ex("e", ["S002"]), ex("f", ["S002"])];
    const events = [att("c", "2026-01-29T12:00:00Z", 10), att("d", "2026-01-20T00:00:00Z", 95), att("e", "2026-01-20T00:00:00Z", 80)];
    const ids = (o: object) => eligible({ ...base, exercises, events, ...o }).map((e) => e.id);
    expect(ids({ servedIds: ["a"] })).toEqual(["e", "f"]); // b needs S003, c<24h, d>=90 in 21d
    expect(ids({ scope: { kind: "stage", stageId: "S002" } })).toEqual(["e", "f"]);
    expect(ids({ scope: { kind: "weak" } })).toEqual(["e", "f"]); // S001 weak=0.1 <0.4, S002 0.5
  });
  it("picks deterministically and flags generation", () => {
    const exercises = [ex("a", ["S001"]), ex("e", ["S002"])];
    const r = pick({ ...base, exercises, rng: () => 0 });
    expect(r.exercise?.id).toBe("e");
    expect(r.needsGeneration).toBe(false);
    const low = pick({ ...base, exercises: [ex("a", ["S001"], { difficulty: 5 })], rng: () => 0 }); // far from the target (2)
    expect(low.bestScore).toBeLessThan(0.45);
    expect(low.needsGeneration).toBe(true);
    expect(pick({ ...base, exercises: [] }).exercise).toBeNull();
  });
  it("M63: level and target difficulty follow the student's control of the graph", () => {
    const c = { plan, progress, events: [] as Event[] };
    expect(skill(c)).toBeCloseTo(2.3); // completed S001+S002, nothing answered: the academic prior 0.1
    expect(skill({ ...c, course: { type: "customCourse", level: 4 } })).toBeCloseTo(2 + 3 * 0.65); // a custom course starts at its level
    expect(targetDifficulty(c, ["S001"])).toBe(2);
    const good = Array.from({ length: 12 }, (_, i) => ({ type: "check_answered", stageId: "S001", checkId: `k${i}`, kind: "open", context: "practice", correct: true, score: 100, mistakeTags: [], ts: now }) as unknown as Event);
    expect(targetDifficulty({ ...c, events: good }, ["S001"])).toBe(4); // controls S001: harder questions are ~3★ for them
    expect(targetDifficulty({ ...c, events: good }, ["S002"])).toBe(2); // not S002
    const run = ["a", "b", "c"].map((i) => ({ ...att(i, now, 90), stageIds: ["S001"], hintsUsed: 0, solutionRevealedBefore: false }) as Event);
    expect(targetDifficulty({ ...c, events: [...good, ...run] }, ["S001"])).toBe(5); // 3 good answers in a row: a stretch
  });
  it("focus stage and required set", () => {
    expect(focusStage({ plan, progress, scope: { kind: "all" } })).toBe("S002");
    expect(focusStage({ plan, progress, scope: { kind: "weak" } })).toBe("S002");
    expect(focusStage({ plan, progress, scope: { kind: "stage", stageId: "S001" } })).toBe("S001");
    expect(requiredSet(plan, "S003", completedIds(progress)).sort()).toEqual(["S001", "S002"]);
  });
  it("M64: Customized (up to a unit) narrows to the learned stages of the units up to it; the engine's hot stages rank first", () => {
    const two = { ...plan, units: [{ id: "U01", stageIds: ["S001"] }, { id: "U02", stageIds: ["S002", "S003"] }] } as unknown as PlanJson;
    expect(uptoStages(two, "U01")).toEqual(new Set(["S001"]));
    expect(uptoStages(two, "U02")).toEqual(new Set(["S001", "S002", "S003"]));
    const exercises = [ex("a", ["S001"]), ex("e", ["S002"])];
    expect(eligible({ ...base, plan: two, exercises, scope: { kind: "upto", unitId: "U01" } }).map((e) => e.id)).toEqual(["a"]);
    expect(focusStage({ plan: two, progress, scope: { kind: "upto", unitId: "U01" } })).toBe("S001");
    expect(focusStage({ plan: two, progress, scope: { kind: "upto", unitId: "U02" } })).toBe("S002"); // S003 is not learned
    expect(focusStage({ plan: two, progress, scope: { kind: "all" }, hot: ["S001"] })).toBe("S001");
  });
});

it("M65: question stars: the question's difficulty against the student's control of what it tests", () => {
  const c = { plan, progress, events: [] as Event[] };
  expect(starsFor(c, 3, ["S001"])).toBe(4); // control 0.1: a 3/5 question is hard for this student
  const good = Array.from({ length: 12 }, (_, i) => ({ type: "check_answered", stageId: "S001", checkId: `k${i}`, kind: "open", context: "practice", correct: true, score: 100, mistakeTags: [], ts: now }) as unknown as Event);
  expect(starsFor({ ...c, events: good }, 3, ["S001"])).toBe(2); // they control S001: easy for them
  expect(starsFor({ ...c, course: { type: "customCourse", level: 5 } }, 3, ["S002"])).toBe(2); // a self-rated expert
});

it("M56: the more advanced the student, the more of the items are exercises", () => {
  const share = (level: number) => Array.from({ length: 30 }, (_, i) => itemKind(i, level)).filter((k) => k === "E").length;
  expect([2, 3, 4, 5].map(share)).toEqual([10, 18, 24, 30]);
  expect(itemKind(0)).toBe("E"); // default level 3 = the old cycle
});
