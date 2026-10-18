/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { beforeEach, describe, expect, it } from "vitest";
import { FakeClaudeGateway, usage0 } from "@/claude/fake";
import { PlanJsonSchema } from "@/domain/dataSchemas";
import { setDeviceId } from "@/lib/device";
import { writeJsonAtomic } from "@/lib/fs/atomicWrite";
import { setFs } from "@/lib/fs/fs";
import { readJsonlDir } from "@/lib/fs/jsonl";
import { coursePaths } from "@/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { memFs } from "@/test/memfs";
import { Lesson } from "./engine";

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
const use = (id: string, name: string, input: unknown) => ({ content: [{ type: "tool_use" as const, id, name, input }], stopReason: "tool_use", usage: usage0 });
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], usage: usage0 });
const mcq = { stageId: "S001", questionMd: "q", options: ["a", "b"], correctIndex: 1, explanationMd: "e", conceptTags: [] };

let gw: FakeClaudeGateway;
const lesson = () => new Lesson(N, "S001", { gw, loadImage: async () => "" });
const events = () => readJsonlDir(coursePaths(useSettings.getState().settings.dataRoot, N).events);

beforeEach(async () => {
  setFs(memFs());
  setDeviceId("dev");
  useSettings.setState((s) => ({ settings: { ...s.settings, dataRoot: "/r", language: "en" } }));
  const p = coursePaths("/r", N);
  await writeJsonAtomic(p.courseJson, course);
  await writeJsonAtomic(p.planJson, plan);
});

describe("Lesson", () => {
  it("starts, waits on an MCQ, records the answer and continues", async () => {
    gw = new FakeClaudeGateway([use("t1", "present_mcq", mcq), text("Good.")]);
    const l = lesson();
    await l.open();
    expect(l.pending().map((u) => u.id)).toEqual(["t1"]);
    expect(JSON.stringify(gw.calls[0]!.messages)).toContain("[START_LESSON]");
    expect(JSON.stringify(gw.calls[0]!.messages)).toContain("[STATUS]");
    await l.answerMcq("t1", 1);
    expect(l.pending()).toEqual([]);
    const second = JSON.stringify(gw.calls[1]!.messages);
    expect(second).toContain('{\\"selectedIndex\\":1,\\"correct\\":true}');
    expect((await events()).map((e) => (e as unknown as { type: string }).type)).toEqual(["stage_started", "check_answered"]);
    // resume: no API call, transcript identical
    const again = lesson();
    await again.open();
    expect(gw.calls).toHaveLength(2);
    expect(again.lines.length).toBe(l.lines.length);
  });

  it("handles update_assessment and consult_materials without waiting", async () => {
    gw = new FakeClaudeGateway([
      use("a1", "update_assessment", { stageId: "S001", mastery: 0.5, coveredObjectives: [0], gaps: ["g"], reviewTopics: [], readyToAdvance: false, rationale: "r" }),
      use("c1", "consult_materials", { question: "what is x", purpose: "definition", stageId: "S001" }),
      // consult has no materials -> retrieval skipped, own-knowledge call, then web fallback
      (() => ({ content: [{ type: "tool_use" as const, id: "r", name: "submit_retrieval", input: { answerMd: "ans", coverage: "none", sources: [], quotes: [] } }], usage: usage0 })) as never,
      text("done"),
    ]);
    useSettings.setState((s) => ({ settings: { ...s.settings, retrieval: { webSearch: false } } }));
    const l = lesson();
    await l.open();
    expect(l.error).toBeNull();
    const res = l.stateOf("a1")!;
    expect(JSON.parse(res.content)).toMatchObject({ ok: true, advanceCriteriaMet: false });
    expect(l.stateOf("c1")!.ephemeral).toBe(true);
    expect((await events()).some((e) => (e as unknown as { type: string }).type === "assessment_updated")).toBe(true);
  });

  it("interjection answers the pending widget, and stop saves the partial", async () => {
    gw = new FakeClaudeGateway([use("t1", "present_mcq", mcq), text("ok")]);
    const l = lesson();
    await l.open();
    await l.send("wait, why?");
    expect(JSON.stringify(gw.calls[1]!.messages)).toContain("studentInterjected");
    expect(l.pending()).toEqual([]);
  });
});
