import {
  CourseJsonSchema, DeviceJsonSchema, EventSchema, FileIndexSchema, GeneratedFileSchema,
  PlanJsonSchema, ProgressJsonSchema, SessionLineSchema, ShalavJsonSchema,
} from "./dataSchemas";

const T = "2026-01-01T00:00:00.000Z";
const course = {
  schema: 1, courseNumber: "01040195", nameHe: "חדוא", credits: 5.5, faculty: "מתמטיקה", syllabusHe: "x",
  prerequisitesRaw: "", catalogSemester: null, courseKind: "proof-based", planVersion: 1, createdAt: T, updatedAt: T,
};
const stage = {
  id: "S001", unitId: "U01", order: 1, title: "t", summary: "s", kind: "concept", objectives: ["a", "b"],
  newConcepts: [], theorems: [], techniques: [], prerequisites: [], edgeCases: [], examRelevance: "core", estimatedMinutes: 30,
};
const plan = {
  schema: 1, courseNumber: "01040195", version: 1, generatedAt: T, model: "m", courseKind: "mixed",
  units: [{ id: "U01", title: "u", summary: "s", stageIds: ["S001"] }], stages: [stage],
};
const ev = { id: "e1", ts: T, deviceId: "d", courseNumber: "01040195" };
const attempt = {
  ...ev, type: "attempt_graded", attemptId: "a", exercise: { source: "index", id: "x" }, stageIds: ["S001"],
  context: "learn", verdict: "correct", score: 1, mistakes: [{ tag: "t", severity: "minor", note: "n" }],
  missingForFullCredit: 0, edgeCasesMissed: [], attachmentHashes: [], difficulty: 3, hasEdgeCaseFocus: false,
  hintsUsed: 0, solutionRevealedBefore: false,
};
const exercise = {
  id: "abcd1234-1", label: "q", pages: [1], statementMd: "s", figureCrops: [{ page: 1, bbox: [0, 0, 1, 1], file: "f.png" }],
  referenceSolutionMd: null, requiredStageIds: ["S001"], primaryStageId: "S001", difficulty: 2, type: "proof",
  estimatedMinutes: 5, edgeCaseFocus: [], gist: "g",
};
const stageProgress = {
  status: "available", mastery: 0, tutorMastery: null, practiceMastery: null, coveredObjectives: [], gaps: [],
  reviewTopics: [], checks: 0, correctChecks: 0, attempts: 0, correctAttempts: 0, edgeCaseCorrect: 0,
  lastActivityAt: null, completedAt: null, completedBy: null,
};

describe("dataSchemas", () => {
  it("shalav.json / device.json", () => {
    expect(ShalavJsonSchema.safeParse({ formatVersion: 1, createdAt: T }).success).toBe(true);
    expect(ShalavJsonSchema.safeParse({ formatVersion: 2, createdAt: T }).success).toBe(false);
    expect(DeviceJsonSchema.safeParse({ deviceId: "01ABC" }).success).toBe(true);
    expect(DeviceJsonSchema.safeParse({}).success).toBe(false);
  });
  it("course", () => {
    expect(CourseJsonSchema.safeParse(course).success).toBe(true);
    expect(CourseJsonSchema.safeParse({ ...course, courseNumber: "a/b" }).success).toBe(false);
  });
  it("plan", () => {
    expect(PlanJsonSchema.safeParse(plan).success).toBe(true);
    expect(PlanJsonSchema.safeParse({ ...plan, stages: [{ ...stage, id: "S1" }] }).success).toBe(false);
  });
  it("events", () => {
    expect(EventSchema.safeParse(attempt).success).toBe(true);
    expect(EventSchema.safeParse({ ...ev, type: "stage_reopened", stageId: "S001" }).success).toBe(true);
    expect(EventSchema.safeParse({ ...ev, type: "plan_replaced", fromVersion: 1, toVersion: 2, idMap: { S001: null } }).success).toBe(true);
    const long = { ...attempt, mistakes: [{ tag: "t", severity: "minor", note: "x".repeat(121) }] };
    expect(EventSchema.safeParse(long).success).toBe(false);
    expect(EventSchema.safeParse({ ...ev, type: "nope" }).success).toBe(false);
  });
  it("progress", () => {
    const p = {
      schema: 1, courseNumber: "01040195", planVersion: 1, computedAt: T, currentStageId: "S001",
      stages: { S001: stageProgress }, mistakes: [],
      totals: { stagesTotal: 1, stagesCompleted: 0, attempts: 0, correctAttempts: 0, checks: 0, correctChecks: 0 },
    };
    expect(ProgressJsonSchema.safeParse(p).success).toBe(true);
    expect(ProgressJsonSchema.safeParse({ ...p, stages: { S001: { ...stageProgress, status: "x" } } }).success).toBe(false);
  });
  it("session lines", () => {
    const m = { kind: "message", id: "1", ts: T, deviceId: "d", role: "user", content: [{ type: "text", text: "hi" }] };
    expect(SessionLineSchema.safeParse(m).success).toBe(true);
    expect(SessionLineSchema.safeParse({ ...m, content: [{ type: "image_ref", sha256: "a", mediaType: "image/gif" }] }).success).toBe(false);
  });
  it("file index + generated", () => {
    const f = {
      schema: 1, sha256: "a", fileName: "f.pdf", relPath: "p", role: "exercises", mediaType: "application/pdf", pageCount: 1,
      addedAt: T, status: "indexed", error: null, indexedAt: T, indexModel: "m", planVersion: 1,
      materialPages: [], exercises: [exercise],
    };
    expect(FileIndexSchema.safeParse(f).success).toBe(true);
    expect(FileIndexSchema.safeParse({ ...f, exercises: [{ ...exercise, difficulty: 6 }] }).success).toBe(false);
    expect(FileIndexSchema.safeParse({ ...f, exercises: [{ ...exercise, figureCrops: [{ page: 1, bbox: [0, 0, 1], file: "f" }] }] }).success).toBe(false);
    const g = { ...exercise, pages: [], origin: "generated", styleRefIds: [], referenceSolutionMd: "r", verified: true, createdAt: T };
    expect(GeneratedFileSchema.safeParse({ schema: 1, items: [g] }).success).toBe(true);
    expect(GeneratedFileSchema.safeParse({ schema: 1, items: [{ ...g, referenceSolutionMd: null }] }).success).toBe(false);
  });
});
