import type { Grade } from "@/core/claude/practiceTools";
/** What the server puts in `structuredContent`; `view` picks the card view (plan v2 §8). */
export type HomeData = {
  view: "home";
  language: "he" | "en";
  theme: "system" | "light" | "dark";
  /** null until the student has chosen (the card then shows the picker). */
  university: "technion" | "huji" | "reichman" | "braude" | null;
  courses: { number: string; name: string; credits: number; pct: number; stage: string | null }[];
};
export type Base = { language: "he" | "en"; theme: "system" | "light" | "dark" };
export type AddData = Base & { view: "add"; example: string };
export type Stage = { id: string; title: string; summary: string; status: "locked" | "available" | "in_progress" | "completed" | "completed_override"; mastery: number };
export type CourseData = Base & {
  view: "course";
  number: string;
  name: string;
  credits: number;
  pct: number;
  stagesDone: number;
  stagesTotal: number;
  current: string | null;
  hasPlan: boolean;
  /** Set while a plan build is running or after it failed. */
  build: BuildStatus | null;
  canPractice: boolean;
  watch: { label: string; count: number; stageIds: string[] }[];
  units: { id: string; title: string; stages: Stage[] }[];
};
export type BuildStatus = { state: "none" | "running" | "done" | "failed"; step?: "folders" | "plan" | "validate" | "progress"; unit?: { k: number; n: number }; error?: string | null; pending?: number };
export type LookupResult =
  | { status: "invalid" }
  /** `manual` = the university has no online catalog; `number` is the normalised course id. */
  | { status: "notfound" | "offline" | "manual"; number: string }
  | { status: "exists"; number: string }
  | { status: "found"; entry: { courseNumber: string; nameHe: string; credits: number; faculty: string; syllabusHe: string } };
export type FileRow = { sha: string; name: string; pages: number; status: "pending" | "indexing" | "indexed" | "failed"; error: string | null; exercises: number; done?: number; total?: number };
/** Files section of the course card (app-only `files_list`). */
export type FilesData = Base & {
  view: "files";
  number: string;
  materials: FileRow[];
  exercises: FileRow[];
  hasPlan: boolean;
  canIndex: boolean;
  canImprove: boolean;
  improving: { state: "running" | "failed"; error: string | null } | null;
  moodle: MoodleState | null;
};
/** Moodle import (plan M14b). `url` null = the student must paste their Moodle address. */
export type MoodleState = {
  url: string | null;
  connected: boolean;
  busy: "login" | "sync" | null;
  last: { course: string; added: number; duplicate: number; skipped: number; error: string | null } | null;
};
/** Lesson card (shalav_start_lesson / app-only lesson_state). */
export type LessonData = Base & {
  view: "lesson";
  number: string;
  stageId: string;
  title: string;
  status: Stage["status"];
  objectives: { text: string; covered: boolean }[];
  mastery: number;
  criteria: { met: boolean; missing: string[] };
  next: { id: string; title: string } | null;
};
/** Question cards of present_mcq / ask_open_question; the answer key stays on the server. */
export type McqData = Base & { view: "mcq"; checkId: string; questionMd: string; options: string[] };
export type OpenData = Base & { view: "open"; checkId: string; questionMd: string };
/** Exercise card (assign_exercise / app-only exercise_state). */
export type ExerciseData = Base & {
  view: "exercise";
  number: string;
  runId: string;
  difficulty: number;
  statementMd: string;
  /** data: URIs of the figure crops */
  figures: string[];
  hints: { level: number; hintMd: string }[];
  solutionMd: string | null;
  grade: Grade | null;
  canReveal: boolean;
  busy: "grade" | "hint" | "solution" | null;
  error: string | null;
};
/** Settings card (shalav_settings / app-only settings_update); `conflicts` = sync conflict copies found in the data folder. */
export type SettingsData = Base & {
  view: "settings";
  /** Locked after the first choice. */
  university: "technion" | "huji" | "reichman" | "braude" | null;
  dataRoot: string;
  learning: { minExercises: number; minExerciseScore: number; masteryThreshold: number; requireAllObjectives: boolean; hintsBeforeSolution: number };
  conflicts: string[];
};
/** Practice card (shalav_practice / app-only practice_*). */
export type PracticeItem =
  | { kind: "E"; exercise: ExerciseData }
  | { kind: "M"; questionMd: string; options: string[]; selected: number | null; correctIndex: number | null; explanationMd: string | null }
  | { kind: "O"; questionMd: string; answer: string | null; result: { correct: boolean; score: number; feedbackMd: string } | null };
export type PracticeData = Base & {
  view: "practice";
  number: string;
  mode: "locked" | "choose" | "item" | "summary";
  units: { id: string; title: string }[];
  stages: { id: string; title: string }[];
  counters: { answered: number; correct: number; avg: number };
  item: PracticeItem | null;
  /** Claude is preparing the next item or grading an answer */
  loading: boolean;
  error: string | null;
  summary: { items: number; avgScore: number; newMistakes: string[]; weakStages: { id: string; title: string }[] } | null;
};
export type CardData = HomeData | AddData | CourseData | LessonData | McqData | OpenData | ExerciseData | PracticeData | SettingsData;

export type Host = {
  callTool(name: string, args?: Record<string, unknown>): Promise<{ structuredContent?: unknown; isError?: boolean }>;
  /** Puts a short user line into the chat (how card buttons ask the model for AI work). */
  say(text: string): Promise<void>;
  context(): { theme?: string; locale?: string };
  /** Replays the latest result to a new subscriber. */
  subscribe(onData: (d: unknown) => void, onContext: () => void): () => void;
};
