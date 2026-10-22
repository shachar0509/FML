import { z } from "zod";
import { LEVELS } from "@/core/claude/prompts/plan";
import { callStructured } from "@/core/claude/structured";
import { defineTool } from "@/core/claude/tools";
import type { ClaudeGateway } from "@/core/claude/types";
import type { CourseJson } from "@/core/domain/dataSchemas";
import { writeTextAtomic } from "@/core/lib/fs/atomicWrite";
import { fs } from "@/core/lib/fs/fs";
import { coursePaths, join } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";

export const submitWebMaterials = defineTool(
  "submit_web_materials",
  "Submit the study texts and exercise sets for the course, each as one Markdown document.",
  z.object({
    items: z.array(z.object({
      role: z.enum(["material", "exercises"]).describe("material = a study text; exercises = an exercise set with solutions"),
      title: z.string().describe("short title, used as the file name"),
      markdown: z.string().describe("the whole document, ending with its source URLs"),
    })),
  }),
);

/** A file name from a title: no path characters, short, never clobbering a file already there. */
async function freeName(dir: string, title: string) {
  const base = title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60).replace(/^\.+/, "") || "web";
  for (let k = 1; ; k++) {
    const name = `${base}${k > 1 ? ` (${k})` : ""}.md`;
    if (!(await fs().exists(join(dir, name)))) return name;
  }
}

/**
 * M54: the host model finds study materials and exercises on the web for a custom course, at the student's level.
 * They land as .md files in the course folders, so the card lists them at once (not scanned until the next Build / Update plan).
 */
export async function gatherWeb(gw: ClaudeGateway, course: CourseJson, lang: "he" | "en", signal?: AbortSignal) {
  const level = course.level ?? 1;
  const { value } = await callStructured(gw, submitWebMaterials, {
    task: "retrieval",
    courseNumber: course.courseNumber,
    system: "You gather high-quality study materials from the web for a self-learner.",
    messages: [{ role: "user", content: `Find study materials and practice exercises on the web for the self-study course "${course.nameHe}".
What the student wants to learn:
${course.syllabusHe}
${course.goal ? `What the student wants to achieve: ${course.goal}\n` : ""}Current level: ${level}/5 (the student ${LEVELS[level - 1]}). Pick materials that start from this level: nothing the student already knows, nothing too advanced yet.

Use web search. Prefer open university courses and lecture notes, official documentation, textbooks and reputable educational sites; never forums or unsourced blogs.
Return 3-6 study texts (role "material") that together cover the subject in a sensible order, and 1-3 exercise sets (role "exercises") with full worked solutions at the end of each set.
Each document stands on its own: write it in your own words (summarize and explain; do not copy pages), keep formulas, code and examples exact, and end it with its source URLs. Write in ${lang === "he" ? "Hebrew" : "English"}.
Call submit_web_materials with all documents.` }],
    signal,
  });
  const p = coursePaths(useSettings.getState().settings.dataRoot, course.courseNumber);
  const saved: string[] = [];
  for (const it of value.items) {
    if (!it.markdown.trim()) continue;
    const dir = it.role === "material" ? p.materials : p.exercises;
    await fs().mkdir(dir);
    const name = await freeName(dir, it.title);
    await writeTextAtomic(join(dir, name), `${it.markdown.trim()}\n`);
    saved.push(name);
  }
  return saved;
}
