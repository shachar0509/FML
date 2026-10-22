import { z } from "zod";
import type { ToolDef } from "./types";
import { AnswerFormSchema } from "@/core/domain/dataSchemas";

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

// 5.5 / 5.6 / 10.4
export const submitMaterialPages = defineTool(
  "submit_material_pages",
  "Submit the index entry of every page in the batch.",
  z.object({
    pages: z.array(
      z.object({
        page: z.number().int(),
        stageIds: z.array(z.string()),
        summary: z.string(),
        notes: z.array(z.string()).describe("Remarks, warnings, special cases, counterexamples and conditions printed on the page (e.g. a domain restriction), one short line each, in the page's words; empty if none").default([]),
        hasFigure: z.boolean(),
        hasExercises: z.boolean(),
      }),
    ),
  }),
);
export const submitExercises = defineTool(
  "submit_exercises",
  "Submit the exercises whose beginning is in this batch of pages.",
  z.object({
    exercises: z.array(
      z.object({
        label: z.string(),
        pages: z.array(z.number().int()),
        statementMd: z.string(),
        figures: z.array(z.object({ page: z.number().int(), bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]) })),
        referenceSolutionMd: z.string().nullable(),
        requiredStageIds: z.array(z.string()),
        difficulty: z.number().int().min(1).max(5),
        type: z.enum(["proof", "computation", "multiple_choice", "true_false", "short_answer", "coding", "design"]),
        estimatedMinutes: z.number(),
        edgeCaseFocus: z.array(z.string()).describe("Traps a careful solver must check, one short line each: a domain of definition, division by zero, a boundary or degenerate case, a condition that makes the answer undefined or not exist, a hypothesis that fails. Include traps you see only by thinking the solution through, even if no solution is printed; empty if none").default([]),
        keyPoints: z.array(z.string()).describe("The specific idea, trick or condition this exercise needs beyond the routine method of its topic, one short line each; empty if it is routine").default([]),
        gist: z.string(),
        answerForms: z.array(AnswerFormSchema).describe("What the answer to this part must contain: graph (a sketch or plot), drawing (a diagram), table, numeric (a number, often with units), formula (an exact expression), proof, written (an explanation or argument in words), code, choice (pick an option); several may apply").default([]),
        question: z.string().describe("The number of the question this part belongs to, as printed (e.g. \"2\"); the same on every part of one question").default(""),
        part: z.string().nullable().describe("The part's own mark as printed (e.g. \"a\", \"ii\"); null for a question without parts").default(null),
      }),
    ),
    occurrences: z.array(z.object({
      label: z.string().describe("The label of the part whose printed solution shows it"),
      useCase: z.string().describe("This solution's own situation at that point, concretely: what the question demanded and what the answer was doing (e.g. \"the answer bases the duty of care on a statute\")"),
      practice: z.string().describe("What the solution did there that a careful grader would expect (e.g. \"cites the statute and its section number\")"),
    })).describe("Answer-writing practices seen in the PRINTED solutions of this batch, one row per place they occur; empty when no solution is printed").default([]),
    absences: z.array(z.object({
      label: z.string(),
      useCase: z.string().describe("A situation in a printed solution that resembles one listed in occurrences"),
      practice: z.string().describe("The practice from occurrences that this solution did NOT follow there"),
    })).describe("Places in the printed solutions where a practice listed in occurrences was NOT followed in a similar-looking situation; empty if none").default([]),
  }),
);
