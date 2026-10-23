import { factCheckPrompt } from "@/core/claude/prompts/facts";
import { submitFactCheck } from "@/core/claude/practiceTools";
import { callStructured } from "@/core/claude/structured";
import { listFileIndexes } from "@/core/domain/ingest/indexStore";
import { rank } from "@/core/domain/retrieval/bm25";
import type { Ctx } from "./exercises";
import { langName, type Env } from "./grade";

/**
 * M73: a grader's doubt that comes only from its own knowledge is settled by the course's own files, never by the model alone.
 * Word search (BM25) with the grader's own phrasings, so a page saying it in other words is found, plus the pages of the
 * exercise's stages (tagged by meaning at scan time); then one small check reads only those pages.
 * A page counts only if it is at least as relevant to the doubt as the pieces the grader was given (reference solution,
 * example solutions, expected points), ranked in the same call: the course page must outweigh the key it would overrule.
 */
export type Dispute = { claim: string; believed: string; points: number; finalAnswer: boolean; queries: string[] };
type Doc = { id: string; head: string; text: string; stageIds: string[] };
const PER = 4; // best pages over all files, per doubt
const STAGE = 2; // and the best ones of the exercise's stages
const CHARS = 16000;

async function docsOf(n: string): Promise<Doc[]> {
  const out: Doc[] = [];
  for (const f of await listFileIndexes(n)) {
    if (f.status !== "indexed" || f.origin === "web") continue; // Shalav's own web files are the model's knowledge coming back
    const kind = f.role === "teacher" ? "teacher's notes" : f.role === "exercises" ? "exercises and solutions" : "course material";
    for (const p of f.materialPages) out.push({ id: `${f.sha256}:p${p.page}`, head: `${f.fileName} p.${p.page} (${kind})`, text: `${p.text} ${p.summary}`, stageIds: p.stageIds });
    for (const e of f.exercises)
      out.push({ id: `${f.sha256}:${e.id}`, head: `${f.fileName}, ${e.label} (${kind})`, text: `${e.statementMd}\n${e.referenceSolutionMd ?? ""}`, stageIds: e.requiredStageIds });
  }
  return out;
}

/** The pages for one doubt: the best word matches anywhere, then the best of the exercise's stages; none below the best given piece. */
export function pagesForDispute(docs: Doc[], d: Dispute, stageIds: string[], given: string[] = []): Doc[] {
  const q = [...d.queries, d.claim, d.believed].join(" ");
  const keys = given.filter((g) => g.trim()).map((text, i) => ({ id: `given:${i}`, text }));
  const all = rank([...docs, ...keys], q);
  const bar = Math.max(0, ...all.filter((r) => r.id.startsWith("given:")).map((r) => r.score));
  const ranked = all.filter((r) => !r.id.startsWith("given:") && r.score > 0 && r.score >= bar);
  const byId = new Map(docs.map((x) => [x.id, x]));
  const st = new Set(stageIds);
  const ids = ranked.slice(0, PER).map((r) => r.id);
  for (const r of ranked.filter((r) => byId.get(r.id)?.stageIds.some((s) => st.has(s))).slice(0, STAGE)) if (!ids.includes(r.id)) ids.push(r.id);
  return ids.map((id) => byId.get(id) as Doc);
}

export type Settled = { deduct: number; finalWrong: boolean; notes: string[] };

/** Nothing found, or the pages don't settle it: no deduction (a fair grader may miss a slip; it never punishes a right answer). */
/** `given`: the pieces the grader was given as the key (see pagesForDispute). */
export async function settleDisputes(env: Env, ctx: Ctx, stageIds: string[], ds: Dispute[], given: string[] = []): Promise<Settled> {
  const none: Settled = { deduct: 0, finalWrong: false, notes: [] };
  if (!ds.length) return none;
  const docs = await docsOf(ctx.course.courseNumber);
  const parts = ds.map((d, i) => {
    let chars = 0; // an equal share per doubt, so a long first page never leaves the others without any
    const pages = pagesForDispute(docs, d, stageIds, given).filter((p, k) => (chars += p.text.length) <= CHARS / ds.length || !k);
    return { d, pages, text: `Doubt ${i + 1}: the answer says "${d.claim}"; the grader believes "${d.believed}".\n${pages.map((p) => `<page source="${p.head}">${p.text}</page>`).join("\n") || "(no matching page)"}` };
  });
  if (!parts.some((p) => p.pages.length)) return none;
  const { value } = await callStructured(env.gw, submitFactCheck, {
    task: "grading", courseNumber: ctx.course.courseNumber, system: factCheckPrompt(langName()),
    messages: [{ role: "user", content: parts.map((p) => p.text).join("\n\n") }], signal: env.signal,
  });
  const out: Settled = { deduct: 0, finalWrong: false, notes: [] };
  for (const r of value.results) {
    const p = parts[r.n - 1];
    if (!p?.pages.length) continue; // a verdict with no pages behind it is the model's own knowledge again
    if (r.verdict === "wrong") {
      out.deduct += p.d.points;
      out.finalWrong ||= p.d.finalAnswer;
      out.notes.push(`${r.note} (${r.source})`);
    } else if (r.verdict === "conflict") out.notes.push(r.note);
  }
  return out;
}
