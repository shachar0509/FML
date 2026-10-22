import { isCustom, uniName } from "@/core/universities";
// Spec 10.3 (verbatim apart from placeholders).
import type { CourseJson } from "@/core/domain/dataSchemas";

export const CALIBRATION_EXAMPLE = `S001 Ordered-field axioms and immediate consequences
S002 Absolute value and the triangle inequality
S003 Bernoulli's inequality and induction-based inequalities
S004 Bounded sets; upper and lower bounds
S005 Supremum and infimum: definition and examples
S006 The epsilon-characterization of sup and inf
S007 The completeness axiom
S008 The Archimedean property
S009 Density of the rationals and irrationals
S010 Applications of completeness: integer part, existence of roots
S011 Unit integration: real numbers
S012 Sequences: definition, boundedness, monotonicity
S013 Limit of a sequence: the epsilon-N definition
S014 Proving limits from the definition (technique)
S015 Negating the limit definition; proving divergence
S016 Uniqueness of the limit and boundedness of convergent sequences`;

type Head = Pick<CourseJson, "courseNumber" | "nameHe" | "credits" | "faculty" | "syllabusHe" | "prerequisitesRaw" | "type" | "goal" | "level">;

export const LEVELS = ["has never studied it", "knows a little", "knows the basics", "is fairly comfortable with it", "is advanced"];
const custom = (c: Head) =>
  `You are designing a study plan for a self-study course "${c.nameHe}" that the student defined (no university).
What the student wants to learn:
${c.syllabusHe}
${c.goal ? `What the student wants to achieve: ${c.goal}\n` : ""}Current level: ${c.level ?? 1}/5 (the student ${LEVELS[(c.level ?? 1) - 1]}). Start where this level is: do not teach what such a learner already knows, and build on it.`;

const header = (c: Head) =>
  isCustom(c) ? custom(c) :
  `You are designing a study plan for ${uniName()} course ${c.courseNumber} "${c.nameHe}" (${c.credits} credits, faculty: ${c.faculty}).
Official syllabus:
${c.syllabusHe}
Prerequisite courses (not to be taught): ${c.prerequisitesRaw || "none"}`;

export const outlinePrompt = (c: Head, r: { min: number; max: number; target: number }, lang: string) =>
  `${header(c)}

Build the most fine-grained plan possible: learning must be truly step by step. Rules:
- Produce between ${r.min} and ${r.max} stages; aim for ${r.target}.
- One stage introduces at most two new definitions, or exactly one major theorem, or one technique. Never more.
- A theorem whose proof is examinable gets two stages: kind "theorem" (statement, meaning, use) then kind "proof".
- Each computational technique is its own "technique" stage, followed by an "applications" stage when it has several standard variants.
- Every unit ends with an "integration" stage. ${isCustom(c) ? 'The plan ends with 1-3 review and capstone stages (kind "exam-prep") that lead to what the student wants to achieve.' : 'The plan ends with 2-4 "exam-prep" stages.'}
- ${isCustom(c) ? "Order the topics the way the subject is best learned" : "Follow the syllabus order unless prerequisites force otherwise"}. Prerequisites refer only to earlier stages.
- When in doubt, split. A stage teaches one idea, using only baseline knowledge (${isCustom(c) ? "what a learner at the student's level already knows" : "Israeli 5-unit high-school math/physics and the prerequisite courses"}), earlier stages, and what it introduces itself. A supporting concept a stage needs but that was not taught earlier must be introduced in that stage (to the needed depth) or in its own earlier stage. Connections to topics taught later belong to the later stage.
- Write titles and summaries in ${lang}; add the English academic term in parentheses on first use where that is the convention.
- Decide courseKind: proof-based, computational, programming, mixed or lab.

Granularity calibration (Calculus 1, first 16 stages):
${CALIBRATION_EXAMPLE}

Call submit_plan_outline with the full outline.`;

export const tooFewMsg = (x: number, y: number) =>
  `The outline has ${x} stages; the minimum is ${y}. Split stages so each introduces at most two definitions, one theorem or one technique, and resubmit the full outline.`;
export const tooManyMsg = (x: number, y: number) =>
  `The outline has ${x} stages; the maximum is ${y}. Merge only "concept" stages and resubmit the full outline.`;

export const detailsPrompt = (c: Head, outlineWithIds: string, unit: { id: string; title: string; stageIds: string[] }, lang: string) =>
  `${header(c)}
Full outline with ids:
${outlineWithIds}

Detail every stage of unit ${unit.id} — ${unit.title}: stage ids ${unit.stageIds.join(", ")}.
For each stage give 2-6 testable objectives ("The student can ..."), the new concepts it introduces (0-3), its major theorem if any (name, precise statement, whether the proof is examinable), techniques, edge cases and pitfalls to test, exam relevance, and estimated minutes (20-45). Write in ${lang}. Call submit_unit_details with exactly these stage ids.`;
