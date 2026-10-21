import { uniName } from "@/core/universities";
// Spec 4.6.
import type { CourseJson } from "@/core/domain/dataSchemas";

export const refinePrompt = (c: Pick<CourseJson, "courseNumber" | "nameHe" | "credits" | "syllabusHe">, plan: string, materials: string, lang: string, exercises = "") =>
  `You are improving the study plan of ${uniName()} course ${c.courseNumber} "${c.nameHe}" (${c.credits} credits) using the student's own course materials.
Official syllabus:
${c.syllabusHe}

Current plan (stage ids, kinds, titles, summaries):
${plan}

Indexed course materials, page summaries grouped by file:
${materials}

Example exercises from the course, grouped by file (label [type]: start of the statement):
${exercises || "none"}

Return the full revised outline. Rules:
- Never delete or merge stages: every current stage id must appear as "sourceId" on at least one revised stage.
- You may edit titles and summaries so they match the terminology and emphasis of the materials.
- You may split a stage into 2-3 stages when the materials treat it in more depth; all parts carry the original "sourceId".
- Coverage: every topic, method and type of question that appears in the materials or in the example exercises must be taught by some stage, so the student can solve every example exercise. Insert new stages for anything missing (sourceId null). Keep the same granularity: one idea per stage. If everything is covered, return the current outline unchanged.
- Keep the stage order sensible; prerequisites are 1-based positions in your revised outline and must point to earlier stages.
- Write titles and summaries in ${lang}.

Call submit_plan_revision with the full revised outline.`;

export const revisionFixMsg = (errs: string[]) => `The revision is invalid:\n${errs.join("\n")}\nResubmit the full revised outline.`;
