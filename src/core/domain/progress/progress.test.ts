import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event, MistakeSummary, PlanJson, StageProgress } from "@/core/domain/dataSchemas";
import { idleMinutes } from "@/core/domain/learn/recap";
import { SettingsSchema } from "@/core/domain/schemas";
import { setDeviceId } from "@/core/lib/device";
import { setFs } from "@/core/lib/fs/fs";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { memFs } from "@/test/memfs";
import { checkAdvanceCriteria } from "./criteria";
import { mapEvents, normalizeTag, reduceProgress } from "./reduce";
import { renderProgressMd } from "./render";
import { appendEvent, recomputeProgress, scheduleRecompute } from "./store";

const stage = (n: number, prerequisites: string[] = [], kind = "concept") => ({
  id: `S00${n}`, unitId: "U01", order: n, title: `t${n}`, summary: "s", kind, prerequisites,
  objectives: ["o0", "o1"], newConcepts: [], theorems: [], techniques: [], edgeCases: [], examRelevance: "core", estimatedMinutes: 30,
});
const plan = {
  schema: 1, courseNumber: "01040195", version: 1, generatedAt: "2026-01-01T00:00:00Z", model: "m", courseKind: "mixed",
  units: [{ id: "U01", title: "u", summary: "s", stageIds: ["S001", "S002", "S003", "S004"] }],
  stages: [stage(1), stage(2, ["S001"]), stage(3, ["S002"]), stage(4, ["S003"], "integration")],
} as unknown as PlanJson;

let n = 0;
const ev = (e: object, ts = `2026-02-01T00:00:${String(n++).padStart(2, "0")}Z`): Event =>
  ({ id: `e${n}`, ts, deviceId: "d", courseNumber: "01040195", ...e }) as Event;
const att = (score: number, o: object = {}) =>
  ev({ type: "attempt_graded", attemptId: `a${n}`, exercise: { source: "index", id: "x" }, stageIds: ["S001"], context: "learn", verdict: "correct", score,
    mistakes: [], missingForFullCredit: 0, edgeCasesMissed: [], attachmentHashes: [], difficulty: 3, hasEdgeCaseFocus: false, hintsUsed: 0, solutionRevealedBefore: false, ...o });
const NOW = "2026-02-02T00:00:00Z";
const st = (events: Event[], id = "S001") => reduceProgress(plan, events, NOW).stages[id] as StageProgress;

beforeEach(() => { n = 0; });

describe("reduceProgress status", () => {
  it("starts with S001 available, rest locked", () => {
    const p = reduceProgress(plan, [], NOW);
    expect(Object.values(p.stages).map((s) => s.status)).toEqual(["available", "locked", "locked", "locked"]);
    expect(p.currentStageId).toBe("S001");
  });
  it("start, complete (unlocks next), override, reopen", () => {
    let p = reduceProgress(plan, [ev({ type: "stage_started", stageId: "S001" })], NOW);
    expect(p.stages.S001?.status).toBe("in_progress");
    const done = ev({ type: "stage_completed", stageId: "S001", by: "mastery", masteryAtCompletion: 0.9 });
    p = reduceProgress(plan, [ev({ type: "stage_started", stageId: "S001" }), done], NOW);
    expect(p.stages.S001).toMatchObject({ status: "completed", completedBy: "mastery" });
    expect(p.stages.S002?.status).toBe("available");
    expect(p.currentStageId).toBe("S002");
    p = reduceProgress(plan, [done, ev({ type: "stage_completed", stageId: "S002", by: "user_override", masteryAtCompletion: 0.2 })], NOW);
    expect(p.stages.S002?.status).toBe("completed_override");
    expect(p.stages.S003?.status).toBe("available");
    p = reduceProgress(plan, [done, ev({ type: "stage_reopened", stageId: "S001" })], NOW);
    expect(p.stages.S001?.status).toBe("in_progress");
    expect(p.stages.S002?.status).toBe("locked");
    expect(p.totals.stagesCompleted).toBe(0);
  });
  it("currentStageId is null when all completed", () => {
    const all = plan.stages.map((s) => ev({ type: "stage_completed", stageId: s.id, by: "mastery", masteryAtCompletion: 1 }));
    expect(reduceProgress(plan, all, NOW).currentStageId).toBeNull();
  });
});

describe("mastery", () => {
  it("EMA over attempts and checks, hints, revealed solution, unreadable", () => {
    expect(st([att(100), att(50)]).mastery).toBe(0.83); // 1 -> 0.65*1+0.35*0.5
    expect(st([att(100, { hintsUsed: 2 })]).mastery).toBe(0.8);
    expect(st([att(100, { solutionRevealedBefore: true })]).mastery).toBe(0.6);
    expect(st([att(5, { hintsUsed: 3 })]).mastery).toBe(0);
    expect(st([att(100, { verdict: "unreadable" })]).attempts).toBe(0);
    const chk = (score: number) => ev({ type: "check_answered", stageId: "S001", checkId: "c", kind: "mcq", context: "learn", correct: score > 50, score, mistakeTags: [] });
    expect(st([chk(100), chk(0)])).toMatchObject({ mastery: 0.83, checks: 2, correctChecks: 1 });
  });
  it("blends tutor assessment 0.4/0.6, practice mastery from practice items only", () => {
    const as = ev({ type: "assessment_updated", stageId: "S001", mastery: 0.5, coveredObjectives: [0], gaps: ["g"], reviewTopics: ["r"], readyToAdvance: false, rationale: "" });
    const s = st([as, att(100, { context: "practice" }), att(0)]);
    // items: 1 then 0.65*1+0.35*0 = 0.65 -> 0.4*0.5+0.6*0.65 = 0.59
    expect(s).toMatchObject({ mastery: 0.59, tutorMastery: 0.5, practiceMastery: 1, gaps: ["g"], reviewTopics: ["r"], coveredObjectives: [0] });
    expect(st([as]).mastery).toBe(0.5);
  });
});

describe("mistakes", () => {
  const miss = (tag: string, o: object = {}) => att(50, { mistakes: [{ tag, severity: "major", note: "n" }], ...o });
  it("normalises tags, weights by severity with 21-day half-life, sorts", () => {
    expect(normalizeTag("Sign  Error!!")).toBe("sign-error");
    const old = att(50, { mistakes: [{ tag: "a", severity: "critical", note: "" }] });
    const p = reduceProgress(plan, [{ ...old, ts: "2026-01-12T00:00:00Z" } as Event, miss("b"), ev({ type: "mistake_observed", tag: "b", stageIds: ["S001"], refId: "r", context: "learn" })], "2026-02-02T00:00:00Z");
    // a: 3 * 0.5^(21/21)=1.5 ; b: (2 + 1) * 0.5^(~1/21)
    expect(p.mistakes.map((m) => m.tag)).toEqual(["b", "a"]);
    expect(p.mistakes[1]).toMatchObject({ count: 1, weight: 1.5, resolved: false });
    expect(p.mistakes[0]?.count).toBe(2);
  });
  it("uses first definition for labels; keeps only 3 newest examples", () => {
    const defs = [ev({ type: "mistake_tag_defined", tag: "x", labelHe: "ה", labelEn: "E1", description: "d" }), ev({ type: "mistake_tag_defined", tag: "x", labelHe: "ז", labelEn: "E2", description: "d2" })];
    const m = reduceProgress(plan, [...defs, miss("x"), miss("x"), miss("x"), miss("x")], NOW).mistakes[0] as MistakeSummary;
    expect(m).toMatchObject({ labelEn: "E1", count: 4 });
    expect(m.recentExamples).toHaveLength(3);
  });
  it("resolved after 3 good attempts on intersecting stages since the last occurrence", () => {
    const base = [miss("x")];
    expect(reduceProgress(plan, [...base, att(90), att(90)], NOW).mistakes[0]?.resolved).toBe(false);
    expect(reduceProgress(plan, [...base, att(90), att(90), att(90)], NOW).mistakes[0]?.resolved).toBe(true);
    expect(reduceProgress(plan, [...base, att(90, { stageIds: ["S002"] }), att(90, { stageIds: ["S002"] }), att(90, { stageIds: ["S002"] })], NOW).mistakes[0]?.resolved).toBe(false);
  });
});

describe("plan_replaced", () => {
  it("maps older events through the id chain and drops removed stages", () => {
    const old = [ev({ type: "stage_completed", stageId: "S001", by: "mastery", masteryAtCompletion: 1 }), ev({ type: "stage_started", stageId: "S009" })];
    const rep = ev({ type: "plan_replaced", fromVersion: 1, toVersion: 2, idMap: { S001: "S002", S009: null } });
    const rep2 = ev({ type: "plan_replaced", fromVersion: 2, toVersion: 3, idMap: { S002: "S003" } });
    const p = reduceProgress(plan, [...old, rep, rep2], NOW);
    expect(p.stages.S003?.status).toBe("completed");
    expect(p.stages.S001?.status).toBe("available");
    expect(mapEvents([...old, rep]).filter((e) => e.type === "stage_started")).toHaveLength(0);
  });
});

describe("checkAdvanceCriteria", () => {
  const cfg = SettingsSchema.parse({}).learning;
  const ready = (id = "S001") => ev({ type: "assessment_updated", stageId: id, mastery: 0.9, coveredObjectives: [0, 1], gaps: [], reviewTopics: [], readyToAdvance: true, rationale: "" });
  const chk = (correct: boolean, id = "S001") => ev({ type: "check_answered", stageId: id, checkId: "c", kind: "mcq", context: "learn", correct, score: correct ? 100 : 0, mistakeTags: [] });
  const run = (events: Event[], stageId = "S001", lang: "he" | "en" = "en") => checkAdvanceCriteria({ plan, events, stageId, cfg, lang, now: NOW });

  it("is met for a normal stage", () => {
    expect(run([ready(), att(90), att(90, { difficulty: 1, hasEdgeCaseFocus: true }), chk(true), chk(true), chk(false), chk(true)])).toEqual({ met: true, missing: [] });
  });
  it("lists what is missing", () => {
    const r = run([ev({ type: "assessment_updated", stageId: "S001", mastery: 0.5, coveredObjectives: [0], gaps: ["g1"], reviewTopics: [], readyToAdvance: false, rationale: "" })]);
    expect(r.met).toBe(false);
    expect(r.missing.join("|")).toMatch(/not say you are ready.*g1.*o1.*2 more exercises.*3 of the last 4.*Mastery is 50%/);
    expect(run([]).missing[0]).toMatch(/ready/);
    expect(run([], "S001", "he").missing[0]).toMatch(/ההערכה/);
  });
  it("needs one hard or edge-case exercise", () => {
    const easy = { difficulty: 2 };
    expect(run([ready(), att(90, easy), att(90, easy), chk(true), chk(true), chk(true)]).missing).toEqual([expect.stringMatching(/difficulty 3\+/)]);
  });
  it("integration needs 3 exercises and no checks", () => {
    const a = (o = {}) => att(95, { stageIds: ["S004"], ...o });
    expect(run([ready("S004"), a(), a()], "S004").missing.join()).toMatch(/1 more exercise with/);
    expect(run([ready("S004"), a(), a(), a()], "S004").missing.join()).not.toMatch(/last 4/);
    expect(run([ready("S004"), a(), a(), a()], "S004").met).toBe(true);
  });
  it("only counts exercises scoring above the bar and in learn context", () => {
    expect(run([ready(), att(80), att(95, { context: "practice" })]).missing.join()).toMatch(/2 more exercises/);
  });
});

describe("render + store", () => {
  const course = { schema: 1, courseNumber: "01040195", nameHe: "קורס", credits: 2, faculty: "f", syllabusHe: "s", prerequisitesRaw: "", catalogSemester: null, courseKind: "mixed", planVersion: 1, createdAt: "x", updatedAt: "x" } as never;
  it("renders the sections", () => {
    const p = reduceProgress(plan, [ev({ type: "stage_completed", stageId: "S001", by: "user_override", masteryAtCompletion: 0.1 }), att(50, { mistakes: [{ tag: "t", severity: "minor", note: "" }] })], NOW);
    const md = renderProgressMd(course, plan, p, "en");
    expect(md).toContain("1 of 4 stages completed");
    expect(md).toContain("| S001 | t1 | Skipped ahead |");
    expect(md).toContain("## Skipped ahead\n- S001");
    expect(md).toContain("## Mistakes to watch out for\n- **t** — 1 times");
    expect(renderProgressMd(course, plan, p, "he")).toContain("## התקדמות כללית");
  });
  it("appends events, recomputes, and writes only on change", async () => {
    const mem = memFs();
    setFs(mem);
    useSettings.setState({ settings: { ...useSettings.getState().settings, dataRoot: "/r", language: "en" } });
    setDeviceId("dev1");
    const p = coursePaths("/r", "01040195");
    mem.files.set(p.courseJson, JSON.stringify(course));
    mem.files.set(p.planJson, JSON.stringify(plan));
    await appendEvent("01040195", { type: "stage_started", stageId: "S001" } as never);
    expect(mem.files.get(p.eventsFile("dev1"))).toContain('"stage_started"');
    expect(await recomputeProgress("01040195")).toBe(true);
    expect(JSON.parse(mem.files.get(p.progressJson) ?? "{}").stages.S001.status).toBe("in_progress");
    expect(mem.files.get(p.progressMd)).toContain("In progress");
    expect(await recomputeProgress("01040195")).toBe(false);
  });
  it("debounces 500 ms", async () => {
    vi.useFakeTimers();
    const mem = memFs();
    setFs(mem);
    useSettings.setState({ settings: { ...useSettings.getState().settings, dataRoot: "/r", language: "en" } });
    const p = coursePaths("/r", "01040195");
    mem.files.set(p.courseJson, JSON.stringify(course));
    mem.files.set(p.planJson, JSON.stringify(plan));
    scheduleRecompute("01040195");
    scheduleRecompute("01040195");
    await vi.advanceTimersByTimeAsync(499);
    expect(mem.files.has(p.progressJson)).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(mem.files.has(p.progressJson)).toBe(true);
    vi.useRealTimers();
  });
});

describe("idleMinutes (A8)", () => {
  const T = "2026-02-01T10:00:00.000Z";
  it("0 with nothing yet", () => expect(idleMinutes([], null, T)).toBe(0));
  it("whole minutes since the newest studying event, floored", () => {
    const e = [ev({ type: "stage_started", stageId: "S001" }, "2026-02-01T07:00:00.000Z"), ev({ type: "check_answered", stageId: "S001", checkId: "c", kind: "mcq", context: "learn", correct: true, score: 100, mistakeTags: [] }, "2026-02-01T07:54:30.000Z")];
    expect(idleMinutes(e, null, T)).toBe(125); // 2 h 5 min 30 s
  });
  it("scan, plan and graph events are not activity", () => {
    const e = [
      ev({ type: "stage_started", stageId: "S001" }, "2026-01-30T10:00:00.000Z"),
      ev({ type: "node_observed", nodeId: "S001/concept/x", score: 0, why: "graded by the teacher", context: "teacher", refId: "sha" }, "2026-02-01T09:59:00.000Z"),
      ev({ type: "mistake_tag_defined", tag: "t", labelHe: "t", labelEn: "t", description: "" }, "2026-02-01T09:59:00.000Z"),
      ev({ type: "plan_replaced", fromVersion: 1, toVersion: 2, idMap: {} }, "2026-02-01T09:59:30.000Z"),
    ];
    expect(idleMinutes(e, null, T)).toBe(2 * 24 * 60);
  });
  it("the lesson's last saved action when it is later, else the event", () => {
    const e = [ev({ type: "stage_started", stageId: "S001" }, "2026-02-01T08:00:00.000Z")];
    expect(idleMinutes(e, "2026-02-01T09:00:00.000Z", T)).toBe(60);
    expect(idleMinutes(e, "2026-02-01T07:00:00.000Z", T)).toBe(120);
    expect(idleMinutes([], "2026-02-01T09:30:00.000Z", T)).toBe(30);
  });
  it("never negative (another device's clock ahead)", () => {
    expect(idleMinutes([ev({ type: "stage_started", stageId: "S001" }, "2026-02-01T10:05:00.000Z")], null, T)).toBe(0);
  });
});
