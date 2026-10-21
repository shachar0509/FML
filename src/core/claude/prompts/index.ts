import { uniName } from "@/core/universities";
// Spec 10.4 (verbatim apart from placeholders).
type Head = { courseNumber: string; nameHe: string };

export const materialPrompt = (c: Head, planCompact: string, lang: string) =>
  `You index pages of course material for ${uniName()} course ${c.courseNumber} "${c.nameHe}".
Study plan stages:
${planCompact}
For each page below, list the stage ids whose content appears on the page (empty if none), a summary of at most 40 words in ${lang}, whether the page has a figure, and whether it contains exercises or worked problems. Call submit_material_pages.`;

export const exercisesPrompt = (c: Head, planCompact: string) =>
  `You extract exercises from pages of a ${uniName()} course exercise file (${c.courseNumber} "${c.nameHe}").
Study plan stages:
${planCompact}
Rules:
- Split every multi-part question into one exercise per part. Each part's statement must be self-contained: repeat the shared stem.
- Transcribe faithfully in Markdown with LaTeX. Do not solve.
- referenceSolutionMd: only a solution printed in the file, attached to the correct part; otherwise null.
- requiredStageIds: every stage whose content is needed to solve the exercise.
- difficulty: 1 = direct application of one definition; 2 = routine computation; 3 = typical exam part; 4 = hard exam part combining several stages; 5 = hardest exam question.
- figures: normalized bounding box (x0, y0, x1, y1) on the page covering each figure the exercise needs.
- An exercise that continues on a page outside this batch: include it only if its beginning is in this batch.
Call submit_exercises.`;
