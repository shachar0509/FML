import { describe, expect, it } from "vitest";
import { FakeClaudeGateway, toolCall } from "@/claude/fake";
import { reduceProgress } from "@/domain/progress/reduce";
import { generatePlan } from "./generate";
import { renderPlanMd, stageRange, validatePlan } from "./plan";

const course = { courseNumber: "01040195", nameHe: "קורס", credits: 2, faculty: "f", syllabusHe: "s", prerequisitesRaw: "" };
const outline = (n: number) => ({
  courseKind: "computational",
  units: [0, 1, 2].map((u) => ({
    title: `unit ${u}`,
    summary: "s",
    stages: Array.from({ length: n / 3 }, (_, i) => ({
      title: `t${u}.${i}`,
      kind: "concept",
      summary: "s",
      prerequisites: u * (n / 3) + i > 0 ? [u * (n / 3) + i, 99] : [], // 99 is invalid and must be dropped
    })),
  })),
});
const details = (req: { messages: { content: unknown }[] }) => {
  const text = String(req.messages[0]?.content);
  const ids = /stage ids ([S\d, ]+)\./.exec(text)?.[1]?.split(", ") ?? [];
  return toolCall("submit_unit_details", {
    stages: ids.map((id) => ({
      id, objectives: ["a", "b"], newConcepts: [], theorems: [], techniques: [], edgeCases: [], examRelevance: "core", estimatedMinutes: 90,
    })),
  });
};

describe("plan", () => {
  it("stageRange follows 4.4", () => {
    expect(stageRange(5.5)).toMatchObject({ min: 66, max: 121 });
    expect(stageRange(2)).toMatchObject({ min: 30, max: 44 });
  });

  it("generates, validates, renders and initialises progress", async () => {
    const gw = new FakeClaudeGateway([toolCall("submit_plan_outline", outline(36)), details, details, details]);
    const plan = await generatePlan({ gw, course, lang: "he" });
    expect(plan.stages).toHaveLength(36);
    expect(plan.stages[1]?.prerequisites).toEqual(["S001"]);
    expect(plan.stages[0]?.estimatedMinutes).toBe(45); // clamped
    expect(plan.units[2]?.stageIds[0]).toBe("S025");
    expect(validatePlan(plan, 2)).toEqual([]);
    expect(renderPlanMd(course, plan)).toContain("**S002 — t0.1**");
    const p = reduceProgress(plan, [], "2026-01-01T00:00:00Z");
    expect(p.currentStageId).toBe("S001");
    expect(p.stages["S002"]?.status).toBe("locked");
  });

  it("asks to split a too-small outline, then fails when far outside the range", async () => {
    const gw = new FakeClaudeGateway([toolCall("submit_plan_outline", outline(9)), toolCall("submit_plan_outline", outline(36)), details, details, details]);
    expect(await generatePlan({ gw, course, lang: "en" })).toBeTruthy();
    expect(JSON.stringify(gw.calls[1]?.messages)).toContain("minimum is 30");
    const bad = new FakeClaudeGateway([1, 2, 3].map(() => toolCall("submit_plan_outline", outline(9))));
    await expect(generatePlan({ gw: bad, course, lang: "en" })).rejects.toThrow(/range/);
  });

  it("retries a unit once when it returns the wrong ids", async () => {
    const wrong = toolCall("submit_unit_details", { stages: [] });
    const gw = new FakeClaudeGateway([toolCall("submit_plan_outline", outline(36)), wrong, details, details, details]);
    await generatePlan({ gw, course, lang: "en" });
    expect(gw.calls).toHaveLength(5);
  });

  it("validatePlan catches bad prerequisites", async () => {
    const gw = new FakeClaudeGateway([toolCall("submit_plan_outline", outline(36)), details, details, details]);
    const plan = await generatePlan({ gw, course, lang: "en" });
    (plan.stages[0] as { prerequisites: string[] }).prerequisites = ["S005"];
    expect(validatePlan(plan, 2).join()).toMatch(/not earlier/);
  });
});
