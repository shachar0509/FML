// @vitest-environment node
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { expect, it } from "vitest";
import type { PracticeData } from "@/cards/types";
import { FakeClaudeGateway, toolCall } from "@/core/claude/fake";
import { setClaude } from "@/core/claude/runtime";
import { createCourse } from "@/core/domain/courses/courses";
import { EventSchema } from "@/core/domain/dataSchemas";
import { appendEvent } from "@/core/domain/progress/store";
import { readJsonlDir } from "@/core/lib/fs/jsonl";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { initNode } from "./platform";
import { createServer } from "./server";

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
});
