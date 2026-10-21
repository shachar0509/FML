import { callStructured } from "@/core/claude/structured";
import { exercisesPrompt, materialPrompt } from "@/core/claude/prompts/index";
import { submitExercises, submitMaterialPages } from "@/core/claude/tools";
import type { Block, ClaudeGateway } from "@/core/claude/types";
import type { FileIndex, IndexedExercise, PlanJson } from "@/core/domain/dataSchemas";
import { fs } from "@/core/lib/fs/fs";
import { coursePaths } from "@/core/lib/fs/paths";
import { nowIso } from "@/core/lib/time";
import { useSettings } from "@/stores/settings";
import type { Bbox, PageSource } from "./types";

export type IndexOpts = {
  gw: ClaudeGateway;
  source: PageSource;
  rec: FileIndex;
  plan: PlanJson;
  course: { courseNumber: string; nameHe: string };
  lang: "he" | "en";
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
};

const MATERIAL_BATCH = 8;
const EXERCISE_BATCH = 6; // 1-page overlap => step 5
const REQUEST_CHARS = 6000;
const RECORD_CHARS = 8000;

/** 5.3: input tokens shown in the large-file confirmation. */
export const pageTokenEstimate = (pages: number) => pages * 2200;

const planCompact = (plan: PlanJson) => plan.stages.map((s) => `${s.id} — ${s.title}`).join("\n");
const slices = <T>(xs: T[], size: number, step: number) => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += step) {
    out.push(xs.slice(i, i + size));
    if (i + size >= xs.length) break;
  }
  return out;
};

async function pageBlocks(source: PageSource, pages: number[], role: "material" | "exercises"): Promise<Block[]> {
  const out: Block[] = [];
  for (const p of pages) {
    out.push({ type: "text", text: `Page ${p}:\n${(await source.text(p)).slice(0, REQUEST_CHARS)}` });
    if (await source.imageNeeded(p, role)) {
      const r = await source.image(p);
      out.push({ type: "image", source: { type: "base64", media_type: r.mediaType, data: r.base64 } });
    }
  }
  return out;
}

const finish = (o: IndexOpts, model: string, patch: Partial<FileIndex>): FileIndex => ({
  ...o.rec, ...patch, status: "indexed", error: null, indexedAt: nowIso(), indexModel: model, planVersion: o.plan.version,
});

/** 5.6 on the given pages. Returns exercises with ids, stage ids validated and figures cropped. */
async function extract(o: IndexOpts, pages: number[], tick: () => void): Promise<{ exercises: IndexedExercise[]; model: string | null }> {
  const { gw, source, rec, plan, course } = o;
  const order = new Map(plan.stages.map((s) => [s.id, s.order]));
  const last = plan.stages[plan.stages.length - 1]?.id as string;
  const paths = coursePaths(useSettings.getState().settings.dataRoot, course.courseNumber);
  const seen = new Set<string>();
  const out: IndexedExercise[] = [];
  let model: string | null = null;

  for (const batch of slices(pages, EXERCISE_BATCH, EXERCISE_BATCH - 1)) {
    const content = await pageBlocks(source, batch, "exercises");
    const { value, response } = await callStructured(gw, submitExercises, {
      task: "index", courseNumber: course.courseNumber, system: exercisesPrompt(course, planCompact(plan)),
      messages: [{ role: "user", content }], signal: o.signal,
    });
    model = response.model;
    for (const e of value.exercises) {
      const key = `${e.label}|${e.statementMd.slice(0, 80)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const id = `${rec.sha256.slice(0, 8)}-${out.length + 1}`;
      let req = [...new Set(e.requiredStageIds)].filter((s) => order.has(s));
      if (!req.length) req = [last];
      const primaryStageId = req.reduce((a, b) => ((order.get(b) as number) > (order.get(a) as number) ? b : a));
      const figureCrops: IndexedExercise["figureCrops"] = [];
      for (const [k, f] of e.figures.entries()) {
        try {
          const bbox = f.bbox.map((n) => Math.min(1, Math.max(0, n))) as Bbox;
          const { bytes, ext } = await source.crop(f.page, bbox);
          const path = `${paths.crops}/${id}-${k + 1}.${ext}`;
          await fs().mkdir(paths.crops);
          await fs().writeBytes(path, bytes);
          figureCrops.push({ page: f.page, bbox, file: path.slice(paths.course.length + 1) });
        } catch {
          // a crop failure must not fail the exercise
        }
      }
      out.push({
        id, label: e.label, pages: e.pages, statementMd: e.statementMd, figureCrops, referenceSolutionMd: e.referenceSolutionMd,
        requiredStageIds: req, primaryStageId, difficulty: e.difficulty as IndexedExercise["difficulty"], type: e.type,
        estimatedMinutes: e.estimatedMinutes, edgeCaseFocus: e.edgeCaseFocus, gist: e.gist,
      });
    }
    tick();
  }
  return { exercises: out, model };
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

/** 5.6: role `exercises`. */
export async function indexExercises(o: IndexOpts): Promise<FileIndex> {
  const pages = range(o.source.pageCount);
  const total = slices(pages, EXERCISE_BATCH, EXERCISE_BATCH - 1).length;
  let done = 0;
  const { exercises, model } = await extract(o, pages, () => o.onProgress?.(++done, total));
  return finish(o, model ?? "", { exercises, materialPages: [] });
}

/** 5.5: role `material`, then 5.6 on pages flagged hasExercises. */
export async function indexMaterial(o: IndexOpts): Promise<FileIndex> {
  const { gw, source, plan, course, lang } = o;
  const known = new Set(plan.stages.map((s) => s.id));
  const pages = range(source.pageCount);
  const batches = slices(pages, MATERIAL_BATCH, MATERIAL_BATCH);
  let total = batches.length;
  let done = 0;
  let model = "";
  const materialPages: FileIndex["materialPages"] = [];
  const withExercises: number[] = [];

  for (const batch of batches) {
    const content = await pageBlocks(source, batch, "material");
    const { value, response } = await callStructured(gw, submitMaterialPages, {
      task: "index", courseNumber: course.courseNumber,
      system: materialPrompt(course, planCompact(plan), lang === "he" ? "Hebrew" : "English"),
      messages: [{ role: "user", content }], signal: o.signal,
    });
    model = response.model;
    for (const p of batch) {
      const r = value.pages.find((x) => x.page === p);
      materialPages.push({
        page: p, stageIds: (r?.stageIds ?? []).filter((s) => known.has(s)), summary: r?.summary ?? "", hasFigure: r?.hasFigure ?? false,
        text: (await source.text(p)).slice(0, RECORD_CHARS),
      });
      if (r?.hasExercises) withExercises.push(p);
    }
    o.onProgress?.(++done, total);
  }

  let exercises: IndexedExercise[] = [];
  if (withExercises.length) {
    total += slices(withExercises, EXERCISE_BATCH, EXERCISE_BATCH - 1).length;
    const r = await extract(o, withExercises, () => o.onProgress?.(++done, total));
    exercises = r.exercises;
    model = r.model ?? model;
  }
  return finish(o, model, { materialPages, exercises });
}
