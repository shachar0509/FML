import "@fontsource/heebo/400.css";
import "@fontsource/heebo/500.css";
import "@fontsource/heebo/700.css";
import "@/index.css";
import "@/i18n";
import { createRoot } from "react-dom/client";
import { Cards } from "./Cards";
import type { CardData, CourseData, FilesData, HomeData, Host, LessonData, LookupResult, McqData, OpenData } from "./types";

/** Playwright test host: a fake bridge instead of Claude Desktop. ?lang=&theme=&empty=1 ; sent messages land in window.__said. */
const q = new URLSearchParams(location.search);
const lang = q.get("lang") === "en" ? "en" : "he";
const home: HomeData = {
  view: "home",
  language: lang,
  theme: "system",
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
  view: "files", language: lang, theme: "system", number: "01040195", hasPlan: true, canIndex: true, canImprove: true, improving: null,
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
const initial: CardData = ({ lesson, mcq, open } as Record<string, CardData>)[q.get("view") ?? ""] ?? home;
const said: string[] = [];
(window as unknown as { __said: string[] }).__said = said;
const host: Host = {
  callTool: async (name) => ({
    structuredContent: name === "course_lookup" ? found : name === "shalav_course" ? course : name === "files_list" ? files : name === "lesson_state" ? lesson : name === "stage_complete" ? { ...lesson, status: "completed_override" } : name === "stage_reopen" ? lesson : name === "check_answer" ? { selectedIndex: 1, correct: false, correctIndex: 0, explanationMd: "Since $1/n \\to 0$." } : name === "course_status" ? { state: "running", step: "plan", unit: { k: 1, n: 4 }, pending: 1 } : { ok: true },
  }),
  say: async (t) => void said.push(t),
  context: () => ({ theme: q.get("theme") ?? undefined }),
  subscribe: (onData) => (onData(initial), () => undefined),
};
createRoot(document.getElementById("root") as HTMLElement).render(<Cards host={host} />);
