import "@fontsource/heebo/400.css";
import "@fontsource/heebo/500.css";
import "@fontsource/heebo/700.css";
import "@/index.css";
import "@/i18n";
import { createRoot } from "react-dom/client";
import { Cards } from "./Cards";
import type { CourseData, HomeData, Host, LookupResult } from "./types";

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
const said: string[] = [];
(window as unknown as { __said: string[] }).__said = said;
const host: Host = {
  callTool: async (name) => ({
    structuredContent: name === "course_lookup" ? found : name === "shalav_course" ? course : name === "course_status" ? { state: "running", step: "plan", unit: { k: 1, n: 4 }, pending: 1 } : { ok: true },
  }),
  say: async (t) => void said.push(t),
  context: () => ({ theme: q.get("theme") ?? undefined }),
  subscribe: (onData) => (onData(home), () => undefined),
};
createRoot(document.getElementById("root") as HTMLElement).render(<Cards host={host} />);
