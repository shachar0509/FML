/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { beforeEach, describe, expect, it } from "vitest";
import { usage0 } from "@/core/claude/fake";
import type { ClaudeGateway, ClaudeRequest } from "@/core/claude/types";
import { EventSchema, type FileIndex, PlanJsonSchema } from "@/core/domain/dataSchemas";
import { writeFileIndex } from "@/core/domain/ingest/indexStore";
import { setDeviceId } from "@/core/lib/device";
import { writeJsonAtomic } from "@/core/lib/fs/atomicWrite";
import { setFs } from "@/core/lib/fs/fs";
import { readJsonlDir } from "@/core/lib/fs/jsonl";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { memFs } from "@/test/memfs";
import { loadCtx, type Ex } from "./exercises";
import { gradeAttempt, gradeCheck } from "./grade";

/** M73: a doubt from the grader's outside knowledge about a course fact is settled by the course's own files. */
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
  // the course's own solution says section 15; Shalav's own web file says 14 and must never decide
  await writeFileIndex(N, rec("sol", { role: "exercises", exercises: [{ id: "x1", label: "Q2", pages: [1], statementMd: "A laptop is faulty.", figureCrops: [], referenceSolutionMd: "Under section 15 the buyer must inform the seller within a reasonable time.", requiredStageIds: ["S002"], primaryStageId: "S002", difficulty: 3, type: "short_answer", estimatedMinutes: 5, edgeCaseFocus: [], gist: "g" }] }));
  await writeFileIndex(N, rec("web", { origin: "web", materialPages: [page("Notice of defect: section 14, inform the seller.")] }));
  await writeFileIndex(N, rec("mat", { materialPages: [page("Unrelated stage-one page about axes.", ["S001"])] }));
  Object.assign(replies, {
    submit_grade: {
      legibility: "clear", illegibleParts: [], verdict: "partially_correct", score: 80, finalAnswerCorrect: true, summaryMd: "ok", steps: [], missingForFullCredit: [],
      mistakes: [], edgeCasesMissed: [], correctedKeyStepMd: "", usesMaterialBeyondCompleted: [], stageIds: ["S001"],
      nodeResults: [], newNodes: [],
      disputed: [dispute],
    },
    submit_check_grade: { correct: true, score: 90, feedbackMd: "fine", mistakes: [], disputed: [dispute] },
    submit_fact_check: { results: [{ n: 1, verdict: "right", source: "sol.md, Q2", quote: "Under section 15", note: "n" }] },
    submit_solution: { solutionMd: "S" },
  });
});

describe("M73 course facts: the course files settle the grader's doubts", () => {
  it("a doubt the course files confirm costs nothing; the fact check reads the course's own files, never Shalav's web file", async () => {
    const { grade } = await gradeAttempt(env, await loadCtx(N), ex, [], { hintsUsed: 0, solutionRevealed: false, context: "practice", answerText: "section 15" });
    expect(sys.submit_grade).toContain("only your own knowledge");
    expect(msg.submit_grade).toContain("<student_answer>section 15</student_answer>");
    // the fact check saw the course's own solution, never the web file
    expect(msg.submit_fact_check).toContain("Under section 15");
    expect(msg.submit_fact_check).not.toContain("section 14, inform");
    expect(grade).toMatchObject({ score: 80, finalAnswerCorrect: true, summaryMd: "ok" });
  });

  it("a doubt the course files contradict is deducted and flips the final answer; a conflict only adds a note", async () => {
    replies.submit_fact_check = { results: [{ n: 1, verdict: "wrong", source: "sol.md, Q2", quote: "q", note: "The course says section 16." }] };
    const { grade } = await gradeAttempt(env, await loadCtx(N), ex, [], { hintsUsed: 0, solutionRevealed: false, context: "practice" });
    expect(grade).toMatchObject({ score: 70, finalAnswerCorrect: false });
    expect(grade.summaryMd).toContain("The course says section 16. (sol.md, Q2)");
    replies.submit_fact_check = { results: [{ n: 1, verdict: "conflict", source: "", quote: "", note: "The course files disagree." }] };
    const c = await gradeCheck(env, await loadCtx(N), { id: "q1", stageIds: ["S001"], questionMd: "q", expectedPoints: ["p"] }, "a", [], "practice");
    expect(c).toMatchObject({ score: 90, feedbackMd: "fine\n\nThe course files disagree." });
    expect(sys.submit_check_grade).toContain("only your own knowledge");
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

  it("a typed answer to a homework question is framed as typed and writes no events", async () => {
    const before = (await events()).length;
    await gradeAttempt(env, await loadCtx(N), { ...ex, stageIds: [], requiredStageIds: [] }, [], { hintsUsed: 0, solutionRevealed: false, context: "homework", answerText: "my answer" });
    expect(msg.submit_grade).toContain("The student's typed answer:");
    expect(msg.submit_grade).not.toContain("solution pages");
    expect((await events()).length).toBe(before);
  });
});
