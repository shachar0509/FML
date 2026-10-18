// Spec 10.9 (verbatim apart from placeholders).
import type { Lang } from "./shared";

export const summaryPrompt = (lang: Lang) =>
  `Summarize this tutoring conversation so it can replace the older messages. Keep: what was taught, in order; every check and exercise with the student's result; misconceptions shown; what the tutor planned next. Max 600 words, in ${lang}. Output plain text only.`;
