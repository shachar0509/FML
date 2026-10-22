import type { z } from "zod";
import type { submitUseCaseConventions } from "@/core/claude/tools";
import type { Convention, ConventionsFile, FileIndex, TeacherItem } from "@/core/domain/dataSchemas";
import { nodeId } from "./graph";

/**
 * M72: the deterministic rules of the conventions registry (CONVENTIONS_PLAN §4). The reconcile job only proposes;
 * every count, threshold and retirement is decided here, from ids the index itself minted.
 */
export type Occurrence = { id: string; sha: string; fileName: string; label: string; useCase: string; practice: string; stageIds: string[] };
/** an absence has no id in the index: `<sha8>-a<n>` by its position in the file's patterns.absences */
export type Absence = Occurrence;
export type TeacherCandidate = { id: string; sha: string; fileName: string; kind: "graded" | "rubric" | "remark"; item: TeacherItem };
export type Candidates = { occurrences: Occurrence[]; absences: Absence[]; teacher: TeacherCandidate[]; shas: Set<string> };

const KIND = { graded_work: "graded", rubric: "rubric", remark: "remark" } as const;

export function candidatesOf(indexes: FileIndex[]): Candidates {
  const c: Candidates = { occurrences: [], absences: [], teacher: [], shas: new Set(indexes.map((r) => r.sha256)) };
  for (const r of indexes) {
    if (r.status !== "indexed") continue;
    const sha = r.sha256, fileName = r.fileName;
    if (r.role === "teacher") {
      for (const item of r.teacherItems ?? []) c.teacher.push({ id: item.id, sha, fileName, kind: KIND[r.materialPages.find((p) => p.page === item.page)?.kind ?? "remark"], item });
    } else if (r.origin !== "web") { // web files are Shalav's own solutions: never evidence
      const stages = (label: string) => r.exercises.find((e) => e.label === label)?.requiredStageIds ?? [];
      const p = r.patterns;
      c.occurrences.push(...(p?.occurrences ?? []).map((o) => ({ ...o, sha, fileName, stageIds: stages(o.label) })));
      c.absences.push(...(p?.absences ?? []).map((a, i) => ({ ...a, id: `${sha.slice(0, 8)}-a${i + 1}`, sha, fileName, stageIds: stages(a.label) })));
    }
  }
  return c;
}

/** Sources whose file is gone are dropped; a convention left with none STAYS active (only a repeating contradictor retires it). */
export const pruneSources = (reg: ConventionsFile, shas: Set<string>): ConventionsFile =>
  ({ ...reg, conventions: reg.conventions.map((x) => ({ ...x, sources: x.sources.filter((s) => shas.has(s.sha)) })) });

export type Draft = z.output<typeof submitUseCaseConventions.schema>["conventions"][number];
export type Judged = { draft: Draft; ok: true; source: "teacher" | "solutions"; sources: Convention["sources"] } | { draft: Draft; ok: false; why: string };

/** The server rules for ONE use case; `useCaseIds` are all the item ids (occurrences, absences, teacher items) the job put in it. */
export function judgeUseCase(drafts: Draft[], useCaseIds: Set<string>, c: Candidates): Judged[] {
  const occ = new Map(c.occurrences.filter((o) => useCaseIds.has(o.id)).map((o) => [o.id, o]));
  const abs = new Set(c.absences.filter((a) => useCaseIds.has(a.id)).map((a) => a.id));
  const tch = new Map(c.teacher.filter((t) => useCaseIds.has(t.id)).map((t) => [t.id, t]));
  // an absence nobody claims never vanishes: it counts against every draft
  const claimed = new Set(drafts.flatMap((d) => [...d.explained.map((x) => x.id), ...d.unexplained]));
  const orphans = [...abs].filter((id) => !claimed.has(id));
  return drafts.map((draft): Judged => {
    const no = (why: string): Judged => ({ draft, ok: false, why });
    if (![draft.rule, draft.trigger, draft.verify].every((s) => s.trim())) return no("empty rule, trigger or verify");
    const followed = [...new Set(draft.followed)].filter((id) => occ.has(id)).map((id) => occ.get(id) as Occurrence);
    const teachers = [...new Set(draft.teacher)].filter((id) => tch.has(id)).map((id) => tch.get(id) as TeacherCandidate);
    const isTeacher = teachers.length > 0;
    if (!isTeacher) {
      const files = new Set(followed.map((o) => o.sha)).size;
      if (followed.length < 3 || files < 2) return no(`seen ${followed.length} times in ${files} files`);
      const unexplained = new Set([
        ...draft.unexplained.filter((id) => abs.has(id)),
        ...draft.explained.filter((x) => abs.has(x.id) && x.notWhen > draft.notWhen.length).map((x) => x.id),
        ...orphans,
      ]);
      if (unexplained.size * 4 > followed.length + unexplained.size) return no(`inconsistent: ${unexplained.size} of ${followed.length + unexplained.size} not followed`);
    }
    const bySha = new Map<string, Convention["sources"][number]>();
    const add = (sha: string, fileName: string, kind: Convention["sources"][number]["kind"], ref: string, quote: string) => {
      const s = bySha.get(sha);
      if (s) s.refs.push(ref);
      else bySha.set(sha, { sha, fileName, kind, refs: [ref], quote: quote.slice(0, 200) });
    };
    for (const t of teachers) add(t.sha, t.fileName, t.kind, t.id, t.item.quote);
    for (const o of followed) add(o.sha, o.fileName, "solution", o.id, o.practice);
    return { draft, ok: true, source: isTeacher ? "teacher" : "solutions", sources: [...bySha.values()] };
  });
}

/** Are the two triggers told apart by the job's labels? An overlap is fine only when the teacher's rule wins it. */
export function separable(labels: { id: string; a: boolean; b: boolean }[], a: Convention["source"], b: Convention["source"]): "ok" | "teacher-wins" | "overlap" {
  if (!labels.some((l) => l.a && l.b)) return "ok";
  return (a === "teacher") !== (b === "teacher") ? "teacher-wins" : "overlap";
}

/** X retires only when all its files are gone AND an active, repeating Y contradicts it; a solutions Y never retires a teacher X. */
export const shouldRetire = (x: Convention, y: Convention, yRepeating: boolean) =>
  x.status === "active" && x.sources.length === 0 && y.status === "active" && yRepeating && (x.source === "solutions" || (y.source === "teacher" && y.addedAt > x.addedAt));

/** Same rule text under another use case must not collide, so the trigger joins the hash on a clash. */
export function conventionId(rule: string, stageIds: string[], trigger: string, taken: Set<string>): string {
  const st = stageIds.length === 1 ? (stageIds[0] as string) : null;
  const id = nodeId(st, "convention", rule);
  return taken.has(id) ? nodeId(st, "convention", `${rule} | ${trigger}`) : id;
}

/** What the prompts and graders see: active only, the teacher's first (stable), so the teacher's rule wins where both trigger. */
export const ordered = (cs: Convention[]) => {
  const on = cs.filter((x) => x.status === "active");
  return [...on.filter((x) => x.source === "teacher"), ...on.filter((x) => x.source !== "teacher")];
};
