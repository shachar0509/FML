import { z } from "zod";
import { LEVELS } from "@/core/claude/prompts/plan";
import { callStructured } from "@/core/claude/structured";
import { defineTool } from "@/core/claude/tools";
import type { ClaudeGateway, Message } from "@/core/claude/types";
import { PlanJsonSchema, type CourseJson, type PlanJson } from "@/core/domain/dataSchemas";
import { readJsonFile, writeTextAtomic } from "@/core/lib/fs/atomicWrite";
import { listFileIndexes } from "./indexStore";
import { fs } from "@/core/lib/fs/fs";
import { coursePaths, join } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";

export const submitWebMaterials = defineTool(
  "submit_web_materials",
  "Submit the study texts and exercise sets for the course, each as one Markdown document.",
  z.object({
    items: z.array(z.object({
      role: z.enum(["material", "exercises"]).describe("material = a study text; exercises = an exercise set with a full, fully elaborated solution to every exercise"),
      title: z.string().describe("short title, used as the file name"),
      markdown: z.string().describe("the whole document, ending with its source URLs"),
    })),
  }),
);

/** A file name from a title: no path characters, short, never clobbering a file already there. */
const safe = (title: string) => title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60).replace(/^\.+/, "") || "web";
async function freeName(dir: string, title: string) {
  const base = safe(title);
  for (let k = 1; ; k++) {
    const name = `${base}${k > 1 ? ` (${k})` : ""}.md`;
    if (!(await fs().exists(join(dir, name)))) return name;
  }
}

const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
const urls = (t: string) => new Set((t.match(/https?:\/\/[^\s)\]>"'`]+/g) ?? []).map((u) => u.replace(/[.,;:]+$/, "").replace(/\/$/, "")));
const stem = (name: string) => norm(name.replace(/\.[^.]+$/, ""));

/** What the course folders already hold, like the Moodle import's duplicate check: file names, the texts of .md files and the URLs they cite. */
async function existing(dirs: string[]) {
  const names = new Set<string>();
  const texts = new Set<string>();
  const used = new Set<string>();
  for (const dir of dirs) {
    if (!(await fs().exists(dir))) continue;
    for (const e of await fs().readDir(dir)) {
      if (!e.isFile || e.name.startsWith(".")) continue;
      names.add(stem(e.name));
      if (!e.name.toLowerCase().endsWith(".md")) continue;
      const t = await fs().readText(join(dir, e.name));
      texts.add(norm(t));
      for (const u of urls(t)) used.add(u);
    }
  }
  return { names, texts, used };
}

/**
 * Balance: with a plan, each unit gets documents so the course files cover the units evenly. A unit's coverage is its
 * scanned material pages and exercises; one new document counts as an average scanned file.
 */
export async function shares(course: string, plan: PlanJson | null, n: number) {
  if (!plan?.units.length) return [];
  const unitOf = new Map(plan.stages.map((s) => [s.id, s.unitId]));
  const have = new Map(plan.units.map((u) => [u.id, 0]));
  const recs = (await listFileIndexes(course)).filter((r) => r.status === "indexed");
  for (const r of recs)
    for (const x of [...r.materialPages.map((pg) => pg.stageIds), ...r.exercises.map((e) => e.requiredStageIds)])
      for (const u of new Set(x.map((id) => unitOf.get(id)))) if (u && have.has(u)) have.set(u, (have.get(u) ?? 0) + 1);
  const per = Math.max(1, [...have.values()].reduce((a, b) => a + b, 0) / Math.max(1, recs.length)); // ponytail: an average file's weight; per-unit weights if docs vary a lot
  const give = new Map(plan.units.map((u) => [u.id, 0]));
  for (let k = 0; k < n; k++) {
    const u = plan.units.reduce((a, b) => ((have.get(b.id) ?? 0) + (give.get(b.id) ?? 0) * per < (have.get(a.id) ?? 0) + (give.get(a.id) ?? 0) * per ? b : a));
    give.set(u.id, (give.get(u.id) ?? 0) + 1);
  }
  return plan.units.filter((u) => give.get(u.id)).map((u) => ({ id: u.id, title: u.title, have: have.get(u.id) ?? 0, docs: give.get(u.id) ?? 0, stages: u.stageIds }));
}

const ROUNDS = 3; // the first answer plus two asks for what was missing or duplicate

/**
 * M54/M55: the host model finds `count` new study materials and exercise sets on the web for a custom course, at the student's level.
 * Like the Moodle import, nothing already in the course folders is added again (same name, same text, or only sources
 * already used); missing ones are asked for again. They land as .md files, so the card lists them at once (not scanned until the next Build / Update plan).
 */
export async function gatherWeb(gw: ClaudeGateway, course: CourseJson, lang: "he" | "en", count: number, signal?: AbortSignal) {
  const level = course.level ?? 1;
  const p = coursePaths(useSettings.getState().settings.dataRoot, course.courseNumber);
  const have = await existing([p.materials, p.exercises]);
  const plan = await readJsonFile(p.planJson, PlanJsonSchema);
  const byId = new Map(plan?.stages.map((s) => [s.id, s]) ?? []);
  const units = await shares(course.courseNumber, plan, count);
  const list = (xs: Iterable<string>) => [...xs].map((x) => `- ${x}`).join("\n") || "(none)";
  const ask = `Find exactly ${count} new document(s) on the web for the self-study course "${course.nameHe}": study texts (role "material") and, for about a third of them, exercise sets with full worked solutions at the end (role "exercises").
What the student wants to learn:
${course.syllabusHe}
${course.goal ? `What the student wants to achieve: ${course.goal}\n` : ""}Current level: ${level}/5 (the student ${LEVELS[level - 1]}). Pick materials that start from this level: nothing the student already knows, nothing too advanced yet.
${units.length ? `
The course has a study plan. Spread the documents over its units as follows, so every unit ends up with a fair share of material (a unit with little material gets more):
${units.map((u) => `- ${u.id} ${u.title} (${u.have} scanned pages/exercises now): ${u.docs} document(s), about: ${u.stages.map((id) => byId.get(id)?.title).filter(Boolean).slice(0, 12).join("; ")}`).join("\n")}
` : ""}
The course folders already hold these files; do not return them again or the same content under another name:
${list(have.names)}
Sources already used (find other ones):
${list(have.used)}

Use web search. Prefer open university courses and lecture notes, official documentation, textbooks and reputable educational sites; never forums or unsourced blogs.
Each document stands on its own: write it in your own words (do not copy pages), keep formulas, code and examples exact, and end it with its source URLs. Study texts may summarize and explain.
Solutions are never summarized: write every solution in full, as the model answer a student should hand in for full credit. Every step is shown and justified (the definition, theorem or rule it uses), with the intermediate calculations and the final answer stated clearly; never skip a step, never write just the result or "similarly". The student learns to write complete answers from them. Each title is distinct. Write in ${lang === "he" ? "Hebrew" : "English"}.
Call submit_web_materials with the documents.`;

  let messages: Message[] = [{ role: "user", content: ask }];
  const saved: string[] = [];
  let skipped = 0;
  for (let round = 0; round < ROUNDS && saved.length < count; round++) {
    const { value, response } = await callStructured(gw, submitWebMaterials, { task: "retrieval", courseNumber: course.courseNumber, system: "You gather high-quality study materials from the web for a self-learner.", messages, signal });
    const dup: string[] = [];
    for (const it of value.items) {
      if (saved.length >= count) break; // never more than asked
      const text = norm(it.markdown);
      const cited = urls(it.markdown);
      const why = !text ? "empty" : have.texts.has(text) ? "same text as a file already there" : have.names.has(norm(safe(it.title))) ? "a file with this name is already there" : cited.size && [...cited].every((u) => have.used.has(u)) ? "only sources already used" : null;
      if (why) {
        dup.push(`"${it.title}": ${why}`);
        continue;
      }
      const dir = it.role === "material" ? p.materials : p.exercises;
      await fs().mkdir(dir);
      const name = await freeName(dir, it.title);
      await writeTextAtomic(join(dir, name), `${it.markdown.trim()}\n`);
      saved.push(name);
      have.names.add(norm(safe(it.title)));
      have.texts.add(text);
      for (const u of cited) have.used.add(u);
    }
    skipped += dup.length;
    const need = count - saved.length;
    if (!need) break;
    const use = response.content.find((b) => b.type === "tool_use") as { id: string } | undefined;
    const msg = `${dup.length ? `Not added (already in the course):\n${dup.join("\n")}\n` : ""}${need} more new document(s) are needed. Find ones that are not in the course yet (other topics of the shares above, other sources) and call submit_web_materials with just those.`;
    messages = [...messages, { role: "assistant", content: response.content }, { role: "user", content: use ? [{ type: "tool_result", tool_use_id: use.id, content: msg }] : msg }];
  }
  return { saved, skipped };
}
