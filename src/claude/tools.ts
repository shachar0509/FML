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
