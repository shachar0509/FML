import { z } from "zod";
import { callStructured } from "@/core/claude/structured";
import { lessonBriefPrompt, retrievalPrompt, webFallbackPrompt, type RetrievalReq } from "@/core/claude/prompts/retrieval";
import { submitLessonBrief, submitRetrieval } from "@/core/claude/tools";
import { toolUses, type Block, type ClaudeGateway } from "@/core/claude/types";
import { buildKnowledgeBoundary } from "@/core/domain/boundary/boundary";
import type { FileIndex, PlanJson, ProgressJson, Stage } from "@/core/domain/dataSchemas";
import { listFileIndexes } from "@/core/domain/ingest/indexStore";
import { readJsonFile, writeJsonAtomic } from "@/core/lib/fs/atomicWrite";
import { coursePaths } from "@/core/lib/fs/paths";
import { sha256Hex } from "@/core/lib/hash";
import { nowIso } from "@/core/lib/time";
import { useSettings } from "@/stores/settings";
import { rank } from "./bm25";

const PAGE_CHARS = 24000;
const FIGURE_TEXT_MAX = 400;

type Course = { courseNumber: string; nameHe: string; prerequisitesRaw: string };
type Lang = "Hebrew" | "English";
export type Coverage = "full" | "partial" | "none";
export type Page = { fileName: string; sha256: string; page: number; text: string; hasFigure: boolean };
export type Deps = {
  gw: ClaudeGateway;
  listIndexes?: (courseNumber: string) => Promise<FileIndex[]>;
  /** Image of a page; only called for figure pages with little text. */
  pageImage?: (sha256: string, page: number) => Promise<{ base64: string; mediaType: "image/jpeg" | "image/png" }>;
  now?: () => string;
  signal?: AbortSignal;
};

const materialFiles = async (d: Deps, course: Course) =>
  (await (d.listIndexes ?? listFileIndexes)(course.courseNumber)).filter((f) => f.role === "material" && f.status === "indexed");

/** Spec 9.9 steps 1-2: stage pages (else all pages), BM25-ranked, cut at 24,000 characters. */
export async function pagesFor(d: Deps, course: Course, stageIds: string[] | null, query: string): Promise<Page[]> {
  const all = (await materialFiles(d, course)).flatMap((f) =>
    f.materialPages.map((p) => ({ fileName: f.fileName, sha256: f.sha256, page: p.page, text: p.text, hasFigure: p.hasFigure, summary: p.summary, stageIds: p.stageIds })),
  );
  const mapped = stageIds ? all.filter((p) => p.stageIds.some((s) => stageIds.includes(s))) : [];
  const cand = mapped.length ? mapped : all;
  const key = (p: Page) => `${p.sha256}:${p.page}`;
  const ranked = rank(cand.map((p) => ({ id: key(p), text: `${p.text} ${p.summary}` })), query);
  const byKey = new Map(cand.map((p) => [key(p), p]));
  const out: Page[] = [];
  let chars = 0;
  for (const r of ranked) {
    const p = byKey.get(r.id) as Page;
    if (out.length && chars + p.text.length > PAGE_CHARS) break;
    out.push(p);
    chars += p.text.length;
  }
  return out;
}

const header = (p: Page) => `[${p.fileName} p.${p.page}]`;
const format = (pages: Page[]) => pages.map((p) => `${header(p)}\n${p.text}`).join("\n\n");

async function imageBlocks(d: Deps, pages: Page[]): Promise<Block[]> {
  const out: Block[] = [];
  if (!d.pageImage) return out;
  for (const p of pages.filter((x) => x.hasFigure && x.text.length < FIGURE_TEXT_MAX)) {
    const r = await d.pageImage(p.sha256, p.page);
    out.push({ type: "text", text: `Image of ${header(p)}:` }, { type: "image", source: { type: "base64", media_type: r.mediaType, data: r.base64 } });
  }
  return out;
}

const stageOf = (plan: PlanJson, id: string) => plan.stages.find((s) => s.id === id) as Stage;
const stageQuery = (s: Stage) => [...s.objectives, ...s.newConcepts, ...s.theorems.map((t) => t.name), ...s.techniques].join(" ");
const unique = (xs: string[]) => [...new Set(xs)];

export type ConsultIn = {
  course: Course; plan: PlanJson; progress: ProgressJson; stageId: string; question: string; purpose: string; lang: Lang; webSearch: boolean;
};
export type Retrieved = { answerMd: string; coverage: Coverage; sources: string[]; quotes: string[] };

/** Spec 9.9 steps 1-5. */
export async function consult(d: Deps, i: ConsultIn): Promise<Retrieved> {
  const { gw, signal } = d;
  const stage = stageOf(i.plan, i.stageId);
  const req: RetrievalReq = { question: i.question, purpose: i.purpose, stageId: stage.id, stageTitle: stage.title, lang: i.lang };
  const pages = await pagesFor(d, i.course, [stage.id], `${i.question} ${stage.title} ${stage.newConcepts.join(" ")}`);

  let res: Retrieved = { answerMd: "", coverage: "none", sources: [], quotes: [] };
  if (pages.length) {
    const content: Block[] = [{ type: "text", text: "Answer the request." }, ...(await imageBlocks(d, pages))];
    const { value } = await callStructured(gw, submitRetrieval, {
      task: "retrieval", courseNumber: i.course.courseNumber, system: retrievalPrompt(i.course, req, format(pages)),
      messages: [{ role: "user", content }], signal,
    });
    res = value;
  }
  if (res.coverage === "full" || !i.webSearch) return res;

  try {
    const boundary = buildKnowledgeBoundary({ course: i.course, plan: i.plan, progress: i.progress, currentStageId: stage.id });
    const r = await gw.send({
      task: "retrieval", courseNumber: i.course.courseNumber, system: webFallbackPrompt(boundary, res.answerMd || "(nothing)"),
      messages: [{ role: "user", content: `Request: ${i.question} (purpose: ${i.purpose}; stage ${stage.id} — ${stage.title}). Write in ${i.lang}.` }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }, submitRetrieval.def],
      toolChoice: { type: "auto" }, signal,
    });
    const call = toolUses(r).find((c) => c.name === submitRetrieval.def.name);
    const web = submitRetrieval.schema.parse(call?.input);
    return {
      answerMd: [res.answerMd, web.answerMd].filter(Boolean).join("\n\n"),
      coverage: res.coverage === "none" ? web.coverage : "partial",
      sources: unique([...res.sources, ...web.sources]),
      quotes: unique([...res.quotes, ...web.quotes]),
    };
  } catch {
    return res; // web fallback is best-effort (9.9 step 4)
  }
}

const BriefFileSchema = z.object({
  schema: z.literal(1), stageId: z.string(), hash: z.string(), planVersion: z.number(), createdAt: z.string(), model: z.string(),
  coverage: z.enum(["full", "partial", "none"]), briefMd: z.string(), sources: z.array(z.string()),
});
export type LessonBrief = z.infer<typeof BriefFileSchema>;

/** Spec 9.9 lesson brief: cached per stage + content hash. */
export async function getLessonBrief(d: Deps, i: { course: Course; plan: PlanJson; stageId: string; lang: Lang }): Promise<LessonBrief> {
  const stage = stageOf(i.plan, i.stageId);
  const files = await materialFiles(d, i.course);
  const mapped = files.filter((f) => f.materialPages.some((p) => p.stageIds.includes(stage.id)));
  const shas = (mapped.length ? mapped : files).map((f) => f.sha256).sort();
  const hash = (await sha256Hex(JSON.stringify(stage) + shas.join(""))).slice(0, 12);
  const paths = coursePaths(useSettings.getState().settings.dataRoot, i.course.courseNumber);
  const file = `${paths.briefs}/${stage.id}-${hash}.json`;
  const cached = await readJsonFile(file, BriefFileSchema);
  if (cached) return cached;

  const base = { schema: 1 as const, stageId: stage.id, hash, planVersion: i.plan.version, createdAt: (d.now ?? nowIso)() };
  const pages = await pagesFor(d, i.course, [stage.id], stageQuery(stage));
  let brief: LessonBrief;
  if (!pages.length) {
    brief = { ...base, model: "", coverage: "none", sources: [],
      briefMd: i.lang === "Hebrew" ? "לא הועלו חומרי לימוד לקורס זה." : "No course materials have been uploaded for this course." };
  } else {
    const { value, response } = await callStructured(d.gw, submitLessonBrief, {
      task: "retrieval", courseNumber: i.course.courseNumber,
      system: lessonBriefPrompt(i.course, stage.id, stage.title, JSON.stringify(stage), i.lang, format(pages)),
      messages: [{ role: "user", content: [{ type: "text", text: "Prepare the brief." }, ...(await imageBlocks(d, pages))] }], signal: d.signal,
    });
    brief = { ...base, model: response.model, ...value };
  }
  await writeJsonAtomic(file, brief);
  return brief;
}
