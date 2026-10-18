import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeClaudeGateway, usage0 } from "@/claude/fake";
import { PlanJsonSchema } from "@/domain/dataSchemas";
import { Lesson } from "@/domain/learn/engine";
import i18n from "@/i18n";
import { setDeviceId } from "@/lib/device";
import { writeJsonAtomic } from "@/lib/fs/atomicWrite";
import { setFs } from "@/lib/fs/fs";
import { coursePaths } from "@/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { memFs } from "@/test/memfs";
import { LessonView } from "./LessonView";

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
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], usage: usage0 });
const mcq = { stageId: "S001", questionMd: "QQQ", options: ["opt-a", "opt-b"], correctIndex: 1, explanationMd: "EXPLAIN-ME", conceptTags: [] };
const mcqUse = { content: [{ type: "tool_use" as const, id: "t1", name: "present_mcq", input: mcq }], stopReason: "tool_use", usage: usage0 };

async function open(...script: unknown[]) {
  const gw = new FakeClaudeGateway(script as never);
  const l = new Lesson(N, "S001", { gw, loadImage: async () => "" });
  await l.open();
  render(<MemoryRouter><LessonView lesson={l} /></MemoryRouter>);
  return { gw, l };
}

beforeEach(async () => {
  setFs(memFs());
  setDeviceId("dev");
  await i18n.changeLanguage("en");
  useSettings.setState((s) => ({ settings: { ...s.settings, dataRoot: "/r", language: "en" } }));
  const p = coursePaths("/r", N);
  await writeJsonAtomic(p.courseJson, course);
  await writeJsonAtomic(p.planJson, plan);
});

describe("LessonView", () => {
  it("hides the MCQ explanation until answered", async () => {
    await open(mcqUse, text("Good."));
    expect(screen.getByText("QQQ")).toBeTruthy();
    expect(screen.queryByText("EXPLAIN-ME")).toBeNull();
    fireEvent.click(screen.getByText("opt-b"));
    expect(await screen.findByText("EXPLAIN-ME")).toBeTruthy();
  });

  it("never renders the hidden START_LESSON message", async () => {
    await open(text("Hello there"));
    expect(screen.getByText("Hello there")).toBeTruthy();
    expect(screen.queryByText(/START_LESSON/)).toBeNull();
  });

  it("Enter sends, Shift+Enter does not", async () => {
    const { gw } = await open(text("first"), text("the reply"));
    const box = screen.getByPlaceholderText("Write a message…");
    fireEvent.change(box, { target: { value: "my question" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(gw.calls).toHaveLength(1);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByText("the reply")).toBeTruthy();
    expect(screen.getByText("my question")).toBeTruthy();
  });
});
