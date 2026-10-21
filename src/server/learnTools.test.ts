// @vitest-environment node
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { expect, it } from "vitest";
import type { LessonData, McqData } from "@/cards/types";
import { FakeClaudeGateway, toolCall } from "@/core/claude/fake";
import { setClaude } from "@/core/claude/runtime";
import { createCourse } from "@/core/domain/courses/courses";
import { EventSchema } from "@/core/domain/dataSchemas";
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

it("runs a lesson: start, questions, events, status, completion, reopen + recap", async () => {
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
  for (const t of ["check_answer", "lesson_state", "stage_complete", "stage_reopen"]) expect(tools.find((x) => x.name === t)?._meta).toMatchObject({ ui: { visibility: ["app"] } });
  for (const t of ["shalav_start_lesson", "shalav_lesson_status", "present_mcq", "ask_open_question", "record_check_result", "update_assessment", "consult_materials"]) expect(tools.map((x) => x.name)).toContain(t);

  // tutor tools need an open lesson
  expect((await call("shalav_lesson_status")).isError).toBe(true);

  const start = await call("shalav_start_lesson", { courseNumber: n });
  expect(text(start)).toContain("[STATUS]");
  expect(text(start)).toContain("shalav_lesson_status");
  expect(text(start)).not.toContain("[START_LESSON]");
  expect(text(start)).not.toContain("RECAP (the student"); // nothing to recap yet
  expect(sc<LessonData>(start)).toMatchObject({ view: "lesson", stageId: "S001", status: "in_progress" });
  expect((await events()).filter((e) => e.type === "stage_started")).toHaveLength(1);
  expect(sc<LessonData>(await call("lesson_state", { number: n, stageId: "S001" })).status).toBe("in_progress");
  await call("shalav_start_lesson", { courseNumber: n });
  expect((await events()).filter((e) => e.type === "stage_started")).toHaveLength(1); // not repeated
  expect((await call("shalav_start_lesson", { courseNumber: n, stageId: "S999" })).isError).toBe(true); // unknown stage

  // multiple choice: the key stays on the server, the answer is recorded once
  const q = await call("present_mcq", { stageId: "S001", questionMd: "q", options: ["a", "b", "c"], correctIndex: 0, explanationMd: "because", conceptTags: [] });
  expect(sc<McqData>(q)).toMatchObject({ view: "mcq", options: ["a", "b", "c"] });
  expect(JSON.stringify(q.structuredContent)).not.toMatch(/correctIndex|because/);
  const checkId = sc<McqData>(q).checkId;
  const wrong = sc<{ correct: boolean; correctIndex: number; explanationMd: string }>(await call("check_answer", { checkId, selectedIndex: 2 }));
  expect(wrong).toMatchObject({ correct: false, correctIndex: 0, explanationMd: "because" });
  await call("check_answer", { checkId, selectedIndex: 0 }); // second press does not re-record
  expect((await events()).filter((e) => e.type === "check_answered")).toMatchObject([{ kind: "mcq", correct: false, score: 0 }]);
  expect((await call("check_answer", { checkId: "nope", selectedIndex: 0 })).isError).toBe(true);
  expect((await call("present_mcq", { stageId: "S001", questionMd: "q", options: ["a", "b"], correctIndex: 5, explanationMd: "", conceptTags: [] })).isError).toBe(true);

  const tag = { tag: "Sign Error", labelHe: "שגיאת סימן", labelEn: "Sign error", description: "d" };
  await call("record_check_result", { checkToolUseId: checkId, correct: false, score: 0, mistakes: [tag] });
  let ev = await events();
  expect(ev.filter((e) => e.type === "mistake_tag_defined")).toMatchObject([{ tag: "sign-error" }]);
  expect(ev.filter((e) => e.type === "mistake_observed")).toMatchObject([{ tag: "sign-error", stageIds: ["S001"], refId: checkId }]);
  expect(ev.filter((e) => e.type === "check_answered")).toHaveLength(1); // MCQ result adds mistakes only

  // open question: recorded by record_check_result
  const oq = await call("ask_open_question", { stageId: "S001", questionMd: "why?", expectedPoints: ["x"], allowAttachment: false });
  const oid = sc<{ checkId: string }>(oq).checkId;
  await call("record_check_result", { checkToolUseId: oid, correct: true, score: 90, mistakes: [tag] });
  ev = await events();
  expect(ev.filter((e) => e.type === "mistake_tag_defined")).toHaveLength(1); // tag reused
  expect(ev.filter((e) => e.type === "check_answered").at(-1)).toMatchObject({ kind: "open", correct: true, score: 90, mistakeTags: ["sign-error"] });

  // assessment -> criteria + status
  const as = await call("update_assessment", { stageId: "S001", mastery: 0.6, coveredObjectives: [0], gaps: ["limits"], reviewTopics: [], readyToAdvance: false, rationale: "halfway" });
  expect(JSON.parse(((as.content as { text: string }[])[0] as { text: string }).text)).toMatchObject({ ok: true, advanceCriteriaMet: false });
  expect(text(await call("shalav_lesson_status"))).toMatch(/covered objectives 0.*gaps limits/);
  expect(sc<LessonData>(await call("lesson_state", { number: n, stageId: "S001" }))).toMatchObject({ objectives: [{ covered: true }, { covered: false }] });

  expect(text(await call("consult_materials", { question: "limit", purpose: "definition", stageId: "S001" }))).toContain("No indexed");

  // completion: mastery needs the criteria, override does not
  expect((await call("stage_complete", { number: n, stageId: "S001", by: "mastery" })).isError).toBe(true);
  expect(sc<LessonData>(await call("stage_complete", { number: n, stageId: "S001", by: "user_override" })).status).toBe("completed_override");
  expect(text(await call("shalav_start_lesson", { courseNumber: n, stageId: "S001" }))).toContain("already completed");

  // reopen: relearn with a recap built from the events
  expect(sc<LessonData>(await call("stage_reopen", { number: n, stageId: "S001" })).status).toBe("in_progress");
  const again = text(await call("shalav_start_lesson", { courseNumber: n, stageId: "S001" }));
  expect(again).toContain("RECAP");
  expect(again).toContain("reopened");
  expect(again).toContain("Gaps: limits");
  expect(again).toContain("first objective");
});
