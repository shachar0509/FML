import { z } from "zod";
import { defineTool } from "./tools";

// 7.5-7.7. Tool schemas for grading, hints, solving, generation and verification.
const severity = z.enum(["minor", "major", "critical"]);
const mistakeFull = z.object({ tag: z.string(), labelHe: z.string(), labelEn: z.string(), description: z.string() });

export const submitGrade = defineTool(
  "submit_grade",
  "Submit the grade of the student's written solution.",
  z.object({
    legibility: z.enum(["clear", "partly_illegible", "illegible"]),
    illegibleParts: z.array(z.string()),
    verdict: z.enum(["correct", "partially_correct", "incorrect", "incomplete", "unreadable"]),
    score: z.number().min(0).max(100),
    /** M56: every final answer exactly right (the score weighs the reasoning, explanations and conventions) */
    finalAnswerCorrect: z.boolean(),
    summaryMd: z.string(),
    steps: z.array(z.object({
      label: z.string(), status: z.enum(["correct", "error", "missing", "unjustified", "irrelevant"]), commentMd: z.string(),
    })),
    missingForFullCredit: z.array(z.string()),
    mistakes: z.array(mistakeFull.extend({ severity, whereMd: z.string() })),
    edgeCasesMissed: z.array(z.string()),
    correctedKeyStepMd: z.string(),
    usesMaterialBeyondCompleted: z.array(z.string()),
    stageIds: z.array(z.string()),
  }),
);
export type Grade = z.infer<typeof submitGrade.schema>;

export const submitCheckGrade = defineTool(
  "submit_check_grade",
  "Submit the grade of the student's short answer.",
  z.object({ correct: z.boolean(), score: z.number().min(0).max(100), feedbackMd: z.string(), mistakes: z.array(mistakeFull) }),
);
export type CheckGrade = z.infer<typeof submitCheckGrade.schema>;

export const submitHint = defineTool(
  "submit_hint",
  "Submit the hint.",
  z.object({ hintMd: z.string(), level: z.number().int().min(1).max(3), targetsStep: z.string() }),
);
/** M56: the solving loop's clue: the first mistake in the student's work, or one small clue for the next step. */
export const submitClue = defineTool(
  "submit_clue",
  "Submit the clue (or, when the student made a mistake, where the first mistake is).",
  z.object({ onTrack: z.boolean(), clueMd: z.string() }),
);
/** M57: the questions of an uploaded homework, transcribed. */
export const submitHomework = defineTool(
  "submit_homework",
  "Submit the questions transcribed from the homework pages.",
  z.object({ name: z.string(), questions: z.array(z.object({ label: z.string(), statementMd: z.string(), pages: z.array(z.number().int().min(1)) })).min(1).max(30) }),
);
export const submitSolution = defineTool("submit_solution", "Submit the complete solution.", z.object({ solutionMd: z.string() }));

export const submitGeneratedExercise = defineTool(
  "submit_generated_exercise",
  "Submit the new exercise with its reference solution.",
  z.object({
    statementMd: z.string(),
    referenceSolutionMd: z.string(),
    requiredStageIds: z.array(z.string()).min(1),
    difficulty: z.number().int().min(1).max(5),
    type: z.enum(["proof", "computation", "multiple_choice", "true_false", "short_answer", "coding", "design"]),
    estimatedMinutes: z.number(),
    edgeCaseFocus: z.array(z.string()),
    gradingNotes: z.string(),
  }),
);
export type GeneratedDraft = z.infer<typeof submitGeneratedExercise.schema>;

export const submitVerification = defineTool(
  "submit_verification",
  "Submit the verification of the exercise.",
  z.object({
    wellPosed: z.boolean(), solvable: z.boolean(), independentSolutionMd: z.string(), matchesReference: z.boolean(),
    requiresStagesBeyond: z.array(z.string()), issues: z.array(z.string()),
  }),
);

const checkItem = z.object({
  kind: z.enum(["mcq", "open"]),
  stageIds: z.array(z.string()).min(1),
  questionMd: z.string(),
  options: z.array(z.string()).optional(),
  correctIndex: z.number().int().min(0).optional(),
  explanationMd: z.string(),
  expectedPoints: z.array(z.string()).optional(),
}).refine((c) => c.kind !== "mcq" || (c.options?.length === 4 && c.correctIndex !== undefined && c.correctIndex < 4), {
  message: "an mcq needs exactly 4 options and a correctIndex 0-3",
}).refine((c) => c.kind !== "open" || !!c.expectedPoints?.length, { message: "an open question needs expectedPoints" });
export const submitPracticeCheck = defineTool(
  "submit_practice_check",
  "Submit exactly 4 questions: 2 mcq and 2 open.",
  z.object({ items: z.array(checkItem).length(4) }),
);
export type CheckItem = z.infer<typeof checkItem>;
