/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { beforeEach, describe, expect, it } from "vitest";
import { usage0 } from "@/core/claude/fake";
import type { ClaudeGateway, ClaudeRequest } from "@/core/claude/types";
import { type Convention, EventSchema, type FileIndex, PlanJsonSchema } from "@/core/domain/dataSchemas";
import { writeFileIndex } from "@/core/domain/ingest/indexStore";
import { appendEvent } from "@/core/domain/progress/store";
import { setDeviceId } from "@/core/lib/device";
import { writeJsonAtomic } from "@/core/lib/fs/atomicWrite";
import { setFs } from "@/core/lib/fs/fs";
import { readJsonlDir } from "@/core/lib/fs/jsonl";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { memFs } from "@/test/memfs";
import { getSolution } from "./assist";
import { loadCtx, type Ex } from "./exercises";
import { gradeAttempt, gradeCheck } from "./grade";

/** M73: conventions reach the graders and writers; only triggered verdicts are evidence; a doubt from outside knowledge is settled by the course files. */
const N = "01040195";
const stage = (n: number) => ({
  id: `S00${n}`, unitId: "U01", order: n, title: `t${n}`, summary: "s", kind: "concept", objectives: ["o1"], newConcepts: ["c"], theorems: [],
  techniques: [], prerequisites: [], edgeCases: [], examRelevance: "core", estimatedMinutes: 30,
});
const plan = PlanJsonSchema.parse({
  schema: 1, courseNumber: N, version: 1, generatedAt: "", model: "m", courseKind: "computational",
  units: [{ id: "U01", title: "u", summary: "s", stageIds: ["S001", "S002"] }], stages: [stage(1), stage(2)],
});
const course = { schema: 1, courseNumber: N, nameHe: "קורס", credits: 3, faculty: "f", syllabusHe: "", prerequisitesRaw: "", catalogSemester: null, courseKind: "computational", planVersion: 1, createdAt: "", updatedAt: "" };
const conv = (id: string, source: Convention["source"], rule: string, o: Partial<Convention["useCase"]> = {}): Convention => ({
  id, rule, source, status: "active", sources: [], conflicts: [], addedAt: "t", updatedAt: "t",
  useCase: { trigger: `trigger of ${rule}`, on: "answer", notWhen: ["only mentioned"], examples: [{ quote: "s.35 CWO", applies: true }], verify: `verify ${rule}`, distinguishes: [], level: "any", stageIds: [], hints: { answerForms: [], questionTypes: [] }, ...o },
});
const CITE = conv("G/convention/cite", "teacher", "Cite the statute and section");
const AXES = conv("S001/convention/axes", "solutions", "Label the axes", { level: "whole", stageIds: ["S001"] });
const OTHER = conv("S002/convention/other", "solutions", "Only in stage 2", { stageIds: ["S002"] });
const rec = (sha: string, o: Partial<FileIndex>): FileIndex => ({
  schema: 1, sha256: sha, fileName: `${sha}.md`, relPath: `${sha}.md`, role: "material", mediaType: "text/markdown", pageCount: 1, addedAt: "t", status: "indexed", error: null, indexedAt: "t",
  indexModel: "m", planVersion: 1, materialPages: [], exercises: [], ...o,
});
const page = (text: string, stageIds = ["S002"]) => ({ page: 1, stageIds, summary: "", hasFigure: false, text });
const ex: Ex = { ref: { source: "index", id: "e1" }, statementMd: "Can the buyer cancel?", referenceSolutionMd: "R", gradingNotes: "", requiredStageIds: ["S001"], stageIds: ["S001"], difficulty: 3, edgeCaseFocus: [], figures: [] };

const dispute = { claim: "notice under section 15", believed: "notice is section 14", points: 10, finalAnswer: true, queries: ["notice of defect", "inform the seller"] };
const replies: Record<string, unknown> = {};
const sys: Record<string, string> = {};
const msg: Record<string, string> = {};
const calls: string[] = [];
const gw: ClaudeGateway = {
  async send(req: ClaudeRequest) {
    const name = req.tools![0]!.name;
    calls.push(name);
    sys[name] = JSON.stringify(req.system);
    msg[name] = JSON.stringify(req.messages);
    return { content: [{ type: "tool_use", id: "t", name, input: replies[name] }], stopReason: "tool_use", usage: usage0, model: "fake" };
  },
};
const env = { gw, loadImage: async () => "" };
const events = () => readJsonlDir(coursePaths("/r", N).events, EventSchema);

beforeEach(async () => {
  calls.length = 0;
  setFs(memFs());
  setDeviceId("dev");
  useSettings.setState((s) => ({ settings: { ...s.settings, dataRoot: "/r", language: "en" } }));
  const p = coursePaths("/r", N);
  await writeJsonAtomic(p.courseJson, course);
  await writeJsonAtomic(p.planJson, plan);
  await writeJsonAtomic(p.conventions, { schema: 1, conventions: [OTHER, AXES, CITE], updatedAt: "t" });
  for (const c of [CITE, AXES, OTHER])
    await appendEvent(N, { type: "node_added", nodeId: c.id, kind: "convention", label: c.rule, why: "w", stageIds: c.useCase.stageIds, requires: [], origin: c.source === "teacher" ? "teacher" : "index", refId: "" });
  // the course's own solution says section 15; Shalav's own web file says 14 and must never decide
  await writeFileIndex(N, rec("sol", { role: "exercises", exercises: [{ id: "x1", label: "Q2", pages: [1], statementMd: "A laptop is faulty.", figureCrops: [], referenceSolutionMd: "Under section 15 the buyer must inform the seller within a reasonable time.", requiredStageIds: ["S002"], primaryStageId: "S002", difficulty: 3, type: "short_answer", estimatedMinutes: 5, edgeCaseFocus: [], gist: "g" }] }));
  await writeFileIndex(N, rec("web", { origin: "web", materialPages: [page("Notice of defect: section 14, inform the seller.")] }));
  await writeFileIndex(N, rec("mat", { materialPages: [page("Unrelated stage-one page about axes.", ["S001"])] }));
  Object.assign(replies, {
    submit_grade: {
      legibility: "clear", illegibleParts: [], verdict: "partially_correct", score: 80, finalAnswerCorrect: true, summaryMd: "ok", steps: [], missingForFullCredit: [],
      mistakes: [], edgeCasesMissed: [], correctedKeyStepMd: "", usesMaterialBeyondCompleted: [], stageIds: ["S001"],
      // C1 = the teacher's (first), C2 = axes; "Only in stage 2" is not offered for an S001 exercise
      conventions: [{ n: 1, triggered: true, why: "relies on a statute", met: 0 }, { n: 2, triggered: false, why: "no graph", met: null }],
      nodeResults: [], newNodes: [{ kind: "convention", label: "Label the axes", why: "no labels", stageIds: [], score: 1 }], // a registry convention by label: never plain evidence
      disputed: [dispute],
    },
    submit_check_grade: { correct: true, score: 90, feedbackMd: "fine", mistakes: [], conventions: [{ n: 1, triggered: true, why: "w", met: 1 }], disputed: [dispute] },
    submit_fact_check: { results: [{ n: 1, verdict: "right", source: "sol.md, Q2", quote: "Under section 15", note: "n" }] },
    submit_solution: { solutionMd: "S" },
  });
});

describe("M73 conventions applied", () => {
  it("the grader judges the offered conventions; only triggered verdicts are evidence; a doubt the course files confirm costs nothing", async () => {
    const { grade, attemptId } = await gradeAttempt(env, await loadCtx(N), ex, [], { hintsUsed: 0, solutionRevealed: false, context: "practice", answerText: "section 15" });
    expect(sys.submit_grade).toContain("C1. [teacher] Cite the statute and section");
    expect(sys.submit_grade).toContain("C2. [example solutions] Label the axes");
    expect(sys.submit_grade).not.toContain("Only in stage 2");
    expect(sys.submit_grade).toContain("only your own knowledge");
    expect(sys.submit_grade).toContain("never by the topic"); // a Sale Law topic resting on a precedent does not rely on a statute
    expect(sys.submit_grade).toContain("judged ONLY by its \\\"met when\\\" line"); // the rest of the answer never moves met
    expect(msg.submit_grade).toContain("<student_answer>section 15</student_answer>");
    // the fact check saw the course's own solution, never the web file
    expect(msg.submit_fact_check).toContain("Under section 15");
    expect(msg.submit_fact_check).not.toContain("section 14, inform");
    expect(grade).toMatchObject({ score: 80, finalAnswerCorrect: true, summaryMd: "ok" });
    const att = (await events()).find((e) => e.type === "attempt_graded" && e.attemptId === attemptId)!;
    expect(att.type === "attempt_graded" && att.nodes).toEqual([{ id: CITE.id, score: 0 }]); // axes not triggered, not even through newNodes
  });

  it("a doubt the course files contradict is deducted and flips the final answer; a conflict only adds a note", async () => {
    replies.submit_fact_check = { results: [{ n: 1, verdict: "wrong", source: "sol.md, Q2", quote: "q", note: "The course says section 16." }] };
    const { grade } = await gradeAttempt(env, await loadCtx(N), ex, [], { hintsUsed: 0, solutionRevealed: false, context: "practice" });
    expect(grade).toMatchObject({ score: 70, finalAnswerCorrect: false });
    expect(grade.summaryMd).toContain("The course says section 16. (sol.md, Q2)");
    replies.submit_fact_check = { results: [{ n: 1, verdict: "conflict", source: "", quote: "", note: "The course files disagree." }] };
    const c = await gradeCheck(env, await loadCtx(N), { id: "q1", stageIds: ["S001"], questionMd: "q", expectedPoints: ["p"] }, "a", [], "practice");
    expect(c).toMatchObject({ score: 90, feedbackMd: "fine\n\nThe course files disagree." });
    expect((await events()).find((e) => e.type === "check_answered")).toMatchObject({ nodes: [{ id: CITE.id, score: 1 }] });
  });

  it("no course page matches the doubt: no fact-check call, no deduction", async () => {
    (replies.submit_grade as { disputed: unknown[] }).disputed = [{ ...dispute, claim: "zzz", believed: "qqq", queries: ["xyzzy"] }];
    const { grade } = await gradeAttempt(env, await loadCtx(N), ex, [], { hintsUsed: 0, solutionRevealed: false, context: "practice" });
    expect(calls).not.toContain("submit_fact_check");
    expect(grade.score).toBe(80);
  });

  it("a course page less relevant to the doubt than the grader's own key does not overrule it: no call, no deduction", async () => {
    replies.submit_fact_check = { results: [{ n: 1, verdict: "wrong", source: "sol.md, Q2", quote: "q", note: "n" }] };
    const key = { ...ex, referenceSolutionMd: "Notice of defect is section 14: the buyer must inform the seller of the defect, notice under section 14, not section 15." };
    const { grade } = await gradeAttempt(env, await loadCtx(N), key, [], { hintsUsed: 0, solutionRevealed: false, context: "practice" });
    expect(calls).not.toContain("submit_fact_check");
    expect(grade.score).toBe(80);
    // the course's solution outweighs a key that hardly speaks to the doubt: checked as before
    await gradeAttempt(env, await loadCtx(N), ex, [], { hintsUsed: 0, solutionRevealed: false, context: "practice", examples: "- Unrelated.\n  Solution: R" });
    expect(calls).toContain("submit_fact_check");
  });

  it("the eval's path: a typed answer to a question with no stage (homework) sees every convention and writes no events", async () => {
    const before = (await events()).length;
    await gradeAttempt(env, await loadCtx(N), { ...ex, stageIds: [], requiredStageIds: [] }, [], { hintsUsed: 0, solutionRevealed: false, context: "homework", answerText: "my answer" });
    expect(msg.submit_grade).toContain("The student's typed answer:");
    expect(msg.submit_grade).not.toContain("solution pages");
    expect(sys.submit_grade).toContain("Only in stage 2");
    expect((await events()).length).toBe(before);
  });

  it("a written solution follows the conventions whose use case occurs; homework gets every convention", async () => {
    await getSolution(env, await loadCtx(N), { ...ex, referenceSolutionMd: null, ref: { source: "index", id: "e2" } }, "practice");
    expect(sys.submit_solution).toContain("Cite the statute and section");
    expect(sys.submit_solution).toContain("none whose use case does not occur");
    await getSolution(env, await loadCtx(N), { ...ex, referenceSolutionMd: null, ref: { source: "index", id: "e3" }, stageIds: [], requiredStageIds: [] }, "homework");
    expect(sys.submit_solution).toContain("Only in stage 2");
  });
});
