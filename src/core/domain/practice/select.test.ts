import { describe, expect, it } from "vitest";
import type { Event, IndexedExercise, PlanJson, ProgressJson } from "@/core/domain/dataSchemas";
import { completedIds, eligible, focusStage, itemKind, pick, requiredSet, targetDifficulty } from "./select";

const st = (id: string, order: number, prerequisites: string[] = []) => ({ id, unitId: "U01", order, prerequisites }) as unknown as PlanJson["stages"][number];
const plan = { units: [{ id: "U01", stageIds: ["S001", "S002", "S003"] }], stages: [st("S001", 1), st("S002", 2, ["S001"]), st("S003", 3, ["S002"])] } as unknown as PlanJson;
const sp = (status: string, mastery: number) => ({ status, mastery });
const progress = { stages: { S001: sp("completed", 0.9), S002: sp("completed", 0.5), S003: sp("available", 0) }, mistakes: [] } as unknown as ProgressJson;
const ex = (id: string, req: string[], over: Partial<IndexedExercise> = {}) =>
  ({ id, requiredStageIds: req, primaryStageId: req[0], difficulty: 3, type: "proof", ...over }) as unknown as IndexedExercise;
const att = (id: string, ts: string, score: number, context = "practice") =>
  ({ type: "attempt_graded", exercise: { source: "index", id }, ts, score, context, verdict: "correct" }) as unknown as Event;
const now = "2026-01-30T00:00:00Z";
const base = { plan, progress, events: [] as Event[], scope: { kind: "all" } as const, servedIds: [] as string[], now };

describe("practice select", () => {
  it("cycles items", () => {
    expect([0, 1, 2, 3, 4, 9, 10].map(itemKind).join("")).toBe("EEMEOOE");
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
    const low = pick({ ...base, exercises: [ex("a", ["S001"], { difficulty: 1 })], rng: () => 0 });
    expect(low.bestScore).toBeLessThan(0.45);
    expect(low.needsGeneration).toBe(true);
    expect(pick({ ...base, exercises: [] }).exercise).toBeNull();
  });
  it("target difficulty", () => {
    expect(targetDifficulty([])).toBe(4);
    const ev = ["a", "b", "c"].map((i) => att(i, now, 100));
    expect(targetDifficulty(ev)).toBe(5);
  });
  it("focus stage and required set", () => {
    expect(focusStage({ plan, progress, scope: { kind: "all" } })).toBe("S002");
    expect(focusStage({ plan, progress, scope: { kind: "weak" } })).toBe("S002");
    expect(focusStage({ plan, progress, scope: { kind: "stage", stageId: "S001" } })).toBe("S001");
    expect(requiredSet(plan, "S003", completedIds(progress)).sort()).toEqual(["S001", "S002"]);
  });
});
