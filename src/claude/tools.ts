import { z } from "zod";
import type { ToolDef } from "./types";

/** A tool = its JSON Schema (sent to the API) + the zod mirror used to validate the result (9.3). */
export type Tool<T extends z.ZodType> = { def: ToolDef; schema: T };

export function defineTool<T extends z.ZodType>(name: string, description: string, schema: T): Tool<T> {
  const input_schema = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete input_schema.$schema;
  return { def: { name, description, input_schema }, schema };
}

const Coverage = z.enum(["full", "partial", "none"]);

// 9.9
export const submitRetrieval = defineTool(
  "submit_retrieval",
  "Submit the answer found in the course materials.",
  z.object({
    answerMd: z.string(),
    coverage: Coverage,
    sources: z.array(z.string()),
    quotes: z.array(z.string()),
  }),
);
export const submitLessonBrief = defineTool(
  "submit_lesson_brief",
  "Submit the lesson brief for the stage.",
  z.object({ briefMd: z.string(), coverage: Coverage, sources: z.array(z.string()) }),
);
// Remaining tools (tutor 6.5, plan 10.3, index 10.4, grading 10.5, ...) are added with the step that owns them.

// 4.5 / 10.3
export const StageKindSchema = z.enum(["concept", "definition", "theorem", "proof", "technique", "applications", "integration", "exam-prep"]);
export const submitPlanOutline = defineTool(
  "submit_plan_outline",
  "Submit the full fine-grained plan outline.",
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
                prerequisites: z.array(z.number().int()).describe("1-based global stage positions in the outline"),
              }),
            )
            .min(1),
        }),
      )
      .min(1),
  }),
);
export type PlanOutline = z.infer<typeof submitPlanOutline.schema>;
export const submitUnitDetails = defineTool(
  "submit_unit_details",
  "Submit the details of every stage of the requested unit.",
  z.object({
    stages: z.array(
      z.object({
        id: z.string(),
        objectives: z.array(z.string()).min(2).max(6),
        newConcepts: z.array(z.string()).max(3),
        theorems: z.array(z.object({ name: z.string(), statement: z.string(), proofRequired: z.boolean() })).max(1),
        techniques: z.array(z.string()),
        edgeCases: z.array(z.string()),
        examRelevance: z.enum(["core", "common", "occasional"]),
        estimatedMinutes: z.number(),
      }),
    ),
  }),
);
export type UnitDetails = z.infer<typeof submitUnitDetails.schema>;
