// On-disk data schemas, spec §3.1-3.9. Settings live in schemas.ts.
import { z } from "zod";

const ts = z.string();
const courseNumber = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$/);
const stageId = z.string().regex(/^S\d{3}$/);
const unitId = z.string().regex(/^U\d{2}$/);
const context = z.enum(["learn", "practice"]);
/** M71: evidence the teacher wrote (graded work) — only on node_observed / mistake_observed */
const evidenceContext = z.enum(["learn", "practice", "teacher"]);

// `university` is written once and never changed (reset = delete the data folder); older files have none.
export const ShalavJsonSchema = z.object({ formatVersion: z.literal(1), createdAt: ts, university: z.enum(["technion", "huji", "reichman", "braude"]).optional() });
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
  // M52: a custom course (any subject, no university); missing = academic. Its description is in syllabusHe.
  type: z.enum(["academic", "customCourse"]).optional(),
  goal: z.string().optional(),
  level: z.number().int().min(1).max(5).optional(),
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
/** Knowledge-graph evidence of one answer: which graph nodes it tested and how well (0..1). Older events have none. */
const nodeEvidence = z.array(z.object({ id: z.string(), score: z.number().min(0).max(1) })).optional();
export const NodeKindSchema = z.enum(["concept", "theorem", "technique", "edge", "skill", "convention", "misconception"]);
export type NodeKind = z.infer<typeof NodeKindSchema>;
export const EventSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("stage_started"), stageId }),
  z.object({
    ...base, type: z.literal("check_answered"), stageId, checkId: z.string(), kind: z.enum(["mcq", "open"]),
    context, correct: z.boolean(), score: z.number(), mistakeTags: z.array(z.string()), nodes: nodeEvidence,
  }),
  z.object({
    ...base, type: z.literal("attempt_graded"), attemptId: z.string(), exercise: ExerciseRefSchema,
    stageIds: z.array(stageId), context, verdict: VerdictSchema, score: z.number(),
    mistakes: z.array(z.object({
      tag: z.string(), severity: z.enum(["minor", "major", "critical"]), note: z.string().max(120),
    })),
    missingForFullCredit: z.number(), edgeCasesMissed: z.array(z.string()), attachmentHashes: z.array(z.string()),
    difficulty: z.number(), hasEdgeCaseFocus: z.boolean(), hintsUsed: z.number(), solutionRevealedBefore: z.boolean(), nodes: nodeEvidence,
  }),
  z.object({ ...base, type: z.literal("hint_requested"), exercise: ExerciseRefSchema, level: z.union([z.literal(1), z.literal(2), z.literal(3)]), context }),
  z.object({ ...base, type: z.literal("solution_revealed"), exercise: ExerciseRefSchema, context }),
  z.object({
    ...base, type: z.literal("assessment_updated"), stageId, mastery: z.number(), coveredObjectives: z.array(z.number()),
    gaps: z.array(z.string()), reviewTopics: z.array(z.string()), readyToAdvance: z.boolean(), rationale: z.string(),
  }),
  z.object({ ...base, type: z.literal("mistake_observed"), tag: z.string(), stageIds: z.array(stageId), refId: z.string(), context: evidenceContext }),
  z.object({ ...base, type: z.literal("stage_completed"), stageId, by: z.enum(["mastery", "user_override"]), masteryAtCompletion: z.number() }),
  z.object({ ...base, type: z.literal("stage_reopened"), stageId }),
  z.object({ ...base, type: z.literal("mistake_tag_defined"), tag: z.string(), labelHe: z.string(), labelEn: z.string(), description: z.string() }),
  // The tutor/grader grows the student's knowledge graph: a node the plan does not have (a skill, a course convention, a misconception…)
  z.object({ ...base, type: z.literal("node_added"), nodeId: z.string(), kind: NodeKindSchema, label: z.string().max(80), why: z.string().max(300), stageIds: z.array(stageId), requires: z.array(z.string()), origin: z.enum(["tutor", "grader", "index", "teacher"]), refId: z.string() }),
  // M72: a course convention the reconcile retired (its files are gone and a repeating convention contradicts it); graphOf drops the node, its answers stay in the log
  z.object({ ...base, type: z.literal("node_retired"), nodeId: z.string(), why: z.string().max(300) }),
  z.object({ ...base, type: z.literal("node_linked"), from: z.string(), to: z.string(), rel: z.enum(["requires", "misconception_of"]) }),
  // The tutor's own observation of a node (e.g. "cited the section numbers this time"), 0..1
  z.object({ ...base, type: z.literal("node_observed"), nodeId: z.string(), score: z.number().min(0).max(1), why: z.string().max(300), context: evidenceContext, refId: z.string().optional() }),
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
/** M70: what kind of answer a part asks for (several may apply) */
export const AnswerFormSchema = z.enum(["graph", "drawing", "table", "numeric", "formula", "proof", "written", "code", "choice"]);
export type AnswerForm = z.infer<typeof AnswerFormSchema>;
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
  /** M41: the specific idea or trick this exercise needs beyond the routine method (absent in records read before M41). */
  keyPoints: z.array(z.string()).optional(),
  gist: z.string(),
  /** M70: the answer forms the part asks for; the question it belongs to ("2") and its part ("a"; null = a single-part question). Absent before M70. */
  answerForms: z.array(AnswerFormSchema).optional(),
  question: z.string().optional(),
  part: z.string().nullable().optional(),
});
export type IndexedExercise = z.infer<typeof IndexedExerciseSchema>;
export const TeacherItemSchema = z.object({
  id: z.string(),
  page: z.number().int(),
  type: z.enum(["requirement", "deduction", "praise"]),
  rule: z.string(),
  quote: z.string(),
  points: z.number().nullable(),
  exercise: z.string().nullable(),
  /** the situation the comment was written on: what that part asked and what the answer did there */
  when: z.string(),
  level: z.enum(["whole", "part", "any"]),
  answerForms: z.array(AnswerFormSchema),
  questionTypes: z.array(IndexedExerciseSchema.shape.type),
  stageIds: z.array(stageId),
  /** graph nodes the teacher's marks score (resolved ids) */
  nodes: z.array(z.object({ id: z.string(), score: z.number().min(0).max(1) })),
  /** deduction: the concept node it concerns, and its mistake tag */
  concerns: z.string().nullable(),
  mistake: z.object({ tag: z.string(), labelHe: z.string(), labelEn: z.string(), description: z.string() }).nullable(),
});
export type TeacherItem = z.infer<typeof TeacherItemSchema>;
export const FileIndexSchema = z.object({
  schema: z.literal(1),
  sha256: z.string(),
  fileName: z.string(),
  relPath: z.string(),
  role: z.enum(["material", "exercises", "teacher"]),
  /** M70: "web" = written by Find materials online (its solutions never teach conventions); absent = the student's or Moodle's */
  origin: z.literal("web").optional(),
  mediaType: z.string(),
  pageCount: z.number().int(),
  addedAt: ts,
  /** M50: size:mtime the folder file had when last seen, so an edit is noticed without hashing every file on every scan (absent before M50). */
  stamp: z.string().optional(),
  status: z.enum(["pending", "indexing", "indexed", "failed"]),
  error: z.string().nullable(),
  indexedAt: ts.nullable(),
  indexModel: z.string().nullable(),
  planVersion: z.number().int().nullable(),
  materialPages: z.array(z.object({
    page: z.number().int(), stageIds: z.array(stageId), summary: z.string(), hasFigure: z.boolean(), text: z.string(),
    /** M41: remarks, warnings, special cases and counterexamples printed on the page (absent in records read before M41). */
    notes: z.array(z.string()).optional(),
    /** M71, teacher files: what the page is (its text is only what the teacher wrote) */
    kind: z.enum(["graded_work", "rubric", "remark"]).optional(),
  })),
  exercises: z.array(IndexedExerciseSchema),
  /** M70: answer-writing practices seen in this file's printed solutions, each with that solution's own situation (generalized later, across files) */
  patterns: z.object({
    occurrences: z.array(z.object({ id: z.string(), label: z.string(), useCase: z.string(), practice: z.string() })),
    absences: z.array(z.object({ label: z.string(), useCase: z.string(), practice: z.string() })),
  }).optional(),
  /** M71, teacher files: the teacher's requirements, deductions and praise (quotes of the teacher, never the student's answer) */
  teacherItems: z.array(TeacherItemSchema).optional(),
});
export type FileIndex = z.infer<typeof FileIndexSchema>;

export const GeneratedExerciseSchema = IndexedExerciseSchema.extend({
  origin: z.literal("generated"),
  styleRefIds: z.array(z.string()),
  referenceSolutionMd: z.string(),
  verified: z.boolean(),
  gradingNotes: z.string().default(""),
  createdAt: ts,
  /** M69: the graph nodes it tests (by the generator); none = its stages' nodes */
  nodeIds: z.array(z.string()).default([]),
});
export type GeneratedExercise = z.infer<typeof GeneratedExerciseSchema>;
export const GeneratedFileSchema = z.object({
  schema: z.literal(1), items: z.array(GeneratedExerciseSchema), solutions: z.record(z.string(), z.string()).default({}),
});
export type GeneratedFile = z.infer<typeof GeneratedFileSchema>;

/**
 * M72: a course convention (`.shalav/conventions.json`), defined by its use case: WHEN it applies, never by a question category.
 * Learned by the reconcile build step from example-solution occurrences (FileIndex.patterns) and teacher items; mirrored as a graph node (id).
 */
export const ConventionSchema = z.object({
  /** the graph node id: nodeId(stage | null, "convention", the first rule text); stays when the wording is refined */
  id: z.string(),
  /** ≤160 chars, the student's language: what the answer must do */
  rule: z.string(),
  source: z.enum(["teacher", "solutions"]),
  useCase: z.object({
    /** ≤240: the situation in words ("the answer bases a claim on a statute") */
    trigger: z.string(),
    /** what the trigger is checked against: what the question demands, what the answer does, or either */
    on: z.enum(["question", "answer", "both"]),
    /** explicit non-cases learned from the sources (absences explained by a context difference) */
    notWhen: z.array(z.string()),
    /** ≤4 short cases from the sources: where it applied, and where it clearly did not */
    examples: z.array(z.object({ quote: z.string(), applies: z.boolean() })),
    /** ≤200: the observable check that it was met */
    verify: z.string(),
    /** a similar use case with another convention, and the context that tells them apart */
    distinguishes: z.array(z.object({ from: z.string(), difference: z.string() })).default([]),
    level: z.enum(["whole", "part", "any"]),
    /** [] = the whole course */
    stageIds: z.array(stageId),
    /** a coarse prefilter only (keeps prompts short); never decides applicability */
    hints: z.object({ answerForms: z.array(AnswerFormSchema), questionTypes: z.array(IndexedExerciseSchema.shape.type) }),
  }),
  /** refs = occurrence ids (`<sha8>-o<n>`) or teacher item ids (`<sha8>-t<n>`) of that file */
  sources: z.array(z.object({ sha: z.string(), fileName: z.string(), kind: z.enum(["solution", "graded", "rubric", "remark"]), refs: z.array(z.string()), quote: z.string() })),
  status: z.enum(["active", "retired"]),
  /** split by use case: which trigger selects which rule; the teacher's wins where both still trigger */
  conflicts: z.array(z.object({ with: z.string(), resolution: z.string() })),
  addedAt: ts,
  updatedAt: ts,
  retiredAt: ts.optional(),
  /** the id of the convention that contradicted it */
  retiredBy: z.string().optional(),
});
export type Convention = z.infer<typeof ConventionSchema>;
export const ConventionsFileSchema = z.object({
  schema: z.literal(1),
  conventions: z.array(ConventionSchema),
  /** incremental reconcile: use-case key → hash of its inputs at the last reconcile (unchanged → not sent again) */
  hashes: z.record(z.string(), z.string()).default({}),
  /** similar use cases whose practices vary with no context to explain them (no convention), kept for the build log and the eval */
  inconsistent: z.array(z.object({ useCase: z.string(), practices: z.array(z.string()), refs: z.array(z.string()), at: ts })).default([]),
  updatedAt: ts,
});
export type ConventionsFile = z.infer<typeof ConventionsFileSchema>;
