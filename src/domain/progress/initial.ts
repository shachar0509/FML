import type { PlanJson, ProgressJson, StageProgress } from "@/domain/dataSchemas";

const blank = (status: StageProgress["status"]): StageProgress => ({
  status, mastery: 0, tutorMastery: null, practiceMastery: null, coveredObjectives: [], gaps: [], reviewTopics: [],
  checks: 0, correctChecks: 0, attempts: 0, correctAttempts: 0, edgeCaseCorrect: 0,
  lastActivityAt: null, completedAt: null, completedBy: null,
});

/** Spec 4.3 step 4: no events yet -> prerequisite-free stages (and S001) are available, the rest locked. Step 6 replaces this with reduceProgress. */
export function initialProgress(plan: PlanJson, now: string): ProgressJson {
  const stages: Record<string, StageProgress> = {};
  for (const s of plan.stages) stages[s.id] = blank(s.prerequisites.length === 0 || s.order === 1 ? "available" : "locked");
  return {
    schema: 1,
    courseNumber: plan.courseNumber,
    planVersion: plan.version,
    computedAt: now,
    currentStageId: plan.stages.find((s) => stages[s.id]?.status === "available")?.id ?? null,
    stages,
    mistakes: [],
    totals: { stagesTotal: plan.stages.length, stagesCompleted: 0, attempts: 0, correctAttempts: 0, checks: 0, correctChecks: 0 },
  };
}
