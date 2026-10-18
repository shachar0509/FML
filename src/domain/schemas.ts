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
export const TaskIdSchema = z.enum(TASK_IDS);

// Spec §13. Every field has a default so partial/old files still parse.
export const SettingsSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  onboardingCompleted: z.boolean().default(false),
  language: z.enum(["he", "en"]).default("he"),
  theme: z.enum(["system", "light", "dark"]).default("system"),
  dataRoot: z.string().default(""), // "" = <Documents>/Shalav, resolved at load inside Tauri
  models: z.partialRecord(TaskIdSchema, z.string()).default({}),
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
  usage: z
    .object({ monthlyCapUsd: z.number().nonnegative().nullable().default(null) })
    .default({ monthlyCapUsd: null }),
  updates: z.object({ autoCheck: z.boolean().default(true) }).default({ autoCheck: true }),
});

export type Settings = z.infer<typeof SettingsSchema>;
export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});
