// On-disk data schemas, spec §3.1-3.9. Settings live in schemas.ts.
import { z } from "zod";

const ts = z.string();
const courseNumber = z.string().regex(/^\d{8}$/);
const stageId = z.string().regex(/^S\d{3}$/);
const unitId = z.string().regex(/^U\d{2}$/);
const context = z.enum(["learn", "practice"]);

export const ShalavJsonSchema = z.object({ formatVersion: z.literal(1), createdAt: ts });
export type ShalavJson = z.infer<typeof ShalavJsonSchema>;
export const DeviceJsonSchema = z.object({ deviceId: z.string().min(1) });
export type DeviceJson = z.infer<typeof DeviceJsonSchema>;

// 3.4
export const CourseKindSchema = z.enum(["proof-based", "computational", "programming", "mixed", "lab"]);
export const CourseJsonSchema = z.object({
  schema: z.literal(1),
  courseNumber,
  nameHe: z.string(),
  credits: z.number(),
  faculty: z.string(),
  syllabusHe: z.string(),
  prerequisitesRaw: z.string(),
  catalogSemester: z.string().nullable(),
  courseKind: CourseKindSchema,
  planVersion: z.number().int(),
  createdAt: ts,
  updatedAt: ts,
});
export type CourseJson = z.infer<typeof CourseJsonSchema>;

// 3.5
export const UnitSchema = z.object({
  id: unitId,
  title: z.string(),
  summary: z.string(),
  stageIds: z.array(stageId),
});
export type Unit = z.infer<typeof UnitSchema>;
export const StageSchema = z.object({
  id: stageId,
  unitId,
  order: z.number().int().min(1),
  title: z.string(),
  summary: z.string(),
  kind: z.enum(["concept", "definition", "theorem", "proof", "technique", "applications", "integration", "exam-prep"]),
  objectives: z.array(z.string()),
  newConcepts: z.array(z.string()),
  theorems: z.array(z.object({ name: z.string(), statement: z.string(), proofRequired: z.boolean() })),
  techniques: z.array(z.string()),
  prerequisites: z.array(stageId),
  edgeCases: z.array(z.string()),
  examRelevance: z.enum(["core", "common", "occasional"]),
  estimatedMinutes: z.number(),
});
export type Stage = z.infer<typeof StageSchema>;
export const PlanJsonSchema = z.object({
  schema: z.literal(1),
  courseNumber,
  version: z.number().int(),
  generatedAt: ts,
  model: z.string(),
  courseKind: CourseKindSchema,
  units: z.array(UnitSchema),
  stages: z.array(StageSchema),
});
export type PlanJson = z.infer<typeof PlanJsonSchema>;

// 3.6
export const VerdictSchema = z.enum(["correct", "partially_correct", "incorrect", "incomplete", "unreadable"]);
export type Verdict = z.infer<typeof VerdictSchema>;
export const ExerciseRefSchema = z.object({ source: z.enum(["index", "generated", "tutor"]), id: z.string() });
export type ExerciseRef = z.infer<typeof ExerciseRefSchema>;
const base = { id: z.string(), ts, deviceId: z.string(), courseNumber };
export const EventSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("stage_started"), stageId }),
  z.object({
    ...base, type: z.literal("check_answered"), stageId, checkId: z.string(), kind: z.enum(["mcq", "open"]),
    context, correct: z.boolean(), score: z.number(), mistakeTags: z.array(z.string()),
  }),
  z.object({
    ...base, type: z.literal("attempt_graded"), attemptId: z.string(), exercise: ExerciseRefSchema,
    stageIds: z.array(stageId), context, verdict: VerdictSchema, score: z.number(),
    mistakes: z.array(z.object({
      tag: z.string(), severity: z.enum(["minor", "major", "critical"]), note: z.string().max(120),
    })),
    missingForFullCredit: z.number(), edgeCasesMissed: z.array(z.string()), attachmentHashes: z.array(z.string()),
    difficulty: z.number(), hasEdgeCaseFocus: z.boolean(), hintsUsed: z.number(), solutionRevealedBefore: z.boolean(),
  }),
  z.object({ ...base, type: z.literal("hint_requested"), exercise: ExerciseRefSchema, level: z.union([z.literal(1), z.literal(2), z.literal(3)]), context }),
  z.object({ ...base, type: z.literal("solution_revealed"), exercise: ExerciseRefSchema, context }),
  z.object({
    ...base, type: z.literal("assessment_updated"), stageId, mastery: z.number(), coveredObjectives: z.array(z.number()),
    gaps: z.array(z.string()), reviewTopics: z.array(z.string()), readyToAdvance: z.boolean(), rationale: z.string(),
  }),
  z.object({ ...base, type: z.literal("mistake_observed"), tag: z.string(), stageIds: z.array(stageId), refId: z.string(), context }),
  z.object({ ...base, type: z.literal("stage_completed"), stageId, by: z.enum(["mastery", "user_override"]), masteryAtCompletion: z.number() }),
  z.object({ ...base, type: z.literal("stage_reopened"), stageId }),
  z.object({ ...base, type: z.literal("mistake_tag_defined"), tag: z.string(), labelHe: z.string(), labelEn: z.string(), description: z.string() }),
  z.object({
    ...base, type: z.literal("plan_replaced"), fromVersion: z.number().int(), toVersion: z.number().int(),
    idMap: z.record(z.string(), z.string().nullable()),
  }),
]);
export type Event = z.infer<typeof EventSchema>;

// 3.7
export const StageProgressSchema = z.object({
  status: z.enum(["locked", "available", "in_progress", "completed", "completed_override"]),
  mastery: z.number(),
  tutorMastery: z.number().nullable(),
  practiceMastery: z.number().nullable(),
  coveredObjectives: z.array(z.number()),
  gaps: z.array(z.string()),
  reviewTopics: z.array(z.string()),
  checks: z.number(), correctChecks: z.number(),
  attempts: z.number(), correctAttempts: z.number(), edgeCaseCorrect: z.number(),
  lastActivityAt: ts.nullable(),
  completedAt: ts.nullable(),
  completedBy: z.enum(["mastery", "user_override"]).nullable(),
});
export type StageProgress = z.infer<typeof StageProgressSchema>;
export const MistakeSummarySchema = z.object({
  tag: z.string(), labelHe: z.string(), labelEn: z.string(), description: z.string(),
  count: z.number(), weight: z.number(), lastSeenAt: ts, stageIds: z.array(stageId), resolved: z.boolean(),
  recentExamples: z.array(z.object({ attemptId: z.string(), note: z.string() })).max(3),
});
export type MistakeSummary = z.infer<typeof MistakeSummarySchema>;
export const ProgressJsonSchema = z.object({
  schema: z.literal(1),
  courseNumber,
  planVersion: z.number().int(),
  computedAt: ts,
  currentStageId: stageId.nullable(),
  stages: z.record(z.string(), StageProgressSchema),
  mistakes: z.array(MistakeSummarySchema),
  totals: z.object({
    stagesTotal: z.number(), stagesCompleted: z.number(), attempts: z.number(),
    correctAttempts: z.number(), checks: z.number(), correctChecks: z.number(),
  }),
});
export type ProgressJson = z.infer<typeof ProgressJsonSchema>;

// 3.8
export const StoredBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("image_ref"), sha256: z.string(), mediaType: z.enum(["image/jpeg", "image/png"]) }),
  z.object({ type: z.literal("tool_use"), id: z.string(), name: z.string(), input: z.unknown() }),
  z.object({
    type: z.literal("tool_result"), tool_use_id: z.string(), content: z.string(),
    is_error: z.boolean().optional(), ephemeral: z.boolean().optional(), stub: z.string().optional(),
  }),
]);
export type StoredBlock = z.infer<typeof StoredBlockSchema>;
const line = { id: z.string(), ts, deviceId: z.string() };
export const SessionLineSchema = z.discriminatedUnion("kind", [
  z.object({ ...line, kind: z.literal("message"), role: z.enum(["user", "assistant"]), content: z.array(StoredBlockSchema) }),
  z.object({ ...line, kind: z.literal("summary"), coversThroughId: z.string(), text: z.string() }),
  z.object({ ...line, kind: z.literal("ui"), widgetId: z.string(), state: z.unknown() }),
]);
export type SessionLine = z.infer<typeof SessionLineSchema>;

// 3.9
export const IndexedExerciseSchema = z.object({
  id: z.string(),
  label: z.string(),
  pages: z.array(z.number().int()),
  statementMd: z.string(),
  figureCrops: z.array(z.object({
    page: z.number().int(),
    bbox: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]),
    file: z.string(),
  })),
  referenceSolutionMd: z.string().nullable(),
  requiredStageIds: z.array(stageId),
  primaryStageId: stageId,
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  type: z.enum(["proof", "computation", "multiple_choice", "true_false", "short_answer", "coding", "design"]),
  estimatedMinutes: z.number(),
  edgeCaseFocus: z.array(z.string()),
  gist: z.string(),
});
export type IndexedExercise = z.infer<typeof IndexedExerciseSchema>;
export const FileIndexSchema = z.object({
  schema: z.literal(1),
  sha256: z.string(),
  fileName: z.string(),
  relPath: z.string(),
  role: z.enum(["material", "exercises"]),
  mediaType: z.string(),
  pageCount: z.number().int(),
  addedAt: ts,
  status: z.enum(["pending", "indexing", "indexed", "failed"]),
  error: z.string().nullable(),
  indexedAt: ts.nullable(),
  indexModel: z.string().nullable(),
  planVersion: z.number().int().nullable(),
  materialPages: z.array(z.object({
    page: z.number().int(), stageIds: z.array(stageId), summary: z.string(), hasFigure: z.boolean(), text: z.string(),
  })),
  exercises: z.array(IndexedExerciseSchema),
});
export type FileIndex = z.infer<typeof FileIndexSchema>;

export const GeneratedExerciseSchema = IndexedExerciseSchema.extend({
  origin: z.literal("generated"),
  styleRefIds: z.array(z.string()),
  referenceSolutionMd: z.string(),
  verified: z.boolean(),
  gradingNotes: z.string().default(""),
  createdAt: ts,
});
export type GeneratedExercise = z.infer<typeof GeneratedExerciseSchema>;
export const GeneratedFileSchema = z.object({
  schema: z.literal(1), items: z.array(GeneratedExerciseSchema), solutions: z.record(z.string(), z.string()).default({}),
});
export type GeneratedFile = z.infer<typeof GeneratedFileSchema>;
