/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { beforeEach, describe, expect, it } from "vitest";
import { usage0 } from "@/core/claude/fake";
import type { ClaudeGateway, ClaudeRequest } from "@/core/claude/types";
import { EventSchema, PlanJsonSchema } from "@/core/domain/dataSchemas";
import { appendEvent } from "@/core/domain/progress/store";
import { setDeviceId } from "@/core/lib/device";
import { writeJsonAtomic } from "@/core/lib/fs/atomicWrite";
import { setFs } from "@/core/lib/fs/fs";
import { readJsonlDir } from "@/core/lib/fs/jsonl";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { memFs } from "@/test/memfs";
import { Practice } from "./engine";

const N = "01040195";
const stage = (n: number) => ({
  id: `S00${n}`, unitId: "U01", order: n, title: `t${n}`, summary: "s", kind: "concept", objectives: ["o1", "o2"], newConcepts: ["c"], theorems: [],
  techniques: [], prerequisites: n > 1 ? [`S00${n - 1}`] : [], edgeCases: [], examRelevance: "core", estimatedMinutes: 30,
});
const plan = PlanJsonSchema.parse({
  schema: 1, courseNumber: N, version: 1, generatedAt: "", model: "m", courseKind: "computational",
  units: [{ id: "U01", title: "u", summary: "s", stageIds: ["S001", "S002"] }], stages: [stage(1), stage(2)],
});
const course = { schema: 1, courseNumber: N, nameHe: "קורס", credits: 3, faculty: "f", syllabusHe: "", prerequisitesRaw: "", catalogSemester: null, courseKind: "computational", planVersion: 1, createdAt: "", updatedAt: "" };

const grade = {
  legibility: "clear", illegibleParts: [], verdict: "partially_correct", score: 70, finalAnswerCorrect: false, summaryMd: "ok", steps: [], missingForFullCredit: ["x"],
  mistakes: [{ tag: "Sign Slip", labelHe: "ה", labelEn: "Sign slip", description: "d", severity: "minor", whereMd: "line 2" }],
  edgeCasesMissed: [], correctedKeyStepMd: "", usesMaterialBeyondCompleted: [], stageIds: ["S001"],
  nodeResults: [{ n: 1, score: 0.8 }, { n: 7, score: 1 }],
  newNodes: [{ kind: "convention", label: "States the units", why: "no units on the result", stageIds: ["S001", "S999"], score: 0.3 }],
};
const replies: Record<string, unknown> = {
  submit_generated_exercise: { statementMd: "Prove P", referenceSolutionMd: "R", requiredStageIds: ["S001"], difficulty: 3, type: "proof", estimatedMinutes: 10, edgeCaseFocus: ["n=0"], gradingNotes: "n" },
  submit_verification: { wellPosed: true, solvable: true, independentSolutionMd: "R", matchesReference: true, requiresStagesBeyond: [], issues: [] },
  submit_grade: grade,
  submit_hint: { hintMd: "think", level: 1, targetsStep: "s1" },
  submit_practice_check: { items: [
    { kind: "mcq", stageIds: ["S001"], questionMd: "q1", options: ["a", "b", "c", "d"], correctIndex: 2, explanationMd: "e" },
    { kind: "mcq", stageIds: ["S001"], questionMd: "q2", options: ["a", "b", "c", "d"], correctIndex: 0, explanationMd: "e" },
    { kind: "open", stageIds: ["S001"], questionMd: "q3", explanationMd: "e", expectedPoints: ["p"] },
    { kind: "open", stageIds: ["S001"], questionMd: "q4", explanationMd: "e", expectedPoints: ["p"] },
  ] },
};
const calls: string[] = [];
let gradeSystem = "";
const gw: ClaudeGateway = {
  async send(req: ClaudeRequest) {
    const name = req.tools![0]!.name;
    calls.push(name);
    if (name === "submit_grade") gradeSystem = JSON.stringify(req.system);
    return { content: [{ type: "tool_use", id: "t", name, input: replies[name] }], stopReason: "tool_use", usage: usage0, model: "fake" };
  },
};
const events = () => readJsonlDir(coursePaths("/r", N).events, EventSchema);
const types = async () => (await events()).map((e) => e.type);
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(async () => {
  calls.length = 0;
  setFs(memFs());
  setDeviceId("dev");
  useSettings.setState((s) => ({ settings: { ...s.settings, dataRoot: "/r", language: "en" } }));
  const p = coursePaths("/r", N);
  await writeJsonAtomic(p.courseJson, course);
  await writeJsonAtomic(p.planJson, plan);
  await appendEvent(N, { type: "stage_completed", stageId: "S001", by: "mastery", masteryAtCompletion: 0.9 });
});

describe("Practice", () => {
  it("generates a verified exercise, hints, grades with a new tag, counts, and restores after restart", async () => {
    const pr = new Practice(N, { gw, loadImage: async () => "" });
    await pr.open();
    await pr.start({ kind: "all" });
    expect(pr.state!.current?.kind).toBe("E");
    expect(calls.slice(0, 2)).toEqual(["submit_generated_exercise", "submit_verification"]);
    await settle();
    expect(pr.run).not.toBeNull();
    await pr.run!.hint([]);
    expect(pr.run!.state.hints).toHaveLength(1);
    const g = await pr.run!.submit([]);
    expect(g?.score).toBe(70);
    expect(await types()).toEqual(expect.arrayContaining(["hint_requested", "mistake_tag_defined", "attempt_graded"]));
    const att = (await events()).find((e) => e.type === "attempt_graded")!;
    expect(att).toMatchObject({ hintsUsed: 1, context: "practice", solutionRevealedBefore: false, exercise: { source: "generated" } });
    expect(pr.counters).toEqual({ answered: 1, correct: 0, avg: 70 });
    // M62: the grader sees the stage's nodes by number; its node results and a new convention are kept (an unknown number and stage are dropped)
    expect(gradeSystem).toContain("1. [concept] c");
    expect(att.nodes).toEqual([{ id: expect.stringMatching(/^S001\/concept\//), score: 0.8 }, { id: expect.stringMatching(/^S001\/convention\//), score: 0.3 }]);
    expect((await events()).filter((e) => e.type === "node_added")).toMatchObject([{ kind: "convention", label: "States the units", stageIds: ["S001"], origin: "grader", refId: att.attemptId }]);
    // reveal is allowed after a graded attempt and counts
    await pr.run!.reveal();
    expect(pr.run!.state.solutionMd).toBe("R");
    // restart: same item, same state
    const again = new Practice(N, { gw, loadImage: async () => "" });
    await again.open();
    expect(again.state!.current).toMatchObject({ kind: "E", run: { attempts: 1 } });
    expect(again.counters.answered).toBe(1);
    pr.close();
  });

  it("serves the prefetched MCQ next, records the answer and summarizes", async () => {
    const pr = new Practice(N, { gw, loadImage: async () => "" });
    await pr.open();
    await pr.start({ kind: "all" });
    await settle();
    await pr.advance(); // item 2 = M (from the batch): S001 completed with no answers is level ~2.3, the E-M-O cycle
    expect(pr.state!.current?.kind).toBe("M");
    await pr.answerMcq(2);
    expect(pr.counters).toMatchObject({ answered: 1, correct: 1 });
    const s = await pr.end();
    expect(s).toMatchObject({ items: 1, avgScore: 100 });
    expect(pr.state).toBeNull();
    pr.close();
  });
});
