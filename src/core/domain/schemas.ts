import { z } from "zod";

export const TASK_IDS = [
  "plan",
  "index",
  "tutor",
  "grading",
  "generation",
  "hint",
  "summary",
  "retrieval",
  "ask",
] as const;

// Spec §13 minus the v1 Claude/usage/updates fields (old settings.json files still parse: unknown keys are ignored). Every field has a default so partial/old files still parse.
export const SettingsSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  language: z.enum(["he", "en"]).default("he"),
  theme: z.enum(["system", "light", "dark"]).default("system"),
  moodleUrl: z.string().default(""), // student's Moodle address (only needed where the university has no built-in one)
  dataRoot: z.string().default(""), // "" = <Documents>/Shalav, resolved at load inside Tauri
  grading: z
    .object({
      thinking: z.boolean().default(true),
      thinkingBudget: z.number().int().min(2000).max(32000).default(8000),
    })
    .default({ thinking: true, thinkingBudget: 8000 }),
  retrieval: z.object({ webSearch: z.boolean().default(true) }).default({ webSearch: true }),
  learning: z
    .object({
      minExercises: z.number().int().min(1).max(5).default(2),
      minExerciseScore: z.number().min(70).max(100).default(85),
      masteryThreshold: z.number().min(0.6).max(1).default(0.85),
      requireAllObjectives: z.boolean().default(true),
      hintsBeforeSolution: z.number().int().min(1).max(3).default(3),
    })
    .default({
      minExercises: 2,
      minExerciseScore: 85,
      masteryThreshold: 0.85,
      requireAllObjectives: true,
      hintsBeforeSolution: 3,
    }),
});

export type Settings = z.infer<typeof SettingsSchema>;
export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});
