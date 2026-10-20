import "@fontsource/heebo/400.css";
import "@fontsource/heebo/500.css";
import "@fontsource/heebo/700.css";
import "@/index.css";
import "@/i18n";
import { createRoot } from "react-dom/client";
import { Cards } from "./Cards";
import type { HomeData, Host } from "./types";

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
const said: string[] = [];
(window as unknown as { __said: string[] }).__said = said;
const host: Host = {
  callTool: async () => ({}),
  say: async (t) => void said.push(t),
  context: () => ({ theme: q.get("theme") ?? undefined }),
  subscribe: (onData) => (onData(home), () => undefined),
};
createRoot(document.getElementById("root") as HTMLElement).render(<Cards host={host} />);
