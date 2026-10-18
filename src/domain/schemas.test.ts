import { DEFAULT_SETTINGS, SettingsSchema } from "./schemas";

describe("SettingsSchema", () => {
  it("applies spec defaults to {}", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      schemaVersion: 1,
      onboardingCompleted: false,
      language: "he",
      theme: "system",
      dataRoot: "",
      models: {},
      grading: { thinking: true, thinkingBudget: 8000 },
      retrieval: { webSearch: true },
      learning: {
        minExercises: 2,
        minExerciseScore: 85,
        masteryThreshold: 0.85,
        requireAllObjectives: true,
        hintsBeforeSolution: 3,
      },
      usage: { monthlyCapUsd: null },
      updates: { autoCheck: true },
    });
  });
  it("rejects out-of-range values", () => {
    expect(SettingsSchema.safeParse({ learning: { minExercises: 9 } }).success).toBe(false);
  });
});
