import "@/index.css";
import "./cards.css";
import "@/core/i18n";
import { createRoot } from "react-dom/client";
import { Cards } from "./Cards";
import type { CardData, CourseData, FilesData, HomeData, Host, ExerciseData, PracticeData, SettingsData, LessonData, LookupResult, McqData, OpenData, FigureData, StepData } from "./types";

/** Playwright test host: a fake bridge instead of Claude Desktop. ?lang=&theme=&empty=1 ; sent messages land in window.__said. */
const q = new URLSearchParams(location.search);
const lang = q.get("lang") === "en" ? "en" : "he";
const home: HomeData = {
  view: "home",
  language: lang,
  theme: "system",
  university: q.get("nouni") ? null : "technion",
  courses: q.get("empty")
    ? []
    : [
        { number: "01040195", name: lang === "he" ? "חשבון אינפיניטסימלי 1" : "Infinitesimal Calculus 1", credits: 5.5, pct: 35, stage: "S12 · Limits of sequences" },
        { number: "02340117", name: lang === "he" ? "מבוא למדעי המחשב" : "Intro to Computer Science", credits: 4, pct: 0, stage: null },
      ],
};
const st = (id: string, title: string, status: CourseData["units"][number]["stages"][number]["status"], mastery: number) => ({ id, title, summary: `${title} summary`, status, mastery });
const course: CourseData = {
  view: "course", language: lang, theme: "system", number: "01040195", name: home.courses[0]?.name ?? "Calculus", credits: 5.5, pct: 17, stagesDone: 1, stagesTotal: 3,
  current: "S002", hasPlan: true, build: null, canPractice: true,
  watch: [{ label: lang === "he" ? "שכחו את תנאי ההתכנסות" : "Forgot the convergence condition", count: 3, stageIds: ["S002"] }],
  units: [{ id: "U01", title: lang === "he" ? "סדרות" : "Sequences", stages: [st("S001", "Definition", "completed", 90), st("S002", "Limits", "in_progress", 40), st("S003", "Squeeze", "locked", 0)] }],
};
const found: LookupResult = { status: "found", entry: { courseNumber: "01040195", nameHe: "חשבון אינפיניטסימלי 1", credits: 5.5, faculty: "מתמטיקה", syllabusHe: "קדם: 01040031\nסדרות, גבולות, רציפות" } };
const files: FilesData = {
  view: "files", language: lang, theme: "system", number: "01040195", moodle: { url: "https://moodle.example.ac.il/", connected: false, busy: null, last: null },
  materials: [{ sha: "a1", name: "lecture1.pdf", pages: 12, status: "indexed", error: null, exercises: 0 }, { sha: "a2", name: "lecture2.pdf", pages: 9, status: "pending", error: null, exercises: 0 }],
  exercises: [{ sha: "b1", name: "hw1.pdf", pages: 3, status: "indexed", error: null, exercises: 5 }],
};
const base = { language: lang, theme: "system" } as const;
const lesson: LessonData = {
  ...base, view: "lesson", number: "01040195", stageId: "S002", title: "Limits of sequences", status: "in_progress", mastery: 40, next: { id: "S003", title: "Squeeze" },
  objectives: [{ text: "State the $\\varepsilon$-$N$ definition", covered: true }, { text: "Prove a limit from the definition", covered: false }],
  criteria: { met: false, missing: ["Solve 2 more exercises with score ≥ 85"] },
};
const mcq: McqData = { ...base, view: "mcq", checkId: "c1", questionMd: "Which holds for $a_n = 1/n$?", options: ["$a_n \\to 0$", "$a_n \\to 1$", "diverges"] };
const open: OpenData = { ...base, view: "open", checkId: "c2", questionMd: "Explain why $\\lim 1/n = 0$." };
const exercise: ExerciseData = {
  ...base, view: "exercise", number: "01040195", runId: "r1", difficulty: 3, statementMd: "Prove that $\\lim 1/n = 0$.", figures: [], hints: [], solutionMd: null, grade: null, canReveal: false, busy: null, error: null,
};
const graded: ExerciseData = {
  ...exercise, canReveal: true,
  grade: {
    legibility: "clear", illegibleParts: [], verdict: "partially_correct", score: 70, summaryMd: "Good start, the choice of $N$ is missing.",
    steps: [{ label: "Setup", status: "correct", commentMd: "Fine." }, { label: "Choose $N$", status: "missing", commentMd: "No $N$ given." }],
    missingForFullCredit: ["explicit N"], mistakes: [], edgeCasesMissed: [], correctedKeyStepMd: "Take $N > 1/\\varepsilon$.", usesMaterialBeyondCompleted: [], stageIds: ["S002"],
  },
};
const practiceBase: PracticeData = {
  ...base, view: "practice", number: "01040195", mode: "choose", units: [{ id: "U01", title: "Limits" }], stages: [{ id: "S001", title: "Sequences" }],
  counters: { answered: 0, correct: 0, avg: 0 }, item: null, loading: false, error: null, summary: null,
};
const mcqItem: PracticeData = { ...practiceBase, mode: "item", item: { kind: "M", questionMd: "Does $a_n=1/n$ converge?", options: ["Yes, to 0", "No", "Yes, to 1", "Only for even n"], selected: null, correctIndex: null, explanationMd: null } };
const mcqDone: PracticeData = { ...mcqItem, counters: { answered: 1, correct: 0, avg: 0 }, item: { ...(mcqItem.item as Extract<PracticeData["item"], { kind: "M" }>), selected: 1, correctIndex: 0, explanationMd: "Since $1/n \\to 0$." } };
const practiceSummary: PracticeData = { ...practiceBase, mode: "summary", summary: { items: 1, avgScore: 0, newMistakes: ["Sign slip"], weakStages: [{ id: "S001", title: "Sequences" }] } };
const practiceReply: Record<string, PracticeData> = { practice_start_request: mcqItem, practice_next_request: mcqItem, practice_answer_mcq: mcqDone, practice_end: practiceSummary, practice_state: practiceBase };
const settings: SettingsData = { ...base, view: "settings", university: "technion", dataRoot: "/Users/me/Documents/Shalav", learning: { minExercises: 2, minExerciseScore: 85, masteryThreshold: 0.85, requireAllObjectives: true, hintsBeforeSolution: 3 }, conflicts: ["courses/01040195/.shalav/events/dev1 (1).jsonl"] };
const figure: FigureData = { ...base, view: "figure", kind: "plot", source: JSON.stringify({ xDomain: [-2, 2], yDomain: [-1, 4], data: [{ fn: "x^2", label: "f" }] }), captionMd: "$f(x)=x^2$" };
const step: StepData = { ...base, view: "step", titleMd: "אקסיומות הכפל", bodyMd: "לכל $\\blue{a}, \\green{b}, \\pink{c} \\in \\R$:\n\n9. **איבר יחידה:** קיים $1 \\neq 0$ כך ש-$a \\cdot 1 = a$\n10. **איבר הופכי:** לכל $a \\ne 0$ קיים $a^{-1}$ כך ש-$a \\cdot a^{-1} = 1$\n\n$$\n\\begin{aligned} 0 \\cdot a &= (0+0) \\cdot a && \\text{(4)} \\\\ &= 0 \\cdot a + 0 \\cdot a && \\text{(11)} \\end{aligned}\n$$\n\nלכן $0 \\cdot a = 0$, ו-$0 \\not= 1$.", figure: { kind: figure.kind, source: figure.source, captionMd: "" }, progress: { n: 2, of: 5 } };
const initial: CardData = ({ lesson, mcq, open, figure, step, exercise, practice: practiceBase, settings } as Record<string, CardData>)[q.get("view") ?? ""] ?? home;
const said: string[] = [];
let mode = "inline";
const reqs: unknown[] = [];
let created = false; // after course_create_request the course has no plan yet
const noPlan: CourseData = { ...course, hasPlan: false, pct: 0, stagesDone: 0, stagesTotal: 0, current: null, canPractice: false, watch: [], units: [] };
(window as unknown as { __said: string[]; __reqs: unknown[] }).__said = said;
(window as unknown as { __reqs: unknown[] }).__reqs = reqs;
const host: Host = {
  callTool: async (name, args) => (name === "shalav_request" && reqs.push(args), name === "course_create_request" && (created = true), {
    structuredContent: practiceReply[name] ?? (name === "shalav_settings" ? settings : name === "settings_update" ? { ...settings, learning: { ...settings.learning, minExercises: 3 } } : undefined) ?? (name === "course_lookup" ? found : name === "shalav_home" ? home : name === "shalav_course" ? (created ? noPlan : course) : name === "course_create_request" ? { ok: true, number: "01040195" } : name === "files_list" ? files : name === "lesson_state" ? lesson : name === "stage_complete" ? { ...lesson, status: "completed_override" } : name === "stage_reopen" ? lesson : name === "check_answer" ? { selectedIndex: 1, correct: false, correctIndex: 0, explanationMd: "Since $1/n \\to 0$." } : name === "attachment_upload" ? { files: [{ sha256: "a".repeat(64), mediaType: "image/jpeg" }] } : name === "exercise_grade_request" || name === "exercise_state" ? graded : name === "moodle_import" ? { ok: true } : name === "course_status" ? { state: "running", step: "plan", unit: { k: 1, n: 4 }, pending: 1 } : { ok: true }),
  }),
  say: async (t) => void said.push(t),
  context: () => ({ theme: q.get("theme") ?? undefined, availableDisplayModes: ["inline", "pip"], displayMode: mode }),
  displayMode: async (m) => (mode = m),
  subscribe: (onData) => (onData(initial), () => undefined),
};
createRoot(document.getElementById("root") as HTMLElement).render(<Cards host={host} />);
