import type { CourseJson, PlanJson, ProgressJson } from "@/domain/dataSchemas";

type Lang = "he" | "en";
const T = {
  he: {
    overall: "התקדמות כללית", of: (k: number, n: number) => `${k} מתוך ${n} שלבים הושלמו`, current: "שלב נוכחי", none: "כל השלבים הושלמו",
    gaps: "פערים", review: "נושאים לחזרה", table: "כל השלבים", cols: ["#", "שלב", "סטטוס", "שליטה"],
    status: { locked: "נעול", available: "זמין", in_progress: "בלמידה", completed: "הושלם", completed_override: "דולג" },
    skipped: "דולגו (מעבר ידני)", mistakes: "טעויות שכדאי לשים לב אליהן", times: "פעמים", stats: "תרגילים", checks: "שאלות בדיקה",
  },
  en: {
    overall: "Overall progress", of: (k: number, n: number) => `${k} of ${n} stages completed`, current: "Current stage", none: "All stages completed",
    gaps: "Gaps", review: "Topics to review", table: "All stages", cols: ["#", "Stage", "Status", "Mastery"],
    status: { locked: "Locked", available: "Available", in_progress: "In progress", completed: "Completed", completed_override: "Skipped ahead" },
    skipped: "Skipped ahead", mistakes: "Mistakes to watch out for", times: "times", stats: "Exercises", checks: "Check questions",
  },
} as const;

/** Spec 3.7: human-readable progress.md in the UI language. Deterministic (no timestamps) so unchanged content is not rewritten. */
export function renderProgressMd(course: CourseJson, plan: PlanJson, p: ProgressJson, lang: Lang): string {
  const t = T[lang];
  const title = (id: string) => plan.stages.find((s) => s.id === id)?.title ?? id;
  const L: string[] = [`# ${course.nameHe} (${course.courseNumber})`, "", `## ${t.overall}`, t.of(p.totals.stagesCompleted, p.totals.stagesTotal)];
  L.push(`${t.stats}: ${p.totals.correctAttempts}/${p.totals.attempts} · ${t.checks}: ${p.totals.correctChecks}/${p.totals.checks}`, "", `## ${t.current}`);
  const c = p.currentStageId ? p.stages[p.currentStageId] : null;
  if (p.currentStageId && c) {
    L.push(`**${p.currentStageId} — ${title(p.currentStageId)}** (${t.status[c.status]}, ${Math.round(c.mastery * 100)}%)`);
    if (c.gaps.length) L.push("", `${t.gaps}:`, ...c.gaps.map((g) => `- ${g}`));
    if (c.reviewTopics.length) L.push("", `${t.review}:`, ...c.reviewTopics.map((g) => `- ${g}`));
  } else L.push(t.none);
  L.push("", `## ${t.table}`, "", `| ${t.cols.join(" | ")} |`, "|---|---|---|---|");
  for (const s of plan.stages) {
    const sp = p.stages[s.id];
    if (sp) L.push(`| ${s.id} | ${s.title.replace(/\|/g, "\\|")} | ${t.status[sp.status]} | ${Math.round(sp.mastery * 100)}% |`);
  }
  const skipped = plan.stages.filter((s) => p.stages[s.id]?.status === "completed_override");
  if (skipped.length) L.push("", `## ${t.skipped}`, ...skipped.map((s) => `- ${s.id} — ${s.title}`));
  const open = p.mistakes.filter((m) => !m.resolved).slice(0, 10);
  if (open.length) {
    L.push("", `## ${t.mistakes}`);
    for (const m of open) L.push(`- **${lang === "he" ? m.labelHe : m.labelEn}** — ${m.count} ${t.times} (${m.stageIds.join(", ")})`);
  }
  return L.join("\n") + "\n";
}
