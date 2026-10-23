import type { PracticeItem } from "../types";

/** U6: the student has not answered this practice item, so Next (or End in test practice) leaves it unscored. Exercise: no grade and not perfect; MCQ: nothing selected; open question: no result. */
export const unanswered = (it: PracticeItem): boolean =>
  it.kind === "E" ? !it.exercise.grade && !it.exercise.perfect : it.kind === "M" ? it.selected === null : !it.result;

/** U6: which item the card shows. The 2.5 s practice_state poll keeps it (same run id / question); the next item changes it. */
export const itemKey = (it: PracticeItem | null): string =>
  !it ? "" : it.kind === "E" ? `E:${it.exercise.runId}` : `${it.kind}:${it.questionMd}`;

/** U6: an exercise answer the grader is still checking. Skipping now leaves it unscored, but "you haven't answered" would be false. */
export const grading = (it: PracticeItem | null): boolean => it?.kind === "E" && it.exercise.busy === "grade";
