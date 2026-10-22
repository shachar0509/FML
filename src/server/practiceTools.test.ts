// @vitest-environment node
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { readFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import { expect, it, vi } from "vitest";
import type { ExerciseData, PracticeData } from "@/cards/types";
import { FakeClaudeGateway, toolCall } from "@/core/claude/fake";
import { setClaude } from "@/core/claude/runtime";
import { createCourse } from "@/core/domain/courses/courses";
import { nodeId } from "@/core/domain/knowledge/graph";
import { EventSchema } from "@/core/domain/dataSchemas";
import { appendEvent } from "@/core/domain/progress/store";
import { readJsonlDir } from "@/core/lib/fs/jsonl";
import { writeJsonAtomic } from "@/core/lib/fs/atomicWrite";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { initNode } from "./platform";
import { createServer } from "./server";

// M57: the Save as dialog picks this path ("" = cancelled)
const saveTo = vi.hoisted(() => ({ path: "" }));
vi.mock("./native", async (orig) => ({ ...(await orig<typeof import("./native")>()), saveDialog: async () => saveTo.path || null }));
// M58: printing needs Shalav's Chromium; here the HTML itself is the "PDF"
vi.mock("./pdf", async (orig) => ({ ...(await orig<typeof import("./pdf")>()), htmlToPdf: async (html: string) => Buffer.from(`%PDF ${html}`) }));

const unit = (n: number) => ({ title: "u", summary: "s", stages: Array.from({ length: n }, () => ({ title: "t", kind: "concept", summary: "s", prerequisites: [] })) });
const details = (req: { messages: { content: unknown }[] }) =>
  toolCall("submit_unit_details", {
    stages: (/stage ids ([S\d, ]+)\./.exec(String(req.messages[0]?.content))?.[1]?.split(", ") ?? []).map((id) => ({
      id, objectives: ["first objective", "second objective"], newConcepts: [], theorems: [], techniques: [], edgeCases: [], examRelevance: "core", estimatedMinutes: 30,
    })),
  });
const sc = <T,>(r: { structuredContent?: unknown }) => r.structuredContent as T;
const text = (r: { content?: unknown }) => JSON.stringify(r.content);
const answers: Record<string, unknown> = {
  submit_generated_exercise: { statementMd: "Prove P", referenceSolutionMd: "R", requiredStageIds: ["S001"], difficulty: 3, type: "proof", estimatedMinutes: 10, edgeCaseFocus: [], gradingNotes: "n" },
  submit_verification: { wellPosed: true, solvable: true, independentSolutionMd: "R", matchesReference: true, requiresStagesBeyond: [], issues: [] },
  submit_practice_check: { items: [
    { kind: "mcq", stageIds: ["S001"], questionMd: "q1", options: ["a", "b", "c", "d"], correctIndex: 2, explanationMd: "because" },
    { kind: "mcq", stageIds: ["S001"], questionMd: "q2", options: ["a", "b", "c", "d"], correctIndex: 0, explanationMd: "e" },
    { kind: "open", stageIds: ["S001"], questionMd: "q3", explanationMd: "e", expectedPoints: ["p"] },
    { kind: "open", stageIds: ["S001"], questionMd: "q4", explanationMd: "e", expectedPoints: ["p"] },
  ] },
  submit_check_grade: { correct: true, score: 90, feedbackMd: "good", mistakes: [] },
};

it("practice card: scope, generated exercise through the bridge, MCQ, open answer, summary", async () => {
  const d = await mkdtemp(join(tmpdir(), "shalav-"));
  Object.assign(process.env, { SHALAV_CONFIG_DIR: join(d, "c"), SHALAV_CACHE_DIR: join(d, "k"), SHALAV_DOCUMENTS_DIR: join(d, "d") });
  await writeFile(join(d, "cards.html"), "<html></html>");
  process.env.SHALAV_CARDS_HTML = join(d, "cards.html");
  await initNode();
  setClaude(new FakeClaudeGateway([toolCall("submit_plan_outline", { courseKind: "mixed", units: [unit(18), unit(18)] }), details, details]));
  await createCourse({ courseNumber: "01040195", nameHe: "קורס", credits: 2, faculty: "f", syllabusHe: "s", prerequisitesRaw: "" }, () => {});
  const n = "01040195";

  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([createServer().connect(a), client.connect(b)]);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  const tools = (await client.listTools()).tools;
  expect(tools.find((x) => x.name === "shalav_practice")?._meta).not.toMatchObject({ ui: { visibility: ["app"] } });
  for (const t of ["practice_state", "practice_start_request", "practice_next_request", "practice_answer_mcq", "practice_answer_open_request", "practice_end"])
    expect(tools.find((x) => x.name === t)?._meta).toMatchObject({ ui: { visibility: ["app"] } });

  // nothing completed yet
  expect(sc<PracticeData>(await call("shalav_practice", { courseNumber: n }))).toMatchObject({ view: "practice", mode: "locked" });
  await appendEvent(n, { type: "stage_completed", stageId: "S001", by: "mastery", masteryAtCompletion: 0.9 });
  // M63: the item mix follows the student's control of S001: about half = level 3, the classic E-E-M-E-O cycle
  for (let i = 0; i < 12; i++) await appendEvent(n, { type: "node_observed", nodeId: nodeId("S001", "concept", "t"), score: 0.5, why: "w", context: "learn" });
  const chooser = sc<PracticeData>(await call("shalav_practice", { courseNumber: n }));
  expect(chooser).toMatchObject({ mode: "choose", stages: [{ id: "S001" }] });

  /** Answer the host jobs of the running op like Claude would. */
  async function work(first: unknown) {
    expect(sc<PracticeData>(first as never).loading).toBe(true);
    const names: string[] = [];
    let t = text(await call("shalav_next_job"));
    for (let i = 0; i < 8; i++) {
      const m = /# Shalav job #(\d+)/.exec(t);
      if (!m) break;
      const name = /\(tool (\w+)\)/.exec(t)?.[1] as string;
      names.push(name);
      t = text(await call("shalav_submit_job", { jobId: Number(m[1]), input: answers[name] as object }));
    }
    return names;
  }

  const started = await call("practice_start_request", { courseNumber: n, scope: { kind: "all" } });
  expect(await work(started)).toEqual(["submit_generated_exercise", "submit_verification"]);
  const e1 = sc<PracticeData>(await call("practice_state", { courseNumber: n }));
  expect(e1).toMatchObject({ mode: "item", loading: false, item: { kind: "E", exercise: { view: "exercise", statementMd: "Prove P", grade: null } } });
  expect(JSON.stringify(e1)).not.toContain('"R"'); // reference solution stays server-side
  // the embedded exercise card runs through the exercise tools
  const runId = (e1.item as { exercise: { runId: string } }).exercise.runId;
  expect(sc<{ statementMd: string }>(await call("exercise_state", { runId })).statementMd).toBe("Prove P");

  // item 2 = E (generated again), item 3 = M
  await work(await call("practice_next_request", { courseNumber: n }));
  const third = await call("practice_next_request", { courseNumber: n });
  expect(await work(third)).toEqual(["submit_practice_check"]);
  const m = sc<PracticeData>(await call("practice_state", { courseNumber: n }));
  expect(m.item).toMatchObject({ kind: "M", questionMd: "q1", selected: null, correctIndex: null, explanationMd: null }); // no key before answering
  const ans = sc<PracticeData>(await call("practice_answer_mcq", { courseNumber: n, selected: 2 }));
  expect(ans.item).toMatchObject({ selected: 2, correctIndex: 2, explanationMd: "because" });
  expect(ans.counters).toMatchObject({ answered: 1, correct: 1 });

  // item 4 = E (may need jobs), item 5 = O from the batch; its answer is graded through a bridge job
  for (const i of [4, 5]) {
    const r = await call("practice_next_request", { courseNumber: n });
    if (sc<PracticeData>(r).loading) await work(r);
    expect(sc<PracticeData>(await call("practice_state", { courseNumber: n })).item?.kind).toBe(i === 4 ? "E" : "O");
  }
  const graded = await call("practice_answer_open_request", { courseNumber: n, text: "my answer" });
  expect(await work(graded)).toEqual(["submit_check_grade"]);
  expect(sc<PracticeData>(await call("practice_state", { courseNumber: n })).item).toMatchObject({ kind: "O", answer: "my answer", result: { correct: true, score: 90 } });

  const sum = sc<PracticeData>(await call("practice_end", { courseNumber: n }));
  expect(sum).toMatchObject({ mode: "summary", summary: { items: 2, avgScore: 95 } });
  expect((await call("practice_end", { courseNumber: n })).isError).toBe(true);
  const ev = await readJsonlDir(coursePaths(useSettings.getState().settings.dataRoot, n).events, EventSchema);
  expect(ev.filter((e) => e.type === "check_answered")).toHaveLength(2);

  // ----- M57: homework with the tutor -----
  const upload = async (name: string) => sc<{ files: { sha256: string; mediaType: string }[] }>(await call("attachment_upload", { number: n, name, mime: "image/png", base64: createCanvas(60, 80 + name.length).toBuffer("image/png").toString("base64") })).files;
  const pages = [...(await upload("p1.png")), ...(await upload("p22.png"))];
  let ahead = ""; // a submit's answer may already carry the op's next job
  async function job(input: object) {
    const t = ahead || text(await call("shalav_next_job"));
    const id = Number(/# Shalav job #(\d+)/.exec(t)?.[1]);
    expect(id).toBeGreaterThan(0);
    const r = text(await call("shalav_submit_job", { jobId: id, input }));
    ahead = r.includes("# Shalav job #") ? r : "";
    return t;
  }
  const hs = sc<PracticeData>(await call("homework_start", { courseNumber: n, kind: "homework", files: pages }));
  expect(hs.hw).toMatchObject({ kind: "homework", how: null, splitting: true, questions: [] });
  const read = await job({ name: "HW 3", questions: [{ label: "Q1", statementMd: "Show A", pages: [1] }, { label: "Q2", statementMd: "Show B", pages: [2, 9] }, { label: "Q3", statementMd: "Show C", pages: [2] }] });
  expect(read).toContain("submit_homework");
  expect(read).toContain("image"); // the pages go to the host model
  let hw = sc<PracticeData>(await call("practice_state", { courseNumber: n })).hw;
  expect(hw).toMatchObject({ name: "HW 3", splitting: false, exercise: null, questions: [{ label: "Q1", accepted: false }, { label: "Q2" }, { label: "Q3" }] });
  hw = sc<PracticeData>(await call("homework_how", { courseNumber: n, how: "tutor" })).hw;
  const q1 = hw?.exercise as ExerciseData;
  expect(q1).toMatchObject({ loop: true, statementMd: "Show A", figures: [expect.stringContaining("data:image/jpeg")] }); // its page is shown with it
  expect((await call("homework_download", { courseNumber: n })).isError).toBe(true); // nothing solved yet
  const before = (await readJsonlDir(coursePaths(useSettings.getState().settings.dataRoot, n).events, EventSchema)).length;
  const sol = await upload("mine.png");
  const g = { legibility: "clear", illegibleParts: [], verdict: "correct", score: 96, summaryMd: "ok", steps: [], missingForFullCredit: [], mistakes: [], edgeCasesMissed: [], correctedKeyStepMd: "", usesMaterialBeyondCompleted: [], stageIds: [] };
  await call("exercise_grade_request", { runId: q1.runId, files: sol });
  await job({ ...g, finalAnswerCorrect: false }); // a wrong final answer is not accepted
  expect(sc<PracticeData>(await call("practice_state", { courseNumber: n })).hw?.questions[0]?.accepted).toBe(false);
  await call("exercise_grade_request", { runId: q1.runId, files: sol });
  const gj = await job({ ...g, finalAnswerCorrect: true });
  expect(gj).toContain("Show A");
  expect(gj).not.toContain("KNOWLEDGE BOUNDARY"); // homework follows the course, not Shalav progress
  expect(sc<PracticeData>(await call("practice_state", { courseNumber: n })).hw?.questions.map((q) => q.accepted)).toEqual([true, false, false]);
  expect((await readJsonlDir(coursePaths(useSettings.getState().settings.dataRoot, n).events, EventSchema)).length).toBe(before); // homework moves no mastery
  expect(sc<PracticeData>(await call("homework_open", { courseNumber: n, index: 2 })).hw?.exercise).toMatchObject({ statementMd: "Show C", grade: null });
  // download: cancelled, then saved where the student picked; the PDF holds their own page
  expect(text(await call("homework_download", { courseNumber: n }))).toContain("cancelled");
  saveTo.path = join(d, "out.pdf");
  expect(sc<PracticeData>(await call("homework_download", { courseNumber: n })).hw?.saved).toBe(saveTo.path);
  const pdf = (await readFile(saveTo.path)).toString("latin1");
  expect(pdf.match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
  // a single question; starting it ends the homework
  const single = sc<PracticeData>(await call("homework_start", { courseNumber: n, kind: "single", files: [pages[0]] }));
  expect(single.hw).toMatchObject({ kind: "single", how: "tutor", splitting: true });
  await job({ name: "q", questions: [{ label: "1", statementMd: "Only", pages: [1] }, { label: "2", statementMd: "dropped", pages: [1] }] });
  expect(sc<PracticeData>(await call("practice_state", { courseNumber: n })).hw).toMatchObject({ questions: [{ label: "1" }], exercise: { statementMd: "Only", loop: true } });
  expect(sc<PracticeData>(await call("homework_end", { courseNumber: n })).hw).toBeNull();

  // ----- M58: the AI solves the homework -----
  await call("homework_start", { courseNumber: n, kind: "homework", files: pages });
  await job({ name: "HW 4", questions: [{ label: "Q1", statementMd: "Show A", pages: [1] }, { label: "Q2", statementMd: "Show B", pages: [2] }] });
  const ai = sc<PracticeData>(await call("homework_how", { courseNumber: n, how: "ai" })).hw;
  expect(ai).toMatchObject({ how: "ai", solving: { step: "solve", done: 0, total: 2 }, ready: false, exercise: null });
  for (const [k, sol] of [["Show A", "Solution $a$"], ["Show B", "Solution B"]]) {
    const t = await job({ solutionMd: sol });
    expect(t).toContain(`<exercise>${k}</exercise>`);
    expect(t).toContain("image"); // the question's page
  }
  await vi.waitFor(async () => expect(sc<PracticeData>(await call("practice_state", { courseNumber: n })).hw).toMatchObject({ solving: null, ready: true, questions: [{ accepted: true }, { accepted: true }] }));
  saveTo.path = join(d, "ai.pdf");
  await call("homework_download", { courseNumber: n });
  const printed = (await readFile(saveTo.path)).toString();
  for (const x of ["HW 4", "Q2", "Show B", "Solution B", "<math"]) expect(printed).toContain(x);

  // ----- M59: test practice -----
  const cp = coursePaths(useSettings.getState().settings.dataRoot, n);
  const q = (id: string, label: string, stage: string, statementMd: string, sol: string | null = null) => ({
    id, label, pages: [1], statementMd, figureCrops: [], referenceSolutionMd: sol, requiredStageIds: [stage], primaryStageId: stage, difficulty: 4, type: "proof", estimatedMinutes: 20, edgeCaseFocus: [], gist: "g",
  });
  const exam = (sha: string, fileName: string, exercises: object[]) => writeJsonAtomic(cp.indexFile(sha), {
    schema: 1, sha256: sha, fileName, relPath: `x/${fileName}`, role: "exercises", mediaType: "application/pdf", pageCount: 2, addedAt: "2026-01-01T00:00:00Z",
    status: "indexed", error: null, indexedAt: "2026-01-01T00:00:00Z", indexModel: null, planVersion: 1, materialPages: [], exercises,
  });
  await exam("e1", "Spring2020MoedA.pdf", [q("m1", "1", "S001", "Exam Q1"), q("m2", "2", "S001", "Exam Q2"), q("m3", "3", "S002", "Exam Q3")]);
  await exam("e2", "Spring2020MoedA_sol.pdf", [q("s1", "שאלה 1", "S001", "Exam Q1", "Sol 1")]);
  await exam("e3", "HW2.pdf", [q("h1", "1", "S001", "Homework Q")]);
  expect(sc<PracticeData>(await call("practice_state", { courseNumber: n })).test).toMatchObject({ exams: 3, left: 3, active: false });
  const bad = { ...g, verdict: "partially_correct", score: 50, finalAnswerCorrect: false };
  const testItem = async () => {
    const st = sc<PracticeData>(await call("practice_state", { courseNumber: n }));
    return { st, ex: (st.item as { exercise: ExerciseData }).exercise };
  };
  const miss = async (ex: ExerciseData) => {
    await call("exercise_grade_request", { runId: ex.runId, files: sol });
    const gj = await job(bad);
    expect(gj).not.toContain("KNOWLEDGE BOUNDARY"); // exams cover the whole course
  };
  ahead = "";
  await call("practice_start_request", { courseNumber: n, scope: { kind: "test", stageIds: ["S001"] } });
  let cur = await testItem();
  expect(cur.st.test).toMatchObject({ active: true, left: 1, note: null });
  const first = cur.ex.statementMd;
  expect(["Exam Q1", "Exam Q2"]).toContain(first);
  const burned = () => readFile(join(cp.shalav, "test-practice.json"), "utf8").then((x) => JSON.parse(x) as { burned: { file: string; question: string }[]; concepts: Record<string, { status: string | null; streak: number }> });
  expect((await burned()).burned).toEqual([expect.objectContaining({ file: first === "Exam Q1" ? "Spring2020MoedA_sol.pdf" : "Spring2020MoedA.pdf" })]); // the twin with the solution
  // a miss: the stern note and the other S001 exam question
  await miss(cur.ex);
  await call("practice_next_request", { courseNumber: n });
  cur = await testItem();
  expect(cur.st.test).toMatchObject({ note: "stern", left: 0, noteStage: { id: "S001" } });
  expect(cur.ex.statementMd).toBe(first === "Exam Q1" ? "Exam Q2" : "Exam Q1");
  // a second miss, no S001 exam question left: a new one like the missed question, verified
  await miss(cur.ex);
  const gen = await call("practice_next_request", { courseNumber: n });
  const genJobs: string[] = [];
  let gt = text(await call("shalav_next_job"));
  for (let i = 0; i < 4 && /# Shalav job #(\d+)/.test(gt); i++) {
    genJobs.push(gt);
    gt = text(await call("shalav_submit_job", { jobId: Number(/# Shalav job #(\d+)/.exec(gt)?.[1]), input: answers[/\(tool (\w+)\)/.exec(gt)?.[1] as string] as object }));
  }
  expect(sc<PracticeData>(gen).loading).toBe(true);
  expect(genJobs[0]).toContain("same concept");
  expect(genJobs[0]).toContain(first);
  expect(genJobs[1]).toContain("submit_verification");
  cur = await testItem();
  expect(cur.st.test).toMatchObject({ note: "stern" });
  expect(cur.ex.statementMd).toBe("Prove P");
  // the third miss ends the follow-ups: the concept is noted as weak
  await miss(cur.ex);
  const after3 = await call("practice_next_request", { courseNumber: n });
  if (sc<PracticeData>(after3).loading) await work(after3);
  cur = await testItem();
  expect(cur.st.test).toMatchObject({ note: "weak", weak: [{ id: "S001" }] });
  const store = await burned();
  expect(store.burned).toHaveLength(2);
  expect(store.concepts.S001?.status).toBe("weak");
  // the last answer counts when the session ends (once)
  await call("exercise_grade_request", { runId: cur.ex.runId, files: sol });
  await job({ ...g, finalAnswerCorrect: true });
  await call("practice_end", { courseNumber: n });
  expect((await burned()).concepts.S001).toMatchObject({ status: "weak", streak: 1 });
  // quiz notes: the host model picks the stages
  ahead = "";
  await call("test_scope_request", { courseNumber: n, files: [pages[0]] });
  const nj = await job({ stageIds: ["S002", "S999"] });
  expect(nj).toContain("submit_test_scope");
  expect(nj).toContain("image");
  expect(sc<PracticeData>(await call("practice_state", { courseNumber: n })).test.notes).toEqual([{ id: "S002", title: expect.any(String) }]);

  // ----- M60: every practice session is saved and listed by type; an ended one continues -----
  const list = async () => sc<{ items: { id: string; type: string; title: string }[] }>(await call("history_list", { number: n, kind: "practice" })).items;
  const saved = await list();
  expect(saved.map((x) => x.type).sort()).toEqual(["homework", "homework", "normal", "single", "test"]);
  expect(saved.find((x) => x.type === "homework")).toMatchObject({ title: "HW 4" }); // the newest first
  const normal = saved.find((x) => x.type === "normal")?.id as string;
  const res = await call("practice_resume", { courseNumber: n, id: normal });
  if (sc<PracticeData>(res).loading) await work(res);
  const back = sc<PracticeData>(await call("practice_state", { courseNumber: n }));
  expect(back).toMatchObject({ mode: "item", hw: null, item: { kind: "O", answer: "my answer" } }); // where it ended
  expect((await list())[0]?.id).toBe(normal);
  // a homework comes back with its questions
  const hw3 = saved.filter((x) => x.type === "homework")[1]?.id as string;
  expect(sc<PracticeData>(await call("practice_resume", { courseNumber: n, id: hw3 })).hw).toMatchObject({ name: "HW 3", questions: [{ label: "Q1", accepted: true }, {}, {}] });
  // deleting the running ones ends them
  await call("history_delete", { number: n, kind: "practice", ids: [normal, hw3] });
  expect(sc<PracticeData>(await call("practice_state", { courseNumber: n }))).toMatchObject({ hw: null, item: null });
  expect(await list()).toHaveLength(3);
  // ...and stay deleted after a restart (the device's session log still has the normal one running)
  const [a3, b3] = InMemoryTransport.createLinkedPair();
  const c3 = new Client({ name: "t3", version: "0" });
  await Promise.all([createServer().connect(a3), c3.connect(b3)]);
  expect(sc<PracticeData>(await c3.callTool({ name: "practice_state", arguments: { courseNumber: n } }))).toMatchObject({ item: null, hw: null });
  expect(sc<{ items: unknown[] }>(await c3.callTool({ name: "history_list", arguments: { number: n, kind: "practice" } })).items).toHaveLength(3);
});
