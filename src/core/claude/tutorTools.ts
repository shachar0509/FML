import { z } from "zod";
import { defineTool } from "./tools";

// 6.5. Result shapes are produced by the app, not validated here.
const stageId = z.string();

export const presentMcq = defineTool(
  "present_mcq",
  "Show the student a multiple-choice question and wait for the answer. Blocking; put it last in the message.",
  z.object({
    stageId,
    questionMd: z.string(),
    options: z.array(z.string()).min(2).max(6),
    correctIndex: z.number().int().min(0),
    explanationMd: z.string(),
    conceptTags: z.array(z.string()),
  }),
);
export const askOpenQuestion = defineTool(
  "ask_open_question",
  "Ask the student an open question and wait for the written answer. Blocking; put it last in the message.",
  z.object({ stageId, questionMd: z.string(), expectedPoints: z.array(z.string()), allowAttachment: z.boolean() }),
);
export const recordCheckResult = defineTool(
  "record_check_result",
  "Record the evaluation of an open answer (or of a specific misconception revealed by a wrong MCQ answer). checkToolUseId is the id of the question's tool call.",
  z.object({
    checkToolUseId: z.string(),
    correct: z.boolean(),
    score: z.number().min(0).max(100),
    mistakes: z.array(z.object({ tag: z.string(), labelHe: z.string(), labelEn: z.string(), description: z.string() })),
  }),
);
export const assignExercise = defineTool(
  "assign_exercise",
  "Assign a full written exercise and wait for the graded result. source \"index\" needs exerciseId; source \"new\" needs statementMd and referenceSolutionMd. Blocking; put it last in the message.",
  z.object({
    stageIds: z.array(stageId),
    source: z.enum(["index", "new"]),
    exerciseId: z.string().optional(),
    statementMd: z.string().optional(),
    referenceSolutionMd: z.string().optional(),
    difficulty: z.number().int().min(1).max(5),
    edgeCaseFocus: z.array(z.string()),
  }),
);
export const updateAssessment = defineTool(
  "update_assessment",
  "Record your assessment of the student on this stage. coveredObjectives are 0-BASED indexes into the stage objectives (the first objective is 0). The result says whether the app's advancement criteria are met and what is missing.",
  z.object({
    stageId,
    mastery: z.number().min(0).max(1),
    coveredObjectives: z.array(z.number().int().min(0)),
    gaps: z.array(z.string()),
    reviewTopics: z.array(z.string()),
    readyToAdvance: z.boolean(),
    rationale: z.string(),
  }),
);
export const consultMaterials = defineTool(
  "consult_materials",
  "Look something up in the course materials (exact wording, notation, worked example, theorem form, indexed exercise statement). The answer is temporary.",
  z.object({
    question: z.string(),
    purpose: z.enum(["definition", "notation", "explanation", "example", "theorem", "exercise"]),
    stageId,
  }),
);

export type PresentMcq = z.infer<typeof presentMcq.schema>;
export type AskOpenQuestion = z.infer<typeof askOpenQuestion.schema>;
export type RecordCheckResult = z.infer<typeof recordCheckResult.schema>;
export type AssignExercise = z.infer<typeof assignExercise.schema>;
export type UpdateAssessment = z.infer<typeof updateAssessment.schema>;
export type ConsultMaterials = z.infer<typeof consultMaterials.schema>;

export const TUTOR_TOOLS = [presentMcq, askOpenQuestion, recordCheckResult, assignExercise, updateAssessment, consultMaterials].map((t) => t.def);
export const BLOCKING = new Set([presentMcq.def.name, askOpenQuestion.def.name, assignExercise.def.name]);
