import { courseRef } from "@/core/universities";
// Spec 10.4 (verbatim apart from placeholders), plus the M41 notes / traps / key points.
type Head = { courseNumber: string; nameHe: string; type?: "academic" | "customCourse" };

export const materialPrompt = (c: Head, planCompact: string, lang: string) =>
  `You index pages of course material for ${courseRef(c)}.
Study plan stages:
${planCompact}
For each page below, list the stage ids whose content appears on the page (empty if none), a summary of at most 40 words in ${lang}, its notes (remarks, warnings, special cases, counterexamples, conditions such as a domain restriction; these are easy to miss and must not be lost), whether the page has a figure, and whether it contains exercises or worked problems. Call submit_material_pages.`;

export const exercisesPrompt = (c: Head, planCompact: string) =>
  `You extract exercises from pages of an exercise file of ${courseRef(c)}.
Study plan stages:
${planCompact}
Rules:
- Split every multi-part question into one exercise per part. Each part's statement must be self-contained: repeat the shared stem.
- Transcribe faithfully in Markdown with LaTeX. Do not write a solution.
- edgeCaseFocus and keyPoints: think the solution through (without writing it) and name every trap and special idea, e.g. "the answer is undefined: x = 2 is outside the domain". A trap that only this exercise has matters most.
- referenceSolutionMd: only a solution printed in the file, attached to the correct part; otherwise null.
- requiredStageIds: every stage whose content is needed to solve the exercise.
- difficulty: 1 = direct application of one definition; 2 = routine computation; 3 = typical exam part; 4 = hard exam part combining several stages; 5 = hardest exam question.
- figures: normalized bounding box (x0, y0, x1, y1) on the page covering each figure the exercise needs.
- An exercise that continues on a page outside this batch: include it only if its beginning is in this batch.
- question / part: every part of one question carries the same question number; part is the part's own mark, null for a question without parts. answerForms: everything the part's answer must contain (a graph sketch, a diagram, a table, a number, an exact formula, a proof, a written argument, code, a chosen option).
- occurrences (only from solutions PRINTED in the file, never invented): every answer-writing practice a careful grader would expect, recorded where it occurs, with that solution's own situation at that point (what the question demanded, what the answer was doing). Record the concrete situation, not a general rule: "the answer bases liability on a statute → cites the statute and section", not "law answers cite sections". One row per place.
- absences: places in the printed solutions with a similar-looking situation where a practice from occurrences was NOT followed. They tell later analysis where the practice really applies, so be precise about the situation.
Call submit_exercises.`;
