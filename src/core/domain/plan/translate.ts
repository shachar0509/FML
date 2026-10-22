import { z } from "zod";
import { defineTool } from "@/core/claude/tools";
import { callStructured } from "@/core/claude/structured";
import type { ClaudeGateway } from "@/core/claude/types";
import type { CourseJson, PlanJson } from "@/core/domain/dataSchemas";
import { pool } from "@/core/domain/ingest/index";
import { readJsonFile, writeJsonAtomic } from "@/core/lib/fs/atomicWrite";
import { coursePaths, join } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";

/**
 * M48: the curriculum (course name, unit and stage titles, stage summaries) shown in the settings language.
 * The plan stays in the language it was built in; translations live per course and language as `source text → text`,
 * so nothing is invalidated and after an Update plan only new or changed texts are missing.
 */
export type Lang = "he" | "en";
type Dict = Record<string, string>;
const DictSchema = z.record(z.string(), z.string());
const CHUNK = 40; // texts per job

const path = (n: string, lang: Lang) => join(coursePaths(useSettings.getState().settings.dataRoot, n).shalav, `translations.${lang}.json`);
const hebrew = /\p{Script=Hebrew}/u;
/** Already in `lang`: any Hebrew letter means Hebrew; English means none. A text with no Hebrew or Latin letters (symbols, "ε-N") passes as both. */
const inLang = (s: string, lang: Lang) => (lang === "he" ? hebrew.test(s) || !/\p{Script=Latin}/u.test(s) : !hebrew.test(s));

export const loadTranslations = async (n: string, lang: Lang): Promise<Dict> => (await readJsonFile(path(n, lang), DictSchema)) ?? {};

/** The texts a course card shows. */
export const courseTexts = (course: CourseJson, plan: PlanJson | null) => [
  course.nameHe,
  ...(plan?.units ?? []).map((u) => u.title),
  ...(plan?.stages ?? []).flatMap((s) => [s.title, s.summary]),
];

/** Shows a text in `lang`: as is when it already is, else its translation, else the original. */
export const translator = (d: Dict, lang: Lang) => (s: string) => (inLang(s, lang) ? s : d[s] ?? s);

/** Texts not in `lang` with no translation yet (each once). */
export const missing = (texts: string[], d: Dict, lang: Lang) => [...new Set(texts.filter((s) => s && !inLang(s, lang) && !(s in d)))];

/** The course's texts and their translator in one read. */
export async function localize(course: CourseJson, plan: PlanJson | null, lang: Lang) {
  const d = await loadTranslations(course.courseNumber, lang);
  return { tr: translator(d, lang), missing: missing(courseTexts(course, plan), d, lang).length };
}

export const submitTranslations = defineTool(
  "submit_translations",
  "Submit the translation of every numbered text.",
  z.object({ items: z.array(z.object({ i: z.number().int().describe("the text's number"), text: z.string().describe("its translation") })) }),
);

/** Translates the missing texts in jobs of 40 (3 at a time); each answered job is saved at once, so a stopped run keeps its part. */
export async function translateCourse(gw: ClaudeGateway, course: CourseJson, plan: PlanJson | null, lang: Lang, signal?: AbortSignal) {
  const d = await loadTranslations(course.courseNumber, lang); // one dict for all parts: each save holds every answer so far
  const todo = missing(courseTexts(course, plan), d, lang);
  const parts = Array.from({ length: Math.ceil(todo.length / CHUNK) }, (_, k) => todo.slice(k * CHUNK, (k + 1) * CHUNK));
  const to = lang === "he" ? "Hebrew" : "English";
  await pool(parts, 3, async (texts) => {
    const { value } = await callStructured(gw, submitTranslations, {
      task: "plan",
      courseNumber: course.courseNumber,
      system: "You translate university course curricula precisely.",
      messages: [{ role: "user", content: `Translate these titles and summaries of the course ${course.courseNumber} to ${to}. Keep the meaning, mathematical notation and standard academic terms of ${to}; keep each title short. Call submit_translations with every number.\n\n${texts.map((s, i) => `${i + 1}. ${s}`).join("\n")}` }],
      signal,
    });
    for (const { i, text } of value.items) {
      const src = texts[i - 1];
      if (src && text.trim()) d[src] = text.trim();
    }
    await writeJsonAtomic(path(course.courseNumber, lang), d);
  });
  return todo.length;
}
