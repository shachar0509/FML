/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from "vitest";
import { BLOCKING, TUTOR_TOOLS, assignExercise, presentMcq, recordCheckResult, updateAssessment } from "./tutorTools";

describe("tutor tools", () => {
  it("six tools in order, three blocking", () => {
    expect(TUTOR_TOOLS.map((t) => t.name)).toEqual(["present_mcq", "ask_open_question", "record_check_result", "assign_exercise", "update_assessment", "consult_materials"]);
    expect([...BLOCKING]).toEqual(["present_mcq", "ask_open_question", "assign_exercise"]);
    expect(TUTOR_TOOLS[4]!.description).toContain("0-BASED");
  });
  it("validates samples", () => {
    expect(presentMcq.schema.safeParse({ stageId: "S001", questionMd: "q", options: ["a", "b"], correctIndex: 1, explanationMd: "e", conceptTags: [] }).success).toBe(true);
    expect(presentMcq.schema.safeParse({ stageId: "S001", questionMd: "q", options: ["a"], correctIndex: 0, explanationMd: "e", conceptTags: [] }).success).toBe(false);
    expect(assignExercise.schema.safeParse({ stageIds: ["S001"], source: "index", exerciseId: "x", difficulty: 3, edgeCaseFocus: [] }).success).toBe(true);
    expect(assignExercise.schema.safeParse({ stageIds: [], source: "other", difficulty: 6, edgeCaseFocus: [] }).success).toBe(false);
    expect(recordCheckResult.schema.safeParse({ checkToolUseId: "t", correct: false, score: 40, mistakes: [{ tag: "a", labelHe: "א", labelEn: "a", description: "d" }] }).success).toBe(true);
    expect(updateAssessment.schema.safeParse({ stageId: "S001", mastery: 1.5, coveredObjectives: [0], gaps: [], reviewTopics: [], readyToAdvance: false, rationale: "r" }).success).toBe(false);
  });
});
