import "@/index.css";
import "./cards.css";
import "@/core/i18n";
import { createRoot } from "react-dom/client";
import { Cards } from "./Cards";
import { ADVANCED } from "./test-advanced";
import type { CardData, CourseData, FileRow, FilesData, HomeData, Host, ExerciseData, PracticeData, SettingsData, LessonData, LookupResult, McqData, OpenData, FigureData, StepData } from "./types";

/** Playwright test host: a fake bridge instead of Claude Desktop. ?lang=&theme=&empty=1 ; sent messages land in window.__said. */
const q = new URLSearchParams(location.search);
const lang = q.get("lang") === "en" ? "en" : "he";
/** Sample content in the card language, like real content (English only in math). */
const L = (he: string, en: string) => (lang === "he" ? he : en);
const home: HomeData = {
  view: "home",
  language: lang,
  theme: "system",
  university: q.get("nouni") ? null : "technion",
  courses: q.get("empty")
    ? []
    : [
        { number: "01040195", name: lang === "he" ? "חשבון אינפיניטסימלי 1" : "Infinitesimal Calculus 1", credits: 5.5, pct: 35, stage: L("S12 · גבולות של סדרות", "S12 · Limits of sequences") },
        { number: "02340117", name: lang === "he" ? "מבוא למדעי המחשב" : "Intro to Computer Science", credits: 4, pct: 0, stage: null },
        // ?custom=1: also a custom course (no number or credits shown)
        ...(q.get("custom") ? [{ number: "Cm1abc", name: L("תורת המוזיקה לגיטרה", "Music theory for guitar"), credits: 0, pct: 10, stage: null, custom: true }] : []),
      ],
};
const st = (id: string, title: string, status: CourseData["units"][number]["stages"][number]["status"], mastery: number) => ({ id, title, summary: L(`תקציר: ${title}`, `${title} summary`), status, mastery });
const course: CourseData = {
  view: "course", language: lang, theme: "system", number: "01040195", name: home.courses[0]?.name ?? "Calculus", credits: 5.5, pct: 17, stagesDone: 1, stagesTotal: 3,
  current: "S002", hasPlan: true, build: null, canPractice: true, custom: false, web: null, translate: { missing: q.get("tr") ? 12 : 0, running: false },
  watch: [{ label: lang === "he" ? "שכחו את תנאי ההתכנסות" : "Forgot the convergence condition", count: 3, stageIds: ["S002"] }],
  units: [{ id: "U01", title: lang === "he" ? "סדרות" : "Sequences", stages: [st("S001", L("הגדרה", "Definition"), "completed", 90), st("S002", L("גבולות", "Limits"), "in_progress", 40), st("S003", L("כלל הסנדוויץ'", "Squeeze"), "locked", 0)] },
    // ?del=1: a second unit, so a whole unit can be deleted
    ...(q.get("del") ? [{ id: "U02", title: L("טורים", "Series"), stages: [st("S004", L("טור הנדסי", "Geometric series"), "locked", 0), st("S005", L("מבחן ההשוואה", "Comparison test"), "locked", 0)] }] : [])],
};
// 21 more files (Hebrew and English names, mixed states) for the pager, filter and sort
const many = Array.from({ length: 21 }, (_, i) => ({ sha: `m${i}`, name: i % 2 ? `notes ${i}.pdf` : `הרצאה ${i}.pdf`, pages: 2, status: (["indexed", "indexing", "pending"] as const)[i % 3] ?? "pending", error: null, exercises: 0, solved: 0 }));
const found: LookupResult = { status: "found", entry: { courseNumber: "01040195", nameHe: "חשבון אינפיניטסימלי 1", credits: 5.5, faculty: "מתמטיקה", syllabusHe: "קדם: 01040031\nסדרות, גבולות, רציפות" } };
// ?files=read: every file indexed (Update plan disabled); ?files=importing: a Moodle import at 3 of 8 links; ?files=installing: the browser download at 42%
const files: FilesData = {
  view: "files", language: lang, theme: "system", number: "01040195",
  moodle: { url: "https://moodle.example.ac.il/", connected: q.get("files") === "importing", busy: q.get("files") === "importing" ? "sync" : q.get("files") === "installing" ? "install" : null, last: null, progress: q.get("files") === "importing" ? { done: 3, total: 8 } : q.get("files") === "installing" ? { done: 42, total: 100 } : null },
  materials: [{ sha: "a1", name: "lecture1.pdf", pages: 12, status: "indexed", error: null, exercises: 0, solved: 0 }, { sha: "a2", name: "lecture2.pdf", pages: 9, status: q.get("files") === "read" ? "indexed" : "pending", error: null, exercises: 0, solved: 0 }, ...(q.get("files") === "mix" ? [{ sha: "a3", name: "lecture3.pdf", pages: 4, status: "indexing" as const, error: null, exercises: 0, solved: 0, done: 1, total: 4 }] : []), ...(q.get("files") === "many" ? many : [])],
  exercises: [{ sha: "b1", name: "hw1.pdf", pages: 3, status: "indexed", error: null, exercises: 5, solved: 3 }],
};
// a plan build is running: lecture2 is read by it, lecture4 was added meanwhile (waits for the next build)
const filesBuilding: FilesData = { ...files, materials: [...files.materials.map((f) => (f.status === "pending" ? { ...f, inBuild: true } : f)), { sha: "a4", name: "lecture4.pdf", pages: 3, status: "pending", error: null, exercises: 0, solved: 0 }] };
// ?files=outside: after the first list, in the folders (not through the app): lecture2.pdf deleted, outside.pdf added, lecture1.pdf renamed (keeps its scan), hw1.pdf edited (to be scanned again)
let lists = 0;
const filesOutside = (): FilesData =>
  lists++
    ? { ...files, materials: [{ ...(files.materials[0] as FileRow), name: "lecture1-final.pdf" }, { sha: "o1", name: "outside.pdf", pages: 2, status: "pending", error: null, exercises: 0, solved: 0 }], exercises: [{ sha: "b2", name: "hw1.pdf", pages: 3, status: "pending", error: null, exercises: 0, solved: 0 }] }
    : files;
const base = { language: lang, theme: "system" } as const;
const lesson: LessonData = {
  ...base, view: "lesson", number: "01040195", stageId: "S002", title: L("גבולות של סדרות", "Limits of sequences"), status: "in_progress", mastery: 40, next: { id: "S003", title: L("כלל הסנדוויץ'", "Squeeze") },
  objectives: [{ text: L("לנסח את הגדרת $\\varepsilon$-$N$", "State the $\\varepsilon$-$N$ definition"), covered: true }, { text: L("להוכיח גבול לפי ההגדרה", "Prove a limit from the definition"), covered: false }],
  criteria: { met: false, missing: [L("לפתור עוד 2 תרגילים בציון 85 לפחות", "Solve 2 more exercises with score ≥ 85")] },
};
const mcq: McqData = { ...base, view: "mcq", checkId: "c1", questionMd: L("מה נכון לגבי $a_n = 1/n$?", "Which holds for $a_n = 1/n$?"), options: ["$a_n \\to 0$", "$a_n \\to 1$", L("מתבדרת", "diverges"), L("$a_n \\to 0$ רק אם $n$ זוגי", "$a_n \\to 0$ only for even $n$")] };
const open: OpenData = { ...base, view: "open", checkId: "c2", number: "01040195", questionMd: L("הסבירו למה $\\lim 1/n = 0$.", "Explain why $\\lim 1/n = 0$.") };
const exercise: ExerciseData = {
  ...base, view: "exercise", number: "01040195", runId: "r1", difficulty: 3, statementMd: L("הוכיחו ש-$\\lim 1/n = 0$.", "Prove that $\\lim 1/n = 0$."), figures: [], hints: [], solutionMd: null, grade: null, canReveal: false, busy: null, error: null,
};
const graded: ExerciseData = {
  ...exercise, canReveal: true,
  grade: {
    legibility: "clear", illegibleParts: [], verdict: "partially_correct", score: 70, summaryMd: L("התחלה טובה, חסרה הבחירה של $N$.", "Good start, the choice of $N$ is missing."),
    steps: [{ label: L("הכנה", "Setup"), status: "correct", commentMd: L("תקין.", "Fine.") }, { label: L("בחירת N", "Choose N"), status: "missing", commentMd: L("לא נבחר $N$.", "No $N$ given.") }],
    missingForFullCredit: [L("N מפורש", "explicit N")], mistakes: [], edgeCasesMissed: [], correctedKeyStepMd: L("ניקח $N > 1/\\varepsilon$.", "Take $N > 1/\\varepsilon$."), usesMaterialBeyondCompleted: [], stageIds: ["S002"],
  },
};
const practiceBase: PracticeData = {
  ...base, view: "practice", number: "01040195", mode: "choose", units: [{ id: "U01", title: L("גבולות", "Limits") }], stages: [{ id: "S001", title: L("סדרות", "Sequences") }],
  counters: { answered: 0, correct: 0, avg: 0 }, item: null, loading: false, error: null, summary: null,
};
const mcqItem: PracticeData = { ...practiceBase, mode: "item", item: { kind: "M", questionMd: L("האם $a_n=1/n$ מתכנסת?", "Does $a_n=1/n$ converge?"), options: lang === "he" ? ["כן, ל-0", "לא", "כן, ל-1", "רק עבור $n$ זוגי"] : ["Yes, to 0", "No", "Yes, to 1", "Only for even n"], selected: null, correctIndex: null, explanationMd: null } };
const mcqDone: PracticeData = { ...mcqItem, counters: { answered: 1, correct: 0, avg: 0 }, item: { ...(mcqItem.item as Extract<PracticeData["item"], { kind: "M" }>), selected: 1, correctIndex: 0, explanationMd: L("כי $1/n \\to 0$.", "Since $1/n \\to 0$.") } };
const practiceSummary: PracticeData = { ...practiceBase, mode: "summary", summary: { items: 1, avgScore: 0, newMistakes: [L("טעות סימן", "Sign slip")], weakStages: [{ id: "S001", title: L("סדרות", "Sequences") }] } };
const practiceReply: Record<string, PracticeData> = { practice_start_request: mcqItem, practice_next_request: mcqItem, practice_answer_mcq: mcqDone, practice_end: practiceSummary, practice_state: practiceBase };
const settings: SettingsData = { ...base, view: "settings", university: "technion", dataRoot: "/Users/me/Documents/Shalav", learning: { minExercises: 2, minExerciseScore: 85, masteryThreshold: 0.85, requireAllObjectives: true, hintsBeforeSolution: 3 }, conflicts: ["courses/01040195/.shalav/events/dev1 (1).jsonl"] };
const figure: FigureData = { ...base, view: "figure", kind: "plot", source: JSON.stringify({ xDomain: [-2, 2], yDomain: [-1, 4], data: [{ fn: "x^2", label: "f" }] }), captionMd: "$f(x)=x^2$" };
const step: StepData = {
  ...base, view: "step", titleMd: L("אקסיומות הכפל", "Multiplication axioms"), figure: null, progress: { n: 2, of: 5 },
  bodyMd: `\`\`\`rows
${L("סגירות", "Closure")} | a \\cdot b \\in F
${L("קיבוציות", "Associativity")} | (a \\cdot b) \\cdot c = a \\cdot (b \\cdot c)
${L("חילופיות", "Commutativity")} | a \\cdot b = b \\cdot a
${L("איבר יחידה", "Identity")} | a \\cdot 1 = a, \\quad 1 \\neq 0
${L("איבר הופכי", "Inverse")} | a \\cdot a^{-1} = 1, \\quad a \\neq 0
${L("טרנזיטיביות", "Transitivity")} | a < b \\text{ ${L("וגם", "and")} } b < c \\Rightarrow a < c
${L("טריכוטומיה", "Trichotomy")} | \\text{${L("בדיוק אחד מהבאים:", "exactly one of:")}} a<b,\\ a=b,\\ b<a
\`\`\`

> [!definition] ${L("שדה סדור", "Ordered field")}
> ${L("שדה $F$ עם יחס $<$ כך שלכל", "A field $F$ with a relation $<$ such that for all")} $\\blue{a}, \\green{b}, \\pink{c}$: ${L("אם", "if")} $\\blue{a} < \\green{b}$ ${L("אז", "then")} $\\blue{a} + \\pink{c} < \\green{b} + \\pink{c}$.

$$
\\boxed{\\N \\subset \\Z \\subset \\Q \\subset \\R}
$$

> [!theorem] ${L("משפט", "Theorem")}
> ${L("לכל", "For every")} $a \\in F$: $0 \\cdot a = 0$.

> [!proof]
> $$
> \\begin{aligned}
> 0 \\cdot a &= (0 + 0) \\cdot a && \\text{${L("איבר אפס", "zero")}} \\\\
> &= 0 \\cdot a + 0 \\cdot a && \\text{${L("פילוג", "distributivity")}} \\\\
> &= x + x && \\text{${L("מ-", "from ")}} x = 0 \\cdot a
> \\end{aligned}
> $$`,
  sideMd: `$\\N \\subset \\Z$\n\n${L("כל טבעי הוא גם שלם.", "Every natural number is an integer.")}`,
};
const sample = ADVANCED[q.get("sample") ?? ""];
const initial: CardData = sample ? { ...step, sideMd: null, ...sample } : (({ lesson, mcq, open, figure, step, exercise, practice: practiceBase, settings } as Record<string, CardData>)[q.get("view") ?? ""] ?? home);
const said: string[] = [];
let mode = "inline";
const reqs: unknown[] = [];
let created = false; // after course_create_request the course has no plan yet
let translating = false; // ?tr=1: the plan has 12 texts not in this language; Translate starts a run
let building = false; // ?joined=1: Update plan joins a build that another chat is running
const noPlan: CourseData = { ...course, hasPlan: false, pct: 0, stagesDone: 0, stagesTotal: 0, current: null, canPractice: false, watch: [], units: [] };
// course Cm1abc (?custom=1 in Home, or made with course_custom_create): a custom course; its files have no Moodle box
const CUSTOM = "Cm1abc";
const gone = new Set<string>(); // stages deleted with plan_remove
const prune = (c: CourseData): CourseData => ({ ...c, units: c.units.map((u) => ({ ...u, stages: u.stages.filter((x) => !gone.has(x.id)) })).filter((u) => u.stages.length) });
const customize = (c: CourseData, n: unknown): CourseData => (n === CUSTOM ? { ...c, custom: true, web: { running: tools.includes("course_web_request"), level: 2 }, number: CUSTOM, name: L("תורת המוזיקה לגיטרה", "Music theory for guitar"), credits: 0 } : c);
(window as unknown as { __said: string[]; __reqs: unknown[] }).__said = said;
(window as unknown as { __reqs: unknown[] }).__reqs = reqs;
const tools: string[] = []; // every tool the card called, by name
(window as unknown as { __tools: string[] }).__tools = tools;
const host: Host = {
  callTool: async (name, args) => (tools.push(name), name === "shalav_request" && reqs.push(args), name === "course_create_request" && (created = true), name === "plan_build_request" && q.get("joined") && (building = true), name === "course_translate_request" && (translating = true), name === "plan_remove" && [args?.stageId, ...(course.units.find((u) => u.id === args?.unitId)?.stages.map((x) => x.id) ?? [])].forEach((id) => typeof id === "string" && gone.add(id)), {
    // ?stale=1: a newer card exists, so this one folds away
    structuredContent: (name === "shalav_card" ? { latest: q.get("stale") && !args?.claim ? 2 : 1 } : undefined) ?? practiceReply[name] ?? (name === "shalav_settings" ? settings : name === "settings_update" ? { ...settings, ...(args?.language ? { language: args.language } : {}), learning: { ...settings.learning, minExercises: 3 } } : undefined) ?? (name === "course_lookup" ? found : name === "shalav_home" ? home : name === "shalav_course" ? prune(customize(created || tools.includes("course_custom_create") ? noPlan : building ? { ...course, build: { state: "running", step: "plan", pending: 0 } } : { ...course, translate: { ...course.translate, running: translating } }, args?.number)) : name === "course_create_request" ? { ok: true, number: "01040195" } : name === "course_custom_create" ? { ok: true, number: CUSTOM } : name === "files_list" ? ((f: FilesData) => (args?.number === CUSTOM ? { ...f, number: CUSTOM, moodle: null } : f))(building ? filesBuilding : q.get("files") === "outside" ? filesOutside() : files) : name === "lesson_state" ? lesson : name === "stage_complete" ? { ...lesson, status: "completed_override" } : name === "stage_reopen" ? lesson : name === "check_answer" ? { selectedIndex: 1, correct: false, correctIndex: 0, explanationMd: L("כי $1/n \\to 0$.", "Since $1/n \\to 0$.") } : name === "attachment_upload" ? { files: [{ sha256: "a".repeat(64), mediaType: "image/jpeg" }] } : name === "exercise_grade_request" || name === "exercise_state" ? graded : name === "plan_build_request" ? { ok: true, joined: !!q.get("joined") } : name === "moodle_import" ? { ok: true } : name === "course_status" ? (q.get("step") === "index" ? { state: "running", step: "index", files: { scanned: 10, scanning: 2, notScanned: 20, total: 32 }, pending: 1 } : { state: "running", step: "plan", unit: { k: 1, n: 4 }, pending: 1 }) : name === "step_answer" ? { answerMd: L("כי $0$ הוא איבר נייטרלי.", "Because $0$ is neutral.") } : { ok: true }),
  }),
  say: async (t) => void said.push(t),
  context: () => ({ theme: q.get("theme") ?? undefined, availableDisplayModes: ["inline", "pip"], displayMode: mode }),
  displayMode: async (m) => (mode = m),
  subscribe: (onData) => (onData(initial), () => undefined),
};
createRoot(document.getElementById("root") as HTMLElement).render(<Cards host={host} />);
