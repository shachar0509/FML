import { beforeEach, expect, it } from "vitest";
import { FakeClaudeGateway, toolCall } from "@/core/claude/fake";
import type { ClaudeRequest } from "@/core/claude/types";
import { EventSchema, type FileIndex, type PlanJson } from "@/core/domain/dataSchemas";
import { evidenceByNode, knowledgeOf } from "@/core/domain/knowledge/control";
import { courseGraph } from "@/core/domain/knowledge/tag";
import { nodeId } from "@/core/domain/knowledge/graph";
import { allExercises } from "@/core/domain/practice/exercises";
import { appendEvent } from "@/core/domain/progress/store";
import { setDeviceId } from "@/core/lib/device";
import { setFs } from "@/core/lib/fs/fs";
import { readJsonlDir } from "@/core/lib/fs/jsonl";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { memFs } from "@/test/memfs";
import { readFileIndex, writeFileIndex } from "./indexStore";
import { createIndexQueue } from "./queue";
import { indexTeacher, teacherEvidence } from "./teacher";
import type { PageSource } from "./types";

const N = "01040195";
const course = { courseNumber: N, nameHe: "ק" };
const stage = (i: number) => ({
  id: `S00${i}`, unitId: "U01", order: i, title: `t${i}`, summary: "s", kind: "concept" as const, objectives: ["a", "b"], newConcepts: [`c${i}`],
  theorems: [], techniques: [], prerequisites: [], edgeCases: [], examRelevance: "core" as const, estimatedMinutes: 30,
});
const plan: PlanJson = { schema: 1, courseNumber: N, version: 1, generatedAt: "t", model: "m", courseKind: "mixed", units: [{ id: "U01", title: "u", summary: "s", stageIds: ["S001", "S002", "S003"] }], stages: [1, 2, 3].map(stage) };
const c2 = nodeId("S002", "concept", "c2");
const events = () => readJsonlDir(coursePaths("/r", N).events, EventSchema);
const rec = (o: Partial<FileIndex> = {}): FileIndex => ({
  schema: 1, sha256: "aaaa1111bbbb", fileName: "hw2 graded.pdf", relPath: "הערות המרצה/hw2 graded.pdf", role: "teacher", mediaType: "application/pdf",
  pageCount: 8, addedAt: "t", status: "pending", error: null, indexedAt: null, indexModel: null, planVersion: null, materialPages: [], exercises: [], ...o,
});
// the raw page holds the STUDENT's (wrong) answer; only the model's teacher-only `text` may be stored
const STUDENT = "student: x = 7 because the tangent is horizontal";
const src = (n: number): PageSource => ({
  pageCount: n, text: async (p) => `${STUDENT} (page ${p})`, imageNeeded: async () => true,
  image: async () => ({ base64: "AAA", mediaType: "image/jpeg" }), crop: async () => ({ bytes: new Uint8Array(), ext: "png" }), close() {},
});
const pagesIn = (r: ClaudeRequest) => (r.messages[0]?.content as { type: string; text?: string }[]).filter((b) => b.type === "text").map((b) => Number(/^Page (\d+)/.exec(b.text ?? "")?.[1]));
const deduction = (page: number, o: object = {}) => ({
  page, type: "deduction", rule: "cite the section number", quote: "missing section number (-5)", points: -5, exercise: "2b", when: "the answer relies on a statute",
  nodeResults: [{ n: 2, score: 0.4 }], concerns: 2, mistake: { tag: "missing-section", labelHe: "חסר מספר סעיף", labelEn: "Missing section number", description: "d" }, ...o,
});
const reply = (r: ClaudeRequest) =>
  toolCall("submit_teacher_notes", {
    pages: pagesIn(r).map((p) => ({ page: p, kind: p === 8 ? "rubric" : "graded_work", text: `teacher p${p}: the result is 5`, summary: "s", stageIds: ["S002", "S999"] })),
    items: pagesIn(r).includes(1) ? [deduction(1), { page: 2, type: "praise", rule: "clear structure", quote: "good", when: "w", nodeResults: [{ n: 99, score: 1 }] }] : [{ page: 8, type: "requirement", rule: "exact form", quote: "always exact", when: "a value is asked" }],
  });

beforeEach(() => {
  setFs(memFs());
  setDeviceId("dev1");
  useSettings.setState({ settings: { ...useSettings.getState().settings, dataRoot: "/r" } });
});

it("M71 indexTeacher: stores only the teacher's writing, no exercises, node numbers from one shared list", async () => {
  const gw = new FakeClaudeGateway([reply, reply]);
  const out = await indexTeacher({ gw, source: src(8), rec: rec(), plan, course, lang: "en" });
  expect(gw.calls.map((c) => c.tools?.[0]?.name)).toEqual(["submit_teacher_notes", "submit_teacher_notes"]);
  expect(gw.calls.map((c) => pagesIn(c).length).sort()).toEqual([2, 6]);
  expect(gw.calls[0]?.system).toBe(gw.calls[1]?.system); // the same numbered node list in every batch
  expect(gw.calls[0]?.system).toContain("2. [concept] c2");
  expect(out.exercises).toEqual([]);
  expect(out.materialPages).toHaveLength(8);
  expect(JSON.stringify(out)).not.toContain("tangent is horizontal");
  expect(out.materialPages[0]).toMatchObject({ text: "teacher p1: the result is 5", stageIds: ["S002"], kind: "graded_work" });
  expect(out.materialPages[7]?.kind).toBe("rubric");
  expect(out.teacherItems?.map((t) => t.type)).toEqual(["deduction", "praise", "requirement"]);
  expect(out.teacherItems?.[0]).toMatchObject({ nodes: [{ id: c2, score: 0.4 }], concerns: c2, mistake: { tag: "missing-section" }, id: "aaaa1111-t1" });
  expect(out.teacherItems?.[1]?.nodes).toEqual([]); // unknown number dropped
  expect(out.teacherItems?.[2]).toMatchObject({ mistake: null, concerns: null, level: "any", answerForms: [] });
});

it("M71 graded work: weight 2, once per sha; a mistake repeated in two works becomes one misconception node, and each repeat lowers it", async () => {
  const items = (await indexTeacher({ gw: new FakeClaudeGateway([reply, reply]), source: src(8), rec: rec(), plan, course, lang: "en" })).teacherItems;
  const file = (sha: string) => rec({ sha256: sha, teacherItems: items, status: "indexed" });

  await teacherEvidence(N, plan, file("sha-one"), "en");
  let ev = await events();
  expect(ev.filter((e) => e.type === "node_observed")).toMatchObject([{ nodeId: c2, score: 0.4, context: "teacher", refId: "sha-one" }]);
  expect(ev.filter((e) => e.type === "mistake_observed")).toMatchObject([{ tag: "missing-section", refId: "sha-one", context: "teacher", stageIds: ["S002"] }]);
  expect(ev.some((e) => e.type === "node_added")).toBe(false); // seen once: not yet a misconception
  expect(evidenceByNode(courseGraph(plan, ev), ev).get(c2)).toEqual([{ s: 0.4, w: 2 }]);

  await teacherEvidence(N, plan, file("sha-one"), "en"); // re-scan of the same file
  expect(await events()).toHaveLength(ev.length);

  await teacherEvidence(N, plan, file("sha-two"), "en");
  ev = await events();
  const mid = nodeId(null, "misconception", "missing-section");
  expect(ev.filter((e) => e.type === "node_added")).toMatchObject([{ nodeId: mid, kind: "misconception", label: "Missing section number", origin: "teacher" }]);
  expect(ev.filter((e) => e.type === "node_linked")).toMatchObject([{ from: mid, to: c2, rel: "misconception_of" }]);
  expect(ev.filter((e) => e.type === "mistake_tag_defined")).toHaveLength(1);
  const k2 = knowledgeOf(courseGraph(plan, ev), ev, 0.1).control.get(mid) as number;

  await teacherEvidence(N, plan, file("sha-three"), "en");
  ev = await events();
  expect(ev.filter((e) => e.type === "node_added")).toHaveLength(1);
  expect(knowledgeOf(courseGraph(plan, ev), ev, 0.1).control.get(mid)).toBeLessThan(k2);
});

it("M71: a graded work after an AI-graded answer with the same mistake makes the misconception at once", async () => {
  await appendEvent(N, { type: "mistake_observed", tag: "missing-section", stageIds: [], refId: "attempt-1", context: "practice" });
  const items = (await indexTeacher({ gw: new FakeClaudeGateway([reply, reply]), source: src(8), rec: rec(), plan, course, lang: "he" })).teacherItems;
  await teacherEvidence(N, plan, rec({ teacherItems: items }), "he");
  expect((await events()).filter((e) => e.type === "node_added")).toMatchObject([{ label: "חסר מספר סעיף" }]);
});

it("M71 queue: a teacher file is scanned, its evidence written, and it never adds exercises", async () => {
  await writeFileIndex(N, rec());
  const q = createIndexQueue({
    gw: () => new FakeClaudeGateway([reply, reply]), open: async () => src(8), getPlan: async () => plan, course: async () => course, lang: () => "en", resolve: () => "/x",
  });
  q.enqueue(N, "aaaa1111bbbb");
  await q.idle();
  expect((await readFileIndex(N, "aaaa1111bbbb"))?.status).toBe("indexed");
  expect((await events()).some((e) => e.type === "node_observed" && e.context === "teacher")).toBe(true);
  expect(await allExercises(N)).toEqual([]);
});

it("M71 queue: two teacher files uploaded together run one after the other, so the second sees the first's tag and one misconception is made", async () => {
  await writeFileIndex(N, rec({ sha256: "sha-one" }));
  await writeFileIndex(N, rec({ sha256: "sha-two" }));
  const gw = new FakeClaudeGateway([reply, reply, reply, reply]);
  const q = createIndexQueue({ gw: () => gw, open: async () => src(8), getPlan: async () => plan, course: async () => course, lang: () => "en", resolve: () => "/x" });
  q.enqueue(N, "sha-one");
  q.enqueue(N, "sha-two");
  await q.idle();
  expect(gw.calls[0]?.system).toContain("(none yet)");
  expect(gw.calls[2]?.system).toContain("missing-section — Missing section number");
  expect((await events()).filter((e) => e.type === "node_added")).toHaveLength(1);
});
