import type { Grade } from "@/core/claude/practiceTools";
/** What the server puts in `structuredContent`; `view` picks the card view (plan v2 §8). */
export type HomeData = {
  view: "home";
  language: "he" | "en";
  theme: "system" | "light" | "dark";
  /** null until the student has chosen (the card then shows the picker). */
  university: "technion" | "huji" | "reichman" | "braude" | null;
  courses: { number: string; name: string; credits: number; pct: number; stage: string | null; building?: boolean; /** M52: a custom course (no number or credits shown) */ custom?: boolean; /** the stage Learn opens, and whether Practice can open */ current?: { id: string; title: string } | null; hasPlan?: boolean }[];
};
export type Base = {
  language: "he" | "en";
  theme: "system" | "light" | "dark";
  /** M60: the card of a resumed lesson's checkpoint; its earlier slides can be browsed */
  history?: { number: string; id: string; count: number };
};
/** M60: a saved lesson or practice session in the list */
export type SavedItem = { id: string; type: "lesson" | "homework" | "single" | "test" | "normal"; title: string; updatedAt: string; stageId?: string };
export type AddData = Base & { view: "add"; example: string };
export type CustomData = Base & { view: "custom" };
export type Stage = { id: string; title: string; summary: string; status: "locked" | "available" | "in_progress" | "completed" | "completed_override"; mastery: number };
export type CourseData = Base & {
  view: "course";
  number: string;
  name: string;
  credits: number;
  /** M52: a custom course: no number, credits or Moodle */
  custom: boolean;
  pct: number;
  stagesDone: number;
  stagesTotal: number;
  current: string | null;
  hasPlan: boolean;
  /** Set while a plan build is running or after it failed. */
  build: BuildStatus | null;
  watch: { label: string; count: number; stageIds: string[] }[];
  units: { id: string; title: string; stages: Stage[] }[];
  /** M48: texts of the plan and name not yet in the settings language (0 = all shown in it), and whether a translation runs. */
  translate: { missing: number; running: boolean };
  /** M54: custom courses only (null for academic): materials from the web at the student's level, and whether a search runs. */
  web: { running: boolean; level: number } | null;
  /** M65: the student's stars (0-5, half steps; a custom course never shows below its self-rated level) and, for academic courses, the exam-ready share (0-100) */
  knowledge: { stars: number; examReady: number | null } | null;
  /** M76: the one-time study-engine download, % (null when not downloading) */
  engineInstall: number | null;
};
/** A plan build's files by scan state, materials and exercises together. */
export type FileCounts = { scanned: number; scanning: number; notScanned: number; total: number };
export type BuildStatus = { state: "none" | "running" | "done" | "failed"; step?: "plan" | "index" | "cover"; unit?: { k: number; n: number }; files?: FileCounts; error?: string | null; pending?: number };
export type LookupResult =
  | { status: "invalid" }
  /** `manual` = the university has no online catalog; `number` is the normalised course id. */
  | { status: "notfound" | "offline" | "manual"; number: string }
  | { status: "exists"; number: string }
  | { status: "found"; entry: { courseNumber: string; nameHe: string; credits: number; faculty: string; syllabusHe: string } };
export type FileRow = { sha: string; name: string; pages: number; status: "pending" | "indexing" | "indexed" | "failed"; error: string | null; exercises: number; /** exercises whose solution is printed in the file */ solved: number; done?: number; total?: number; /** read by the plan build running now (one added meanwhile waits for the next) */ inBuild?: boolean };
/** Files section of the course card (app-only `files_list`). */
export type FilesData = Base & {
  view: "files";
  number: string;
  materials: FileRow[];
  exercises: FileRow[];
  /** M70: the student's real teacher's notes and comments (graded work, rubrics, remarks) */
  teacher: FileRow[];
  moodle: MoodleState | null;
};
/** Moodle import (plan M14b). `url` null = the student must paste their Moodle address. */
export type MoodleState = {
  url: string | null;
  connected: boolean;
  /** install: downloading Shalav's browser (once); login: the window is open; sync: downloading, hidden */
  busy: "install" | "login" | "sync" | null;
  /** `code` names the failure for the card (i18n moodle.err.*); `error` is the English detail for the model. */
  /** install: percent of the browser download (total 100); sync: Moodle links handled so far (the import after it takes seconds). */
  progress?: { done: number; total: number } | null;
  last: { course: string; added: number; duplicate: number; skipped: number; error: string | null; code?: MoodleError } | null;
};
export type MoodleError = "install" | "closed" | "timeout" | "http" | "noCourse" | "login" | "failed";
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
export type McqData = Base & { view: "mcq"; checkId: string; questionMd: string; options: string[]; /** M65: how hard this question is for the student (1-5 ★), frozen when served */ stars?: number };
export type OpenData = Base & { view: "open"; checkId: string; number: string; questionMd: string; /** M65: how hard this question is for the student (1-5 ★), frozen when served */ stars?: number };
/** A drawing the tutor shows in the chat (show_figure). */
export type FigureData = Base & { view: "figure"; kind: "plot" | "geometry" | "svg"; source: string; captionMd: string };
/** One small lesson step (teach_step). */
export type StepData = Base & { view: "step"; titleMd: string; bodyMd: string; figure: Omit<FigureData, keyof Base | "view"> | null; progress?: { n: number; of: number } | null; sideMd?: string | null };
/** Exercise card (assign_exercise / app-only exercise_state). */
export type ExerciseData = Base & {
  view: "exercise";
  number: string;
  runId: string;
  difficulty: number;
  /** M65: how hard this question is for the student (1-5 ★), frozen when served */ stars?: number;
  statementMd: string;
  /** data: URIs of the figure crops */
  figures: string[];
  hints: { level: number; hintMd: string }[];
  solutionMd: string | null;
  grade: Grade | null;
  canReveal: boolean;
  busy: "grade" | "hint" | "solution" | "clue" | null;
  error: string | null;
  /** M56 solving loop: clues (with re-explanations) instead of the 3 hints; `perfect` = graded ≥95 with every final answer right */
  loop?: boolean;
  clues?: { onTrack: boolean; clueMd: string; more: string[] }[];
  clueOpen?: boolean;
  perfect?: boolean;
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
  | { kind: "M"; stars?: number; questionMd: string; options: string[]; selected: number | null; correctIndex: number | null; explanationMd: string | null }
  | { kind: "O"; stars?: number; questionMd: string; answer: string | null; result: { correct: boolean; score: number; feedbackMd: string } | null };
/** M57: the homework (or single question) in Practice. */
export type HomeworkData = {
  kind: "single" | "homework";
  how: "tutor" | "ai" | null;
  name: string;
  /** the host model is reading the uploaded pages */
  splitting: boolean;
  questions: { label: string; accepted: boolean }[];
  current: number;
  /** the loop card of the current question (tutor) */
  exercise: ExerciseData | null;
  error: string | null;
  /** where the last download was saved */
  saved?: string | null;
  /** M58 "Let the AI solve it": solutions written so far, then the PDF (`install` = % of the one-time browser download) */
  solving?: { step: "solve" | "pdf"; done: number; total: number; install: number | null } | null;
  /** the AI's solutions PDF is ready to download */
  ready?: boolean;
};
export type PracticeData = Base & {
  view: "practice";
  hw: HomeworkData | null;
  number: string;
  mode: "locked" | "choose" | "item" | "summary";
  units: { id: string; title: string }[];
  stages: { id: string; title: string }[];
  /** M64: a custom course (practice: Normal and Customized only) */
  custom: boolean;
  /** M64 Customized: every plan unit; `ready` = something up to it was learned */
  allUnits: { id: string; title: string; ready: boolean }[];
  counters: { answered: number; correct: number; avg: number };
  item: PracticeItem | null;
  /** Claude is preparing the next item or grading an answer */
  loading: boolean;
  error: string | null;
  summary: { items: number; avgScore: number; newMistakes: string[]; weakStages: { id: string; title: string }[] } | null;
  /** M59 Test practice: exam questions found / not yet served (in the session's scope), the plan's units, weak concepts, the note for the current question, the quiz-notes scope */
  test: TestData;
};
export type TestData = {
  exams: number;
  left: number;
  units: { id: string; title: string; stageIds: string[] }[];
  weak: { id: string; title: string }[];
  /** a session is running in test mode */
  active: boolean;
  note: "stern" | "weak" | "learned" | null;
  noteStage: { id: string; title: string } | null;
  /** the host model is reading the uploaded quiz notes */
  scoping: boolean;
  /** the stages the quiz notes cover, once read */
  notes: { id: string; title: string }[] | null;
  error: string | null;
};
export type CardData = HomeData | AddData | CustomData | CourseData | LessonData | McqData | OpenData | ExerciseData | FigureData | StepData | PracticeData | SettingsData;

/** What a card button asks Claude for (shalav_request); no request = "do the pending Shalav work". */
export type Req =
  /** card-only: "▶️ Building the plan" (the model serves the build lane); nothing goes to the server */
  | { kind: "build" }
  | { kind: "learn" | "relearn"; stageId: string; title: string }
  | { kind: "answer"; text: string; number?: string; files?: string[] }
  | { kind: "step"; action: "next" | "again" }
  | { kind: "step"; action: "question"; text: string }
  /** M60: continue a saved lesson */
  | { kind: "resume"; number: string; id: string };
export type Go = (req?: Req) => Promise<void>;

export type Host = {
  callTool(name: string, args?: Record<string, unknown>): Promise<{ structuredContent?: unknown; isError?: boolean }>;
  /** Puts a short user line into the chat (how card buttons ask the model for AI work). */
  say(text: string): Promise<void>;
  context(): { theme?: string; locale?: string; displayMode?: string; availableDisplayModes?: string[] };
  /** Asks the host to show the card inline, floating (pip) or full screen; resolves to the mode the host chose. */
  displayMode(mode: "inline" | "pip" | "fullscreen"): Promise<string>;
  /** Replays the latest result to a new subscriber. */
  subscribe(onData: (d: unknown) => void, onContext: () => void): () => void;
};
