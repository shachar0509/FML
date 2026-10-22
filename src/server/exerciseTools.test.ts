// @vitest-environment node
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createCanvas } from "@napi-rs/canvas";
import { expect, it } from "vitest";
import type { ExerciseData, LessonData } from "@/cards/types";
import { FakeClaudeGateway, toolCall } from "@/core/claude/fake";
import { setClaude } from "@/core/claude/runtime";
import { createCourse } from "@/core/domain/courses/courses";
import { EventSchema } from "@/core/domain/dataSchemas";
import { readJsonlDir } from "@/core/lib/fs/jsonl";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { initNode } from "./platform";
import { createServer } from "./server";

const unit = (n: number) => ({ title: "u", summary: "s", stages: Array.from({ length: n }, (_, i) => ({ title: "t", kind: i % 2 ? "technique" : "concept", summary: "s", prerequisites: [] })) });
const details = (req: { messages: { content: unknown }[] }) =>
  toolCall("submit_unit_details", {
    stages: (/stage ids ([S\d, ]+)\./.exec(String(req.messages[0]?.content))?.[1]?.split(", ") ?? []).map((id) => ({
      id, objectives: ["first objective", "second objective"], newConcepts: [], theorems: [], techniques: [], edgeCases: [], examRelevance: "core", estimatedMinutes: 30,
    })),
  });
const sc = <T,>(r: { structuredContent?: unknown }) => r.structuredContent as T;
const text = (r: { content?: unknown }) => JSON.stringify(r.content);
const grade = {
  legibility: "clear", illegibleParts: [], verdict: "partially_correct", score: 70, finalAnswerCorrect: false, summaryMd: "ok", steps: [{ label: "s", status: "correct", commentMd: "c" }],
  missingForFullCredit: ["N"], mistakes: [{ tag: "Missing N", labelHe: "חסר", labelEn: "Missing N", description: "d", severity: "major", whereMd: "line 2" }],
  edgeCasesMissed: [], correctedKeyStepMd: "k", usesMaterialBeyondCompleted: [], stageIds: ["S001"],
};

it("exercise card: hints 1-3, upload, grade through the bridge, solution reveal, events", async () => {
  const d = await mkdtemp(join(tmpdir(), "shalav-"));
  Object.assign(process.env, { SHALAV_CONFIG_DIR: join(d, "c"), SHALAV_CACHE_DIR: join(d, "k"), SHALAV_DOCUMENTS_DIR: join(d, "d") });
  await writeFile(join(d, "cards.html"), "<html></html>");
  process.env.SHALAV_CARDS_HTML = join(d, "cards.html");
  await initNode();
  setClaude(new FakeClaudeGateway([toolCall("submit_plan_outline", { courseKind: "mixed", units: [unit(18), unit(18)] }), details, details]));
  await createCourse({ courseNumber: "01040195", nameHe: "קורס", credits: 2, faculty: "f", syllabusHe: "s", prerequisitesRaw: "" }, () => {});
  const n = "01040195";
  const events = () => readJsonlDir(coursePaths(useSettings.getState().settings.dataRoot, n).events, EventSchema);

  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([createServer().connect(a), client.connect(b)]);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  const tools = (await client.listTools()).tools;
  for (const t of ["exercise_state", "exercise_grade_request", "exercise_hint_request", "exercise_solution_request", "exercise_retry", "attachment_upload"])
    expect(tools.find((x) => x.name === t)?._meta).toMatchObject({ ui: { visibility: ["app"] } });
  expect(tools.map((x) => x.name)).toContain("assign_exercise");

  expect((await call("assign_exercise", { stageIds: ["S001"], source: "new", statementMd: "s", difficulty: 2, edgeCaseFocus: [] })).isError).toBe(true); // no lesson yet
  await call("shalav_start_lesson", { courseNumber: n });
  expect((await call("assign_exercise", { stageIds: ["S001"], source: "index", exerciseId: "nope", difficulty: 2, edgeCaseFocus: [] })).isError).toBe(true);
  const card = await call("assign_exercise", { stageIds: ["S001"], source: "new", statementMd: "Prove $x$.", referenceSolutionMd: "ref", difficulty: 2, edgeCaseFocus: [] });
  const ex = sc<ExerciseData>(card);
  expect(ex).toMatchObject({ view: "exercise", statementMd: "Prove $x$.", hints: [], grade: null, canReveal: false, busy: null });
  expect(JSON.stringify(card.structuredContent)).not.toContain("ref"); // the reference solution stays on the server
  const runId = ex.runId;

  // answer the job the card started (as the host model does)
  async function answer(input?: object, textAnswer?: string) {
    const job = await call("shalav_next_job");
    const id = Number(/# Shalav job #(\d+)/.exec(text(job))?.[1]);
    expect(id).toBeGreaterThan(0);
    return { job, res: await call("shalav_submit_job", { jobId: id, ...(input ? { input } : { text: textAnswer }) }) };
  }

  // hints: levels 1-3, a fourth is refused
  for (const level of [1, 2, 3]) {
    expect(sc<ExerciseData>(await call("exercise_hint_request", { runId, files: [] })).busy).toBe("hint");
    const { job, res } = await answer({ hintMd: `hint ${level}`, level, targetsStep: "s" });
    expect(text(job)).toContain(`level ${level}`);
    expect(text(res)).toContain("hint is shown");
  }
  expect((await call("exercise_hint_request", { runId, files: [] })).isError).toBe(true);
  expect(sc<ExerciseData>(await call("exercise_state", { runId }))).toMatchObject({ busy: null, canReveal: true, hints: [{ level: 1 }, { level: 2 }, { level: 3 }] });
  expect((await events()).filter((e) => e.type === "hint_requested").map((e) => (e as { level: number }).level)).toEqual([1, 2, 3]);

  // upload a photo, grade it through the bridge
  const png = createCanvas(40, 30).toBuffer("image/png").toString("base64");
  const up = sc<{ files: { sha256: string; mediaType: string }[] }>(await call("attachment_upload", { number: n, name: "w.png", mime: "image/png", base64: png }));
  expect(up.files).toHaveLength(1);
  expect((await call("attachment_upload", { number: n, name: "w.txt", mime: "text/plain", base64: "aGk=" })).isError).toBe(true);
  expect((await call("exercise_grade_request", { runId, files: [] })).isError).toBe(true);
  await call("exercise_grade_request", { runId, files: up.files });
  const { job, res } = await answer(grade);
  expect(JSON.stringify((job.content as { type: string }[]).map((c) => c.type))).toContain("image"); // the solution page goes to the host model
  expect(text(res)).toContain("Graded");
  expect(text(res)).toContain("update_assessment");
  const st = sc<ExerciseData>(await call("exercise_state", { runId }));
  expect(st.grade).toMatchObject({ verdict: "partially_correct", score: 70 });
  const ev = await events();
  expect(ev.filter((e) => e.type === "attempt_graded")).toMatchObject([{ verdict: "partially_correct", score: 70, hintsUsed: 3, context: "learn", attachmentHashes: [up.files[0]?.sha256] }]);
  expect(ev.filter((e) => e.type === "mistake_tag_defined")).toHaveLength(1);

  // solution: the model-written solution is cached; reveal is an event
  await call("exercise_solution_request", { runId });
  expect(text(await call("shalav_next_job"))).toContain("No Shalav job"); // the reference solution exists: no job is parked
  expect(sc<ExerciseData>(await call("exercise_state", { runId }))).toMatchObject({ solutionMd: "ref", busy: null });
  expect((await events()).filter((e) => e.type === "solution_revealed")).toHaveLength(1);

  expect(sc<ExerciseData>(await call("exercise_retry", { runId })).grade).toBeNull();
  expect((await call("exercise_state", { runId: "gone" })).isError).toBe(true);
  expect(sc<LessonData>(await call("lesson_state", { number: n, stageId: "S001" })).view).toBe("lesson");

  // M56 solving loop: a hard exercise of an advanced stage (S002 is a technique) opens with clues instead of hints
  expect(sc<ExerciseData>(await call("assign_exercise", { stageIds: ["S001"], source: "new", statementMd: "q", difficulty: 4, edgeCaseFocus: [] })).loop).toBe(false); // an intro stage keeps the hints
  const lp = sc<ExerciseData>(await call("assign_exercise", { stageIds: ["S002"], source: "new", statementMd: "Hard $y$.", referenceSolutionMd: "ref2", difficulty: 4, edgeCaseFocus: [] }));
  expect(lp).toMatchObject({ loop: true, clues: [], clueOpen: false, perfect: false });
  const r = lp.runId;
  expect((await call("exercise_clarify_request", { runId: r })).isError).toBe(true); // nothing to explain yet
  expect(sc<ExerciseData>(await call("exercise_clue_request", { runId: r, files: up.files })).busy).toBe("clue");
  let j = await answer({ onTrack: true, clueMd: "think of N" });
  expect(text(j.job)).toContain("ONE small clue");
  expect(text(j.job)).toContain("image"); // the work so far is checked
  for (const m of ["say it simpler", "simplest"]) {
    await call("exercise_clarify_request", { runId: r });
    j = await answer({ onTrack: true, clueMd: m });
    expect(text(j.job)).toContain("think of N");
  }
  expect(sc<ExerciseData>(await call("exercise_state", { runId: r }))).toMatchObject({ clueOpen: true, clues: [{ onTrack: true, clueMd: "think of N", more: ["say it simpler", "simplest"] }] });
  expect(sc<ExerciseData>(await call("exercise_clue_done", { runId: r }))).toMatchObject({ clueOpen: false });
  // 96 with a wrong final answer is not perfect; 96 with every final answer right is
  for (const [finalAnswerCorrect, ok] of [[false, false], [true, true]] as const) {
    await call("exercise_grade_request", { runId: r, files: up.files });
    j = await answer({ ...grade, verdict: "correct", score: 96, finalAnswerCorrect, mistakes: [], stageIds: ["S002"] });
    expect(text(j.job)).toContain("finalAnswerCorrect");
    expect(sc<ExerciseData>(await call("exercise_state", { runId: r })).perfect).toBe(ok);
  }
});
