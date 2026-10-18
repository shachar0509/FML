import { z } from "zod";
import { defineTool, StageKindSchema } from "@/claude/tools";

/** 4.6: same shape as submit_plan_outline, plus `sourceId` on each stage (null = inserted). */
export const submitPlanRevision = defineTool(
  "submit_plan_revision",
  "Submit the full revised plan outline.",
  z.object({
    courseKind: z.enum(["proof-based", "computational", "programming", "mixed", "lab"]),
    units: z
      .array(
        z.object({
          title: z.string(),
          summary: z.string(),
          stages: z
            .array(
              z.object({
                title: z.string(),
                kind: StageKindSchema,
                summary: z.string(),
                prerequisites: z.array(z.number().int()).describe("1-based global stage positions in the revised outline"),
                sourceId: z.string().nullable().describe('Id of the current stage this one comes from, e.g. "S014"; null for a newly inserted stage'),
              }),
            )
            .min(1),
        }),
      )
      .min(1),
  }),
);
export type PlanRevision = z.infer<typeof submitPlanRevision.schema>;
