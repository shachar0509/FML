import { expect, it } from "vitest";
import type { ExerciseData, PracticeItem } from "../types";
import { grading, itemKey, unanswered } from "./practiceSkip";

type E = Extract<PracticeItem, { kind: "E" }>;
type M = Extract<PracticeItem, { kind: "M" }>;
type O = Extract<PracticeItem, { kind: "O" }>;
const ex = { runId: "practice-1-s-3", grade: null, perfect: false } as unknown as ExerciseData;
const grade = { score: 40 } as unknown as NonNullable<ExerciseData["grade"]>;
const e: E = { kind: "E", exercise: ex };
const m: M = { kind: "M", questionMd: "q", options: ["a", "b"], selected: null, correctIndex: null, explanationMd: null };
const o: O = { kind: "O", questionMd: "q", answer: null, result: null };

it("unanswered, per item type (U6)", () => {
  expect(unanswered(e)).toBe(true);
  expect(unanswered({ ...e, exercise: { ...ex, grade } })).toBe(false); // graded, even with a low score
  expect(unanswered({ ...e, exercise: { ...ex, perfect: true } })).toBe(false);
  expect(unanswered({ ...e, exercise: { ...ex, perfect: undefined } })).toBe(true); // old runs without the M56 flag
  expect(unanswered(m)).toBe(true);
  expect(unanswered({ ...m, selected: 0 })).toBe(false); // index 0 is an answer
  expect(unanswered(o)).toBe(true);
  expect(unanswered({ ...o, answer: "x" })).toBe(true); // text without a result is not graded yet
  expect(unanswered({ ...o, answer: "x", result: { correct: false, score: 0, feedbackMd: "" } })).toBe(false);
});

it("itemKey: the same item after a poll, a new key for the next item (U6)", () => {
  expect(itemKey(null)).toBe("");
  expect(itemKey({ ...e, exercise: { ...ex, grade } })).toBe(itemKey(e)); // a poll changes the grade, not the item
  expect(itemKey({ ...e, exercise: { ...ex, runId: "practice-1-s-4" } })).not.toBe(itemKey(e));
  expect(itemKey({ ...m, selected: 1 })).toBe(itemKey(m));
  expect(itemKey(m)).not.toBe(itemKey(o)); // same text, other kind
  expect(itemKey({ ...o, questionMd: "q2" })).not.toBe(itemKey(o));
});

it("grading: only an exercise whose answer is being checked (U6)", () => {
  expect(grading({ ...e, exercise: { ...ex, busy: "grade" } })).toBe(true);
  expect(unanswered({ ...e, exercise: { ...ex, busy: "grade" } })).toBe(true); // still asks: the answer would be lost
  expect(grading({ ...e, exercise: { ...ex, busy: "hint" } })).toBe(false);
  expect(grading({ ...e, exercise: { ...ex, busy: null } })).toBe(false);
  expect(grading(m)).toBe(false);
  expect(grading(null)).toBe(false);
});
