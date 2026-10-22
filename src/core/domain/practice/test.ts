// M59 Test practice: past exam questions only, each served once ("burned"), similar follow-ups after a miss, weak concepts kept across sessions.
import * as z from "zod";
import type { IndexedExercise } from "@/core/domain/dataSchemas";
import { listFileIndexes } from "@/core/domain/ingest/indexStore";
import { readJsonFile, writeJsonAtomic } from "@/core/lib/fs/atomicWrite";
import { nowIso } from "@/core/lib/time";
import { testScopePrompt } from "@/core/claude/prompts/practice";
import { submitTestScope } from "@/core/claude/practiceTools";
import { callStructured } from "@/core/claude/structured";
import { loadCtx, paths } from "./exercises";
import { imageBlocks, stageList, type Attachment, type Env } from "./grade";

/** ponytail: exams are told apart by file name (no index-time flag); add one if real exams are named otherwise. */
export const isExam = (fileName: string) => /moed|exam|final|midterm|quiz|\btest|מועד|מבחן|בחינה|בוחן|בחן/i.test(fileName);

/** The file without its extension and a solution suffix (an exam and its `_sol` twin hold the same questions), plus the question number and part. */
export function burnKey(fileName: string, label: string) {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[\s_-]*(solutions?|sol|with[\s_-]*answers|פתרונות|פתרון)$/i, "").toLowerCase();
  const num = label.match(/\d+/)?.[0];
  if (!num) return `${base}#${label.trim()}`;
  const part = label.match(/(?:סעיף|part)\s*\(?([א-ת]{1,2}|[a-z])(?!\p{L})/iu)?.[1] ?? label.match(/\d+\s*[.)]?\s*\(?([א-ת]|[a-z])\)?(?!\p{L})/iu)?.[1] ?? "";
  return `${base}#${num}${part.toLowerCase()}`;
}

export type PoolItem = { ex: IndexedExercise; file: string; key: string };
/** One question per burn key from the indexed exam files; the copy with a solution wins. */
export function poolOf(files: { fileName: string; status: string; exercises: IndexedExercise[] }[]): PoolItem[] {
  const by = new Map<string, PoolItem>();
  for (const f of files) {
    if (f.status !== "indexed" || !isExam(f.fileName)) continue;
    for (const ex of f.exercises) {
      const key = burnKey(f.fileName, ex.label);
      const had = by.get(key);
      if (!had || (!had.ex.referenceSolutionMd && ex.referenceSolutionMd)) by.set(key, { ex, file: f.fileName, key });
    }
  }
  return [...by.values()];
}
export const examPool = async (n: string) => poolOf(await listFileIndexes(n));

const StoreSchema = z.object({
  burned: z.array(z.object({ file: z.string(), question: z.string(), key: z.string(), at: z.string() })).default([]),
  concepts: z.record(z.string(), z.object({ status: z.enum(["weak", "learned"]).nullable(), streak: z.number() })).default({}),
});
export type Store = z.infer<typeof StoreSchema>;
const file = (n: string) => `${paths(n).shalav}/test-practice.json`;
export const loadStore = async (n: string): Promise<Store> => (await readJsonFile(file(n), StoreSchema)) ?? { burned: [], concepts: {} };
export const saveStore = (n: string, s: Store) => writeJsonAtomic(file(n), s);
export const burn = (s: Store, p: PoolItem): Store => ({ ...s, burned: [...s.burned, { file: p.file, question: p.ex.label, key: p.key, at: nowIso() }] });

/** After a miss: up to 2 similar questions on the same concept (`missedId` is the exam question they're like). */
export type Chain = { stageId: string; missedId: string; left: number };
export type Note = "stern" | "weak" | "learned" | null;
export const FOLLOW_UPS = 2;
export const LEARNED_STREAK = 4;

/** The answer's effect: the concept's streak (4 perfect in a row after being weak = learned), and the follow-up chain. */
export function after(s: Store, chain: Chain | null, stageId: string, exId: string, perfect: boolean): { store: Store; chain: Chain | null; note: Note } {
  const c = s.concepts[stageId] ?? { status: null, streak: 0 };
  const streak = perfect ? c.streak + 1 : 0;
  const learned = c.status === "weak" && streak >= LEARNED_STREAK;
  const out = (status: typeof c.status, next: Chain | null, note: Note) => ({ store: { ...s, concepts: { ...s.concepts, [stageId]: { status, streak } } }, chain: next, note });
  if (perfect) return out(learned ? "learned" : c.status, null, learned ? "learned" : null);
  if (!chain) return out(c.status, { stageId, missedId: exId, left: FOLLOW_UPS }, "stern");
  if (chain.left > 1) return out(c.status, { ...chain, left: chain.left - 1 }, "stern");
  return out("weak", null, "weak");
}

/** A chosen scope: the question's own stage must be one of `primary`; what it needs may come earlier in the plan (`allowed`), not later. Null = the whole course. */
export type TestScope = { primary: Set<string>; allowed: Set<string> } | null;
export function scopeOf(stages: { id: string; order: number }[], ids: string[] | null): TestScope {
  if (!ids) return null;
  const last = Math.max(...stages.filter((s) => ids.includes(s.id)).map((s) => s.order));
  return { primary: new Set(ids), allowed: new Set(stages.filter((s) => s.order <= last).map((s) => s.id)) };
}
export const inScope = (e: IndexedExercise, sc: TestScope) => !sc || (sc.primary.has(e.primaryStageId) && e.requiredStageIds.every((x) => sc.allowed.has(x)));
const any = <T>(xs: T[], rng: () => number) => xs[Math.floor(rng() * xs.length)] ?? null;

/** The next question: the chain's concept first, else variety (not the last stages, a weak concept half the time); generate when nothing fits. */
export function pickTest(
  pool: PoolItem[], s: Store, chain: Chain | null, scope: TestScope, recent: string[], rng: () => number = Math.random,
): { pick: PoolItem } | { generate: string } | null {
  const burned = new Set(s.burned.map((b) => b.key));
  const inside = pool.filter((p) => inScope(p.ex, scope));
  const open = inside.filter((p) => !burned.has(p.key));
  if (chain) {
    const same = any(open.filter((p) => p.ex.primaryStageId === chain.stageId), rng);
    return same ? { pick: same } : { generate: chain.stageId };
  }
  const weak = new Set(Object.entries(s.concepts).filter(([, c]) => c.status === "weak").map(([id]) => id));
  if (open.length) {
    const fresh = open.filter((p) => !recent.includes(p.ex.primaryStageId));
    const from = fresh.length ? fresh : open;
    const w = from.filter((p) => weak.has(p.ex.primaryStageId));
    return { pick: (w.length && rng() < 0.5 ? any(w, rng) : any(from, rng)) as PoolItem };
  }
  // every exam question in scope is burned: a new one on a weak concept, else on a subject the exams test
  const subjects = [...new Set(inside.map((p) => p.ex.primaryStageId))];
  const stage = any(subjects.filter((x) => weak.has(x)), rng) ?? any(subjects, rng);
  return stage ? { generate: stage } : null;
}

/** The plan stages a quiz covers, read by the host model from the quiz material notes the student uploaded. */
export async function scopeFromNotes(env: Env, n: string, pages: Attachment[]): Promise<string[]> {
  const ctx = await loadCtx(n);
  const { value } = await callStructured(env.gw, submitTestScope, {
    task: "grading", courseNumber: n, system: testScopePrompt(stageList(ctx, ctx.plan.stages.map((s) => s.id))),
    messages: [{ role: "user", content: [{ type: "text", text: `${pages.length} page(s):` }, ...(await imageBlocks(env, pages))] }], signal: env.signal,
  });
  const known = new Set(ctx.plan.stages.map((s) => s.id));
  return value.stageIds.filter((s) => known.has(s));
}
