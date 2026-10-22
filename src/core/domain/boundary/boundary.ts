import { LEVELS } from "@/core/claude/prompts/plan";
import type { CourseJson, PlanJson, ProgressJson, Stage } from "@/core/domain/dataSchemas";
import { isCustom } from "@/core/universities";

type In = {
  course: Pick<CourseJson, "prerequisitesRaw"> & Partial<Pick<CourseJson, "type" | "level">>;
  plan: PlanJson;
  progress: ProgressJson;
  currentStageId: string | null;
  hasPhysics?: boolean;
};

const line = (s: Stage) =>
  `${s.id} ${s.title}: ${[s.newConcepts, s.theorems.map((t) => t.name), s.techniques].map((x) => x.join(", ")).join("; ")}`;

/** Spec 6.8. */
export function buildKnowledgeBoundary({ course, plan, progress, currentStageId, hasPhysics }: In): string {
  const done = (s: Stage) => ["completed", "completed_override"].includes(progress.stages[s.id]?.status ?? "");
  const stages = [...plan.stages].sort((a, b) => a.order - b.order);
  const learned = stages.filter(done);
  const current = stages.find((s) => s.id === currentStageId);
  const later = stages.filter((s) => !done(s) && s.id !== currentStageId);
  return [
    "KNOWLEDGE BOUNDARY",
    "Allowed (use freely):",
    isCustom(course)
      ? `- Baseline: what a learner who ${LEVELS[(course.level ?? 1) - 1]} in this subject already knows`
      : `- Baseline: high-school 5-unit mathematics${hasPhysics ? ", physics" : ""}; prerequisite courses: ${course.prerequisitesRaw}`,
    `- Learned: ${learned.map(line).join(" | ") || "(nothing yet)"}`,
    ...(current ? [`- Being learned now: ${line(current)}`] : []),
    `Not learned yet (do not use, mention or preview): ${later.map((s) => `${s.id} ${s.title}`).join("; ") || "(none)"}`,
  ].join("\n");
}
