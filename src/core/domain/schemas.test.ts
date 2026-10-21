import { DEFAULT_SETTINGS, SettingsSchema } from "./schemas";

describe("SettingsSchema", () => {
  it("applies spec defaults to {}", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      schemaVersion: 1,
      language: "he",
      theme: "system",
      dataRoot: "",
      moodleUrl: "",
      grading: { thinking: true, thinkingBudget: 8000 },
      retrieval: { webSearch: true },
      learning: {
        minExercises: 2,
        minExerciseScore: 85,
        masteryThreshold: 0.85,
        requireAllObjectives: true,
        hintsBeforeSolution: 3,
      },
    });
  });
  it("ignores v1 fields", () => {
    expect(SettingsSchema.parse({ models: { plan: "x" }, usage: {}, updates: {} })).toEqual(DEFAULT_SETTINGS);
  });
  it("rejects out-of-range values", () => {
    expect(SettingsSchema.safeParse({ learning: { minExercises: 9 } }).success).toBe(false);
  });
});
