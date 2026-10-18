import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeClaudeGateway, toolCall } from "@/claude/fake";
import { setFs } from "@/lib/fs/fs";
import { useSettings } from "@/stores/settings";
import { memFs } from "@/test/memfs";

let gw: FakeClaudeGateway;
vi.mock("@/claude/runtime", () => ({ claude: () => gw }));
const { buildPlan, courseExists, createCourse, listCourses } = await import("./courses");

const entry = { courseNumber: "01040195", nameHe: "קורס", credits: 2, faculty: "f", syllabusHe: "s", prerequisitesRaw: "" };
const unit = (n: number) => ({
  title: "u", summary: "s",
  stages: Array.from({ length: n }, () => ({ title: "t", kind: "concept", summary: "s", prerequisites: [] })),
});
const details = (req: { messages: { content: unknown }[] }) =>
  toolCall("submit_unit_details", {
    stages: (/stage ids ([S\d, ]+)\./.exec(String(req.messages[0]?.content))?.[1]?.split(", ") ?? []).map((id) => ({
      id, objectives: ["a", "b"], newConcepts: [], theorems: [], techniques: [], edgeCases: [], examRelevance: "core", estimatedMinutes: 30,
    })),
  });

describe("courses", () => {
  beforeEach(() => {
    setFs(memFs());
    useSettings.setState({ settings: { ...useSettings.getState().settings, dataRoot: "/root" } });
  });

  it("creates the course, plan and progress; lists it", async () => {
    gw = new FakeClaudeGateway([toolCall("submit_plan_outline", { courseKind: "proof-based", units: [unit(18), unit(18)] }), details, details]);
    const r = await createCourse(entry, () => {});
    expect(r.planError).toBeNull();
    expect(r.course.courseKind).toBe("proof-based");
    expect(await courseExists("01040195")).toBe(true);
    const [c] = await listCourses();
    expect(c?.plan?.stages).toHaveLength(36);
    expect(c?.progress?.currentStageId).toBe("S001");
  });

  it("keeps the course when the plan fails and rebuilds on retry", async () => {
    gw = new FakeClaudeGateway([{ content: [] }, { content: [] }, { content: [] }]);
    const r = await createCourse(entry, () => {});
    expect(r.planError).toBeTruthy();
    const [c] = await listCourses();
    expect(c?.plan).toBeNull();
    gw = new FakeClaudeGateway([toolCall("submit_plan_outline", { courseKind: "mixed", units: [unit(36)] }), details]);
    expect((await buildPlan("01040195", () => {})).planError).toBeNull();
  });
});
