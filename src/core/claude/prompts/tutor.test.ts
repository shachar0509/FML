/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from "vitest";
import type { PlanJson } from "@/core/domain/dataSchemas";
import { statusBlock, tutorSystem } from "./tutor";

const stage = (n: number, prerequisites: string[] = []) => ({
  id: `S00${n}`, unitId: "U01", order: n, title: `title${n}`, summary: "s", kind: "concept", prerequisites,
  objectives: [`obj${n}a`, `obj${n}b`], newConcepts: [], theorems: [], techniques: [], edgeCases: [], examRelevance: "core", estimatedMinutes: 30,
});
const plan = { stages: [1, 2, 3, 4, 5].map((n) => stage(n, n > 1 ? [`S00${n - 1}`] : [])) } as unknown as PlanJson;

describe("tutorSystem", () => {
  const s = tutorSystem({
    course: { courseNumber: "01040195", nameHe: "אינפי", credits: 5.5 }, courseKind: "proof-based", stage: plan.stages[1]!, plan, minExercises: 2,
    lang: "English", knowledgeBoundary: "KNOWLEDGE BOUNDARY\nBOUNDARY-X", lessonBrief: "BRIEF-Y", exercises: [{ id: "E1", label: "Q1", difficulty: 2, type: "proof", gist: "g" }],
    mistakeTags: [{ tag: "t1", labelHe: "ת", labelEn: "Tag one" }],
  });
  it("fills every placeholder", () => {
    expect(s).not.toContain("{{");
    expect(s).toContain("S002 — title2");
    expect(s).toContain("BOUNDARY-X");
    expect(s).toContain("BRIEF-Y");
    expect(s).toContain("S001 — title1: obj1a; obj1b");
    expect(s).toContain("S003 — title3\nS004 — title4\n\n");
    expect(s).toContain("E1 — Q1 — 2 — proof — g");
    expect(s).toContain("t1 — Tag one");
  });
  it("materials in another language: questions in that language, quotes in the original with a translation (M49)", () => {
    expect(s).not.toContain("materials are mostly in"); // not given: nothing added
    const args = { course: { courseNumber: "01040195", nameHe: "אינפי", credits: 5.5 }, courseKind: "proof-based", stage: plan.stages[1]!, plan, minExercises: 2, knowledgeBoundary: "", lessonBrief: "", exercises: [], mistakeTags: [] };
    const he = tutorSystem({ ...args, lang: "English", materialsLang: "Hebrew" });
    expect(he).toContain("write consult_materials questions in Hebrew");
    expect(he).toContain("original Hebrew wording in quotes, then its English translation");
    expect(tutorSystem({ ...args, lang: "Hebrew", materialsLang: "Hebrew" })).not.toContain("materials are mostly in"); // same language: unchanged
  });
  it("status block", () => {
    const b = statusBlock({ completed: 1, total: 5, mastery: 0.5, covered: [0], gaps: [], reviewTopics: [], missing: ["m"], overriddenPrereqs: [], mistakes: ["x"], idleMinutes: 3 });
    expect(b).toContain("Stages completed: 1 of 5");
    expect(b).not.toContain("{{");
  });
});
